import { scopedTurnCheckpoints } from "../../checkpointing/scopedTurnCheckpoints";
import { validateRestoreConfirmation } from "../../checkpointing/scopedRestore";
import {
  CheckpointRef,
  CommandId,
  EventId,
  MessageId,
  type ProjectId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  type OrchestrationProjectShell,
  type OrchestrationThread,
} from "@glade/contracts/orchestration/threadEntities";
import { type ProviderSession } from "@glade/contracts/provider/provider";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Cause, Deferred, Effect, Fiber, Layer, Option, Schedule, Stream } from "effect";
import {
  makeDrainableWorker,
  startDrainableWorkerProducers,
} from "../../platform/workers/drainableWorker";

import { parseCheckpointFilesFromUnifiedDiff } from "../../checkpointing/Diffs.ts";
import {
  checkpointRefForThreadMessageStart,
  checkpointRefForThreadRevertRescue,
  checkpointRefForThreadTurn,
  checkpointRefForThreadTurnInManagedFamily,
  checkpointRefForThreadTurnLive,
  checkpointRefForThreadTurnStart,
  checkpointRefForThreadTurnStartInManagedFamily,
  isManagedCheckpointRefForThread,
  resolveThreadWorkspaceCwd,
} from "../../checkpointing/Utils.ts";
import { clearWorkspaceIndexCache } from "../../workspace/workspaceEntries.ts";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { CheckpointReactor, type CheckpointReactorShape } from "../Services/CheckpointReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import { TurnCheckpointCoordinator } from "../Services/TurnCheckpointCoordinator.ts";
import { CheckpointInvariantError, type CheckpointStoreError } from "../../checkpointing/Errors.ts";
import { OrchestrationDispatchError } from "../Errors.ts";
import {
  CHECKPOINT_REVERT_FAILED_ACTIVITY_KIND,
  checkpointRevertActiveTurnDetail,
  threadHasInFlightTurn,
} from "../commandInvariants.ts";
import { isGitRepository } from "../../git/isRepo.ts";
import { resolveProviderSessionThread } from "../providerSessionThread.ts";

type ReactorInput =
  | {
      readonly source: "runtime";
      readonly event: ProviderRuntimeEvent;
    }
  | {
      readonly source: "domain";
      readonly event: OrchestrationEvent;
    };

const CHECKPOINT_REACTOR_CAPACITY = 256;

const REVERT_LEASE_ACQUIRE_TIMEOUT_MS = 15_000;

function toTurnId(value: string | undefined): TurnId | null {
  return value === undefined ? null : TurnId.makeUnsafe(String(value));
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

function providerSessionHasInFlightTurn(session: ProviderSession | undefined): boolean {
  return (
    session?.status === "connecting" ||
    session?.status === "running" ||
    (session?.status !== "error" && session?.status !== "closed" && session?.activeTurnId != null)
  );
}

function checkpointStatusFromRuntime(status: string | undefined): "ready" | "missing" | "error" {
  switch (status) {
    case "failed":
      return "error";
    case "cancelled":
    case "interrupted":
      return "missing";
    case "completed":
    default:
      return "ready";
  }
}

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

const ASSISTANT_MESSAGE_ID_RETRY_DELAY_MS = 20;
const ASSISTANT_MESSAGE_ID_RETRY_ATTEMPTS = 6;
const REVERT_FAILURE_ACTIVITY_MAX_RETRIES = 3;

const REVERT_COMPLETE_MAX_RETRIES = 3;

const revertRescueCheckpointRef = (threadId: ThreadId): CheckpointRef =>
  checkpointRefForThreadRevertRescue(threadId, crypto.randomUUID());

function resolveExistingAssistantMessageIdForTurn(
  thread:
    | {
        readonly messages: ReadonlyArray<{
          readonly id: MessageId;
          readonly role: string;
          readonly turnId: TurnId | null;
        }>;
      }
    | undefined,
  turnId: TurnId,
  assistantMessageId: MessageId | undefined,
): MessageId | undefined {
  if (!thread || assistantMessageId === undefined) {
    return undefined;
  }
  return thread.messages.some(
    (entry) =>
      entry.id === assistantMessageId && entry.role === "assistant" && entry.turnId === turnId,
  )
    ? assistantMessageId
    : undefined;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const checkpointStore = yield* CheckpointStore;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const receiptBus = yield* RuntimeReceiptBus;
  const turnCheckpointCoordinator = yield* TurnCheckpointCoordinator;
  const pendingMessageStartByThread = new Map<ThreadId, MessageId>();

  const liveDiffScheduledThreads = new Set<ThreadId>();
  // Turns that started in a workspace that was not yet a git repository. A scaffolding turn (`git
  // init`, create-next-app, ...) turns the folder into a repo mid-turn, so the completion capture
  // finds no turn-start baseline. That is expected for such turns and must not surface as a capture
  // failure.
  const turnsStartedWithoutGitWorkspace = new Map<ThreadId, TurnId>();

  const supportsLiveTurnDiffPatch = Effect.fnUntraced(function* (
    provider: ProviderRuntimeEvent["provider"],
  ) {
    const capabilities = yield* providerService
      .getCapabilities(provider)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    return capabilities?.supportsLiveTurnDiffPatch === true;
  });

  // Wait a short time for ProviderRuntimeIngestion to persist the final assistant message id when
  // turn completion wins the subscriber race.
  const resolveAssistantMessageIdForTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly assistantMessageId: MessageId | undefined;
  }) {
    const currentThreadOption = yield* projectionSnapshotQuery.getThreadDetailById(input.threadId);
    const currentThread = Option.getOrUndefined(currentThreadOption);
    const knownInputAssistantMessageId = resolveExistingAssistantMessageIdForTurn(
      currentThread,
      input.turnId,
      input.assistantMessageId,
    );
    if (knownInputAssistantMessageId !== undefined) {
      return knownInputAssistantMessageId;
    }

    for (let attempt = 0; attempt < ASSISTANT_MESSAGE_ID_RETRY_ATTEMPTS; attempt += 1) {
      const threadOption = yield* projectionSnapshotQuery.getThreadDetailById(input.threadId);
      const thread = Option.getOrUndefined(threadOption);
      const candidateAssistantMessageId =
        resolveExistingAssistantMessageIdForTurn(
          thread,
          input.turnId,
          thread?.latestTurn?.turnId === input.turnId
            ? (thread.latestTurn.assistantMessageId ?? undefined)
            : undefined,
        ) ??
        thread?.messages
          .toReversed()
          .find((entry) => entry.role === "assistant" && entry.turnId === input.turnId)?.id;

      if (candidateAssistantMessageId !== undefined) {
        return candidateAssistantMessageId;
      }

      if (attempt < ASSISTANT_MESSAGE_ID_RETRY_ATTEMPTS - 1) {
        yield* Effect.sleep(`${ASSISTANT_MESSAGE_ID_RETRY_DELAY_MS} millis`);
      }
    }

    return undefined;
  });

  const resolveRevertFailureTurnId = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly turnCount: number;
  }) {
    const thread = yield* getThreadDetail(input.threadId);
    if (!thread) {
      return null;
    }
    const targetCheckpoint = thread.checkpoints.find(
      (checkpoint) => checkpoint.checkpointTurnCount === input.turnCount,
    );
    if (targetCheckpoint) {
      return targetCheckpoint.turnId;
    }
    const latestCheckpoint = thread.checkpoints.reduce<(typeof thread.checkpoints)[number] | null>(
      (latest, checkpoint) =>
        latest === null || checkpoint.checkpointTurnCount > latest.checkpointTurnCount
          ? checkpoint
          : latest,
      null,
    );
    return latestCheckpoint?.turnId ?? thread.latestTurn?.turnId ?? null;
  });

  const appendRevertFailureActivity = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly turnCount: number;
    readonly detail: string;
    readonly createdAt: string;
  }) {
    const turnId = yield* resolveRevertFailureTurnId({
      threadId: input.threadId,
      turnCount: input.turnCount,
    });
    yield* orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId: serverCommandId("checkpoint-revert-failure"),
        threadId: input.threadId,
        activity: {
          id: EventId.makeUnsafe(crypto.randomUUID()),
          tone: "error",
          kind: CHECKPOINT_REVERT_FAILED_ACTIVITY_KIND,
          summary: "Checkpoint revert failed",
          payload: {
            turnCount: input.turnCount,
            detail: input.detail,
          },
          turnId,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      })
      .pipe(
        Effect.retry(
          Schedule.addDelay(Schedule.recurs(REVERT_FAILURE_ACTIVITY_MAX_RETRIES), () =>
            Effect.succeed("100 millis"),
          ),
        ),
      );
  });

  const appendCaptureFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("checkpoint-capture-failure"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "error",
        kind: "checkpoint.capture.failed",
        summary: "Checkpoint capture failed",
        payload: {
          detail: input.detail,
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const resolveSessionRuntimeForThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const thread = yield* projectionSnapshotQuery
      .getThreadShellById(threadId)
      .pipe(Effect.catch(() => Effect.succeed(Option.none())));
    if (Option.isNone(thread)) {
      return Option.none();
    }

    const sessions = yield* providerService.listSessions();

    const findSessionWithCwd = (
      session: (typeof sessions)[number] | undefined,
    ): Option.Option<{ readonly threadId: ThreadId; readonly cwd: string }> => {
      if (!session?.cwd) {
        return Option.none();
      }
      return Option.some({ threadId: session.threadId, cwd: session.cwd });
    };

    const providerThread = yield* resolveProviderSessionThread(
      projectionSnapshotQuery,
      thread.value.id,
    );
    const sessionThreadId = providerThread?.id ?? thread.value.id;
    const projectedSession = sessions.find((session) => session.threadId === sessionThreadId);
    const fromProjected = findSessionWithCwd(projectedSession);
    if (Option.isSome(fromProjected)) {
      return fromProjected;
    }

    return Option.none();
  });

  const isGitWorkspace = (cwd: string) => isGitRepository(cwd);

  const getThreadDetail = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<OrchestrationThread | undefined> {
    return Option.getOrUndefined(
      yield* projectionSnapshotQuery
        .getThreadDetailById(threadId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
    );
  });

  const getProjectShell = Effect.fnUntraced(function* (
    projectId: ProjectId,
  ): Effect.fn.Return<OrchestrationProjectShell | undefined> {
    return Option.getOrUndefined(
      yield* projectionSnapshotQuery
        .getProjectShellById(projectId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
    );
  });

  const resolveCheckpointWorkspace = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly thread: Pick<OrchestrationThread, "projectId" | "envMode" | "worktreePath">;
    readonly project: OrchestrationProjectShell;
  }) {
    const fromSession = yield* resolveSessionRuntimeForThread(input.threadId);
    const cwd =
      Option.match(fromSession, {
        onNone: () => undefined,
        onSome: (runtime) => runtime.cwd,
      }) ??
      resolveThreadWorkspaceCwd({
        thread: input.thread,
        projects: [input.project],
      });

    if (!cwd) {
      return undefined;
    }
    return { cwd, isGitRepository: isGitWorkspace(cwd) } as const;
  });

  const resolveCheckpointCwd = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly thread: Pick<OrchestrationThread, "projectId" | "envMode" | "worktreePath">;
    readonly project: OrchestrationProjectShell;
  }) {
    const workspace = yield* resolveCheckpointWorkspace(input);
    return workspace?.isGitRepository ? workspace.cwd : undefined;
  });

  const captureAndDispatchCheckpoint = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly thread: {
      readonly messages: ReadonlyArray<{
        readonly id: MessageId;
        readonly role: string;
        readonly turnId: TurnId | null;
      }>;
    };
    readonly cwd: string;
    readonly turnCount: number;
    readonly status: "ready" | "missing" | "error";
    readonly assistantMessageId: MessageId | undefined;
    readonly createdAt: string;

    readonly workspaceInitializedDuringTurn: boolean;
  }) {
    const fromCheckpointRef = checkpointRefForThreadTurnStart(input.threadId, input.turnId);
    const targetCheckpointRef = checkpointRefForThreadTurn(input.threadId, input.turnCount);

    const fromCheckpointExists = yield* checkpointStore.hasCheckpointRef({
      cwd: input.cwd,
      checkpointRef: fromCheckpointRef,
    });
    if (!fromCheckpointExists) {
      if (input.workspaceInitializedDuringTurn) {
        yield* Effect.logDebug(
          "checkpoint capture has no pre-turn baseline: workspace became a git repository during the turn",
          {
            threadId: input.threadId,
            turnId: input.turnId,
            checkpointRef: fromCheckpointRef,
          },
        );
      } else {
        yield* Effect.logWarning("checkpoint capture missing pre-turn baseline", {
          threadId: input.threadId,
          turnId: input.turnId,
          checkpointRef: fromCheckpointRef,
        });
      }
    }

    yield* checkpointStore.captureCheckpoint({
      cwd: input.cwd,
      checkpointRef: targetCheckpointRef,
    });

    clearWorkspaceIndexCache(input.cwd);

    const checkpointStatus = fromCheckpointExists ? input.status : ("missing" as const);

    const files = fromCheckpointExists
      ? yield* checkpointStore
          .diffCheckpoints({
            cwd: input.cwd,
            fromCheckpointRef,
            toCheckpointRef: targetCheckpointRef,
            fallbackFromToHead: false,
            ignoreWhitespace: false,
          })
          .pipe(
            Effect.flatMap((diff) => parseCheckpointFilesFromUnifiedDiff(diff)),
            Effect.tapError((error) =>
              appendCaptureFailureActivity({
                threadId: input.threadId,
                turnId: input.turnId,
                detail: `Checkpoint captured, but turn diff summary is unavailable: ${error.message}`,
                createdAt: input.createdAt,
              }),
            ),
            Effect.catch((error) =>
              Effect.logWarning("failed to derive checkpoint file summary", {
                threadId: input.threadId,
                turnId: input.turnId,
                turnCount: input.turnCount,
                detail: error.message,
              }).pipe(Effect.as([])),
            ),
          )
      : input.workspaceInitializedDuringTurn
        ? []
        : yield* appendCaptureFailureActivity({
            threadId: input.threadId,
            turnId: input.turnId,
            detail: "Checkpoint captured, but the turn start baseline is unavailable.",
            createdAt: input.createdAt,
          }).pipe(Effect.as([]));

    const assistantMessageId = yield* resolveAssistantMessageIdForTurn({
      threadId: input.threadId,
      turnId: input.turnId,
      assistantMessageId:
        input.assistantMessageId ??
        input.thread.messages
          .toReversed()
          .find((entry) => entry.role === "assistant" && entry.turnId === input.turnId)?.id,
    });

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.diff.complete",
      commandId: serverCommandId("checkpoint-turn-diff-complete"),
      threadId: input.threadId,
      turnId: input.turnId,
      completedAt: input.createdAt,
      checkpointRef: targetCheckpointRef,
      status: checkpointStatus,
      files,
      assistantMessageId,
      checkpointTurnCount: input.turnCount,
      createdAt: input.createdAt,
    });
    yield* receiptBus.publish({
      type: "checkpoint.diff.finalized",
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      checkpointRef: targetCheckpointRef,
      status: checkpointStatus,
      createdAt: input.createdAt,
    });
    yield* receiptBus.publish({
      type: "turn.processing.quiesced",
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      createdAt: input.createdAt,
    });

    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("checkpoint-captured-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "info",
        kind: "checkpoint.captured",
        summary: "Checkpoint captured",
        payload: {
          turnCount: input.turnCount,
          status: checkpointStatus,
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const ensureLegacyBaselineCheckpoint = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly turnCount: number;
    readonly createdAt: string;
  }) {
    const legacyBaselineRef = checkpointRefForThreadTurn(input.threadId, input.turnCount);
    const legacyBaselineExists = yield* checkpointStore.hasCheckpointRef({
      cwd: input.cwd,
      checkpointRef: legacyBaselineRef,
    });
    if (legacyBaselineExists) {
      return;
    }

    yield* checkpointStore.captureCheckpoint({
      cwd: input.cwd,
      checkpointRef: legacyBaselineRef,
    });
    yield* receiptBus.publish({
      type: "checkpoint.baseline.captured",
      threadId: input.threadId,
      checkpointTurnCount: input.turnCount,
      checkpointRef: legacyBaselineRef,
      createdAt: input.createdAt,
    });
  });

  const captureCheckpointFromTurnCompletion = Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) {
      return;
    }

    const thread = yield* getThreadDetail(event.threadId);
    if (!thread) {
      yield* Effect.logDebug("turn-completion checkpoint skipped: thread not found", {
        threadId: event.threadId,
        turnId,
      });
      return;
    }
    const project = yield* getProjectShell(thread.projectId);
    if (!project) {
      yield* Effect.logDebug("turn-completion checkpoint skipped: project not found", {
        threadId: thread.id,
        turnId,
        projectId: thread.projectId,
      });
      return;
    }

    if (thread.session?.activeTurnId && !sameId(thread.session.activeTurnId, turnId)) {
      yield* Effect.logDebug("turn-completion checkpoint skipped: turn is not the active turn", {
        threadId: thread.id,
        turnId,
        activeTurnId: thread.session.activeTurnId,
      });
      return;
    }

    // Only skip if a real (non-placeholder) checkpoint already exists for this turn.
    // ProviderRuntimeIngestion may insert placeholder entries with status "missing" before this reactor
    // runs; those must not prevent real git capture.
    if (
      thread.checkpoints.some(
        (checkpoint) => checkpoint.turnId === turnId && checkpoint.status !== "missing",
      )
    ) {
      return;
    }

    const checkpointCwd = yield* resolveCheckpointCwd({
      threadId: thread.id,
      thread,
      project,
    });
    if (!checkpointCwd) {
      yield* Effect.logDebug(
        "turn-completion checkpoint skipped: no git workspace to capture from",
        {
          threadId: thread.id,
          turnId,
          projectId: thread.projectId,
        },
      );
      return;
    }

    const existingPlaceholder = thread.checkpoints.find(
      (checkpoint) => checkpoint.turnId === turnId && checkpoint.status === "missing",
    );
    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );
    const nextTurnCount = existingPlaceholder
      ? existingPlaceholder.checkpointTurnCount
      : currentTurnCount + 1;

    const workspaceInitializedDuringTurn =
      turnsStartedWithoutGitWorkspace.get(thread.id) === turnId;
    turnsStartedWithoutGitWorkspace.delete(thread.id);

    yield* captureAndDispatchCheckpoint({
      threadId: thread.id,
      turnId,
      thread,
      cwd: checkpointCwd,
      turnCount: nextTurnCount,
      status: checkpointStatusFromRuntime(event.payload.state),
      assistantMessageId: undefined,
      createdAt: event.createdAt,
      workspaceInitializedDuringTurn,
    });
  });

  // Snapshots the working tree into a throwaway ref (isolated temp index — the real index/worktree
  // are untouched), diffs it against the turn-start baseline, and dispatches a provider-diff
  // placeholder so the "files changed" strip shows live +N/-M.
  const captureLiveTurnDiff = Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: "item.completed" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) {
      return;
    }

    const thread = yield* getThreadDetail(event.threadId);
    if (!thread) {
      return;
    }
    const project = yield* getProjectShell(thread.projectId);
    if (!project) {
      return;
    }

    if (thread.session?.activeTurnId && !sameId(thread.session.activeTurnId, turnId)) {
      return;
    }

    const existingForTurn = thread.checkpoints.find((checkpoint) => checkpoint.turnId === turnId);
    if (existingForTurn && existingForTurn.status !== "missing") {
      return;
    }

    const checkpointCwd = yield* resolveCheckpointCwd({
      threadId: thread.id,
      thread,
      project,
    });
    if (!checkpointCwd) {
      return;
    }

    const fromCheckpointRef = checkpointRefForThreadTurnStart(thread.id, turnId);
    const baselineExists = yield* checkpointStore.hasCheckpointRef({
      cwd: checkpointCwd,
      checkpointRef: fromCheckpointRef,
    });
    if (!baselineExists) {
      return;
    }

    const liveCheckpointRef = checkpointRefForThreadTurnLive(thread.id, turnId);
    yield* checkpointStore.captureCheckpoint({
      cwd: checkpointCwd,
      checkpointRef: liveCheckpointRef,
    });
    const diff = yield* checkpointStore
      .diffCheckpoints({
        cwd: checkpointCwd,
        fromCheckpointRef,
        toCheckpointRef: liveCheckpointRef,
        fallbackFromToHead: false,
        ignoreWhitespace: false,
      })
      .pipe(Effect.catch(() => Effect.succeed("")));
    yield* checkpointStore
      .deleteCheckpointRefs({ cwd: checkpointCwd, checkpointRefs: [liveCheckpointRef] })
      .pipe(Effect.catch(() => Effect.void));

    const files = yield* parseCheckpointFilesFromUnifiedDiff(diff);
    if (files.length === 0) {
      return;
    }

    const maxTurnCount = thread.checkpoints.reduce(
      (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
      0,
    );
    const checkpointTurnCount = existingForTurn
      ? existingForTurn.checkpointTurnCount
      : maxTurnCount + 1;

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.diff.complete",
      commandId: serverCommandId("checkpoint-live-turn-diff"),
      threadId: thread.id,
      turnId,
      completedAt: event.createdAt,

      checkpointRef: CheckpointRef.makeUnsafe(`provider-diff:${event.eventId}`),
      status: "missing",
      files,
      assistantMessageId: undefined,
      checkpointTurnCount,
      createdAt: event.createdAt,
    });
  });

  // The real filesystem checkpoint for a turn must only be captured from the terminal turn.completed
  // event; otherwise an in-progress diff update can freeze an intermediate tree as the final
  // checkpoint for the turn.
  const captureCheckpointFromPlaceholder = Effect.fnUntraced(function* (
    event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>,
  ) {
    if (event.payload.status === "missing") {
      yield* Effect.logDebug("checkpoint placeholder left unresolved until turn completion", {
        threadId: event.payload.threadId,
        turnId: event.payload.turnId,
        checkpointTurnCount: event.payload.checkpointTurnCount,
      });
    }
  });

  const ensurePreTurnBaselineFromTurnStart = Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) {
      return;
    }

    const thread = yield* getThreadDetail(event.threadId);
    if (!thread) {
      return;
    }
    const project = yield* getProjectShell(thread.projectId);
    if (!project) {
      return;
    }

    const workspace = yield* resolveCheckpointWorkspace({
      threadId: thread.id,
      thread,
      project,
    });
    if (!workspace) {
      turnsStartedWithoutGitWorkspace.delete(thread.id);
      return;
    }
    if (!workspace.isGitRepository) {
      turnsStartedWithoutGitWorkspace.set(thread.id, turnId);
      yield* Effect.logDebug(
        "checkpoint turn start baseline skipped: workspace is not a git repository",
        {
          threadId: thread.id,
          turnId,
          cwd: workspace.cwd,
        },
      );
      return;
    }
    turnsStartedWithoutGitWorkspace.delete(thread.id);
    const checkpointCwd = workspace.cwd;

    const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
      threadId: thread.id,
    });
    const messageId =
      pendingMessageStartByThread.get(thread.id) ??
      Option.match(pendingTurnStart, {
        onNone: () => undefined,
        onSome: (pending) => pending.messageId,
      });
    const turnStartCheckpointRef = checkpointRefForThreadTurnStart(thread.id, turnId);
    let hasTurnStartBaseline = false;
    if (messageId !== undefined) {
      const messageStartCheckpointRef = checkpointRefForThreadMessageStart(thread.id, messageId);
      const copyMessageStartBaseline = checkpointStore.copyCheckpointRef({
        cwd: checkpointCwd,
        fromCheckpointRef: messageStartCheckpointRef,
        toCheckpointRef: turnStartCheckpointRef,
      });
      let copied = yield* copyMessageStartBaseline;
      if (!copied) {
        yield* checkpointStore.captureCheckpoint({
          cwd: checkpointCwd,
          checkpointRef: messageStartCheckpointRef,
          skipIfExists: true,
        });
        copied = yield* copyMessageStartBaseline;
      }
      hasTurnStartBaseline = copied;
      pendingMessageStartByThread.delete(thread.id);
      if (!copied) {
        yield* Effect.logWarning("checkpoint turn start baseline alias missing message baseline", {
          threadId: thread.id,
          turnId,
          messageId,
        });
      }
    }
    if (!hasTurnStartBaseline) {
      const existingTurnStartBaseline = yield* checkpointStore.hasCheckpointRef({
        cwd: checkpointCwd,
        checkpointRef: turnStartCheckpointRef,
      });
      if (!existingTurnStartBaseline) {
        yield* checkpointStore.captureCheckpoint({
          cwd: checkpointCwd,
          checkpointRef: turnStartCheckpointRef,
        });
      }
    }

    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );
    yield* ensureLegacyBaselineCheckpoint({
      threadId: thread.id,
      cwd: checkpointCwd,
      turnCount: currentTurnCount,
      createdAt: event.createdAt,
    });
  });

  const ensurePreTurnBaselineFromDomainTurnStart = Effect.fnUntraced(function* (
    event: Extract<
      OrchestrationEvent,
      { type: "thread.turn-start-requested" | "thread.message-sent" }
    >,
  ) {
    if (event.type === "thread.message-sent") {
      if (
        event.payload.role !== "user" ||
        event.payload.streaming ||
        event.payload.turnId !== null
      ) {
        return;
      }
    }

    const threadId = event.payload.threadId;
    const thread = yield* getThreadDetail(threadId);
    if (!thread) {
      return;
    }
    const project = yield* getProjectShell(thread.projectId);
    if (!project) {
      return;
    }

    const checkpointCwd = yield* resolveCheckpointCwd({
      threadId,
      thread,
      project,
    });
    if (!checkpointCwd) {
      return;
    }

    if (event.type === "thread.turn-start-requested") {
      pendingMessageStartByThread.set(threadId, event.payload.messageId);

      const messageStartCheckpointRef = checkpointRefForThreadMessageStart(
        threadId,
        event.payload.messageId,
      );
      const messageStartCheckpointExists = yield* checkpointStore.hasCheckpointRef({
        cwd: checkpointCwd,
        checkpointRef: messageStartCheckpointRef,
      });
      if (!messageStartCheckpointExists) {
        yield* checkpointStore.captureCheckpoint({
          cwd: checkpointCwd,
          checkpointRef: messageStartCheckpointRef,
          skipIfExists: true,
        });
      }
    }

    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );
    yield* ensureLegacyBaselineCheckpoint({
      threadId,
      cwd: checkpointCwd,
      turnCount: currentTurnCount,
      createdAt: event.occurredAt,
    });
  });

  const handleRevertRequestedWithoutLease = Effect.fnUntraced(function* (
    event: Extract<OrchestrationEvent, { type: "thread.checkpoint-revert-requested" }>,
    sessionThreadId: ThreadId,
  ) {
    const now = new Date().toISOString();

    const thread = yield* getThreadDetail(event.payload.threadId);
    if (!thread) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: "Thread was not found in projection state.",
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const relevantThreadIds =
      sessionThreadId === event.payload.threadId
        ? [event.payload.threadId]
        : [event.payload.threadId, sessionThreadId];
    const [commandReadModel, pendingTurnStarts, providerSessions] = yield* Effect.all([
      orchestrationEngine.getReadModel(),
      Effect.forEach(relevantThreadIds, (threadId) =>
        projectionTurnRepository.getPendingTurnStartByThreadId({ threadId }),
      ),
      providerService.listSessions(),
    ]);
    const commandThread = commandReadModel.threads.find(
      (entry) => entry.id === event.payload.threadId,
    );
    const sessionCommandThread = commandReadModel.threads.find(
      (entry) => entry.id === sessionThreadId,
    );
    const providerSession = providerSessions.find(
      (session) => session.threadId === sessionThreadId,
    );
    const currentThread = commandThread ?? thread;
    const hasPendingNonTerminalTurnStart = pendingTurnStarts.some(
      (pendingTurnStart, index) =>
        Option.isSome(pendingTurnStart) &&
        commandReadModel.threads.find((entry) => entry.id === relevantThreadIds[index])?.session
          ?.status !== "error",
    );
    if (
      threadHasInFlightTurn(currentThread) ||
      (sessionCommandThread !== undefined && threadHasInFlightTurn(sessionCommandThread)) ||
      hasPendingNonTerminalTurnStart ||
      providerSessionHasInFlightTurn(providerSession)
    ) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: checkpointRevertActiveTurnDetail(event.payload.threadId),
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );

    if (event.payload.turnCount > currentTurnCount) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Checkpoint turn count ${event.payload.turnCount} exceeds current turn count ${currentTurnCount}.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const project = yield* getProjectShell(thread.projectId);
    const checkpointCwd = project
      ? yield* resolveCheckpointCwd({
          threadId: event.payload.threadId,
          thread,
          project,
        })
      : undefined;
    if (!checkpointCwd) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail:
          event.payload.scope === "files"
            ? "No git workspace is available for file Undo."
            : "No git workspace is available for this thread's checkpoints.",
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    if (event.payload.scope === "files") {
      const isUndoableCheckpoint = (checkpoint: (typeof thread.checkpoints)[number]) =>
        checkpoint.status === "ready" &&
        checkpoint.files.length > 0 &&
        isManagedCheckpointRefForThread(checkpoint.checkpointRef, event.payload.threadId);
      const targetCheckpoint = thread.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === event.payload.turnCount,
      );
      if (!targetCheckpoint || !isUndoableCheckpoint(targetCheckpoint)) {
        yield* appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: `File changes for turn ${event.payload.turnCount} are unavailable or already undone.`,
          createdAt: now,
        }).pipe(Effect.catch(() => Effect.void));
        return;
      }
      const latestUndoableTurnCount = thread.checkpoints.reduce(
        (latest, checkpoint) =>
          isUndoableCheckpoint(checkpoint)
            ? Math.max(latest, checkpoint.checkpointTurnCount)
            : latest,
        0,
      );
      if (targetCheckpoint.checkpointTurnCount !== latestUndoableTurnCount) {
        yield* appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: "Undo newer file changes before undoing this turn.",
          createdAt: now,
        }).pipe(Effect.catch(() => Effect.void));
        return;
      }

      const scopedInput = {
        cwd: checkpointCwd,
        turns: scopedTurnCheckpoints(thread, [targetCheckpoint]),
      };
      const preview = yield* checkpointStore.previewScopedRestore(scopedInput).pipe(
        Effect.tap((plan) => validateRestoreConfirmation(plan, event.payload.workspaceRestore)),
        Effect.tapError((error) =>
          appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: error.message,
            createdAt: now,
          }),
        ),
        Effect.catch(() => Effect.succeed(null)),
      );
      if (!preview) return;
      yield* checkpointStore.restoreScopedCheckpoint({
        ...scopedInput,
        confirmation: event.payload.workspaceRestore ?? {
          fingerprint: preview.fingerprint,
          overwritePaths: [],
        },
      });

      yield* checkpointStore.captureCheckpoint({
        cwd: checkpointCwd,
        checkpointRef: targetCheckpoint.checkpointRef,
      });
      yield* Effect.forEach(
        thread.checkpoints.filter(
          (checkpoint) =>
            checkpoint.checkpointTurnCount > targetCheckpoint.checkpointTurnCount &&
            isManagedCheckpointRefForThread(checkpoint.checkpointRef, event.payload.threadId),
        ),
        (checkpoint) => {
          const laterTurnStartCheckpointRef =
            checkpointRefForThreadTurnStartInManagedFamily(
              checkpoint.checkpointRef,
              event.payload.threadId,
              checkpoint.turnId,
            ) ?? checkpointRefForThreadTurnStart(event.payload.threadId, checkpoint.turnId);
          return Effect.all([
            checkpointStore.copyCheckpointRef({
              cwd: checkpointCwd,
              fromCheckpointRef: targetCheckpoint.checkpointRef,
              toCheckpointRef: checkpoint.checkpointRef,
            }),
            checkpointStore.copyCheckpointRef({
              cwd: checkpointCwd,
              fromCheckpointRef: targetCheckpoint.checkpointRef,
              toCheckpointRef: laterTurnStartCheckpointRef,
            }),
          ]).pipe(Effect.asVoid);
        },
        { discard: true },
      );

      clearWorkspaceIndexCache(checkpointCwd);
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: serverCommandId("checkpoint-files-undone"),
        threadId: event.payload.threadId,
        turnId: targetCheckpoint.turnId,
        completedAt: targetCheckpoint.completedAt,
        checkpointRef: targetCheckpoint.checkpointRef,
        status: targetCheckpoint.status,
        files: [],
        ...(targetCheckpoint.assistantMessageId
          ? { assistantMessageId: targetCheckpoint.assistantMessageId }
          : {}),
        checkpointTurnCount: targetCheckpoint.checkpointTurnCount,
        preserveLatestTurn: true,
        checkpointRevertTurnCount: event.payload.turnCount,
        createdAt: now,
      });
      return;
    }

    const earliestManagedBaselineRef = thread.checkpoints
      .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
      .map((checkpoint) =>
        checkpointRefForThreadTurnInManagedFamily(
          checkpoint.checkpointRef,
          event.payload.threadId,
          0,
        ),
      )
      .find((checkpointRef) => checkpointRef !== null);
    const targetCheckpointRef =
      event.payload.turnCount === 0
        ? (earliestManagedBaselineRef ?? checkpointRefForThreadTurn(event.payload.threadId, 0))
        : thread.checkpoints.find(
            (checkpoint) => checkpoint.checkpointTurnCount === event.payload.turnCount,
          )?.checkpointRef;

    if (!targetCheckpointRef) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Checkpoint ref for turn ${event.payload.turnCount} is unavailable in read model.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const missingTargetCheckpointDetail = yield* checkpointStore
      .hasCheckpointRef({
        cwd: checkpointCwd,
        checkpointRef: targetCheckpointRef,
      })
      .pipe(
        Effect.map((exists) =>
          exists
            ? null
            : `Filesystem checkpoint is unavailable for turn ${event.payload.turnCount}.`,
        ),
        Effect.catch((error) =>
          Effect.succeed(
            `Filesystem checkpoint for turn ${event.payload.turnCount} could not be verified: ${error.message}`,
          ),
        ),
      );
    if (missingTargetCheckpointDetail !== null) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: missingTargetCheckpointDetail,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const scopedRestoreInput = {
      cwd: checkpointCwd,
      turns: scopedTurnCheckpoints(
        thread,
        thread.checkpoints.filter(
          (checkpoint) => checkpoint.checkpointTurnCount > event.payload.turnCount,
        ),
      ),
    };
    const preview = yield* checkpointStore.previewScopedRestore(scopedRestoreInput).pipe(
      Effect.tap((plan) => validateRestoreConfirmation(plan, event.payload.workspaceRestore)),
      Effect.tapError((error) =>
        appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: error.message,
          createdAt: now,
        }),
      ),
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!preview) return;
    const confirmation = event.payload.workspaceRestore ?? {
      fingerprint: preview.fingerprint,
      overwritePaths: [],
    };

    const rolledBackTurns = Math.max(0, currentTurnCount - event.payload.turnCount);
    const rescueCheckpointRef = revertRescueCheckpointRef(event.payload.threadId);
    const rescueCaptureFailure = yield* checkpointStore
      .captureCheckpoint({ cwd: checkpointCwd, checkpointRef: rescueCheckpointRef })
      .pipe(
        Effect.as(null),
        Effect.catch((error) =>
          Effect.succeed(
            `The pre-revert workspace snapshot could not be captured, so the revert was refused: ${error.message}`,
          ),
        ),
      );
    if (rescueCaptureFailure !== null) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: rescueCaptureFailure,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const discardRescueCheckpoint = checkpointStore
      .deleteCheckpointRefs({ cwd: checkpointCwd, checkpointRefs: [rescueCheckpointRef] })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("checkpoint revert rescue ref cleanup failed", {
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            rescueCheckpointRef,
            detail: error.message,
          }),
        ),
      );

    if (rolledBackTurns > 0) {
      const rollbackFailure = yield* providerService
        .rollbackConversation({ threadId: sessionThreadId, numTurns: rolledBackTurns })
        .pipe(
          Effect.as(null),
          Effect.catch((error) => Effect.succeed(error.message)),
        );
      if (rollbackFailure !== null) {
        yield* discardRescueCheckpoint;
        yield* appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: `Conversation rollback failed before restoring files: ${rollbackFailure}`,
          createdAt: now,
        });
        return;
      }
    }

    const restoreOutcome = yield* checkpointStore
      .restoreScopedCheckpoint({ ...scopedRestoreInput, confirmation })
      .pipe(
        Effect.as({ kind: "restored" } as const),
        Effect.catch((error) => Effect.succeed({ kind: "failed", detail: error.message } as const)),
      );

    if (restoreOutcome.kind === "failed") {
      // A changed workspace may be why validation failed; restoring the rescue snapshot would erase it.
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Filesystem restore failed after the provider rollback: ${restoreOutcome.detail}. The pre-revert snapshot is kept at ${rescueCheckpointRef}.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    clearWorkspaceIndexCache(checkpointCwd);

    const completionFailure = yield* orchestrationEngine
      .dispatch({
        type: "thread.revert.complete",

        commandId: CommandId.makeUnsafe(`server:checkpoint-revert-complete:${event.eventId}`),
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        createdAt: now,
      })
      .pipe(
        Effect.retry(
          Schedule.addDelay(Schedule.recurs(REVERT_COMPLETE_MAX_RETRIES), () =>
            Effect.succeed("100 millis"),
          ),
        ),
        Effect.as(null),
        Effect.catch((error) => Effect.succeed(error.message)),
      );
    if (completionFailure !== null) {
      // Both systems already moved, so the snapshot is deliberately kept: it is the only way back to the
      // pre-revert worktree. Name it in the activity, otherwise the ref survives with nothing pointing a
      // human at it.
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail:
          `${completionFailure} The workspace${rolledBackTurns > 0 ? " and the conversation were" : " was"} already reverted; ` +
          `the pre-revert snapshot is kept at ${rescueCheckpointRef}.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const staleCheckpointRefs = thread.checkpoints
      .filter((checkpoint) => checkpoint.checkpointTurnCount > event.payload.turnCount)
      .map((checkpoint) => checkpoint.checkpointRef);

    yield* checkpointStore
      .deleteCheckpointRefs({
        cwd: checkpointCwd,
        checkpointRefs: [...staleCheckpointRefs, rescueCheckpointRef],
      })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("checkpoint revert ref cleanup failed after completion", {
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: error.message,
          }),
        ),
      );
  });

  const handleRevertRequested = (
    event: Extract<OrchestrationEvent, { type: "thread.checkpoint-revert-requested" }>,
  ) =>
    Effect.gen(function* () {
      const providerThread = yield* resolveProviderSessionThread(
        projectionSnapshotQuery,
        event.payload.threadId,
      );
      const sessionThreadId = providerThread?.id ?? event.payload.threadId;

      // The per-thread lease is shared with checkpoint capture, which can park on a slow git command or
      // be held by a turn that never settles. Bound only the acquisition — once the lease is held the
      // revert itself must run to completion — by parking the lease in a child fiber and racing a timeout
      // against the handshake.
      const leaseAcquired = yield* Deferred.make<void>();
      const leaseReleased = yield* Deferred.make<void>();
      const leaseFiber = yield* Effect.forkChild(
        turnCheckpointCoordinator.withThreadLease(
          sessionThreadId,
          Deferred.succeed(leaseAcquired, undefined).pipe(
            Effect.andThen(Deferred.await(leaseReleased)),
          ),
        ),
        { startImmediately: true },
      );

      const acquired = yield* Deferred.await(leaseAcquired).pipe(
        Effect.timeoutOption(REVERT_LEASE_ACQUIRE_TIMEOUT_MS),
      );
      if (Option.isNone(acquired)) {
        yield* Fiber.interrupt(leaseFiber).pipe(Effect.ignore);
        return yield* new CheckpointInvariantError({
          operation: "thread revert",
          detail: `Undo could not start because another checkpoint operation held this thread for more than ${Math.round(
            REVERT_LEASE_ACQUIRE_TIMEOUT_MS / 1000,
          )}s. Try again in a moment.`,
        });
      }

      return yield* handleRevertRequestedWithoutLease(event, sessionThreadId).pipe(
        Effect.ensuring(
          Deferred.succeed(leaseReleased, undefined).pipe(
            Effect.andThen(Fiber.join(leaseFiber)),
            Effect.ignore,
          ),
        ),
      );
    });

  const processDomainEvent = Effect.fnUntraced(function* (event: OrchestrationEvent) {
    if (event.type === "thread.turn-start-requested" || event.type === "thread.message-sent") {
      yield* ensurePreTurnBaselineFromDomainTurnStart(event);
      return;
    }

    if (event.type === "thread.checkpoint-revert-requested") {
      yield* handleRevertRequested(event).pipe(
        Effect.catch((error) =>
          appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: error.message,
            createdAt: new Date().toISOString(),
          }),
        ),
      );
      return;
    }

    if (event.type === "thread.turn-diff-completed") {
      yield* captureCheckpointFromPlaceholder(event);
    }
  });

  const processRuntimeEvent = Effect.fnUntraced(function* (event: ProviderRuntimeEvent) {
    if (event.type === "turn.started") {
      yield* ensurePreTurnBaselineFromTurnStart(event);
      return;
    }

    if (event.type === "item.completed") {
      liveDiffScheduledThreads.delete(event.threadId);
      yield* captureLiveTurnDiff(event);
      return;
    }

    if (event.type === "turn.completed") {
      const turnId = toTurnId(event.turnId);
      yield* captureCheckpointFromTurnCompletion(event).pipe(
        Effect.catch((error) =>
          appendCaptureFailureActivity({
            threadId: event.threadId,
            turnId,
            detail: error.message,
            createdAt: new Date().toISOString(),
          }).pipe(Effect.catch(() => Effect.void)),
        ),
      );
      return;
    }
  });

  const processInput = (
    input: ReactorInput,
  ): Effect.Effect<void, CheckpointStoreError | OrchestrationDispatchError, never> =>
    input.source === "domain" ? processDomainEvent(input.event) : processRuntimeEvent(input.event);

  const processInputSafely = (input: ReactorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("checkpoint reactor failed to process input", {
          source: input.source,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely, {
    capacity: CHECKPOINT_REACTOR_CAPACITY,
  });

  const start: CheckpointReactorShape["start"] = startDrainableWorkerProducers(
    worker,
    Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (
            event.type !== "thread.turn-start-requested" &&
            event.type !== "thread.message-sent" &&
            event.type !== "thread.checkpoint-revert-requested" &&
            event.type !== "thread.turn-diff-completed"
          ) {
            return Effect.void;
          }
          return worker.enqueue({ source: "domain", event });
        }),
      );

      yield* Effect.forkScoped(
        Stream.runForEach(providerService.streamEvents, (event) => {
          if (event.type === "turn.started" || event.type === "turn.completed") {
            return worker.enqueue({ source: "runtime", event });
          }
          if (event.type === "item.completed" && event.payload.itemType === "file_change") {
            return Effect.gen(function* () {
              if (liveDiffScheduledThreads.has(event.threadId)) {
                return;
              }

              if (yield* supportsLiveTurnDiffPatch(event.provider)) {
                return;
              }
              liveDiffScheduledThreads.add(event.threadId);
              yield* worker.enqueue({ source: "runtime", event });
            });
          }
          return Effect.void;
        }),
      );
    }),
  );

  return {
    start,
    drain: worker.drain,
  } satisfies CheckpointReactorShape;
});

export const CheckpointReactorLive = Layer.effect(CheckpointReactor, make).pipe(
  Layer.provide(ProjectionTurnRepositoryLive),
);
