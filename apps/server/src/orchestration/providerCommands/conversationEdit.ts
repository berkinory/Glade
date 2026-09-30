import type { ServiceMap } from "effect";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { QueuedTurnPromotionRepository } from "../../persistence/Services/QueuedTurnPromotions.ts";
import { makeProviderThreadProjection } from "./threadProjection";
import { Effect } from "effect";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { ProviderServiceError } from "../../provider/core/Errors.ts";
import { isRollbackStillInProgressError } from "./interactionPolicy";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { ProviderCommandExecutionError } from "./providerCallPolicy";
import { clearWorkspaceIndexCache } from "../../workspace/workspaceEntries.ts";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import {
  collectTailTurnIds,
  resolveTailUserMessageEditTarget,
} from "@glade/shared/threads/conversationEdit";
import { serverCommandId } from "./deliveryClaims";
import { computerActivationMetadata } from "../../computer/computerActivation.ts";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";
import { EditReplayWorkspaceRestorePlan } from "./runtimeState";

export function makeProviderConversationEdit(input: {
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
  readonly checkpointStore: ServiceMap.Service.Shape<typeof CheckpointStore>;
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly queuedTurnPromotions: ServiceMap.Service.Shape<typeof QueuedTurnPromotionRepository>;
  readonly threadSessionSettings: ServiceMap.Service.Shape<typeof ThreadSessionSettings>;
  readonly setThreadSession: ReturnType<typeof makeProviderThreadProjection>["setThreadSession"];
}) {
  const {
    providerService,
    checkpointStore,
    orchestrationEngine,
    queuedTurnPromotions,
    threadSessionSettings,
    setThreadSession,
    projectionAccess,
  } = input;
  const {
    resolveThread,
    resolveProjectedThreadWorkspaceCwd,
    resolveProviderSessionThread,
    resolveSubagentProviderThreadId,
    withProviderSessionLease,
  } = projectionAccess;
  const rollbackProviderConversationForEdit = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) {
    let attempt = 0;
    while (true) {
      let rollbackError: ProviderServiceError | null = null;
      yield* providerService
        .rollbackConversation({
          threadId: input.threadId,
          numTurns: input.numTurns,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              rollbackError = error;
            }),
          ),
        );
      if (rollbackError === null) {
        return;
      }
      if (isRollbackStillInProgressError(rollbackError) && attempt < 30) {
        attempt += 1;
        yield* Effect.sleep(100);
        continue;
      }
      return yield* Effect.fail(rollbackError);
    }
  });

  const planWorkspaceRestoreForEditReplay = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly removedTurnIds: ReadonlyArray<TurnId>;
  }) {
    if (input.removedTurnIds.length === 0) {
      return null;
    }

    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return null;
    }

    const removedTurnIdSet = new Set(input.removedTurnIds);
    const removedCheckpoints = thread.checkpoints.filter((checkpoint) =>
      removedTurnIdSet.has(checkpoint.turnId),
    );
    if (removedCheckpoints.length === 0) {
      return null;
    }

    const firstRemovedTurnCount = removedCheckpoints.reduce(
      (minTurnCount, checkpoint) => Math.min(minTurnCount, checkpoint.checkpointTurnCount),
      Number.POSITIVE_INFINITY,
    );
    const targetTurnCount = Math.max(0, firstRemovedTurnCount - 1);
    const cwd = yield* resolveProjectedThreadWorkspaceCwd(thread);
    if (!cwd) {
      return null;
    }

    if (!(yield* checkpointStore.isGitRepository(cwd))) {
      return null;
    }

    const targetCheckpointRef =
      targetTurnCount === 0
        ? checkpointRefForThreadTurn(input.threadId, 0)
        : thread.checkpoints.find(
            (checkpoint) => checkpoint.checkpointTurnCount === targetTurnCount,
          )?.checkpointRef;
    if (!targetCheckpointRef) {
      return yield* Effect.fail(
        new ProviderCommandExecutionError(
          `Checkpoint ref for edit replay turn ${targetTurnCount} is unavailable.`,
        ),
      );
    }

    if (
      targetTurnCount !== 0 &&
      !(yield* checkpointStore.hasCheckpointRef({ cwd, checkpointRef: targetCheckpointRef }))
    ) {
      return yield* Effect.fail(
        new ProviderCommandExecutionError(
          `Filesystem checkpoint is unavailable for edit replay turn ${targetTurnCount}.`,
        ),
      );
    }

    return {
      cwd,
      checkpointRef: targetCheckpointRef,
      targetTurnCount,
    } satisfies EditReplayWorkspaceRestorePlan;
  });

  const executeEditReplayWorkspaceRestore = Effect.fnUntraced(function* (
    plan: EditReplayWorkspaceRestorePlan | null,
  ) {
    if (plan === null) {
      return;
    }
    const restored = yield* checkpointStore.restoreCheckpoint({
      cwd: plan.cwd,
      checkpointRef: plan.checkpointRef,
      fallbackToHead: plan.targetTurnCount === 0,
    });
    if (!restored) {
      return yield* Effect.fail(
        new ProviderCommandExecutionError(
          `Filesystem checkpoint for edit replay turn ${plan.targetTurnCount} became unavailable during the rollback.`,
        ),
      );
    }

    clearWorkspaceIndexCache(plan.cwd);
  });

  const processConversationRollbackRequestedWithoutLease = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.conversation-rollback-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    const removedTurnIds = thread
      ? collectTailTurnIds<TurnId>({
          messages: thread.messages,
          messageId: event.payload.messageId,
        })
      : [];
    if (!thread || removedTurnIds.length !== event.payload.numTurns) {
      return yield* Effect.fail(
        new ProviderCommandExecutionError(
          `Conversation rollback target '${event.payload.messageId}' is no longer valid for ${event.payload.numTurns} turn(s).`,
        ),
      );
    }
    if (event.payload.numTurns > 0) {
      const providerThread = yield* resolveProviderSessionThread(event.payload.threadId);
      if (
        thread &&
        providerThread?.session?.status === "running" &&
        providerThread.session.activeTurnId !== null
      ) {
        const providerThreadId = resolveSubagentProviderThreadId(thread.id, providerThread.id);
        yield* providerService.interruptTurn({
          threadId: providerThread.id,
          turnId: providerThread.session.activeTurnId,
          ...(providerThreadId ? { providerThreadId } : {}),
        });
      }

      yield* rollbackProviderConversationForEdit({
        threadId: event.payload.threadId,
        numTurns: event.payload.numTurns,
      });
    }
    yield* orchestrationEngine.dispatch({
      type: "thread.conversation.rollback.complete",
      commandId: serverCommandId("conversation-rollback-complete"),
      threadId: event.payload.threadId,
      messageId: event.payload.messageId,
      numTurns: event.payload.numTurns,
      removedTurnIds,
      createdAt: event.payload.createdAt,
    });
  });

  const processConversationRollbackRequested = (
    event: Extract<ProviderIntentEvent, { type: "thread.conversation-rollback-requested" }>,
  ) =>
    withProviderSessionLease(
      event.payload.threadId,
      processConversationRollbackRequestedWithoutLease(event),
    );

  const processMessageEditResendPayload = Effect.fnUntraced(function* (
    payload: Extract<
      ProviderIntentEvent,
      { type: "thread.message-edit-resend-requested" }
    >["payload"],
    options?: {
      readonly skipProviderRollback?: boolean;
      readonly preserveQueuedTurns?: boolean;
      readonly preserveThreadSession?: boolean;
      readonly activeTurnId?: TurnId | null;
    },
  ) {
    if (options?.preserveQueuedTurns !== true) {
      yield* queuedTurnPromotions.cancelThread({
        threadId: payload.threadId,
        updatedAt: payload.createdAt,
      });
      threadSessionSettings.clearEditResendStartsForThread(payload.threadId);
    } else {
      yield* queuedTurnPromotions.cancelMessage({
        threadId: payload.threadId,
        messageId: payload.messageId,
        updatedAt: new Date().toISOString(),
      });
    }
    const originalThread = yield* resolveThread(payload.threadId);
    const originalMessage = originalThread?.messages.find(
      (message) => message.id === payload.messageId,
    );
    if (!originalThread || !originalMessage || originalMessage.role !== "user") {
      return yield* Effect.fail(
        new ProviderCommandExecutionError(
          `Cannot edit missing user message '${payload.messageId}'.`,
        ),
      );
    }
    const editTarget =
      payload.removedTurnIds !== undefined && payload.rollbackTurnCount !== undefined
        ? {
            editable: true as const,
            messageId: payload.messageId,
            messageIndex: originalThread.messages.findIndex(
              (message) => message.id === payload.messageId,
            ),
            mode: payload.rollbackTurnCount > 0 ? ("rollback" as const) : ("active" as const),
            rollbackTurnCount: payload.rollbackTurnCount,
            removedTurnIds: payload.removedTurnIds,
          }
        : resolveTailUserMessageEditTarget({
            messages: originalThread.messages,
            messageId: payload.messageId,
            activeTurnId:
              options?.activeTurnId ??
              (originalThread.session?.status === "running"
                ? (originalThread.session.activeTurnId ?? null)
                : null),
          });
    if (!editTarget.editable) {
      return yield* Effect.fail(
        new ProviderCommandExecutionError(
          `Cannot edit non-tail user message '${payload.messageId}': ${editTarget.reason}.`,
        ),
      );
    }
    // Validate the workspace restore before the provider conversation rollback: once the provider trims
    // its conversation there is no undo, so a missing checkpoint must refuse the edit replay while
    // nothing has happened yet.
    const workspaceRestorePlan = yield* planWorkspaceRestoreForEditReplay({
      threadId: payload.threadId,
      removedTurnIds: editTarget.removedTurnIds.map((turnId) => TurnId.makeUnsafe(turnId)),
    });
    if (options?.skipProviderRollback !== true && editTarget.rollbackTurnCount > 0) {
      yield* rollbackProviderConversationForEdit({
        threadId: payload.threadId,
        numTurns: editTarget.rollbackTurnCount,
      });
    }
    yield* executeEditReplayWorkspaceRestore(workspaceRestorePlan);
    yield* orchestrationEngine.dispatch({
      type: "thread.conversation.rollback.complete",
      commandId: serverCommandId("message-edit-rollback-complete"),
      threadId: payload.threadId,
      messageId: payload.messageId,
      numTurns: editTarget.rollbackTurnCount,
      removedTurnIds: editTarget.removedTurnIds.map((turnId) => TurnId.makeUnsafe(turnId)),
      skipAttachmentPrune: true,
      replacementText: payload.text,
      createdAt: payload.createdAt,
    });

    const thread = yield* resolveThread(payload.threadId);
    if (thread && options?.preserveThreadSession !== true) {
      yield* setThreadSession({
        threadId: payload.threadId,
        session: {
          threadId: payload.threadId,
          status: "starting",
          providerName: thread.session?.providerName ?? thread.modelSelection.provider,
          runtimeMode: payload.runtimeMode,
          activeTurnId: null,
          lastError: null,
          updatedAt: payload.createdAt,
        },
        createdAt: payload.createdAt,
      });
    }

    threadSessionSettings.markEditResendStart(payload.threadId, payload.messageId);
    yield* orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: serverCommandId("message-edit-resend-turn-start"),
      threadId: payload.threadId,
      message: {
        messageId: payload.messageId,
        role: "user",
        text: payload.text,
        attachments: originalMessage.attachments ?? [],
        ...(originalMessage.skills !== undefined ? { skills: originalMessage.skills } : {}),
        ...(originalMessage.mentions !== undefined ? { mentions: originalMessage.mentions } : {}),
      },
      ...(payload.modelSelection !== undefined ? { modelSelection: payload.modelSelection } : {}),
      ...(payload.providerOptions !== undefined
        ? { providerOptions: payload.providerOptions }
        : {}),
      ...computerActivationMetadata(payload),
      ...(payload.assistantDeliveryMode !== undefined
        ? { assistantDeliveryMode: payload.assistantDeliveryMode }
        : {}),
      dispatchMode: "queue",
      runtimeMode: payload.runtimeMode,
      interactionMode: payload.interactionMode,
      createdAt: payload.createdAt,
    });
  });

  const processMessageEditResendRequestedWithoutLease = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.message-edit-resend-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    const providerThread = yield* resolveProviderSessionThread(event.payload.threadId);
    const activeTurnId =
      providerThread?.session?.status === "running"
        ? (providerThread.session.activeTurnId ?? null)
        : null;
    const isQueuedMessageEdit = yield* queuedTurnPromotions.hasPendingMessage({
      threadId: event.payload.threadId,
      messageId: event.payload.messageId,
    });
    if (thread && !isQueuedMessageEdit) {
      yield* setThreadSession({
        threadId: event.payload.threadId,
        session: {
          threadId: event.payload.threadId,
          status: "starting",
          providerName: thread.session?.providerName ?? thread.modelSelection.provider,
          runtimeMode: event.payload.runtimeMode,
          activeTurnId: null,
          lastError: null,
          updatedAt: event.payload.createdAt,
        },
        createdAt: event.payload.createdAt,
      });
    }
    if (
      thread &&
      providerThread?.session?.status === "running" &&
      providerThread.session.activeTurnId !== null &&
      !isQueuedMessageEdit
    ) {
      yield* providerService.interruptTurn({
        threadId: providerThread.id,
        turnId: providerThread.session.activeTurnId,
      });
      yield* processMessageEditResendPayload(event.payload, { activeTurnId });
      return;
    }

    yield* processMessageEditResendPayload(event.payload, {
      ...(isQueuedMessageEdit ? { skipProviderRollback: true } : {}),
      preserveQueuedTurns: isQueuedMessageEdit,
      preserveThreadSession: isQueuedMessageEdit,
      activeTurnId,
    });
  });

  const processMessageEditResendRequested = (
    event: Extract<ProviderIntentEvent, { type: "thread.message-edit-resend-requested" }>,
  ) =>
    withProviderSessionLease(
      event.payload.threadId,
      processMessageEditResendRequestedWithoutLease(event),
    );
  return { processConversationRollbackRequested, processMessageEditResendRequested };
}
