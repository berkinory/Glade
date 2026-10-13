import { it, assert } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { MessageId, ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationSessionStatus } from "@glade/contracts/orchestration/threadEntities";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../Layers/ProjectionSnapshotQuery.ts";
import {
  makeProjectionPipelinePrefixedTestLayer,
  makeScenarioAppender,
} from "./projectionTestFixtures";

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-thread-head-test-")))(
  "thread detail head",
  (it) => {
    it.effect(
      "reports what the detail snapshot shows and the last detail event a client must hold",
      () =>
        Effect.gen(function* () {
          const pipeline = yield* OrchestrationProjectionPipeline;
          const eventStore = yield* OrchestrationEventStore;
          const append = makeScenarioAppender(
            (event) => eventStore.append(event).pipe(Effect.tap(pipeline.projectEvent)),
            "thread-head",
          );
          const query = yield* ProjectionSnapshotQuery;
          const threadId = ThreadId.makeUnsafe("thread-head");
          const projectId = ProjectId.makeUnsafe("thread-head-project");
          const turnId = TurnId.makeUnsafe("thread-head-turn");
          const messageId = MessageId.makeUnsafe("thread-head-reply");
          const at = (second: number) => `2026-10-13T10:00:${String(second).padStart(2, "0")}.000Z`;
          const session = (second: number, status: OrchestrationSessionStatus) =>
            append({
              type: "thread.session-set",
              aggregateKind: "thread",
              aggregateId: threadId,
              occurredAt: at(second),
              payload: {
                threadId,
                session: {
                  threadId,
                  status,
                  providerName: "codex",
                  runtimeMode: "full-access",
                  activeTurnId: status === "running" ? turnId : null,
                  lastError: null,
                  updatedAt: at(second),
                },
              },
            });
          const reply = (second: number, streaming: boolean) =>
            append({
              type: "thread.message-sent",
              aggregateKind: "thread",
              aggregateId: threadId,
              occurredAt: at(second),
              payload: {
                threadId,
                messageId,
                role: "assistant",
                text: "Done.",
                turnId,
                streaming,
                createdAt: at(second),
                updatedAt: at(second),
              },
            });
          const readBoth = Effect.gen(function* () {
            const head = Option.getOrThrow(yield* query.getThreadDetailHeadById(threadId));
            const detail = Option.getOrThrow(yield* query.getThreadDetailSnapshotById(threadId));
            assert.strictEqual(head.snapshotSequence, detail.snapshotSequence);
            assert.deepStrictEqual(head.session, detail.thread.session);
            assert.deepStrictEqual(head.latestTurn, detail.thread.latestTurn);
            assert.deepStrictEqual(head.pendingInteractions, detail.thread.pendingInteractions);
            assert.deepStrictEqual(
              head.streamingMessageIds,
              detail.thread.messages.filter((message) => message.streaming).map(({ id }) => id),
            );
            const latestTurnId = detail.thread.latestTurn?.turnId;
            assert.strictEqual(
              head.latestTurnMessageCount,
              detail.thread.messages.filter((message) => message.turnId === latestTurnId).length,
            );
            assert.strictEqual(
              head.latestTurnActivityCount,
              detail.thread.activities.filter((activity) => activity.turnId === latestTurnId)
                .length,
            );
            return head;
          });

          yield* pipeline.bootstrap;
          assert.isTrue(Option.isNone(yield* query.getThreadDetailHeadById(threadId)));
          yield* append({
            type: "project.created",
            aggregateKind: "project",
            aggregateId: projectId,
            occurredAt: at(0),
            payload: {
              projectId,
              title: "Head",
              workspaceRoot: "/tmp/thread-head",
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
              title: "Head",
              modelSelection: { provider: "codex", model: "gpt-5" },
              runtimeMode: "full-access",
              branch: null,
              worktreePath: null,
              createdAt: at(0),
              updatedAt: at(0),
            },
          });
          yield* session(1, "running");
          const streamed = yield* reply(2, true);

          const running = yield* readBoth;
          assert.strictEqual(running.detailSequence, streamed.sequence);
          assert.deepStrictEqual(running.streamingMessageIds, [messageId]);
          assert.isTrue(running.latestTurnAssistantMessageStored);
          assert.strictEqual(running.latestTurnMessageCount, 1);

          // The thread stream never carries this event, so a client cursor can never reach it.
          const interrupt = yield* append({
            type: "thread.turn-interrupt-requested",
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: at(3),
            payload: { threadId, turnId, createdAt: at(3) },
          });
          const afterInterrupt = yield* readBoth;
          assert.strictEqual(afterInterrupt.snapshotSequence, interrupt.sequence);
          assert.strictEqual(afterInterrupt.detailSequence, streamed.sequence);

          yield* reply(4, false);
          const settled = yield* session(5, "ready");
          const ready = yield* readBoth;
          assert.strictEqual(ready.detailSequence, settled.sequence);
          assert.deepStrictEqual(ready.streamingMessageIds, []);
          assert.strictEqual(ready.latestTurn?.state, "completed");
        }).pipe(Effect.provide(OrchestrationProjectionSnapshotQueryLive)),
    );
  },
);
