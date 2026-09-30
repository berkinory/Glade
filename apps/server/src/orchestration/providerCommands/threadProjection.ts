import { ServiceMap, Effect } from "effect";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ThreadId, TurnId, CommandId, EventId } from "@glade/contracts/core/baseSchemas";
import { serverCommandId } from "./deliveryClaims";
import {
  type OrchestrationSession,
  type PendingClaudeCacheReview,
} from "@glade/contracts/orchestration/threadEntities";
import { type RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { DEFAULT_RUNTIME_MODE } from "./contextLifecycle";
import { activeThreadGoal } from "../../provider/core/goalMode.ts";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";

export function makeProviderThreadProjection(input: {
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
}) {
  const { orchestrationEngine, projectionAccess } = input;
  const { resolveThread } = projectionAccess;
  const appendProviderFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind:
      | "provider.turn.start.failed"
      | "provider.turn.interrupt.failed"
      | "provider.task.stop.failed"
      | "provider.task.background.failed"
      | "provider.approval.respond.failed"
      | "provider.user-input.respond.failed"
      | "provider.session.stop.failed";
    readonly summary: string;
    readonly detail: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly requestId?: string;
    readonly lifecycleGeneration?: string;
    readonly responseCommandId?: CommandId;
    readonly settlementStatus?: "retryable" | "uncertain";
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("provider-failure-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "error",
        kind: input.kind,
        summary: input.summary,
        payload: {
          detail: input.detail,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          ...(input.lifecycleGeneration ? { lifecycleGeneration: input.lifecycleGeneration } : {}),
          ...(input.responseCommandId ? { responseCommandId: input.responseCommandId } : {}),
          ...(input.settlementStatus ? { settlementStatus: input.settlementStatus } : {}),
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const setThreadSession = (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly expectedSession?: Pick<OrchestrationSession, "status" | "updatedAt">;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: serverCommandId("provider-session-set"),
      threadId: input.threadId,
      session: input.session,
      ...(input.expectedSession !== undefined
        ? {
            expectedSessionStatus: input.expectedSession.status,
            expectedSessionUpdatedAt: input.expectedSession.updatedAt,
          }
        : {}),
      createdAt: input.createdAt,
    });

  const setThreadSessionError = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly runtimeMode?: RuntimeMode;
    readonly detail: string;
    readonly expectedSession?: Pick<OrchestrationSession, "status" | "updatedAt">;
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return;
    }
    yield* setThreadSession({
      threadId: input.threadId,
      session: {
        threadId: input.threadId,
        status: "error",
        providerName: thread.session?.providerName ?? thread.modelSelection.provider,
        runtimeMode: input.runtimeMode ?? thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: input.detail,
        updatedAt: input.createdAt,
      },
      ...(input.expectedSession !== undefined ? { expectedSession: input.expectedSession } : {}),
      createdAt: input.createdAt,
    });
  });

  // Finalizes a turn the provider will never settle on its own. `Stop` is only trustworthy if every
  // dead-end branch clears the projected active turn: `settleTurnStateFromSession` finalizes a
  // running turn only when the session reports `activeTurnId: null`, so leaving it set renders as
  // "Thinking" forever with no escape hatch left for the user.
  const settleInterruptedProviderTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    const session = thread?.session;
    if (!thread || !session) {
      return;
    }
    if (session.activeTurnId === null && thread.latestTurn?.state !== "running") {
      return;
    }
    yield* setThreadSession({
      threadId: input.threadId,
      session: {
        ...session,
        threadId: input.threadId,

        status:
          session.status === "stopped" || session.status === "error"
            ? session.status
            : "interrupted",
        activeTurnId: null,
        updatedAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const setClaudeCacheReview = (
    threadId: ThreadId,
    review: PendingClaudeCacheReview | null,
    expectedReviewId: string | null,
    hold?: { readonly sourceEventSequence: number; readonly session: OrchestrationSession },
  ) =>
    orchestrationEngine
      .dispatch({
        type: "thread.claude-cache.set",
        commandId: serverCommandId("claude-cache-review"),
        threadId,
        review,
        expectedReviewId,
        ...(hold ? { hold } : {}),
        createdAt: new Date().toISOString(),
      })
      .pipe(
        Effect.catchTag("OrchestrationCommandInvariantError", (error) =>
          error.detail === "Command produced no events." ? Effect.void : Effect.fail(error),
        ),
      );

  const isClaudeReviewAuthorized = (
    threadId: ThreadId,
    reviewId: string,
    status: "responding" | "compacting",
  ) =>
    resolveThread(threadId).pipe(
      Effect.map((thread) => {
        return (
          !!thread &&
          thread.deletedAt == null &&
          thread.archivedAt == null &&
          thread.claudeCacheReview?.reviewId === reviewId &&
          thread.claudeCacheReview.status === status &&
          thread.messages.some(
            (message) =>
              message.id === thread.claudeCacheReview?.messageId && message.role === "user",
          )
        );
      }),
    );

  const pauseActiveThreadGoal = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly expectedGoalStartedAt: string | null;
  }) {
    const thread = (yield* orchestrationEngine.getReadModel()).threads.find(
      (candidate) => candidate.id === input.threadId,
    );
    if (
      !thread ||
      !activeThreadGoal(thread)?.trim() ||
      thread.goalPausedAt != null ||
      (thread.goalStartedAt ?? null) !== input.expectedGoalStartedAt
    ) {
      return;
    }
    yield* orchestrationEngine.dispatch({
      type: "thread.meta.update",
      commandId: serverCommandId("goal-auto-pause"),
      threadId: input.threadId,
      goalPaused: true,
    });
  });

  const surfaceTimedOutTurnStart = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
    detail: string,
  ) {
    const session = (yield* resolveThread(event.payload.threadId))?.session;
    if (session?.status !== "starting" || session.activeTurnId !== null) {
      return;
    }

    const createdAt = new Date().toISOString();
    yield* setThreadSessionError({
      threadId: event.payload.threadId,
      runtimeMode: event.payload.runtimeMode,
      detail,
      expectedSession: {
        status: session.status,
        updatedAt: session.updatedAt,
      },
      createdAt,
    });
    yield* appendProviderFailureActivity({
      threadId: event.payload.threadId,
      kind: "provider.turn.start.failed",
      summary: "Provider turn start timed out",
      detail,
      turnId: null,
      createdAt,
      settlementStatus: "uncertain",
    });
  });

  const surfaceTimedOutGoalContinuation = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.goal-continuation-requested" }>,
    detail: string,
  ) {
    const createdAt = new Date().toISOString();
    const thread = yield* resolveThread(event.payload.threadId);
    if (thread?.session?.status === "starting" && thread.session.activeTurnId === null) {
      yield* setThreadSessionError({
        threadId: event.payload.threadId,
        runtimeMode: thread.runtimeMode,
        detail,
        expectedSession: {
          status: thread.session.status,
          updatedAt: thread.session.updatedAt,
        },
        createdAt,
      });
    }
    yield* appendProviderFailureActivity({
      threadId: event.payload.threadId,
      kind: "provider.turn.start.failed",
      summary: "Goal continuation timed out",
      detail,
      turnId: null,
      createdAt,
      settlementStatus: "uncertain",
    });
    yield* pauseActiveThreadGoal({
      threadId: event.payload.threadId,
      expectedGoalStartedAt: event.payload.goalStartedAt,
    });
  });
  return {
    setThreadSession,
    isClaudeReviewAuthorized,
    setClaudeCacheReview,
    pauseActiveThreadGoal,
    appendProviderFailureActivity,
    setThreadSessionError,
    settleInterruptedProviderTurn,
    surfaceTimedOutTurnStart,
    surfaceTimedOutGoalContinuation,
  };
}
