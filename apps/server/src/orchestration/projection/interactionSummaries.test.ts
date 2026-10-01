import { it, assert } from "@effect/vitest";
import { Layer, Effect } from "effect";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  ProjectId,
  ThreadId,
  ApprovalRequestId,
  EventId,
  CommandId,
  MessageId,
} from "@glade/contracts/core/baseSchemas";
import { CorrelationId } from "@glade/contracts/orchestration/threadEntities";
import { makeProjectionPipelinePrefixedTestLayer } from "./projectionTestFixtures";

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-projection-pipeline-approvals-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("refreshes stored thread approval summary after approval-response-requested", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.makeUnsafe("project-approvals");
      const threadId = ThreadId.makeUnsafe("thread-approvals");
      const requestId = ApprovalRequestId.makeUnsafe("approval-request-1");
      const createdAt = "2026-03-05T09:00:00.000Z";
      const requestedAt = "2026-03-05T09:00:01.000Z";
      const resolvedAt = "2026-03-05T09:00:02.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-approvals-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-approvals-project"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-approvals-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Approvals Project",
          workspaceRoot: "/tmp/project-approvals",
          defaultModelSelection: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-approvals-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-approvals-thread"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-approvals-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Approvals Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.activity-appended",
        eventId: EventId.makeUnsafe("evt-approvals-requested"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: requestedAt,
        commandId: CommandId.makeUnsafe("cmd-approvals-requested"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-approvals-requested"),
        metadata: {},
        payload: {
          threadId,
          activity: {
            id: EventId.makeUnsafe("activity-approval-requested"),
            tone: "approval",
            kind: "approval.requested",
            summary: "Command approval requested",
            payload: {
              requestId,
              requestKind: "command",
            },
            turnId: null,
            createdAt: requestedAt,
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const rowsAfterRequest = yield* sql<{
        readonly pendingApprovalCount: number;
      }>`
        SELECT
          pending_approval_count AS "pendingApprovalCount"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      assert.deepEqual(rowsAfterRequest, [{ pendingApprovalCount: 1 }]);

      yield* eventStore.append({
        type: "thread.approval-response-requested",
        eventId: EventId.makeUnsafe("evt-approvals-resolved"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: resolvedAt,
        commandId: CommandId.makeUnsafe("cmd-approvals-resolved"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-approvals-resolved"),
        metadata: {},
        payload: {
          threadId,
          requestId,
          decision: "accept",
          createdAt: resolvedAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rowsAfterResolve = yield* sql<{
        readonly pendingApprovalCount: number;
        readonly updatedAt: string;
      }>`
        SELECT
          pending_approval_count AS "pendingApprovalCount",
          updated_at AS "updatedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      assert.deepEqual(rowsAfterResolve, [
        {
          pendingApprovalCount: 0,
          updatedAt: resolvedAt,
        },
      ]);
    }),
  );

  it.effect("does not refresh stored thread shell summary for streaming assistant deltas", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.makeUnsafe("project-streaming-shell");
      const threadId = ThreadId.makeUnsafe("thread-streaming-shell");
      const createdAt = "2026-03-05T10:00:00.000Z";
      const deltaAt = "2026-03-05T10:00:05.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-streaming-shell-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-streaming-shell-project"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-streaming-shell-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Streaming Shell Project",
          workspaceRoot: "/tmp/project-streaming-shell",
          defaultModelSelection: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-streaming-shell-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-streaming-shell-thread"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-streaming-shell-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Streaming Shell Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-streaming-shell-assistant-delta"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: deltaAt,
        commandId: CommandId.makeUnsafe("cmd-streaming-shell-assistant-delta"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-streaming-shell-assistant-delta"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-streaming-shell-assistant"),
          role: "assistant",
          text: "hello",
          turnId: null,
          streaming: true,
          createdAt: deltaAt,
          updatedAt: deltaAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{
        readonly latestUserMessageAt: string | null;
        readonly updatedAt: string;
      }>`
          SELECT
            latest_user_message_at AS "latestUserMessageAt",
            updated_at AS "updatedAt"
          FROM projection_threads
          WHERE thread_id = ${threadId}
        `;
      assert.deepEqual(rows, [
        {
          latestUserMessageAt: null,
          updatedAt: createdAt,
        },
      ]);
    }),
  );

  it.effect("refreshes stored thread user-input summary after user-input-response-requested", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.makeUnsafe("project-user-inputs");
      const threadId = ThreadId.makeUnsafe("thread-user-inputs");
      const requestId = ApprovalRequestId.makeUnsafe("user-input-request-1");
      const createdAt = "2026-03-05T11:00:00.000Z";
      const requestedAt = "2026-03-05T11:00:01.000Z";
      const respondedAt = "2026-03-05T11:00:02.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-user-input-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-user-input-project"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-user-input-project"),
        metadata: {},
        payload: {
          projectId,
          title: "User Input Project",
          workspaceRoot: "/tmp/project-user-input",
          defaultModelSelection: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-user-input-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-user-input-thread"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-user-input-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "User Input Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.activity-appended",
        eventId: EventId.makeUnsafe("evt-user-input-requested"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: requestedAt,
        commandId: CommandId.makeUnsafe("cmd-user-input-requested"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-user-input-requested"),
        metadata: {},
        payload: {
          threadId,
          activity: {
            id: EventId.makeUnsafe("activity-user-input-requested"),
            tone: "info",
            kind: "user-input.requested",
            summary: "Need more info",
            payload: {
              requestId,
              questions: [
                {
                  id: "q1",
                  header: "Choice",
                  question: "Pick one",
                  options: [
                    {
                      label: "Yes",
                      description: "Use the provided answer",
                    },
                  ],
                },
              ],
            },
            turnId: null,
            createdAt: requestedAt,
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const rowsAfterRequest = yield* sql<{
        readonly pendingApprovalCount: number;
        readonly pendingUserInputCount: number;
      }>`
          SELECT
            pending_approval_count AS "pendingApprovalCount",
            pending_user_input_count AS "pendingUserInputCount"
          FROM projection_threads
          WHERE thread_id = ${threadId}
        `;
      assert.deepEqual(rowsAfterRequest, [{ pendingApprovalCount: 0, pendingUserInputCount: 1 }]);

      yield* sql`
            INSERT INTO projection_pending_interactions (
              interaction_kind,
              request_id,
              thread_id,
              turn_id,
              status,
              decision,
              created_at,
              resolved_at
            )
            VALUES (
              'approval',
              ${requestId},
              ${threadId},
              ${null},
              'pending',
              ${null},
              ${requestedAt},
              ${null}
            )
          `;

      yield* eventStore.append({
        type: "thread.user-input-response-requested",
        eventId: EventId.makeUnsafe("evt-user-input-responded"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: respondedAt,
        commandId: CommandId.makeUnsafe("cmd-user-input-responded"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-user-input-responded"),
        metadata: {},
        payload: {
          threadId,
          requestId,
          answers: {
            q1: "yes",
          },
          createdAt: respondedAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rowsAfterRespond = yield* sql<{
        readonly pendingApprovalCount: number;
        readonly pendingUserInputCount: number;
        readonly updatedAt: string;
      }>`
          SELECT
            pending_approval_count AS "pendingApprovalCount",
            pending_user_input_count AS "pendingUserInputCount",
            updated_at AS "updatedAt"
          FROM projection_threads
          WHERE thread_id = ${threadId}
        `;
      assert.deepEqual(rowsAfterRespond, [
        {
          pendingApprovalCount: 0,
          pendingUserInputCount: 0,
          updatedAt: respondedAt,
        },
      ]);

      const interactionRowsAfterRespond = yield* sql<{
        readonly interactionKind: string;
        readonly status: string;
        readonly responseCommandId: string | null;
      }>`
        SELECT
          interaction_kind AS "interactionKind",
          status,
          response_command_id AS "responseCommandId"
        FROM projection_pending_interactions
        WHERE thread_id = ${threadId} AND request_id = ${requestId}
        ORDER BY interaction_kind
      `;
      assert.deepEqual(interactionRowsAfterRespond, [
        { interactionKind: "approval", status: "pending", responseCommandId: null },
        {
          interactionKind: "userInput",
          status: "responding",
          responseCommandId: "cmd-user-input-responded",
        },
      ]);

      const failedAt = "2026-03-05T11:00:03.000Z";
      yield* eventStore.append({
        type: "thread.activity-appended",
        eventId: EventId.makeUnsafe("evt-user-input-response-failed"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: failedAt,
        commandId: CommandId.makeUnsafe("cmd-user-input-response-failed"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-user-input-response-failed"),
        metadata: {},
        payload: {
          threadId,
          activity: {
            id: EventId.makeUnsafe("activity-user-input-response-failed"),
            tone: "error",
            kind: "provider.user-input.respond.failed",
            summary: "User input response failed",
            payload: {
              requestId,
              responseCommandId: "cmd-user-input-responded",
              settlementStatus: "retryable",
              detail: "No active provider session is bound to this thread.",
            },
            turnId: null,
            createdAt: failedAt,
          },
        },
      });
      yield* projectionPipeline.bootstrap;

      const retryableRows = yield* sql<{
        readonly status: string;
        readonly pendingUserInputCount: number;
      }>`
        SELECT
          interactions.status,
          threads.pending_user_input_count AS "pendingUserInputCount"
        FROM projection_pending_interactions AS interactions
        INNER JOIN projection_threads AS threads
          ON threads.thread_id = interactions.thread_id
        WHERE interactions.thread_id = ${threadId}
          AND interactions.interaction_kind = 'userInput'
          AND interactions.request_id = ${requestId}
      `;
      assert.deepEqual(retryableRows, [{ status: "retryable", pendingUserInputCount: 1 }]);

      const retryAt = "2026-03-05T11:00:04.000Z";
      yield* eventStore.append({
        type: "thread.user-input-response-requested",
        eventId: EventId.makeUnsafe("evt-user-input-retried"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: retryAt,
        commandId: CommandId.makeUnsafe("cmd-user-input-retried"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-user-input-retried"),
        metadata: {},
        payload: {
          threadId,
          requestId,
          answers: { q1: "yes" },
          createdAt: retryAt,
        },
      });
      yield* projectionPipeline.bootstrap;

      const confirmedAt = "2026-03-05T11:00:05.000Z";
      yield* eventStore.append({
        type: "thread.activity-appended",
        eventId: EventId.makeUnsafe("evt-user-input-confirmed"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: confirmedAt,
        commandId: CommandId.makeUnsafe("cmd-user-input-confirmed"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-user-input-confirmed"),
        metadata: {},
        payload: {
          threadId,
          activity: {
            id: EventId.makeUnsafe("activity-user-input-confirmed"),
            tone: "info",
            kind: "user-input.resolved",
            summary: "User input answered",
            payload: { requestId, answers: { q1: "yes" } },
            turnId: null,
            createdAt: confirmedAt,
          },
        },
      });
      yield* projectionPipeline.bootstrap;

      const confirmedRows = yield* sql<{
        readonly status: string;
        readonly responseCommandId: string | null;
        readonly resolvedAt: string;
      }>`
        SELECT
          status,
          response_command_id AS "responseCommandId",
          resolved_at AS "resolvedAt"
        FROM projection_pending_interactions
        WHERE thread_id = ${threadId}
          AND interaction_kind = 'userInput'
          AND request_id = ${requestId}
      `;
      assert.deepEqual(confirmedRows, [
        {
          status: "confirmed",
          responseCommandId: "cmd-user-input-retried",
          resolvedAt: confirmedAt,
        },
      ]);
    }),
  );

  it.effect("settles pending interactions from reconciliation stale-request failures", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.makeUnsafe("project-stale-reconcile");
      const threadId = ThreadId.makeUnsafe("thread-stale-reconcile");
      const requestId = ApprovalRequestId.makeUnsafe("user-input-request-stale");
      const createdAt = "2026-03-06T09:00:00.000Z";
      const requestedAt = "2026-03-06T09:00:01.000Z";
      const reconciledAt = "2026-03-06T09:00:02.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-stale-reconcile-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-stale-reconcile-project"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stale-reconcile-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Stale Reconcile Project",
          workspaceRoot: "/tmp/project-stale-reconcile",
          defaultModelSelection: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-stale-reconcile-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-stale-reconcile-thread"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stale-reconcile-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Stale Reconcile Thread",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-5",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.activity-appended",
        eventId: EventId.makeUnsafe("evt-stale-reconcile-requested"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: requestedAt,
        commandId: CommandId.makeUnsafe("cmd-stale-reconcile-requested"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stale-reconcile-requested"),
        metadata: {},
        payload: {
          threadId,
          activity: {
            id: EventId.makeUnsafe("activity-stale-reconcile-requested"),
            tone: "info",
            kind: "user-input.requested",
            summary: "Need more info",
            payload: {
              requestId,
              lifecycleGeneration: "generation-old",
              questions: [],
            },
            turnId: null,
            createdAt: requestedAt,
          },
        },
      });

      // Restart/session reconciliation reports the request as stale without a responseCommandId: nothing
      // ever claimed the row, but the provider callback that could consume it is gone. The row must not
      // stay pending.
      yield* eventStore.append({
        type: "thread.activity-appended",
        eventId: EventId.makeUnsafe("evt-stale-reconcile-failed"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: reconciledAt,
        commandId: CommandId.makeUnsafe("cmd-stale-reconcile-failed"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-stale-reconcile-failed"),
        metadata: {},
        payload: {
          threadId,
          activity: {
            id: EventId.makeUnsafe("activity-stale-reconcile-failed"),
            tone: "error",
            kind: "provider.user-input.respond.failed",
            summary: "Provider user input response failed",
            payload: {
              requestId,
              detail: `Stale pending user-input request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`,
            },
            turnId: null,
            createdAt: reconciledAt,
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const settledRows = yield* sql<{
        readonly status: string;
        readonly pendingUserInputCount: number;
      }>`
        SELECT
          interactions.status,
          threads.pending_user_input_count AS "pendingUserInputCount"
        FROM projection_pending_interactions AS interactions
        INNER JOIN projection_threads AS threads
          ON threads.thread_id = interactions.thread_id
        WHERE interactions.thread_id = ${threadId}
          AND interactions.interaction_kind = 'userInput'
          AND interactions.request_id = ${requestId}
      `;
      assert.deepEqual(settledRows, [{ status: "uncertain", pendingUserInputCount: 0 }]);
    }),
  );
});
