import { Effect, FileSystem, Path, Stream, Option, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionSpaceRepository } from "../../persistence/Services/ProjectionSpaces.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionThreadMessageRepository } from "../../persistence/Services/ProjectionThreadMessages.ts";

import { ProjectionThreadActivityRepository } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadSessionRepository } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionPendingInteractionRepository } from "../../persistence/Services/ProjectionPendingInteractions.ts";
import { ServerConfig } from "../../server/config.ts";
import {
  shouldApplyThreadsProjection,
  THREAD_PROJECTION_EVENT_TYPES,
  shouldApplyDeferredThreadShellSummary,
  DEFERRED_THREAD_SHELL_SUMMARY_EVENT_TYPES,
} from "../threadShellEvents.ts";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { parseAttachmentIdFromRelativePath } from "../../attachments/attachmentStore.ts";
import {
  PROJECT_METADATA_SNAPSHOT_PROJECTORS,
  advanceProjectMetadataSnapshotState,
} from "../projectMetadataProjection.ts";
import {
  type OrchestrationProjectionPipelineShape,
  OrchestrationProjectionPipeline,
} from "../Services/ProjectionPipeline.ts";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionSpaceRepositoryLive } from "../../persistence/Layers/ProjectionSpaces.ts";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/Layers/ProjectionThreadMessages.ts";

import { ProjectionThreadActivityRepositoryLive } from "../../persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadSessionRepositoryLive } from "../../persistence/Layers/ProjectionThreadSessions.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProjectionPendingInteractionRepositoryLive } from "../../persistence/Layers/ProjectionPendingInteractions.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { ManagedAttachmentRepositoryLive } from "../../persistence/Layers/ManagedAttachments.ts";
import { makeMetadataProjectors } from "../projection/metadataProjectors";
import { makeThreadProjector } from "../projection/threadProjector";
import { makeShellSummaryProjector } from "../projection/shellSummaryProjector";
import { makeMessageProjector } from "../projection/messageProjector";
import { makeHistoryProjectors } from "../projection/historyProjectors";
import { makeTurnProjector } from "../projection/turnProjector";
import { makeInteractionProjector } from "../projection/interactionProjector";
import {
  ProjectorDefinition,
  ORCHESTRATION_PROJECTOR_NAMES,
  PROJECT_EVENT_TYPES,
  THREAD_MESSAGE_PROJECTION_EVENT_TYPES,
  THREAD_ACTIVITY_PROJECTION_EVENT_TYPES,
  THREAD_SESSION_PROJECTION_EVENT_TYPES,
  shouldApplyThreadTurnsProjection,
  THREAD_TURN_PROJECTION_EVENT_TYPES,
  shouldApplyPendingInteractionsProjection,
  PENDING_INTERACTION_EVENT_TYPES,
  PENDING_INTERACTION_ACTIVITY_KINDS,
  ProjectorName,
  AttachmentSideEffects,
} from "../projection/projectorRegistration";
import { runAttachmentSideEffects } from "../projection/attachmentEffects";

const makeOrchestrationProjectionPipeline = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* OrchestrationEventStore;
  const managedAttachments = yield* ManagedAttachmentRepository;
  const projectionStateRepository = yield* ProjectionStateRepository;
  const projectionProjectRepository = yield* ProjectionProjectRepository;
  const projectionSpaceRepository = yield* ProjectionSpaceRepository;
  const projectionThreadRepository = yield* ProjectionThreadRepository;
  const projectionThreadMessageRepository = yield* ProjectionThreadMessageRepository;

  const projectionThreadActivityRepository = yield* ProjectionThreadActivityRepository;
  const projectionThreadSessionRepository = yield* ProjectionThreadSessionRepository;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const projectionPendingInteractionRepository = yield* ProjectionPendingInteractionRepository;

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;

  const { applyProjectsProjection, applyShellMetadataProjection } = makeMetadataProjectors({
    projectionProjectRepository,
    projectionSpaceRepository,
  });
  const { updateThreadProjection, applyThreadsProjection } = makeThreadProjector({
    projectionThreadRepository,
    projectionThreadSessionRepository,
    projectionThreadMessageRepository,
  });
  const { applyThreadShellSummariesProjection } = makeShellSummaryProjector({
    updateThreadProjection,
    projectionThreadRepository,

    projectionThreadMessageRepository,
    projectionPendingInteractionRepository,
  });
  const { applyThreadMessagesProjection } = makeMessageProjector({
    sql,
    projectionThreadMessageRepository,
    projectionTurnRepository,
  });
  const { applyThreadActivitiesProjection, applyThreadSessionsProjection } = makeHistoryProjectors({
    managedAttachments,
    projectionTurnRepository,
    projectionThreadActivityRepository,
    projectionThreadSessionRepository,
    projectionThreadRepository,
  });
  const { applyThreadTurnsProjection } = makeTurnProjector({ projectionTurnRepository });
  const { applyPendingInteractionsProjection } = makeInteractionProjector({
    updateThreadProjection,
    projectionPendingInteractionRepository,
  });

  const applyCheckpointsProjection: ProjectorDefinition["apply"] = () => Effect.void;

  const projectors: ReadonlyArray<ProjectorDefinition> = [
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.projects,
      phase: "hot",
      shouldApply: (event) => PROJECT_EVENT_TYPES.has(event.type),
      replayFilter: { eventTypes: [...PROJECT_EVENT_TYPES] },
      apply: applyProjectsProjection,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
      phase: "hot",
      shouldApply: (event) => THREAD_MESSAGE_PROJECTION_EVENT_TYPES.has(event.type),
      replayFilter: { eventTypes: [...THREAD_MESSAGE_PROJECTION_EVENT_TYPES] },
      apply: applyThreadMessagesProjection,
    },

    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
      phase: "hot",
      shouldApply: (event) => THREAD_ACTIVITY_PROJECTION_EVENT_TYPES.has(event.type),
      replayFilter: { eventTypes: [...THREAD_ACTIVITY_PROJECTION_EVENT_TYPES] },
      apply: applyThreadActivitiesProjection,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threads,
      phase: "hot",
      shouldApply: shouldApplyThreadsProjection,
      replayFilter: { eventTypes: [...THREAD_PROJECTION_EVENT_TYPES] },
      apply: applyThreadsProjection,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
      phase: "hot",
      shouldApply: (event) => THREAD_SESSION_PROJECTION_EVENT_TYPES.has(event.type),
      replayFilter: { eventTypes: [...THREAD_SESSION_PROJECTION_EVENT_TYPES] },
      apply: applyThreadSessionsProjection,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
      phase: "hot",
      shouldApply: shouldApplyThreadTurnsProjection,
      replayFilter: {
        eventTypes: [...THREAD_TURN_PROJECTION_EVENT_TYPES, "thread.message-sent"],
      },
      apply: applyThreadTurnsProjection,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
      phase: "hot",
      shouldApply: () => false,
      replayFilter: { eventTypes: [] },
      apply: applyCheckpointsProjection,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.pendingInteractions,
      phase: "hot",
      shouldApply: shouldApplyPendingInteractionsProjection,
      replayFilter: {
        eventTypes: [...PENDING_INTERACTION_EVENT_TYPES],
        activityKinds: [...PENDING_INTERACTION_ACTIVITY_KINDS],
      },
      apply: applyPendingInteractionsProjection,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries,
      phase: "deferred",
      shouldApply: shouldApplyDeferredThreadShellSummary,
      replayFilter: { eventTypes: [...DEFERRED_THREAD_SHELL_SUMMARY_EVENT_TYPES] },
      apply: applyThreadShellSummariesProjection,
    },
  ];
  const projectsProjector = projectors.find(
    (projector) => projector.name === ORCHESTRATION_PROJECTOR_NAMES.projects,
  );

  const selectProjectorsForEvent = (
    event: OrchestrationEvent,
    phase?: ProjectorDefinition["phase"],
  ): ReadonlyArray<ProjectorDefinition> => {
    const filterProjectors = (candidates: ReadonlyArray<ProjectorDefinition>) =>
      candidates.filter(
        (projector) =>
          (phase === undefined || projector.phase === phase) &&
          (projector.shouldApply?.(event) ?? true),
      );

    return filterProjectors(
      PROJECT_EVENT_TYPES.has(event.type) && projectsProjector ? [projectsProjector] : projectors,
    );
  };

  const runProjectorsForEventCore = (
    selectedProjectors: ReadonlyArray<ProjectorDefinition>,
    event: OrchestrationEvent,
    phaseCursor?: ProjectorName,
  ) =>
    Effect.gen(function* () {
      if (selectedProjectors.length === 0 && phaseCursor === undefined) {
        return null;
      }
      const attachmentSideEffects: AttachmentSideEffects = {
        deletedThreadIds: new Set<string>(),
        prunedThreadRelativePaths: new Map<string, Set<string>>(),
      };

      yield* Effect.forEach(selectedProjectors, (projector) =>
        projector.apply(event, attachmentSideEffects).pipe(
          Effect.flatMap(() => {
            if (projector.name === phaseCursor) {
              return Effect.void;
            }
            return projectionStateRepository.upsert({
              projector: projector.name,
              lastAppliedSequence: event.sequence,
              updatedAt: event.occurredAt,
            });
          }),
        ),
      );
      if (phaseCursor !== undefined) {
        yield* projectionStateRepository.upsert({
          projector: phaseCursor,
          lastAppliedSequence: event.sequence,
          updatedAt: event.occurredAt,
        });
      }
      for (const threadId of attachmentSideEffects.deletedThreadIds) {
        yield* managedAttachments.markCleanupByThread({
          ownerThreadId: threadId,
          reason: "thread-deleted",
          requestedAt: event.occurredAt,
        });
      }
      for (const [threadId, relativePaths] of attachmentSideEffects.prunedThreadRelativePaths) {
        yield* managedAttachments.markUnreferencedClaimedForCleanup({
          ownerThreadId: threadId,
          retainedAttachmentIds: [...relativePaths]
            .map(parseAttachmentIdFromRelativePath)
            .filter(
              (attachmentId): attachmentId is string =>
                attachmentId?.startsWith("att_v2_") === true,
            ),
          reason: "projection-pruned",
          requestedAt: event.occurredAt,
        });
      }

      return attachmentSideEffects;
    });

  const runProjectorAttachmentSideEffects = (
    selectedProjectors: ReadonlyArray<ProjectorDefinition>,
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects | null,
  ) =>
    attachmentSideEffects === null
      ? Effect.void
      : runAttachmentSideEffects(attachmentSideEffects).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("failed to apply projected attachment side-effects", {
              projectors: selectedProjectors.map((projector) => projector.name),
              sequence: event.sequence,
              eventType: event.type,
              cause,
            }),
          ),
        );

  // A phase whose projectors all rejected the event still has to keep its cursor moving, because the
  // snapshot sequence exposed to clients is the minimum of the phase cursors (see
  // ProjectionSnapshotQuery.computeSnapshotSequence) and a lagging cursor would make clients replay
  // push events they already have. The write is one idempotent upsert, so it does not need — and must
  // not pay for — an explicit transaction: SQLite already commits a lone statement atomically. The
  // deferred phase rejects every assistant delta, so this is the difference between one transaction
  // per streamed token and one statement.
  const advancePhaseCursorOnly = (event: OrchestrationEvent, phaseCursor: ProjectorName) =>
    projectionStateRepository.upsert({
      projector: phaseCursor,
      lastAppliedSequence: event.sequence,
      updatedAt: event.occurredAt,
    });

  const runProjectorsForEvent = (
    selectedProjectors: ReadonlyArray<ProjectorDefinition>,
    event: OrchestrationEvent,
    phaseCursor?: ProjectorName,
  ) =>
    Effect.gen(function* () {
      if (selectedProjectors.length === 0) {
        if (phaseCursor !== undefined) {
          yield* advancePhaseCursorOnly(event, phaseCursor);
        }
        return;
      }
      const attachmentSideEffects = yield* sql.withTransaction(
        runProjectorsForEventCore(selectedProjectors, event, phaseCursor),
      );
      yield* runProjectorAttachmentSideEffects(selectedProjectors, event, attachmentSideEffects);
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig, serverConfig),
    );

  // File removal must wait for the caller's commit: a rolled-back revert or delete would otherwise
  // lose legacy attachment files while its events were never written.
  const runProjectorsForHotEvent = (
    selectedProjectors: ReadonlyArray<ProjectorDefinition>,
    event: OrchestrationEvent,
    phaseCursor: ProjectorName,
  ) =>
    runProjectorsForEventCore(selectedProjectors, event, phaseCursor).pipe(
      Effect.map((attachmentSideEffects) =>
        runProjectorAttachmentSideEffects(selectedProjectors, event, attachmentSideEffects).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.provideService(ServerConfig, serverConfig),
        ),
      ),
    );

  const initializeHotProjectionCursor = Effect.gen(function* () {
    const hotProjectorNames = new Set(
      projectors
        .filter((projector) => projector.phase === "hot")
        .map((projector) => projector.name),
    );
    const stateRows = yield* projectionStateRepository.listAll();
    const sourceRows = stateRows.filter((row) =>
      hotProjectorNames.has(row.projector as ProjectorName),
    );
    if (sourceRows.length === 0) {
      if (stateRows.length > 0) {
        yield* projectionStateRepository.upsert({
          projector: ORCHESTRATION_PROJECTOR_NAMES.hot,
          lastAppliedSequence: 0,
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }

    const oldestCursor = sourceRows.reduce((oldest, row) =>
      row.lastAppliedSequence < oldest.lastAppliedSequence ? row : oldest,
    );
    yield* projectionStateRepository.upsert({
      projector: ORCHESTRATION_PROJECTOR_NAMES.hot,
      lastAppliedSequence: oldestCursor.lastAppliedSequence,
      updatedAt: oldestCursor.updatedAt,
    });
  });

  const fastForwardHotProjectorCursors = Effect.gen(function* () {
    const stateRows = yield* projectionStateRepository.listAll();
    const stateByProjector = new Map(stateRows.map((row) => [row.projector, row] as const));
    const hotState = stateByProjector.get(ORCHESTRATION_PROJECTOR_NAMES.hot);
    if (!hotState) {
      return;
    }

    const laggingProjectors = projectors.filter((projector) => {
      if (projector.phase !== "hot") {
        return false;
      }
      const projectorState = stateByProjector.get(projector.name);
      return (
        projectorState !== undefined &&
        projectorState.lastAppliedSequence < hotState.lastAppliedSequence
      );
    });
    if (laggingProjectors.length === 0) {
      return;
    }

    yield* sql.withTransaction(
      Effect.forEach(laggingProjectors, (projector) =>
        projectionStateRepository.upsert({
          projector: projector.name,
          lastAppliedSequence: hotState.lastAppliedSequence,
          updatedAt: hotState.updatedAt,
        }),
      ),
    );
  });

  // Replay batching amortizes SQLite commit fsyncs, which dominate a large catch-up: one transaction
  // per event costs ~0.5ms of commit overhead each, so a multi-hundred-thousand-event backlog takes
  // minutes on fsync alone. Committing the batch's applied rows and a single tail-cursor upsert
  // together keeps the invariant that a committed cursor never runs ahead of its committed rows; a
  // mid-batch crash merely re-applies up to one batch of idempotent events on the next start.
  const BOOTSTRAP_REPLAY_BATCH_SIZE = 500;

  const applyBootstrapReplayBatch = (
    projector: ProjectorDefinition,
    events: ReadonlyArray<OrchestrationEvent>,
  ) =>
    Effect.gen(function* () {
      const lastEvent = events[events.length - 1];
      if (lastEvent === undefined) {
        return;
      }
      const attachmentSideEffects: AttachmentSideEffects = {
        deletedThreadIds: new Set<string>(),
        prunedThreadRelativePaths: new Map<string, Set<string>>(),
      };
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const event of events) {
            if (projector.shouldApply?.(event) ?? true) {
              yield* projector.apply(event, attachmentSideEffects);
            }
          }

          yield* projectionStateRepository.upsert({
            projector: projector.name,
            lastAppliedSequence: lastEvent.sequence,
            updatedAt: lastEvent.occurredAt,
          });

          for (const threadId of attachmentSideEffects.deletedThreadIds) {
            yield* managedAttachments.markCleanupByThread({
              ownerThreadId: threadId,
              reason: "thread-deleted",
              requestedAt: lastEvent.occurredAt,
            });
          }
          for (const [threadId, relativePaths] of attachmentSideEffects.prunedThreadRelativePaths) {
            yield* managedAttachments.markUnreferencedClaimedForCleanup({
              ownerThreadId: threadId,
              retainedAttachmentIds: [...relativePaths]
                .map(parseAttachmentIdFromRelativePath)
                .filter(
                  (attachmentId): attachmentId is string =>
                    attachmentId?.startsWith("att_v2_") === true,
                ),
              reason: "projection-pruned",
              requestedAt: lastEvent.occurredAt,
            });
          }
        }),
      );
      yield* runProjectorAttachmentSideEffects([projector], lastEvent, attachmentSideEffects);
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig, serverConfig),
    );

  const bootstrapProjector = (projector: ProjectorDefinition, highWaterSequence: number) =>
    projectionStateRepository
      .getByProjector({
        projector: projector.name,
      })
      .pipe(
        Effect.flatMap((stateRow) =>
          Stream.runForEach(
            eventStore
              .readFromSequence(
                Option.isSome(stateRow) ? stateRow.value.lastAppliedSequence : 0,
                Number.MAX_SAFE_INTEGER,
                highWaterSequence,
                {
                  ...projector.replayFilter,
                  includeBoundaryEvent: true,
                },
              )
              .pipe(Stream.grouped(BOOTSTRAP_REPLAY_BATCH_SIZE)),
            (events) => applyBootstrapReplayBatch(projector, events),
          ),
        ),
      );

  const advanceSnapshotProjectorStates = (event: OrchestrationEvent) =>
    sql.withTransaction(
      Effect.forEach(PROJECT_METADATA_SNAPSHOT_PROJECTORS, (projector) =>
        projectionStateRepository.upsert({
          projector,
          lastAppliedSequence: event.sequence,
          updatedAt: event.occurredAt,
        }),
      ),
    );

  const projectMetadataEvent: OrchestrationProjectionPipelineShape["projectMetadataEvent"] = (
    event,
  ) =>
    applyShellMetadataProjection(event).pipe(
      Effect.flatMap(() =>
        advanceProjectMetadataSnapshotState({
          event,
          projectionStateRepository,
        }),
      ),
      Effect.asVoid,
    );

  // The deferred phase rejects every streamed assistant delta, so for those events its only work is
  // moving its cursor (see advancePhaseCursorOnly).
  const settleDeferredPhaseInHotTransaction = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      if (selectProjectorsForEvent(event, "deferred").length > 0) return false;
      const rows = yield* sql<{ readonly projector: string }>`
        UPDATE projection_state
        SET last_applied_sequence = ${event.sequence}, updated_at = ${event.occurredAt}
        WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries}
          AND last_applied_sequence < ${event.sequence}
          AND last_applied_sequence >= (
            SELECT last_applied_sequence FROM projection_state
            WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.hot}
          )
        RETURNING projector
      `.pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionPipeline.settleDeferredPhaseInHotTransaction:query"),
        ),
      );
      return rows.length > 0;
    });

  const projectHotEventInCurrentTransaction: OrchestrationProjectionPipelineShape["projectHotEventInCurrentTransaction"] =
    (event) =>
      settleDeferredPhaseInHotTransaction(event).pipe(
        Effect.flatMap((deferredPhaseSettled) =>
          runProjectorsForHotEvent(
            selectProjectorsForEvent(event, "hot"),
            event,
            ORCHESTRATION_PROJECTOR_NAMES.hot,
          ).pipe(Effect.map((afterCommit) => ({ deferredPhaseSettled, afterCommit }))),
        ),
      );

  const projectHotEventInOwnTransaction = (event: OrchestrationEvent) =>
    runProjectorsForEvent(
      selectProjectorsForEvent(event, "hot"),
      event,
      ORCHESTRATION_PROJECTOR_NAMES.hot,
    ).pipe(
      Effect.catchTag("SqlError", (sqlError) =>
        Effect.fail(
          toPersistenceSqlError("ProjectionPipeline.projectHotEventInOwnTransaction:query")(
            sqlError,
          ),
        ),
      ),
    );

  const projectDeferredEvent: OrchestrationProjectionPipelineShape["projectDeferredEvent"] = (
    event,
  ) =>
    runProjectorsForEvent(
      selectProjectorsForEvent(event, "deferred"),
      event,
      ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries,
    ).pipe(
      Effect.catchTag("SqlError", (sqlError) =>
        Effect.fail(
          toPersistenceSqlError("ProjectionPipeline.projectDeferredEvent:query")(sqlError),
        ),
      ),
    );

  const projectEvent: OrchestrationProjectionPipelineShape["projectEvent"] = (event) =>
    projectHotEventInOwnTransaction(event).pipe(
      Effect.andThen(projectDeferredEvent(event)),
      Effect.flatMap(() =>
        PROJECT_EVENT_TYPES.has(event.type) ? advanceSnapshotProjectorStates(event) : Effect.void,
      ),
      Effect.asVoid,
      Effect.catchTag("SqlError", (sqlError) =>
        Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectEvent:query")(sqlError)),
      ),
    );

  const reportProjectorLag = (phase: "before-replay" | "after-replay", highWaterSequence: number) =>
    Effect.gen(function* () {
      const stateRows = yield* projectionStateRepository.listAll();
      if (stateRows.length === 0) {
        return;
      }
      const sequenceByProjector = new Map(
        stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
      );
      const lagByProjector: Record<string, number> = {};
      const missingProjectors: string[] = [];
      for (const projector of projectors) {
        const sequence = sequenceByProjector.get(projector.name);
        if (sequence === undefined) {
          missingProjectors.push(projector.name);
          continue;
        }
        const lag = highWaterSequence - sequence;
        if (lag > 0) {
          lagByProjector[projector.name] = lag;
        }
      }
      const laggingCount = Object.keys(lagByProjector).length;
      if (laggingCount === 0 && missingProjectors.length === 0) {
        return;
      }
      const annotations = {
        phase,
        highWaterSequence,
        lagByProjector,
        missingProjectors,
      };

      if (phase === "after-replay") {
        yield* Effect.logError("orchestration projectors lag the journal after bootstrap").pipe(
          Effect.annotateLogs(annotations),
        );
        return;
      }
      yield* Effect.logWarning("orchestration projectors lag the journal at bootstrap").pipe(
        Effect.annotateLogs(annotations),
      );
    });

  const bootstrap: OrchestrationProjectionPipelineShape["bootstrap"] = Effect.gen(function* () {
    yield* fastForwardHotProjectorCursors;
    const highWaterSequence = yield* eventStore.getHighWaterSequence();
    yield* reportProjectorLag("before-replay", highWaterSequence);
    yield* Effect.forEach(projectors, (projector) =>
      bootstrapProjector(projector, highWaterSequence),
    );
    yield* initializeHotProjectionCursor;
    yield* reportProjectorLag("after-replay", highWaterSequence);
  }).pipe(
    Effect.tap(() =>
      Effect.log("orchestration projection pipeline bootstrapped").pipe(
        Effect.annotateLogs({ projectors: projectors.length }),
      ),
    ),
    Effect.catchTag("SqlError", (sqlError) =>
      Effect.fail(toPersistenceSqlError("ProjectionPipeline.bootstrap:query")(sqlError)),
    ),
  );

  return {
    bootstrap,
    projectEvent,
    projectHotEventInCurrentTransaction,
    projectDeferredEvent,
    projectMetadataEvent,
  } satisfies OrchestrationProjectionPipelineShape;
});

export const OrchestrationProjectionPipelineLive = Layer.effect(
  OrchestrationProjectionPipeline,
  makeOrchestrationProjectionPipeline,
).pipe(
  Layer.provide(NodeServices.layer),
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(ProjectionSpaceRepositoryLive),
  Layer.provideMerge(ProjectionThreadRepositoryLive),
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),

  Layer.provideMerge(ProjectionThreadActivityRepositoryLive),
  Layer.provideMerge(ProjectionThreadSessionRepositoryLive),
  Layer.provideMerge(ProjectionTurnRepositoryLive),
  Layer.provideMerge(ProjectionPendingInteractionRepositoryLive),
  Layer.provideMerge(ProjectionStateRepositoryLive),
  Layer.provideMerge(ManagedAttachmentRepositoryLive),
);
