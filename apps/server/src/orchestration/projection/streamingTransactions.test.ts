import { it, assert } from "@effect/vitest";
import { Layer, Effect, Path } from "effect";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  EventId,
  ProjectId,
  CommandId,
  ThreadId,
  MessageId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import { CorrelationId } from "@glade/contracts/orchestration/threadEntities";
import { ServerConfig } from "../../server/config.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import {
  makeProjectionPipelinePrefixedTestLayer,
  makeAppendAndProject,
  exists,
  readProjectedMessage,
} from "./projectionTestFixtures";

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-projection-attachments-rollback-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("does not persist attachment files when projector transaction rolls back", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const path = yield* Path.Path;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      const appendAndProject = makeAppendAndProject(eventStore, projectionPipeline);

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-rollback-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-rollback"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-rollback-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-rollback-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-rollback"),
          title: "Project Rollback",
          workspaceRoot: "/tmp/project-rollback",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-rollback-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-rollback"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-rollback-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-rollback-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-rollback"),
          projectId: ProjectId.makeUnsafe("project-rollback"),
          title: "Thread Rollback",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* sql`
        CREATE TRIGGER fail_thread_messages_projection_state_update
        BEFORE UPDATE ON projection_state
        WHEN NEW.projector = 'projection.thread-messages'
        BEGIN
          SELECT RAISE(ABORT, 'forced-projection-state-failure');
        END;
      `;

      const result = yield* Effect.result(
        appendAndProject({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe("evt-rollback-3"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-rollback"),
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-rollback-3"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-rollback-3"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-rollback"),
            messageId: MessageId.makeUnsafe("message-rollback"),
            role: "user",
            text: "Rollback me",
            attachments: [
              {
                type: "image",
                id: "thread-rollback-att-1",
                name: "rollback.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      assert.equal(result._tag, "Failure");

      const rows = yield* sql<{
        readonly count: number;
      }>`
        SELECT COUNT(*) AS "count"
        FROM projection_thread_messages
        WHERE message_id = 'message-rollback'
      `;
      assert.equal(rows[0]?.count ?? 0, 0);

      const { attachmentsDir } = yield* ServerConfig;
      const attachmentPath = path.join(attachmentsDir, "thread-rollback-att-1.png");
      assert.isFalse(yield* exists(attachmentPath));
      yield* sql`DROP TRIGGER IF EXISTS fail_thread_messages_projection_state_update`;
    }),
  );

  it.effect("streams assistant deltas into one byte-identical message row", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = makeAppendAndProject(eventStore, projectionPipeline);
      const projectId = ProjectId.makeUnsafe("project-stream-append");
      const threadId = ThreadId.makeUnsafe("thread-stream-append");
      const messageId = MessageId.makeUnsafe("message-stream-append");
      const turnId = TurnId.makeUnsafe("turn-stream-append");
      const otherTurnId = TurnId.makeUnsafe("turn-stream-append-other");
      const createdAt = "2026-04-01T10:00:00.000Z";
      const iso = (offsetSeconds: number) =>
        new Date(Date.parse(createdAt) + offsetSeconds * 1_000).toISOString();

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-stream-append-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-stream-append-project"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stream-append-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Stream Append Project",
          workspaceRoot: "/tmp/project-stream-append",
          defaultModelSelection: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-stream-append-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-stream-append-thread"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stream-append-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Stream Append Thread",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      const deltas = Array.from({ length: 64 }, (_, index) =>
        index % 8 === 3 ? "" : `δ${index}-${"x".repeat(index % 5)}${index % 4 === 0 ? "\n" : " "}`,
      );

      for (const [index, delta] of deltas.entries()) {
        yield* appendAndProject({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe(`evt-stream-append-delta-${index}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: iso(index + 1),
          commandId: CommandId.makeUnsafe(`cmd-stream-append-delta-${index}`),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe(`cmd-stream-append-delta-${index}`),
          metadata: {},
          payload: {
            threadId,
            messageId,
            role: "assistant",
            text: delta,
            // The first delta creates the row without a turn; the next one binds it, and a later conflicting
            // turn must not steal the binding.
            turnId: index === 0 ? null : index === deltas.length - 1 ? otherTurnId : turnId,
            streaming: true,
            ...(index === 1 ? { dispatchOrigin: "agent" as const } : {}),
            createdAt: iso(index + 1),
            updatedAt: iso(index + 1),
          },
        });
        if (index === 0) {
          const rows = yield* sql<{ readonly turnId: string | null }>`
            SELECT turn_id AS "turnId" FROM projection_thread_messages
            WHERE thread_id = ${threadId} AND message_id = ${messageId}
          `;
          assert.strictEqual(rows[0]?.turnId, null);
        }
      }

      const streamedRows = yield* sql<{
        readonly text: string;
        readonly turnId: string | null;
        readonly dispatchOrigin: string | null;
        readonly isStreaming: unknown;
        readonly sequence: number;
        readonly createdAt: string;
        readonly updatedAt: string;
      }>`
        SELECT
          text,
          turn_id AS "turnId",
          dispatch_origin AS "dispatchOrigin",
          is_streaming AS "isStreaming",
          sequence,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId} AND message_id = ${messageId}
      `;
      const streamed = streamedRows[0];
      assert.lengthOf(streamedRows, 1);
      assert.equal((yield* readProjectedMessage(threadId, messageId)).text, deltas.join(""));
      assert.equal(streamed?.turnId, turnId);
      assert.equal(streamed?.dispatchOrigin, "agent");
      assert.isTrue(Boolean(streamed?.isStreaming));
      assert.equal(streamed?.createdAt, iso(1));
      assert.equal(streamed?.updatedAt, iso(deltas.length));

      const firstDeltaSequence = yield* sql<{ readonly sequence: number }>`
        SELECT sequence FROM orchestration_events
        WHERE event_id = 'evt-stream-append-delta-0'
      `;
      assert.equal(streamed?.sequence, firstDeltaSequence[0]?.sequence);

      const lastDeltaSequence = yield* sql<{ readonly sequence: number }>`
        SELECT sequence FROM orchestration_events
        WHERE event_id = ${`evt-stream-append-delta-${deltas.length - 1}`}
      `;
      const shellCursor = yield* sql<{ readonly lastAppliedSequence: number }>`
        SELECT last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries}
      `;
      assert.equal(shellCursor[0]?.lastAppliedSequence, lastDeltaSequence[0]?.sequence);

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-stream-append-final"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: iso(500),
        commandId: CommandId.makeUnsafe("cmd-stream-append-final"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stream-append-final"),
        metadata: {},
        payload: {
          threadId,
          messageId,
          role: "assistant",
          text: "replaced final text",
          turnId,
          streaming: false,
          createdAt: iso(500),
          updatedAt: iso(500),
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-stream-append-complete"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: iso(501),
        commandId: CommandId.makeUnsafe("cmd-stream-append-complete"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stream-append-complete"),
        metadata: {},
        payload: {
          threadId,
          messageId,
          role: "assistant",
          text: "",
          turnId,
          streaming: false,
          createdAt: iso(501),
          updatedAt: iso(501),
        },
      });

      const settledRows = yield* sql<{
        readonly text: string;
        readonly isStreaming: unknown;
        readonly sequence: number;
        readonly createdAt: string;
      }>`
        SELECT text, is_streaming AS "isStreaming", sequence, created_at AS "createdAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId} AND message_id = ${messageId}
      `;
      assert.equal(settledRows[0]?.text, "replaced final text");
      assert.isFalse(Boolean(settledRows[0]?.isStreaming));
      assert.equal(settledRows[0]?.sequence, firstDeltaSequence[0]?.sequence);
      assert.equal(settledRows[0]?.createdAt, iso(1));
    }),
  );

  it.effect("keeps streaming appends and message rebuilds consistent after a rollback", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = makeAppendAndProject(eventStore, projectionPipeline);
      const projectId = ProjectId.makeUnsafe("project-stream-restart");
      const threadId = ThreadId.makeUnsafe("thread-stream-restart");
      const messageId = MessageId.makeUnsafe("message-stream-restart");
      const createdAt = "2026-04-02T10:00:00.000Z";

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-stream-restart-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-stream-restart-project"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stream-restart-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Stream Restart Project",
          workspaceRoot: "/tmp/project-stream-restart",
          defaultModelSelection: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-stream-restart-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-stream-restart-thread"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stream-restart-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Stream Restart Thread",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      for (const [index, delta] of ["first ", "second ", "third"].entries()) {
        yield* appendAndProject({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe(`evt-stream-restart-delta-${index}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: createdAt,
          commandId: CommandId.makeUnsafe(`cmd-stream-restart-delta-${index}`),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe(`cmd-stream-restart-delta-${index}`),
          metadata: {},
          payload: {
            threadId,
            messageId,
            role: "assistant",
            text: delta,
            turnId: null,
            streaming: true,
            createdAt,
            updatedAt: createdAt,
          },
        });
      }

      yield* sql`DELETE FROM projection_thread_messages WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM projection_state`;
      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{ readonly text: string }>`
        SELECT text FROM projection_thread_messages
        WHERE thread_id = ${threadId} AND message_id = ${messageId}
      `;
      assert.lengthOf(rows, 1);
      assert.equal((yield* readProjectedMessage(threadId, messageId)).text, "first second third");
    }),
  );
});
