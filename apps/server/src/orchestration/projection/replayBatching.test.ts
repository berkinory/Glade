import { it, assert } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { ServerConfig } from "../../server/config.ts";
import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationProjectionPipelineLive } from "../Layers/ProjectionPipeline.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import {
  type OrchestrationEventReplayFilter,
  OrchestrationEventStore,
  type OrchestrationEventStoreShape,
} from "../../persistence/Services/OrchestrationEventStore.ts";
import {
  ProjectId,
  ThreadId,
  EventId,
  CommandId,
  MessageId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { CorrelationId } from "@glade/contracts/orchestration/threadEntities";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { makeObservedEventStoreLayer } from "./projectionTestFixtures";

it.effect("fast-forwards lagging hot projector cursors before restart replay", () =>
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const firstProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );
    const readCursors: Array<number> = [];
    const readFilters: Array<OrchestrationEventReplayFilter> = [];
    const secondProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(makeObservedEventStoreLayer(readCursors, readFilters)),
      Layer.provideMerge(persistenceLayer),
    );
    const projectId = ProjectId.makeUnsafe("project-bootstrap-fast-forward");
    const threadId = ThreadId.makeUnsafe("thread-bootstrap-fast-forward");
    const createdAt = "2026-07-09T10:00:00.000Z";

    const latestSequence = yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-bootstrap-fast-forward-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-bootstrap-fast-forward-project"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-bootstrap-fast-forward-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Bootstrap fast-forward project",
          workspaceRoot: "/tmp/project-bootstrap-fast-forward",
          defaultModelSelection: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-bootstrap-fast-forward-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-bootstrap-fast-forward-thread"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-bootstrap-fast-forward-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Bootstrap fast-forward thread",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-5-20250929",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* projectionPipeline.bootstrap;

      let latestSequence = 0;
      for (let index = 0; index < 20; index += 1) {
        const occurredAt = `2026-07-09T10:00:${String(index + 1).padStart(2, "0")}.000Z`;
        const savedEvent = yield* eventStore.append({
          type: "thread.activity-appended",
          eventId: EventId.makeUnsafe(`evt-bootstrap-fast-forward-activity-${index}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt,
          commandId: CommandId.makeUnsafe(`cmd-bootstrap-fast-forward-activity-${index}`),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe(`cmd-bootstrap-fast-forward-activity-${index}`),
          metadata: {},
          payload: {
            threadId,
            activity: {
              id: EventId.makeUnsafe(`activity-bootstrap-fast-forward-${index}`),
              tone: "info",
              kind: "context-window.updated",
              summary: "Context window updated",
              payload: { usedTokens: index + 1, maxTokens: 200_000 },
              turnId: null,
              createdAt: occurredAt,
            },
          },
        });
        latestSequence = savedEvent.sequence;
        yield* projectionPipeline.projectEvent(savedEvent);
      }
      return latestSequence;
    }).pipe(Effect.provide(firstProjectionLayer));

    const projectorStates = yield* Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      yield* projectionPipeline.bootstrap;
      return yield* sql<{ readonly projector: string; readonly lastAppliedSequence: number }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector <> ${ORCHESTRATION_PROJECTOR_NAMES.hot}
        ORDER BY projector ASC
      `;
    }).pipe(Effect.provide(secondProjectionLayer));

    assert.equal(readCursors.length, projectorStates.length);
    assert.deepEqual([...new Set(readCursors)], [latestSequence]);
    assert.equal(readFilters.length, projectorStates.length);
    assert.isTrue(readFilters.every((filter) => filter.includeBoundaryEvent === true));
    assert.isTrue(
      readFilters.some(
        (filter) =>
          filter.eventTypes.includes("thread.activity-appended") &&
          filter.activityKinds?.includes("approval.requested") === true,
      ),
    );
    for (const row of projectorStates) {
      assert.equal(row.lastAppliedSequence, latestSequence);
    }
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "glade-projection-pipeline-fast-forward-",
        }),
        NodeServices.layer,
      ),
    ),
  ),
);

it.effect("rebuilds a deleted hot cursor and advances a stalled projector on bootstrap", () =>
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const projectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );
    const projectId = ProjectId.makeUnsafe("project-hot-cursor-repair");
    const threadId = ThreadId.makeUnsafe("thread-hot-cursor-repair");
    const createdAt = "2026-08-11T10:00:00.000Z";

    const latestSequence = yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-hot-cursor-repair-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-hot-cursor-repair-project"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-hot-cursor-repair-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Hot cursor repair project",
          workspaceRoot: "/tmp/project-hot-cursor-repair",
          defaultModelSelection: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-hot-cursor-repair-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-hot-cursor-repair-thread"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-hot-cursor-repair-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Hot cursor repair thread",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-5-20250929",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* projectionPipeline.bootstrap;

      let latestSequence = 0;
      for (let index = 0; index < 5; index += 1) {
        const occurredAt = `2026-08-11T10:00:${String(index + 1).padStart(2, "0")}.000Z`;
        const savedEvent = yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe(`evt-hot-cursor-repair-message-${index}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt,
          commandId: CommandId.makeUnsafe(`cmd-hot-cursor-repair-message-${index}`),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe(`cmd-hot-cursor-repair-message-${index}`),
          metadata: {},
          payload: {
            threadId,
            messageId: MessageId.makeUnsafe(`message-hot-cursor-repair-${index}`),
            role: "user",
            text: `message ${index}`,
            turnId: null,
            streaming: false,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
        });
        latestSequence = savedEvent.sequence;
        yield* projectionPipeline.projectEvent(savedEvent);
      }

      yield* sql`
        DELETE FROM projection_state
        WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.hot}
      `;
      yield* sql`
        UPDATE projection_state
        SET last_applied_sequence = 2
        WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadMessages}
      `;
      yield* sql`DELETE FROM projection_thread_messages`;
      return latestSequence;
    }).pipe(Effect.provide(projectionLayer));

    const { stateRows, messageCount } = yield* Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      yield* projectionPipeline.bootstrap;
      const stateRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT projector, last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        ORDER BY projector ASC
      `;
      const [countRow] = yield* sql<{ readonly messageCount: number }>`
        SELECT COUNT(*) AS "messageCount" FROM projection_thread_messages
      `;
      return { stateRows, messageCount: countRow?.messageCount ?? 0 };
    }).pipe(Effect.provide(projectionLayer));

    const cursorByProjector = new Map(
      stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
    );
    assert.equal(cursorByProjector.get(ORCHESTRATION_PROJECTOR_NAMES.hot), latestSequence);
    assert.equal(
      cursorByProjector.get(ORCHESTRATION_PROJECTOR_NAMES.threadMessages),
      latestSequence,
    );

    assert.equal(messageCount, 5);
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "glade-projection-pipeline-hot-cursor-repair-",
        }),
        NodeServices.layer,
      ),
    ),
  ),
);

it.effect("replays a backlog larger than one commit batch without losing rows or cursors", () =>
  Effect.gen(function* () {
    // Bootstrap replay commits in batches (BOOTSTRAP_REPLAY_BATCH_SIZE = 500) to amortize fsync. A
    // backlog spanning multiple batches, with the final batch partially filled, must still converge:
    // every event applied, the cursor at the journal head, and — because rows and cursor share each
    // batch transaction — never a committed cursor ahead of committed rows.
    const { dbPath } = yield* ServerConfig;
    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const projectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );
    const projectId = ProjectId.makeUnsafe("project-batched-replay");
    const threadId = ThreadId.makeUnsafe("thread-batched-replay");
    const createdAt = "2026-08-12T08:00:00.000Z";
    const messageCount = 1_200;

    yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-batched-replay-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-batched-replay-project"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-batched-replay-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Batched replay project",
          workspaceRoot: "/tmp/project-batched-replay",
          defaultModelSelection: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-batched-replay-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-batched-replay-thread"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-batched-replay-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Batched replay thread",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-5-20250929",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      for (let index = 0; index < messageCount; index += 1) {
        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe(`evt-batched-replay-message-${index}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: createdAt,
          commandId: CommandId.makeUnsafe(`cmd-batched-replay-message-${index}`),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe(`cmd-batched-replay-message-${index}`),
          metadata: {},
          payload: {
            threadId,
            messageId: MessageId.makeUnsafe(`message-batched-replay-${index}`),
            role: "user",
            text: `message ${index}`,
            turnId: null,
            streaming: false,
            createdAt,
            updatedAt: createdAt,
          },
        });
      }

      yield* sql`DELETE FROM projection_state`;
      yield* sql`DELETE FROM projection_thread_messages`;
    }).pipe(Effect.provide(projectionLayer));

    const { stateRows, projectedCount, highWater } = yield* Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      yield* projectionPipeline.bootstrap;
      const stateRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT projector, last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
      `;
      const [countRow] = yield* sql<{ readonly projectedCount: number }>`
        SELECT COUNT(*) AS "projectedCount" FROM projection_thread_messages
      `;
      const highWater = yield* eventStore.getHighWaterSequence();
      return { stateRows, projectedCount: countRow?.projectedCount ?? 0, highWater };
    }).pipe(Effect.provide(projectionLayer));

    assert.equal(projectedCount, messageCount);
    const cursorByProjector = new Map(
      stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
    );
    assert.equal(cursorByProjector.get(ORCHESTRATION_PROJECTOR_NAMES.threadMessages), highWater);
    assert.equal(cursorByProjector.get(ORCHESTRATION_PROJECTOR_NAMES.hot), highWater);
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "glade-projection-pipeline-batched-replay-",
        }),
        NodeServices.layer,
      ),
    ),
  ),
);

it.effect("drains 2,501 file-backed events to a captured high-water fence", () =>
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const eventStoreLayer = OrchestrationEventStoreLive.pipe(Layer.provideMerge(persistenceLayer));
    const projectId = ProjectId.makeUnsafe("project-bootstrap-paged");
    const occurredAt = "2026-07-14T01:00:00.000Z";

    yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-bootstrap-paged-created"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt,
        commandId: CommandId.makeUnsafe("cmd-bootstrap-paged-created"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-bootstrap-paged-created"),
        metadata: {},
        payload: {
          projectId,
          title: "Project 0",
          workspaceRoot: "/tmp/project-bootstrap-paged",
          defaultModelSelection: null,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
      yield* sql`
        WITH RECURSIVE digits(n) AS (
          SELECT 0
          UNION ALL
          SELECT n + 1 FROM digits WHERE n < 49
        ), numbered(n) AS (
          SELECT (high.n * 50) + low.n + 1
          FROM digits AS high
          CROSS JOIN digits AS low
        )
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        SELECT
          'evt-bootstrap-paged-' || n,
          'project',
          ${projectId},
          n,
          'project.meta-updated',
          ${occurredAt},
          'cmd-bootstrap-paged-' || n,
          NULL,
          'cmd-bootstrap-paged-' || n,
          'user',
          json_object(
            'projectId', ${projectId},
            'title', 'Project ' || n,
            'updatedAt', ${occurredAt}
          ),
          json_object('persistedEventSchemaVersion', 1)
        FROM numbered
      `;
    }).pipe(Effect.provide(eventStoreLayer));

    let appendedAfterFence = false;
    const appendAfterFenceLayer = Layer.effect(
      OrchestrationEventStore,
      Effect.gen(function* () {
        const eventStore = yield* OrchestrationEventStore;
        return {
          ...eventStore,
          readFromSequence(sequenceExclusive, limit, throughSequenceInclusive, filter) {
            return Stream.unwrap(
              Effect.gen(function* () {
                if (!appendedAfterFence) {
                  appendedAfterFence = true;
                  yield* eventStore.append({
                    type: "project.meta-updated",
                    eventId: EventId.makeUnsafe("evt-bootstrap-paged-after-fence"),
                    aggregateKind: "project",
                    aggregateId: projectId,
                    occurredAt,
                    commandId: CommandId.makeUnsafe("cmd-bootstrap-paged-after-fence"),
                    causationEventId: null,
                    correlationId: CorrelationId.makeUnsafe("cmd-bootstrap-paged-after-fence"),
                    metadata: {},
                    payload: {
                      projectId,
                      title: "Project after fence",
                      updatedAt: occurredAt,
                    },
                  });
                }
                return eventStore.readFromSequence(
                  sequenceExclusive,
                  limit,
                  throughSequenceInclusive,
                  filter,
                );
              }),
            );
          },
        } satisfies OrchestrationEventStoreShape;
      }),
    ).pipe(Layer.provide(OrchestrationEventStoreLive));
    const projectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(appendAfterFenceLayer),
      Layer.provideMerge(persistenceLayer),
    );

    const result = yield* Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      yield* projectionPipeline.bootstrap;
      const projects = yield* sql<{ readonly title: string }>`
        SELECT title FROM projection_projects WHERE project_id = ${projectId}
      `;
      const cursors = yield* sql<{ readonly lastAppliedSequence: number }>`
        SELECT last_applied_sequence AS "lastAppliedSequence" FROM projection_state
      `;
      const eventCount = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM orchestration_events
      `;
      return { projects, cursors, eventCount: eventCount[0]?.count ?? 0 };
    }).pipe(Effect.provide(projectionLayer));

    assert.deepEqual(result.projects, [{ title: "Project 2500" }]);
    assert.equal(result.eventCount, 2_502);
    assert.equal(result.cursors.length, Object.keys(ORCHESTRATION_PROJECTOR_NAMES).length);
    for (const cursor of result.cursors) {
      assert.equal(cursor.lastAppliedSequence, 2_501);
    }
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "glade-projection-pipeline-paged-",
        }),
        NodeServices.layer,
      ),
    ),
  ),
);

it.effect("restores pending turn-start metadata across projection pipeline restart", () =>
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const firstProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );
    const secondProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );

    const threadId = ThreadId.makeUnsafe("thread-restart");
    const turnId = TurnId.makeUnsafe("turn-restart");
    const messageId = MessageId.makeUnsafe("message-restart");
    const turnStartedAt = "2026-02-26T14:00:00.000Z";
    const sessionSetAt = "2026-02-26T14:00:05.000Z";

    yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* eventStore.append({
        type: "thread.turn-start-requested",
        eventId: EventId.makeUnsafe("evt-restart-1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: turnStartedAt,
        commandId: CommandId.makeUnsafe("cmd-restart-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-restart-1"),
        metadata: {},
        payload: {
          threadId,
          messageId,
          runtimeMode: "approval-required",
          createdAt: turnStartedAt,
        },
      });

      yield* projectionPipeline.bootstrap;
    }).pipe(Effect.provide(firstProjectionLayer));

    const turnRows = yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;

      yield* eventStore.append({
        type: "thread.session-set",
        eventId: EventId.makeUnsafe("evt-restart-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: sessionSetAt,
        commandId: CommandId.makeUnsafe("cmd-restart-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-restart-2"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: turnId,
            lastError: null,
            updatedAt: sessionSetAt,
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const pendingRows = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
      `;
      assert.deepEqual(pendingRows, []);

      return yield* sql<{
        readonly turnId: string;
        readonly userMessageId: string | null;

        readonly requestedAt: string;
        readonly startedAt: string;
      }>`
        SELECT
          turn_id AS "turnId",
          pending_message_id AS "userMessageId",
          requested_at AS "requestedAt",
          started_at AS "startedAt"
        FROM projection_turns
        WHERE turn_id = ${turnId}
      `;
    }).pipe(Effect.provide(secondProjectionLayer));

    assert.deepEqual(turnRows, [
      {
        turnId: "turn-restart",
        userMessageId: "message-restart",
        requestedAt: turnStartedAt,
        startedAt: sessionSetAt,
      },
    ]);
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "glade-projection-pipeline-restart-",
        }),
        NodeServices.layer,
      ),
    ),
  ),
);
