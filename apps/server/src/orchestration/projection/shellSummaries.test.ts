import { it, assert } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  ThreadId,
  EventId,
  CommandId,
  MessageId,
  ProjectId,
} from "@glade/contracts/core/baseSchemas";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../Layers/ProjectionSnapshotQuery.ts";
import {
  makeProjectionPipelinePrefixedTestLayer,
  makeScenarioAppender,
  makeAppendAndProject,
} from "./projectionTestFixtures";

it.layer(makeProjectionPipelinePrefixedTestLayer("glade-projection-pipeline-deferred-"))(
  "OrchestrationProjectionPipeline deferred cursor",
  (it) => {
    it.effect(
      "settles the deferred cursor inside the hot transaction only when it is caught up",
      () =>
        Effect.gen(function* () {
          const projectionPipeline = yield* OrchestrationProjectionPipeline;
          const eventStore = yield* OrchestrationEventStore;
          const sql = yield* SqlClient.SqlClient;
          const now = new Date().toISOString();
          const threadId = ThreadId.makeUnsafe("thread-deferred-settle");
          const cursorOf = (projector: string) =>
            Effect.map(
              sql<{ readonly sequence: number }>`
            SELECT last_applied_sequence AS sequence FROM projection_state WHERE projector = ${projector}
          `,
              (rows) => rows[0]?.sequence ?? null,
            );
          const streamedDelta = (index: number, text: string) =>
            eventStore.append({
              type: "thread.message-sent",
              eventId: EventId.makeUnsafe(`evt-deferred-settle-${index}`),
              aggregateKind: "thread",
              aggregateId: threadId,
              occurredAt: now,
              commandId: CommandId.makeUnsafe(`cmd-deferred-settle-${index}`),
              causationEventId: null,
              correlationId: CommandId.makeUnsafe(`cmd-deferred-settle-${index}`),
              metadata: {},
              payload: {
                threadId,
                messageId: MessageId.makeUnsafe("message-deferred-settle"),
                role: "assistant",
                text,
                turnId: null,
                streaming: true,
                createdAt: now,
                updatedAt: now,
              },
            });

          yield* projectionPipeline.bootstrap;

          const first = yield* streamedDelta(1, "one ");
          yield* projectionPipeline.projectEvent(first);
          assert.strictEqual(yield* cursorOf(ORCHESTRATION_PROJECTOR_NAMES.hot), first.sequence);
          assert.strictEqual(
            yield* cursorOf(ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries),
            first.sequence,
          );

          const second = yield* streamedDelta(2, "two ");
          const settled = yield* sql.withTransaction(
            projectionPipeline.projectHotEventInCurrentTransaction(second),
          );
          assert.isTrue(settled.deferredPhaseSettled);
          assert.strictEqual(yield* cursorOf(ORCHESTRATION_PROJECTOR_NAMES.hot), second.sequence);
          assert.strictEqual(
            yield* cursorOf(ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries),
            second.sequence,
          );

          // Lagging (a failed or in-flight deferred catch-up): the hot transaction must leave the deferred
          // cursor alone so the catch-up still replays.
          yield* sql`
        UPDATE projection_state SET last_applied_sequence = ${first.sequence}
        WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries}
      `;
          const third = yield* streamedDelta(3, "three");
          const notSettled = yield* sql.withTransaction(
            projectionPipeline.projectHotEventInCurrentTransaction(third),
          );
          assert.isFalse(notSettled.deferredPhaseSettled);
          assert.strictEqual(yield* cursorOf(ORCHESTRATION_PROJECTOR_NAMES.hot), third.sequence);
          assert.strictEqual(
            yield* cursorOf(ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries),
            first.sequence,
          );
          yield* projectionPipeline.projectDeferredEvent(third);
          assert.strictEqual(
            yield* cursorOf(ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries),
            third.sequence,
          );
        }),
    );
  },
);

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-human-recency-test-")))(
  "human message recency",
  (it) => {
    it.effect(
      "projects human sends separately and restores their timestamp after rollback and replay",
      () =>
        Effect.gen(function* () {
          const pipeline = yield* OrchestrationProjectionPipeline;
          const eventStore = yield* OrchestrationEventStore;
          const sql = yield* SqlClient.SqlClient;
          const append = makeScenarioAppender(
            makeAppendAndProject(eventStore, pipeline),
            "human-recency",
          );
          const threadId = ThreadId.makeUnsafe("human-recency");
          const projectId = ProjectId.makeUnsafe("human-recency-project");
          const at = (minute: number) => `2026-09-17T10:${String(minute).padStart(2, "0")}:00.000Z`;
          yield* append({
            type: "project.created",
            aggregateKind: "project",
            aggregateId: projectId,
            occurredAt: at(0),
            payload: {
              projectId,
              title: "Recency",
              workspaceRoot: "/tmp/human-recency",
              defaultModelSelection: null,
              createdAt: at(0),
              updatedAt: at(0),
            },
          });
          yield* append({
            type: "thread.created",
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: at(0),
            payload: {
              threadId,
              projectId,
              title: "Recency",
              modelSelection: { provider: "codex", model: "gpt-5" },
              runtimeMode: "full-access",
              branch: null,
              worktreePath: null,
              createdAt: at(0),
              updatedAt: at(0),
            },
          });
          for (const [index, dispatchOrigin] of (
            [undefined, "agent", "automation", "user"] as const
          ).entries()) {
            yield* append({
              type: "thread.message-sent",
              aggregateKind: "thread",
              aggregateId: threadId,
              occurredAt: at(index + 1),
              payload: {
                threadId,
                messageId: MessageId.makeUnsafe(`human-recency-${index}`),
                role: "user",
                ...(dispatchOrigin ? { dispatchOrigin } : {}),
                text: "Follow-up",
                turnId: null,
                streaming: false,
                createdAt: at(index + 1),
                updatedAt: at(index + 1),
              },
            });
            const [row] =
              yield* sql`SELECT latest_user_message_at, latest_human_message_at FROM projection_threads WHERE thread_id = ${threadId}`;
            assert.deepStrictEqual(row, {
              latest_user_message_at: at(index + 1),
              latest_human_message_at: index === 3 ? at(4) : at(1),
            });
          }
          const resendAt = at(6);
          for (const [index, createdAt] of [resendAt, at(4)].entries()) {
            yield* append({
              type: "thread.message-sent",
              aggregateKind: "thread",
              aggregateId: threadId,
              occurredAt: at(6 + index),
              payload: {
                threadId,
                messageId: MessageId.makeUnsafe("human-recency-3"),
                role: "user",
                dispatchOrigin: "user",
                text: "Edited and resent",
                turnId: null,
                streaming: false,
                createdAt,
                updatedAt: resendAt,
              },
            });
          }
          yield* append({
            type: "thread.message-sent",
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: at(8),
            payload: {
              threadId,
              messageId: MessageId.makeUnsafe("human-recency-next"),
              role: "user",
              dispatchOrigin: "user",
              text: "Later prompt",
              turnId: null,
              streaming: false,
              createdAt: at(8),
              updatedAt: at(8),
            },
          });
          yield* append({
            type: "thread.conversation-rolled-back",
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: at(9),
            payload: {
              threadId,
              messageId: MessageId.makeUnsafe("human-recency-next"),
              numTurns: 1,
            },
          });
          const assertResendSummary = Effect.gen(function* () {
            const [row] =
              yield* sql`SELECT latest_human_message_at FROM projection_threads WHERE thread_id = ${threadId}`;
            assert.strictEqual(row?.latest_human_message_at, resendAt);
            const [message] =
              yield* sql`SELECT created_at, updated_at FROM projection_thread_messages WHERE thread_id = ${threadId} AND message_id = 'human-recency-3'`;
            assert.deepStrictEqual(message, { created_at: at(4), updated_at: resendAt });
          });
          yield* assertResendSummary;
          yield* sql`DELETE FROM projection_state`;
          yield* pipeline.bootstrap;
          yield* assertResendSummary;
          yield* append({
            type: "thread.conversation-rolled-back",
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: at(10),
            payload: { threadId, messageId: MessageId.makeUnsafe("human-recency-3"), numTurns: 1 },
          });
          const readSummary = Effect.gen(function* () {
            const query = yield* ProjectionSnapshotQuery;
            const shell = Option.getOrThrow(yield* query.getThreadShellById(threadId));
            const detail = Option.getOrThrow(yield* query.getThreadDetailById(threadId));
            assert.strictEqual(shell.latestHumanMessageAt, at(1));
            assert.strictEqual(detail.latestHumanMessageAt, at(1));
            assert.strictEqual(shell.latestUserMessageAt, at(3));
          }).pipe(Effect.provide(OrchestrationProjectionSnapshotQueryLive));
          yield* readSummary;
          yield* sql`DELETE FROM projection_state`;
          yield* pipeline.bootstrap;
          yield* readSummary;
        }),
    );
  },
);
