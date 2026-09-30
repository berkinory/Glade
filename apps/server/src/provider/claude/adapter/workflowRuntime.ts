import { FileSystem, Effect, Fiber, Duration } from "effect";
import { ClaudeAdapterLiveOptions } from "./adapterConfiguration";
import { EventId, RuntimeTaskId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  makeClaudeWorkflowRuntimeState,
  collectClaudeWorkflowRuntime,
  claudeWorkflowRuntimeSnapshots,
} from "../claudeWorkflowRuntime.ts";
import { asCanonicalTurnId, nativeProviderRefs } from "./messageContent";
import { makeClaudeRuntimeEvents } from "./runtimeEvents";

const DEFAULT_WORKFLOW_RUNTIME_POLL_INTERVAL_MS = 2_000;

const WORKFLOW_AGENTS_PROGRESS_DESCRIPTION = "Workflow agents";

export function makeClaudeWorkflowRuntime(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly options: ClaudeAdapterLiveOptions | undefined;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ReturnType<typeof makeClaudeRuntimeEvents>["offerRuntimeEvent"];
  readonly runSdkFork: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E>;
}) {
  const { fileSystem, options, makeEventStamp, offerRuntimeEvent, runSdkFork } = input;
  const resolveWorkflowScriptText = (
    context: ClaudeSessionContext,
    message: Extract<SDKMessage, { subtype: "task_started" }>,
  ): Effect.Effect<string | undefined> =>
    Effect.gen(function* () {
      if (typeof message.prompt === "string" && message.prompt.trim().length > 0) {
        return message.prompt;
      }
      const tool = message.tool_use_id
        ? Array.from(context.inFlightTools.values()).find(
            (candidate) => candidate.itemId === message.tool_use_id,
          )
        : undefined;
      if (typeof tool?.input.script === "string" && tool.input.script.trim().length > 0) {
        return tool.input.script;
      }
      if (typeof tool?.input.scriptPath === "string" && tool.input.scriptPath.length > 0) {
        return yield* fileSystem
          .readFileString(tool.input.scriptPath)
          .pipe(Effect.orElseSucceed(() => undefined));
      }
      return undefined;
    });

  const workflowRuntimePollInterval = Duration.millis(
    options?.workflowRuntimePollIntervalMs ?? DEFAULT_WORKFLOW_RUNTIME_POLL_INTERVAL_MS,
  );

  const startWorkflowRuntimePoller = (
    context: ClaudeSessionContext,
    taskId: string,
    transcriptDir: string,
  ): void => {
    if (context.workflowRuntimePollers.has(taskId)) {
      return;
    }
    const state = makeClaudeWorkflowRuntimeState();
    context.workflowRuntimeStates.set(taskId, state);
    let lastEmitted = "";
    const loop = Effect.gen(function* () {
      while (!context.stopped && context.liveWorkflowTaskIds.has(taskId)) {
        yield* Effect.sleep(workflowRuntimePollInterval);
        const changed = yield* collectClaudeWorkflowRuntime(fileSystem, transcriptDir, state);
        if (!changed) {
          continue;
        }
        const snapshots = claudeWorkflowRuntimeSnapshots(
          state,
          context.workflowAgentLabels.get(taskId) ?? [],
        );
        if (snapshots.length === 0) {
          continue;
        }
        const fingerprint = JSON.stringify(snapshots);
        if (fingerprint === lastEmitted) {
          continue;
        }
        lastEmitted = fingerprint;
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "task.progress",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          payload: {
            taskId: RuntimeTaskId.makeUnsafe(taskId),
            description: WORKFLOW_AGENTS_PROGRESS_DESCRIPTION,
            workflowAgents: snapshots,
          },
          providerRefs: nativeProviderRefs(context),
        });
      }
    });
    const fiber = runSdkFork(loop);
    context.workflowRuntimePollers.set(taskId, fiber);
    fiber.addObserver(() => {
      if (context.workflowRuntimePollers.get(taskId) === fiber) {
        context.workflowRuntimePollers.delete(taskId);
      }
    });
  };

  const stopWorkflowRuntimePoller = (
    context: ClaudeSessionContext,
    taskId: string,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      context.workflowAgentLabels.delete(taskId);

      const fiber = context.workflowRuntimePollers.get(taskId);
      if (!fiber) {
        return;
      }
      context.workflowRuntimePollers.delete(taskId);
      yield* Fiber.interrupt(fiber);
    });
  return { startWorkflowRuntimePoller, stopWorkflowRuntimePoller, resolveWorkflowScriptText };
}
