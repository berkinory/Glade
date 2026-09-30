import { type BrowserTabId } from "@glade/contracts/browser/automation/browserAutomationIds";
import {
  BROWSER_TOOL_DEFINITIONS_BY_NAME,
  stableJsonStringify,
} from "@glade/shared/browser/browserAutomationCatalogue";
import { browserInputErrorCode } from "@glade/shared/browser/browserAutomationErrors";
import { Schema } from "effect";
import { BrowserAutomationToolRequest, isToolName, raceWithAbort } from "./automationHostPolicy";
import { type BrowserAutomationHostRuntime } from "./automationHostRuntimeTypes";
import { BrowserAutomationHostError, browserHostError } from "./hostErrors";

export function createAutomationToolRequests(
  hostRuntime: Pick<
    BrowserAutomationHostRuntime,
    | "disposal"
    | "disposed"
    | "options"
    | "activeOperations"
    | "browserManager"
    | "withLock"
    | "dispatch"
    | "sessionRegistry"
  >,
) {
  function dispose(): Promise<void> {
    if (hostRuntime.disposal) return hostRuntime.disposal;
    hostRuntime.disposed = true;
    hostRuntime.disposal = (async () => {
      await Promise.allSettled(hostRuntime.activeOperations);
    })();
    return hostRuntime.disposal;
  }

  async function waitForIdle(): Promise<void> {
    while (hostRuntime.activeOperations.size > 0)
      await Promise.allSettled(hostRuntime.activeOperations);
  }

  async function executeTool(request: BrowserAutomationToolRequest): Promise<unknown> {
    if (hostRuntime.disposed) {
      browserHostError({
        code: "BrowserHostUnavailable",
        retryable: true,
        phase: "routing",
        effectMayHaveCommitted: false,
      });
    }
    if (!isToolName(request.name)) {
      browserHostError({
        code: "BrowserInputUnsupported",
      });
    }
    const definition = BROWSER_TOOL_DEFINITIONS_BY_NAME[request.name];
    if (
      request.name !== "browser_status" &&
      request.name !== "browser_tabs" &&
      (hostRuntime.browserManager.isAnnotationInteractive(request.threadId) ||
        hostRuntime.browserManager.isHumanBrowserOperationActive())
    ) {
      throw new BrowserAutomationHostError({
        code: "BrowserInterruptedByHuman",
        retryable: true,
        phase: "runtime",
        effectMayHaveCommitted: false,
      });
    }
    let input: Record<string, unknown>;
    try {
      input = Schema.decodeUnknownSync(definition.input as never)(request.arguments) as Record<
        string,
        unknown
      >;
    } catch {
      browserHostError({ code: browserInputErrorCode(request.arguments) });
    }
    const affinity = hostRuntime.sessionRegistry.bindSession(request);
    const timeoutMs =
      typeof input.timeoutMs === "number" ? input.timeoutMs : definition.defaultTimeoutMs;
    const queuedTimeoutError = new BrowserAutomationHostError({
      code: "BrowserTimeout",
      retryable: true,
      phase: "queue",
      effectMayHaveCommitted: false,
    });
    const runtimeTimeoutError = new BrowserAutomationHostError({
      code: "BrowserTimeout",
      retryable: true,
      phase: "runtime",
      effectMayHaveCommitted: !definition.annotations.readOnlyHint,
    });
    const cancellationError = new BrowserAutomationHostError({
      code: "BrowserCancelled",
      retryable: true,
      phase: "runtime",
      effectMayHaveCommitted: !definition.annotations.readOnlyHint,
    });
    const controller = new AbortController();
    let actionStarted = false;
    const abortForTimeout = () =>
      controller.abort(actionStarted ? runtimeTimeoutError : queuedTimeoutError);
    const abortForRequest = () =>
      controller.abort(
        request.signal?.reason instanceof BrowserAutomationHostError
          ? request.signal.reason
          : cancellationError,
      );
    const interruptByHuman = (error: BrowserAutomationHostError) => controller.abort(error);
    request.signal?.addEventListener("abort", abortForRequest, { once: true });
    if (request.signal?.aborted) abortForRequest();
    const requestedTabId = typeof input.tabId === "string" ? input.tabId : affinity.tabId;
    const unsubscribeHumanControl =
      request.name === "browser_status" || request.name === "browser_tabs"
        ? undefined
        : hostRuntime.browserManager.subscribeAutomationHumanControl(request.threadId, () => {
            interruptByHuman(
              new BrowserAutomationHostError({
                code: "BrowserInterruptedByHuman",
                retryable: true,
                phase: "runtime",
                effectMayHaveCommitted: !definition.annotations.readOnlyHint,
                ...(requestedTabId ? { tabId: requestedTabId as BrowserTabId } : {}),
              }),
            );
          });

    const run = (): Promise<unknown> => {
      const operation = (async () => {
        try {
          return await hostRuntime.withLock(
            `session:${request.sessionId}`,
            () =>
              hostRuntime.dispatch(
                request,
                input,
                affinity,
                controller.signal,
                runtimeTimeoutError,
                interruptByHuman,
                () => (actionStarted = true),
              ),
            controller.signal,
            queuedTimeoutError,
          );
        } catch (error) {
          if (error instanceof BrowserAutomationHostError) throw error;
          throw new BrowserAutomationHostError({
            code: "BrowserMalformedResponse",
            retryable: false,
            phase: "runtime",
            effectMayHaveCommitted: !definition.annotations.readOnlyHint,
          });
        }
      })();
      hostRuntime.activeOperations.add(operation);
      void operation.then(
        () => hostRuntime.activeOperations.delete(operation),
        () => hostRuntime.activeOperations.delete(operation),
      );
      return operation;
    };
    const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : null;
    const intentionArguments = { ...input };

    delete intentionArguments.timeoutMs;
    const fingerprint = stableJsonStringify({
      name: request.name,
      threadId: request.threadId,
      arguments: intentionArguments,
    });
    const operation = idempotencyKey
      ? hostRuntime.sessionRegistry.runIdempotent(
          `${request.sessionId}:${idempotencyKey}`,
          fingerprint,
          !definition.annotations.readOnlyHint,
          affinity,
          run,
        )
      : run();

    const timer = setTimeout(abortForTimeout, timeoutMs);
    try {
      const rawOutput = await raceWithAbort(operation, controller.signal, queuedTimeoutError);
      let output = hostRuntime.options.vault?.redact(rawOutput) ?? rawOutput;
      if (
        request.name === "browser_run" &&
        output &&
        typeof output === "object" &&
        "value" in output
      ) {
        output = {
          ...output,
          serializedByteCount: Buffer.byteLength(JSON.stringify(output.value), "utf8"),
        };
      }
      try {
        return Schema.decodeUnknownSync(definition.hostOutput as never)(output);
      } catch {
        throw new BrowserAutomationHostError({
          code: "BrowserMalformedResponse",
          retryable: false,
          phase: "runtime",
          effectMayHaveCommitted: !definition.annotations.readOnlyHint,
        });
      }
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abortForRequest);
      unsubscribeHumanControl?.();
    }
  }

  return { dispose, waitForIdle, executeTool };
}
