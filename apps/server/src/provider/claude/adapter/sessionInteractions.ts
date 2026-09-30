import { Duration, Effect, Option } from "effect";
import { PROVIDER, PendingUserInputResult } from "./sessionTypes";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { type ServerConfigShape } from "../../../server/config.ts";
import { makeClaudeInteractionSettlement } from "./interactionSettlement";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { toRequestError } from "./streamErrors";
import { withAgentGatewayTurnCancellation } from "../../../agentGateway/sessionLease.ts";
import { ProviderAdapterRequestError } from "../../core/Errors.ts";
import { buildFileAttachmentsPromptBlock } from "../../core/attachmentProjection.ts";
import type { ClaudeSessionAccessShape } from "../../Services/ClaudeSessionAccess.ts";

// The SDK's interrupt resolves only once the CLI acknowledges it; a wedged CLI would otherwise
// stall the caller (and the provider command reactor) forever.
const CLAUDE_INTERRUPT_TIMEOUT = Duration.seconds(10);

export function makeClaudeSessionInteractions(input: {
  readonly requireSession: ClaudeSessionAccessShape["requireSession"];
  readonly serverConfig: ServerConfigShape;
  readonly snapshotThread: ClaudeRuntimeEventsShape["snapshotThread"];
  readonly settlePendingApproval: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingApproval"];
  readonly settlePendingUserInput: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingUserInput"];
}): {
  readonly interruptTurn: NonNullable<ClaudeAdapterShape["interruptTurn"]>;
  readonly stopTask: NonNullable<ClaudeAdapterShape["stopTask"]>;
  readonly backgroundTask: NonNullable<ClaudeAdapterShape["backgroundTask"]>;
  readonly steerSubagent: NonNullable<ClaudeAdapterShape["steerSubagent"]>;
  readonly readThread: NonNullable<ClaudeAdapterShape["readThread"]>;
  readonly respondToRequest: NonNullable<ClaudeAdapterShape["respondToRequest"]>;
  readonly respondToUserInput: NonNullable<ClaudeAdapterShape["respondToUserInput"]>;
} {
  const {
    requireSession,
    serverConfig,
    snapshotThread,
    settlePendingApproval,
    settlePendingUserInput,
  } = input;
  const interruptTurn: ClaudeAdapterShape["interruptTurn"] = (threadId, turnId, providerThreadId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);

      if (providerThreadId !== undefined) {
        if (context.settledSubagentToolUseIds.has(providerThreadId)) {
          return;
        }
        const taskId = context.subagentRuns.get(providerThreadId)?.taskId;
        const stopChild =
          taskId === undefined
            ? Effect.sync(() => {
                context.pendingSubagentStops.add(providerThreadId);
              })
            : Effect.tryPromise({
                try: () => context.query.stopTask(taskId),
                catch: (cause) => toRequestError(threadId, "turn/interrupt", cause),
              });
        // Revoke the shared bearer before either asynchronous stop can yield so a delayed request cannot
        // inherit authority from the following turn.
        yield* withAgentGatewayTurnCancellation(
          context.gatewaySessionLease,
          context.turnState?.turnId,
          stopChild,
        );
        return;
      }

      if (turnId !== undefined && turnId !== context.turnState?.turnId) {
        yield* Effect.logWarning("claude.stale_interrupt_ignored", {
          threadId,
          requestedTurnId: turnId,
          activeTurnId: context.turnState?.turnId,
        });
        return;
      }
      const activeTurnId = turnId ?? context.turnState?.turnId;
      if (activeTurnId) {
        context.interruptRequestedTurnId = activeTurnId;
      }
      const acknowledged = yield* withAgentGatewayTurnCancellation(
        context.gatewaySessionLease,
        activeTurnId,
        Effect.tryPromise({
          try: () => context.query.interrupt(),
          catch: (cause) => toRequestError(threadId, "turn/interrupt", cause),
        }).pipe(Effect.timeoutOption(CLAUDE_INTERRUPT_TIMEOUT)),
      );
      if (Option.isNone(acknowledged)) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "turn/interrupt",
          detail: `The Claude CLI did not acknowledge the interrupt within ${Duration.toMillis(
            CLAUDE_INTERRUPT_TIMEOUT,
          )}ms.`,
        });
      }
    });

  const stopTask: ClaudeAdapterShape["stopTask"] = (threadId, taskId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      yield* Effect.tryPromise({
        try: () => context.query.stopTask(taskId),
        catch: (cause) => toRequestError(threadId, "task/stop", cause),
      });
    });

  const backgroundTask: ClaudeAdapterShape["backgroundTask"] = (threadId, toolUseId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      yield* Effect.tryPromise({
        try: () => context.query.backgroundTasks(toolUseId).then(() => undefined),
        catch: (cause) => toRequestError(threadId, "task/background", cause),
      });
    });

  const steerSubagent: ClaudeAdapterShape["steerSubagent"] = (threadId, providerThreadId, input) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      if (!context.subagentRuns.has(providerThreadId)) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "turn/steerSubagent",
          detail: `Subagent '${providerThreadId}' already finished; the message was not delivered.`,
        });
      }

      const attachmentsBlock = buildFileAttachmentsPromptBlock({
        attachments: input.attachments,
        attachmentsDir: serverConfig.attachmentsDir,
        include: "all-files",
        includeImage: () => true,
      });
      const message = [input.input, attachmentsBlock]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join("\n\n");
      const pending = context.pendingSubagentSteers.get(providerThreadId) ?? [];
      pending.push(message);
      context.pendingSubagentSteers.set(providerThreadId, pending);
    });

  const readThread: ClaudeAdapterShape["readThread"] = (threadId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      return yield* snapshotThread(context);
    });

  const respondToRequest: ClaudeAdapterShape["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const pending = context.pendingApprovals.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "item/requestApproval/decision",
          detail: `Unknown pending approval request: ${requestId}`,
        });
      }

      const settledDecision = yield* settlePendingApproval(context, requestId, pending, decision);
      if (settledDecision !== decision) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "item/requestApproval/decision",
          detail: `Approval request ${requestId} was already resolved as ${settledDecision}.`,
        });
      }
    });

  const respondToUserInput: ClaudeAdapterShape["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const pending = context.pendingUserInputs.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "item/tool/respondToUserInput",
          detail: `Unknown pending user-input request: ${requestId}`,
        });
      }

      const submittedResult: PendingUserInputResult = {
        answers,
        cancelled: false,
      };
      const settledResult = yield* settlePendingUserInput(
        context,
        requestId,
        pending,
        submittedResult,
      );
      if (settledResult !== submittedResult) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "item/tool/respondToUserInput",
          detail: `User-input request ${requestId} was already resolved.`,
        });
      }
    });
  return {
    interruptTurn,
    stopTask,
    backgroundTask,
    steerSubagent,
    readThread,
    respondToRequest,
    respondToUserInput,
  };
}
