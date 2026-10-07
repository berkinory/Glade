import type { ServiceMap } from "effect";
import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";
import type { OrchestrationThreadShell } from "@glade/contracts/orchestration/threadEntities";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { Effect, Cause } from "effect";
import { makeProviderThreadProjection } from "./threadProjection";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { QueuedTurnPromotionRepository } from "../../persistence/Services/QueuedTurnPromotions.ts";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import {
  runBoundedProviderCall,
  PROVIDER_COMMAND_INTERRUPT_TIMEOUT,
  PROVIDER_COMMAND_STOP_TIMEOUT,
} from "./providerCallPolicy";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import { DEFAULT_RUNTIME_MODE } from "./contextLifecycle";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";
import { PendingInterruptEscalation } from "./runtimeState";
import { QueuedDispatchState } from "../Services/QueuedDispatchState.ts";
import { makeProviderContextBootstrap } from "./contextBootstrap";

export function makeProviderTaskControl(input: {
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly appendProviderFailureActivity: ReturnType<
    typeof makeProviderThreadProjection
  >["appendProviderFailureActivity"];
  readonly settleInterruptedProviderTurn: ReturnType<
    typeof makeProviderThreadProjection
  >["settleInterruptedProviderTurn"];
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
  readonly queuedTurnPromotions: ServiceMap.Service.Shape<typeof QueuedTurnPromotionRepository>;
  readonly threadSessionSettings: ServiceMap.Service.Shape<typeof ThreadSessionSettings>;
  readonly queuedDispatchState: ServiceMap.Service.Shape<typeof QueuedDispatchState>;
  readonly clearPendingContextBootstraps: ReturnType<
    typeof makeProviderContextBootstrap
  >["clearPendingContextBootstraps"];
  readonly pendingInterruptEscalations: Map<string, PendingInterruptEscalation>;
  readonly suppressContextBootstrapOnNextStartThreadIds: Set<string>;
  readonly setThreadSession: ReturnType<typeof makeProviderThreadProjection>["setThreadSession"];
}) {
  const {
    appendProviderFailureActivity,
    settleInterruptedProviderTurn,
    providerService,
    queuedTurnPromotions,
    threadSessionSettings,
    queuedDispatchState,
    clearPendingContextBootstraps,
    pendingInterruptEscalations,
    suppressContextBootstrapOnNextStartThreadIds,
    setThreadSession,

    projectionAccess,
    projectionSnapshotQuery,
  } = input;

  const {
    resolveThread,
    resolveProviderSessionThread,
    hasLiveProviderTurn,
    resolveSubagentProviderThreadId,
    resolveLiveProviderTurnId,
  } = projectionAccess;
  const readActiveNativeChildren = Effect.fnUntraced(function* (ownerId: ThreadId) {
    const children = yield* projectionSnapshotQuery.listChildThreadShells(ownerId);
    return children.filter(
      (child) =>
        resolveSubagentProviderThreadId(child.id, ownerId) !== undefined &&
        child.session?.activeTurnId !== null &&
        child.session?.status === "running",
    );
  });
  const settleStoppedNativeChildren = Effect.fnUntraced(function* (
    children: ReadonlyArray<OrchestrationThreadShell>,
    createdAt: string,
  ) {
    for (const child of children) {
      if (!child.session) continue;
      // Teardown proves these native turns ended; a later child update must survive this settlement.
      yield* setThreadSession({
        threadId: child.id,
        expectedSession: child.session,
        session: {
          ...child.session,
          status: "interrupted",
          activeTurnId: null,
          updatedAt: createdAt,
        },
        createdAt,
      });
    }
  });
  const interruptProviderTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId?: TurnId | undefined;
    readonly createdAt: string;
    readonly intentionalQuit?: boolean;
  }) {
    const thread = yield* resolveThread(input.threadId);
    const providerThread = yield* resolveProviderSessionThread(input.threadId);
    if (!thread) {
      return;
    }

    const interruptSession = thread.session;
    if (
      interruptSession !== null &&
      (interruptSession.status === "starting" || interruptSession.status === "running") &&
      interruptSession.activeTurnId === null &&
      thread.latestTurn?.state !== "running" &&
      !(yield* hasLiveProviderTurn(input.threadId))
    ) {
      return yield* processThreadSessionStop({
        threadId: input.threadId,
        createdAt: input.createdAt,
      });
    }

    const reportInterruptFailure = (detail: string, settlementStatus?: "uncertain") =>
      appendProviderFailureActivity({
        threadId: input.threadId,
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        detail,
        turnId: input.turnId ?? null,
        createdAt: input.createdAt,
        ...(settlementStatus ? { settlementStatus } : {}),
      });

    if (!providerThread || !providerThread.session || providerThread.session.status === "stopped") {
      if (
        input.intentionalQuit &&
        providerThread?.session?.status === "stopped" &&
        providerThread.session.activeTurnId === null &&
        providerThread.session.lastError === null
      ) {
        return;
      }
      yield* reportInterruptFailure("No active provider session is bound to this thread.");

      return yield* settleInterruptedProviderTurn({
        threadId: input.threadId,
        createdAt: input.createdAt,
      });
    }

    const providerThreadId = resolveSubagentProviderThreadId(thread.id, providerThread.id);
    const liveTurnId = yield* resolveLiveProviderTurnId(input.threadId);
    const turnId = liveTurnId ?? input.turnId ?? thread.session?.activeTurnId ?? undefined;
    const children = providerThreadId ? [] : yield* readActiveNativeChildren(providerThread.id);
    const result = yield* runBoundedProviderCall({
      label: "The provider interrupt",
      timeout: PROVIDER_COMMAND_INTERRUPT_TIMEOUT,
      call: providerService.interruptTurn({
        threadId: providerThread.id,
        ...(turnId ? { turnId } : {}),
        ...(providerThreadId ? { providerThreadId } : {}),
      }),
    });
    if (result._tag === "ok") {
      yield* settleStoppedNativeChildren(children, input.createdAt);
      return;
    }

    if (input.intentionalQuit) {
      const settled = (yield* resolveProviderSessionThread(input.threadId))?.session;
      if (
        settled?.status === "stopped" &&
        settled.activeTurnId === null &&
        settled.lastError === null
      ) {
        return;
      }
    }

    if (result._tag === "timeout" || result.outcome._tag === "uncertain") {
      const detail =
        result._tag === "timeout"
          ? `${result.detail} Stopping the provider session to settle the turn.`
          : `${result.outcome.detail}\nStopping the provider session to settle the turn.`;
      yield* reportInterruptFailure(detail, "uncertain");
      return yield* processThreadSessionStop({
        threadId: input.threadId,
        createdAt: input.createdAt,
        interruptEscalated: true,
      });
    }

    // Terminal rejections (validation and friends) would otherwise vanish silently and leave the stop
    // button looking dead; surface them on the thread and settle locally, since the provider never
    // accepted the request.
    if (result.outcome._tag === "rejected") {
      yield* reportInterruptFailure(result.outcome.detail);
      return yield* settleInterruptedProviderTurn({
        threadId: input.threadId,
        createdAt: input.createdAt,
      });
    }

    return yield* Effect.failCause(result.cause);
  });

  const processTurnInterruptRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-interrupt-requested" }>,
  ) {
    yield* interruptProviderTurn({
      threadId: event.payload.threadId,
      turnId: event.payload.turnId,
      createdAt: event.payload.createdAt,
      intentionalQuit: event.commandId?.startsWith("quit-resume-interrupt:") === true,
    });
  });

  const processTaskStopRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.task-stop-requested" }>,
  ) {
    const providerThread = yield* resolveProviderSessionThread(event.payload.threadId);
    const hasSession = providerThread?.session && providerThread.session.status !== "stopped";
    if (!providerThread || !hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.task.stop.failed",
        summary: "Provider task stop failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
      });
    }

    yield* providerService
      .stopTask({
        threadId: providerThread.id,
        taskId: event.payload.taskId,
      })
      .pipe(
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.task.stop.failed",
            summary: "Provider task stop failed",
            detail: Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
          }),
        ),
      );
  });

  const processTaskBackgroundRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.task-background-requested" }>,
  ) {
    const providerThread = yield* resolveProviderSessionThread(event.payload.threadId);
    const hasSession = providerThread?.session && providerThread.session.status !== "stopped";
    if (!providerThread || !hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.task.background.failed",
        summary: "Provider task background failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
      });
    }

    yield* providerService
      .backgroundTask({
        threadId: providerThread.id,
        toolUseId: event.payload.toolUseId,
      })
      .pipe(
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.task.background.failed",
            summary: "Provider task background failed",
            detail: Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
          }),
        ),
      );
  });

  const processThreadSessionStop = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly createdAt: string;
    readonly interruptEscalated?: boolean;
  }) {
    const thread = yield* resolveThread(input.threadId);
    const providerThread = yield* resolveProviderSessionThread(input.threadId);
    if (!thread) {
      return;
    }

    const stoppedSessionThreadId = providerThread?.id ?? thread.id;
    const stopsProviderSession = providerThread === null || providerThread.id === thread.id;
    const clearedQueuedThreadIds = new Set<ThreadId>([thread.id]);
    if (stopsProviderSession) {
      for (const queuedThreadId of yield* queuedTurnPromotions.listPendingThreadIds) {
        const queuedThread = ThreadId.makeUnsafe(queuedThreadId);
        const queuedProviderThread = yield* resolveProviderSessionThread(queuedThread);
        if ((queuedProviderThread?.id ?? queuedThread) === stoppedSessionThreadId) {
          clearedQueuedThreadIds.add(queuedThread);
        }
      }
    }
    for (const queuedThreadId of clearedQueuedThreadIds) {
      yield* queuedTurnPromotions.cancelThread({
        threadId: queuedThreadId,
        updatedAt: input.createdAt,
      });
      threadSessionSettings.clearEditResendStartsForThread(queuedThreadId);
      queuedDispatchState.endDrain(queuedThreadId);
    }

    queuedDispatchState.clearStopped(
      stoppedSessionThreadId,
      stopsProviderSession,
      Array.from(clearedQueuedThreadIds),
    );
    clearPendingContextBootstraps(thread.id);
    if (input.interruptEscalated) {
      pendingInterruptEscalations.set(thread.id, { evidence: null });
    } else {
      pendingInterruptEscalations.delete(thread.id);
    }
    suppressContextBootstrapOnNextStartThreadIds.add(thread.id);
    const providerThreadId =
      providerThread !== null
        ? resolveSubagentProviderThreadId(thread.id, providerThread.id)
        : undefined;
    const isChildProviderRuntime =
      providerThread !== null && providerThread.id !== thread.id && providerThreadId !== undefined;

    if (
      isChildProviderRuntime &&
      thread.session &&
      thread.session.status === "running" &&
      thread.session.activeTurnId !== null &&
      providerThread.session &&
      providerThread.session.status !== "stopped"
    ) {
      const childInterrupt = yield* runBoundedProviderCall({
        label: "The provider interrupt",
        timeout: PROVIDER_COMMAND_INTERRUPT_TIMEOUT,
        call: providerService.interruptTurn({
          threadId: providerThread.id,
          turnId: thread.session.activeTurnId,
          providerThreadId,
        }),
      });
      if (childInterrupt._tag !== "ok") {
        const detail =
          childInterrupt._tag === "timeout" ? childInterrupt.detail : childInterrupt.outcome.detail;
        yield* appendProviderFailureActivity({
          threadId: thread.id,
          kind: "provider.turn.interrupt.failed",
          summary: "Provider turn interrupt failed",
          detail,
          turnId: thread.session.activeTurnId,
          createdAt: input.createdAt,
          settlementStatus: "uncertain",
        });

        yield* settleInterruptedProviderTurn({
          threadId: thread.id,
          createdAt: input.createdAt,
        });
        return;
      }

      yield* setThreadSession({
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "interrupted",
          providerName: thread.session.providerName ?? null,
          runtimeMode: thread.session.runtimeMode ?? DEFAULT_RUNTIME_MODE,

          activeTurnId: thread.session.activeTurnId,
          lastError: null,
          updatedAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });
      return;
    }

    const ownsProviderSession = providerThread !== null && providerThread.id === thread.id;
    if (thread.session && thread.session.status !== "stopped" && ownsProviderSession) {
      // A stop that cannot finish must still settle the projection: the session row below is the only
      // thing that releases the turn in the UI.
      if (!providerService.stopRuntimeSession) {
        yield* Effect.logWarning(
          "provider command reactor skipped session stop: stopRuntimeSession is unavailable",
          { threadId: thread.id },
        );
        yield* appendProviderFailureActivity({
          threadId: thread.id,
          kind: "provider.session.stop.failed",
          summary: "Provider session stop failed",
          detail: "The cursor-preserving runtime stop is unavailable.",
          turnId: null,
          createdAt: input.createdAt,
          settlementStatus: "uncertain",
        });
      } else {
        const children = yield* readActiveNativeChildren(providerThread.id);
        const stopped = yield* runBoundedProviderCall({
          label: "The provider session stop",
          timeout: PROVIDER_COMMAND_STOP_TIMEOUT,
          call: providerService.stopRuntimeSession({ threadId: providerThread.id }),
        });
        if (stopped._tag === "ok") {
          yield* settleStoppedNativeChildren(children, input.createdAt);
        } else {
          yield* appendProviderFailureActivity({
            threadId: thread.id,
            kind: "provider.session.stop.failed",
            summary: "Provider session stop failed",
            detail: stopped._tag === "timeout" ? stopped.detail : stopped.outcome.detail,
            turnId: null,
            createdAt: input.createdAt,
            settlementStatus: "uncertain",
          });
        }
      }
    }

    yield* setThreadSession({
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: "stopped",
        providerName: thread.session?.providerName ?? null,
        runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: thread.session?.lastError ?? null,
        updatedAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const processSessionStopRequested = (
    event: Extract<ProviderIntentEvent, { type: "thread.session-stop-requested" }>,
  ) =>
    Effect.gen(function* () {
      yield* processThreadSessionStop({
        threadId: event.payload.threadId,
        createdAt: event.payload.createdAt,
      });
    });
  return {
    interruptProviderTurn,
    processThreadSessionStop,
    processTurnInterruptRequested,
    processTaskStopRequested,
    processTaskBackgroundRequested,
    processSessionStopRequested,
  };
}
