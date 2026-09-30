import { makeClaudeInteractionSettlement } from "./interactionSettlement";
import { makeClaudeTurnCompletion } from "./turnCompletion";
import { makeClaudeWorkflowRuntime } from "./workflowRuntime";
import { makeClaudeRuntimeEvents } from "./runtimeEvents";
import { makeClaudeProcessOwnership } from "./processOwnership";
import { Effect, Queue, Fiber, Deferred, Exit } from "effect";
import { EventId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, ClaudeStopSessionOptions, PROVIDER } from "./sessionTypes";
import { ProviderAdapterProcessError } from "../../core/Errors.ts";
import { cancelAgentGatewayTurn } from "../../../agentGateway/sessionLease.ts";

export function makeClaudeSessionTeardown(input: {
  readonly settlePendingHumanInteractions: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingHumanInteractions"];
  readonly completeTurn: ReturnType<typeof makeClaudeTurnCompletion>["completeTurn"];
  readonly stopWorkflowRuntimePoller: ReturnType<
    typeof makeClaudeWorkflowRuntime
  >["stopWorkflowRuntimePoller"];
  readonly emitRuntimeError: ReturnType<typeof makeClaudeRuntimeEvents>["emitRuntimeError"];
  readonly teardownClaudeProcess: ReturnType<
    typeof makeClaudeProcessOwnership
  >["teardownClaudeProcess"];
  readonly nowIso: Effect.Effect<string>;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ReturnType<typeof makeClaudeRuntimeEvents>["offerRuntimeEvent"];
  readonly sessions: Map<ThreadId, ClaudeSessionContext>;
}) {
  const {
    settlePendingHumanInteractions,
    completeTurn,
    stopWorkflowRuntimePoller,
    emitRuntimeError,
    teardownClaudeProcess,
    nowIso,
    makeEventStamp,
    offerRuntimeEvent,
    sessions,
  } = input;
  const performStopSessionInternal = (
    context: ClaudeSessionContext,
    options?: ClaudeStopSessionOptions,
  ): Effect.Effect<void, ProviderAdapterProcessError> =>
    Effect.gen(function* () {
      context.stopped = true;
      yield* cancelAgentGatewayTurn(context.gatewaySessionLease, context.turnState?.turnId);
      context.gatewaySessionLease?.release();

      yield* settlePendingHumanInteractions(context, { type: "session" });

      for (const run of context.subagentRuns.values()) {
        if (run.context.turnState) {
          yield* completeTurn(run.context, "interrupted", "Session stopped.");
        }
      }
      context.subagentRuns.clear();
      context.pendingSubagentSteers.clear();
      context.pendingSubagentStops.clear();

      for (const taskId of Array.from(context.workflowRuntimePollers.keys())) {
        yield* stopWorkflowRuntimePoller(context, taskId);
      }
      context.liveWorkflowTaskIds.clear();
      context.knownWorkflowTaskIds.clear();

      if (context.turnState) {
        yield* completeTurn(context, "interrupted", "Session stopped.");
      }

      yield* Queue.shutdown(context.promptQueue);

      const streamFiber = context.streamFiber;
      context.streamFiber = undefined;
      if (
        options?.interruptStream !== false &&
        streamFiber &&
        streamFiber.pollUnsafe() === undefined
      ) {
        yield* Fiber.interrupt(streamFiber);
      }

      // @effect-diagnostics-next-line tryCatchInEffectGen:off
      try {
        context.query.close();
      } catch (cause) {
        yield* emitRuntimeError(context, "Failed to close Claude runtime query.", cause);
      }

      yield* teardownClaudeProcess(context.session.threadId, context.processOwner);

      const updatedAt = yield* nowIso;
      context.session = {
        ...context.session,
        status: "closed",
        activeTurnId: undefined,
        updatedAt,
      };

      if (options?.emitExitEvent !== false) {
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "session.exited",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          payload: {
            reason: "Session stopped",
            exitKind: "graceful",
          },
          providerRefs: {},
        });
      }

      if (sessions.get(context.session.threadId) === context) {
        sessions.delete(context.session.threadId);
      }
    });

  const stopSessionInternal = (
    context: ClaudeSessionContext,
    options?: ClaudeStopSessionOptions,
  ): Effect.Effect<void, ProviderAdapterProcessError> =>
    Effect.suspend(() => {
      if (context.stopDeferred) {
        return Deferred.await(context.stopDeferred);
      }
      const stopDeferred = Deferred.makeUnsafe<void, ProviderAdapterProcessError>();
      context.stopDeferred = stopDeferred;
      return performStopSessionInternal(context, options).pipe(
        Effect.onExit((exit) =>
          Deferred.done(stopDeferred, exit).pipe(
            Effect.andThen(
              Exit.isFailure(exit)
                ? Effect.sync(() => {
                    if (context.stopDeferred === stopDeferred) {
                      delete context.stopDeferred;
                    }
                  })
                : Effect.void,
            ),
            Effect.asVoid,
          ),
        ),
      );
    });
  return { stopSessionInternal };
}
