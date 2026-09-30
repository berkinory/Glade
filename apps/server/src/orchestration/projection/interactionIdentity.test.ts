import { it, assert } from "@effect/vitest";
import { Layer, Effect } from "effect";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ApprovalRequestId, ThreadId, EventId, CommandId } from "@glade/contracts/core/baseSchemas";
import { CorrelationId } from "@glade/contracts/orchestration/threadEntities";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import { makeProjectionPipelinePrefixedTestLayer } from "./projectionTestFixtures";

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-approval-identity-scope-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("keeps reused provider request ids thread-scoped through replay", () =>
      Effect.gen(function* () {
        const eventStore = yield* OrchestrationEventStore;
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const sql = yield* SqlClient.SqlClient;
        const requestId = ApprovalRequestId.makeUnsafe("shared-provider-request-id");
        const firstThreadId = ThreadId.makeUnsafe("thread-shared-provider-request-a");
        const secondThreadId = ThreadId.makeUnsafe("thread-shared-provider-request-b");

        const appendRequest = (input: {
          readonly eventId: string;
          readonly commandId: string;
          readonly activityId: string;
          readonly threadId: ThreadId;
          readonly occurredAt: string;
        }) =>
          eventStore.append({
            type: "thread.activity-appended",
            eventId: EventId.makeUnsafe(input.eventId),
            aggregateKind: "thread",
            aggregateId: input.threadId,
            occurredAt: input.occurredAt,
            commandId: CommandId.makeUnsafe(input.commandId),
            causationEventId: null,
            correlationId: CorrelationId.makeUnsafe(input.commandId),
            metadata: {},
            payload: {
              threadId: input.threadId,
              activity: {
                id: EventId.makeUnsafe(input.activityId),
                tone: "approval" as const,
                kind: "approval.requested" as const,
                summary: "Approval requested",
                payload: { requestId, requestKind: "command" },
                turnId: null,
                createdAt: input.occurredAt,
              },
            },
          });

        yield* appendRequest({
          eventId: "evt-shared-provider-request-a",
          commandId: "cmd-shared-provider-request-a",
          activityId: "activity-shared-provider-request-a",
          threadId: firstThreadId,
          occurredAt: "2026-07-14T12:30:00.000Z",
        });
        yield* appendRequest({
          eventId: "evt-shared-provider-request-b",
          commandId: "cmd-shared-provider-request-b",
          activityId: "activity-shared-provider-request-b",
          threadId: secondThreadId,
          occurredAt: "2026-07-14T12:30:01.000Z",
        });
        yield* eventStore.append({
          type: "thread.approval-response-requested",
          eventId: EventId.makeUnsafe("evt-shared-provider-request-a-response"),
          aggregateKind: "thread",
          aggregateId: firstThreadId,
          occurredAt: "2026-07-14T12:30:02.000Z",
          commandId: CommandId.makeUnsafe("cmd-shared-provider-request-a-response"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-shared-provider-request-a-response"),
          metadata: {},
          payload: {
            threadId: firstThreadId,
            requestId,
            decision: "accept",
            createdAt: "2026-07-14T12:30:02.000Z",
          },
        });

        const readRows = () =>
          sql<{
            readonly threadId: string;
            readonly status: string;
            readonly decision: string | null;
          }>`
          SELECT thread_id AS "threadId", status, decision
          FROM projection_pending_interactions
          WHERE interaction_kind = 'approval' AND request_id = ${requestId}
          ORDER BY thread_id ASC
        `;
        const expectedRows = [
          { threadId: firstThreadId, status: "responding", decision: "accept" },
          { threadId: secondThreadId, status: "pending", decision: null },
        ];

        yield* projectionPipeline.bootstrap;
        assert.deepEqual(yield* readRows(), expectedRows);

        yield* sql`DELETE FROM projection_pending_interactions`;
        yield* sql`
        DELETE FROM projection_state
        WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.pendingInteractions}
      `;
        yield* projectionPipeline.bootstrap;
        assert.deepEqual(yield* readRows(), expectedRows);
      }),
    );

    it.effect("does not let an older provider generation settle a reused request id", () =>
      Effect.gen(function* () {
        const eventStore = yield* OrchestrationEventStore;
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const sql = yield* SqlClient.SqlClient;
        const threadId = ThreadId.makeUnsafe("thread-reused-request-generation");
        const requestId = ApprovalRequestId.makeUnsafe("reused-provider-request");

        const appendRequest = (generation: string, suffix: string, occurredAt: string) =>
          eventStore.append({
            type: "thread.activity-appended",
            eventId: EventId.makeUnsafe(`evt-request-${suffix}`),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt,
            commandId: CommandId.makeUnsafe(`cmd-request-${suffix}`),
            causationEventId: null,
            correlationId: CorrelationId.makeUnsafe(`cmd-request-${suffix}`),
            metadata: {},
            payload: {
              threadId,
              activity: {
                id: EventId.makeUnsafe(`activity-request-${suffix}`),
                tone: "approval" as const,
                kind: "approval.requested" as const,
                summary: "Approval requested",
                payload: { requestId, requestKind: "command", lifecycleGeneration: generation },
                turnId: null,
                createdAt: occurredAt,
              },
            },
          });
        const appendResponse = (generation: string, suffix: string, occurredAt: string) =>
          eventStore.append({
            type: "thread.approval-response-requested",
            eventId: EventId.makeUnsafe(`evt-response-${suffix}`),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt,
            commandId: CommandId.makeUnsafe(`cmd-response-${suffix}`),
            causationEventId: null,
            correlationId: CorrelationId.makeUnsafe(`cmd-response-${suffix}`),
            metadata: {},
            payload: {
              threadId,
              requestId,
              lifecycleGeneration: generation,
              decision: "accept" as const,
              createdAt: occurredAt,
            },
          });
        const readRow = () =>
          sql<{
            readonly lifecycleGeneration: string | null;
            readonly status: string;
            readonly decision: string | null;
          }>`
          SELECT
            lifecycle_generation AS "lifecycleGeneration",
            status,
            decision
          FROM projection_pending_interactions
          WHERE thread_id = ${threadId}
            AND interaction_kind = 'approval'
            AND request_id = ${requestId}
        `;

        yield* appendRequest("generation-a", "a", "2026-07-14T13:00:00.000Z");
        yield* projectionPipeline.bootstrap;
        yield* appendRequest("generation-b", "b", "2026-07-14T13:00:01.000Z");
        yield* appendResponse("generation-a", "stale-a", "2026-07-14T13:00:02.000Z");
        yield* projectionPipeline.bootstrap;
        assert.deepEqual(yield* readRow(), [
          { lifecycleGeneration: "generation-b", status: "pending", decision: null },
        ]);

        yield* appendResponse("generation-b", "current-b", "2026-07-14T13:00:03.000Z");
        yield* projectionPipeline.bootstrap;
        assert.deepEqual(yield* readRow(), [
          { lifecycleGeneration: "generation-b", status: "responding", decision: "accept" },
        ]);

        yield* eventStore.append({
          type: "thread.activity-appended",
          eventId: EventId.makeUnsafe("evt-response-confirmed-b"),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: "2026-07-14T13:00:04.000Z",
          commandId: CommandId.makeUnsafe("cmd-response-confirmed-b"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-response-confirmed-b"),
          metadata: { requestId },
          payload: {
            threadId,
            activity: {
              id: EventId.makeUnsafe("activity-response-confirmed-b"),
              tone: "approval",
              kind: "approval.resolved",
              summary: "Approval resolved",
              payload: {
                requestId,
                lifecycleGeneration: "generation-b",
                decision: "accept",
              },
              turnId: null,
              createdAt: "2026-07-14T13:00:04.000Z",
            },
          },
        });
        yield* projectionPipeline.bootstrap;
        assert.deepEqual(yield* readRow(), [
          { lifecycleGeneration: "generation-b", status: "confirmed", decision: "accept" },
        ]);
      }),
    );
  },
);
