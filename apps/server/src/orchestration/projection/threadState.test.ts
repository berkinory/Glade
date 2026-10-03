import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
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
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import {
  BaseTestLayer,
  makeAppendAndProject,
  makeScenarioAppender,
} from "./projectionTestFixtures";

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect("bootstraps all projection states and writes projection rows", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-1"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          defaultModelSelection: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-2"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Thread 1",
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

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-3"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          messageId: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "hello",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      const projectRows = yield* sql<{
        readonly projectId: string;
        readonly title: string;
        readonly scriptsJson: string;
      }>`
        SELECT
          project_id AS "projectId",
          title,
          scripts_json AS "scriptsJson"
        FROM projection_projects
      `;
      assert.deepEqual(projectRows, [
        { projectId: "project-1", title: "Project 1", scriptsJson: "[]" },
      ]);

      const messageRows = yield* sql<{
        readonly messageId: string;
        readonly text: string;
      }>`
        SELECT
          message_id AS "messageId",
          text
        FROM projection_thread_messages
      `;
      assert.deepEqual(messageRows, [{ messageId: "message-1", text: "hello" }]);

      const stateRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        ORDER BY projector ASC
      `;
      assert.equal(stateRows.length, Object.keys(ORCHESTRATION_PROJECTOR_NAMES).length);
      for (const row of stateRows) {
        assert.equal(row.lastAppliedSequence, 3);
      }
    }),
  );

  it.effect("persists turn-start thread settings into projection rows", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = "2026-02-26T13:00:00.000Z";
      const turnRequestedAt = "2026-02-26T13:00:05.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-turn-settings-project"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-turn-settings"),
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-turn-settings-project"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-turn-settings-project"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-turn-settings"),
          title: "Project",
          workspaceRoot: "/tmp/project-turn-settings",
          defaultModelSelection: null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-turn-settings-thread"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-turn-settings"),
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-turn-settings-thread"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-turn-settings-thread"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-turn-settings"),
          projectId: ProjectId.makeUnsafe("project-turn-settings"),
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4-mini",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* eventStore.append({
        type: "thread.turn-start-requested",
        eventId: EventId.makeUnsafe("evt-turn-settings-start"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-turn-settings"),
        occurredAt: turnRequestedAt,
        commandId: CommandId.makeUnsafe("cmd-turn-settings-start"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-turn-settings-start"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-turn-settings"),
          messageId: MessageId.makeUnsafe("message-turn-settings"),
          modelSelection: {
            provider: "codex",
            model: "gpt-5.5",
          },
          runtimeMode: "approval-required",

          createdAt: turnRequestedAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{
        readonly modelSelectionJson: string;
        readonly runtimeMode: string;

        readonly updatedAt: string;
      }>`
        SELECT
          model_selection_json AS "modelSelectionJson",
          runtime_mode AS "runtimeMode",
          updated_at AS "updatedAt"
        FROM projection_threads
        WHERE thread_id = 'thread-turn-settings'
      `;

      assert.equal(rows.length, 1);
      assert.deepEqual(JSON.parse(rows[0]!.modelSelectionJson), {
        provider: "codex",
        model: "gpt-5.5",
      });
      assert.equal(rows[0]!.runtimeMode, "approval-required");

      assert.equal(rows[0]!.updatedAt, turnRequestedAt);

      const sessionRows = yield* sql<{
        readonly status: string;
        readonly providerName: string | null;
        readonly runtimeMode: string;
        readonly activeTurnId: string | null;
        readonly updatedAt: string;
      }>`
        SELECT
          status,
          provider_name AS "providerName",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        WHERE thread_id = 'thread-turn-settings'
      `;
      assert.deepEqual(sessionRows, [
        {
          status: "starting",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: turnRequestedAt,
        },
      ]);

      const turnCompletedAt = "2026-02-26T13:00:10.000Z";
      yield* eventStore.append({
        type: "thread.session-set",
        eventId: EventId.makeUnsafe("evt-turn-settings-ready"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-turn-settings"),
        occurredAt: turnCompletedAt,
        commandId: CommandId.makeUnsafe("cmd-turn-settings-ready"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-turn-settings-ready"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-turn-settings"),
          session: {
            threadId: ThreadId.makeUnsafe("thread-turn-settings"),
            status: "ready",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: turnCompletedAt,
          },
        },
      });

      yield* sql`
        DELETE FROM projection_thread_sessions
        WHERE thread_id = 'thread-turn-settings'
      `;
      yield* sql`
        DELETE FROM projection_state
        WHERE projector IN (
          ${ORCHESTRATION_PROJECTOR_NAMES.threadSessions},
          ${ORCHESTRATION_PROJECTOR_NAMES.threads}
        )
      `;
      yield* projectionPipeline.bootstrap;

      const rebuiltSessionRows = yield* sql<{
        readonly status: string;
        readonly updatedAt: string;
      }>`
        SELECT status, updated_at AS "updatedAt"
        FROM projection_thread_sessions
        WHERE thread_id = 'thread-turn-settings'
      `;
      assert.deepEqual(rebuiltSessionRows, [
        {
          status: "ready",
          updatedAt: turnCompletedAt,
        },
      ]);

      const crossProviderRequestedAt = "2026-02-26T13:00:15.000Z";
      const crossProviderEvent = yield* eventStore.append({
        type: "thread.turn-start-requested",
        eventId: EventId.makeUnsafe("evt-turn-settings-cross-provider"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-turn-settings"),
        occurredAt: crossProviderRequestedAt,
        commandId: CommandId.makeUnsafe("cmd-turn-settings-cross-provider"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-turn-settings-cross-provider"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-turn-settings"),
          messageId: MessageId.makeUnsafe("message-turn-settings-cross-provider"),
          modelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
          runtimeMode: "full-access",

          createdAt: crossProviderRequestedAt,
        },
      });
      yield* projectionPipeline.projectEvent(crossProviderEvent);

      const providerRows = yield* sql<{
        readonly modelSelectionJson: string;
        readonly providerName: string | null;
      }>`
        SELECT
          threads.model_selection_json AS "modelSelectionJson",
          sessions.provider_name AS "providerName"
        FROM projection_threads AS threads
        LEFT JOIN projection_thread_sessions AS sessions
          ON sessions.thread_id = threads.thread_id
        WHERE threads.thread_id = 'thread-turn-settings'
      `;
      assert.deepEqual(JSON.parse(providerRows[0]!.modelSelectionJson), {
        provider: "codex",
        model: "gpt-5.5",
      });
      assert.equal(providerRows[0]!.providerName, "codex");

      // Automation-dispatched turns run with the automation's modes but must not repaint the thread's
      // persisted runtime/interaction modes.
      const automationRequestedAt = "2026-02-26T13:00:20.000Z";
      const automationEvent = yield* eventStore.append({
        type: "thread.turn-start-requested",
        eventId: EventId.makeUnsafe("evt-turn-settings-automation"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-turn-settings"),
        occurredAt: automationRequestedAt,
        commandId: CommandId.makeUnsafe("cmd-turn-settings-automation"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-turn-settings-automation"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-turn-settings"),
          messageId: MessageId.makeUnsafe("message-turn-settings-automation"),
          dispatchOrigin: "automation",
          runtimeMode: "approval-required",

          createdAt: automationRequestedAt,
        },
      });
      yield* projectionPipeline.projectEvent(automationEvent);

      const automationRows = yield* sql<{
        readonly runtimeMode: string;
      }>`
        SELECT
          runtime_mode AS "runtimeMode"
        FROM projection_threads
        WHERE thread_id = 'thread-turn-settings'
      `;
      assert.equal(automationRows[0]!.runtimeMode, "full-access");
    }),
  );

  it.effect("keeps a retained runtime-error turn terminal across projection rebuilds", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = makeAppendAndProject(eventStore, projectionPipeline);
      const threadId = ThreadId.makeUnsafe("thread-retained-error-turn");
      const turnId = TurnId.makeUnsafe("turn-retained-error-turn");
      const createdAt = "2026-07-21T00:00:00.000Z";
      const requestedAt = "2026-07-21T00:00:01.000Z";
      const startedAt = "2026-07-21T00:00:02.000Z";
      const failedAt = "2026-07-21T00:00:03.000Z";

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-retained-error-project"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-retained-error"),
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-retained-error-project"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-retained-error-project"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-retained-error"),
          title: "Retained error project",
          workspaceRoot: "/tmp/project-retained-error",
          defaultModelSelection: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-retained-error-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-retained-error-thread"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-retained-error-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.makeUnsafe("project-retained-error"),
          title: "Retained error thread",
          modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* appendAndProject({
        type: "thread.turn-start-requested",
        eventId: EventId.makeUnsafe("evt-retained-error-start"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: requestedAt,
        commandId: CommandId.makeUnsafe("cmd-retained-error-start"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-retained-error-start"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-retained-error"),
          modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
          runtimeMode: "full-access",

          dispatchMode: "queue",
          createdAt: requestedAt,
        },
      });
      yield* appendAndProject({
        type: "thread.session-set",
        eventId: EventId.makeUnsafe("evt-retained-error-running"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: startedAt,
        commandId: CommandId.makeUnsafe("cmd-retained-error-running"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-retained-error-running"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: turnId,
            lastError: null,
            updatedAt: startedAt,
          },
        },
      });
      yield* appendAndProject({
        type: "thread.session-set",
        eventId: EventId.makeUnsafe("evt-retained-error-terminal"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: failedAt,
        commandId: CommandId.makeUnsafe("cmd-retained-error-terminal"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-retained-error-terminal"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "error",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: turnId,
            lastError: "provider failed",
            updatedAt: failedAt,
          },
        },
      });

      const readTerminalRows = () =>
        Effect.all({
          sessions: sql<{
            readonly status: string;
            readonly activeTurnId: string | null;
          }>`
            SELECT status, active_turn_id AS "activeTurnId"
            FROM projection_thread_sessions
            WHERE thread_id = ${threadId}
          `,
          turns: sql<{
            readonly state: string;
            readonly completedAt: string | null;
          }>`
            SELECT state, completed_at AS "completedAt"
            FROM projection_turns
            WHERE thread_id = ${threadId} AND turn_id = ${turnId}
          `,
        });

      const liveRows = yield* readTerminalRows();
      assert.deepEqual(liveRows, {
        sessions: [{ status: "error", activeTurnId: turnId }],
        turns: [{ state: "error", completedAt: failedAt }],
      });

      yield* sql`DELETE FROM projection_thread_sessions WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM projection_turns WHERE thread_id = ${threadId}`;
      yield* sql`
        DELETE FROM projection_state
        WHERE projector IN (
          ${ORCHESTRATION_PROJECTOR_NAMES.threadSessions},
          ${ORCHESTRATION_PROJECTOR_NAMES.threadTurns}
        )
      `;
      yield* projectionPipeline.bootstrap;

      assert.deepEqual(yield* readTerminalRows(), liveRows);
    }),
  );

  it.effect("keeps thread updatedAt monotonic across stale session events and replay", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = makeAppendAndProject(eventStore, projectionPipeline);
      const appendScenarioEvent = makeScenarioAppender(appendAndProject, "stale-session");
      const threadId = ThreadId.makeUnsafe("thread-stale-session-updated-at");
      const turnId = TurnId.makeUnsafe("turn-stale-session-updated-at");
      const projectId = ProjectId.makeUnsafe("project-stale-session-updated");
      const modelSelection = { provider: "codex", model: "gpt-5.6-sol" } as const;
      const createdAt = "2026-09-01T00:00:00.000Z";
      const requestedAt = "2026-09-01T00:00:01.000Z";
      const startedAt = "2026-09-01T00:00:02.000Z";
      const completedAt = "2026-09-01T00:00:03.000Z";

      const session = (
        status: "running" | "ready",
        activeTurnId: TurnId | null,
        updatedAt: string,
      ) => ({
        threadId,
        status,
        providerName: "codex",
        runtimeMode: "full-access" as const,
        activeTurnId,
        lastError: null,
        updatedAt,
      });

      yield* appendScenarioEvent({
        type: "project.created",
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        payload: {
          projectId,
          title: "Stale session project",
          workspaceRoot: "/tmp/project-stale-session",
          defaultModelSelection: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* appendScenarioEvent({
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        payload: {
          threadId,
          projectId,
          title: "Stale session thread",
          modelSelection,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* appendScenarioEvent({
        type: "thread.turn-start-requested",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: requestedAt,
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-stale-session"),
          modelSelection,
          runtimeMode: "full-access",

          dispatchMode: "queue",
          createdAt: requestedAt,
        },
      });
      yield* appendScenarioEvent({
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: startedAt,
        payload: { threadId, session: session("running", turnId, startedAt) },
      });
      yield* appendScenarioEvent({
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: completedAt,
        payload: { threadId, session: session("ready", null, completedAt) },
      });

      yield* appendScenarioEvent({
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: startedAt,
        payload: { threadId, session: session("running", turnId, startedAt) },
      });

      const readThreadUpdatedAt = sql<{ readonly updatedAt: string }>`
        SELECT updated_at AS "updatedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      const readTurn = sql<{ readonly state: string; readonly completedAt: string | null }>`
        SELECT state, completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId} AND turn_id = ${turnId}
      `;

      assert.equal((yield* readThreadUpdatedAt)[0]!.updatedAt, completedAt);

      // Projection repair resets projector cursors and replays from the journal; the stale event must not
      // regress the thread row during the rebuild.
      yield* sql`
        DELETE FROM projection_state
        WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threads}
      `;
      yield* projectionPipeline.bootstrap;

      assert.equal((yield* readThreadUpdatedAt)[0]!.updatedAt, completedAt);
      assert.deepEqual(yield* readTurn, [{ state: "completed", completedAt }]);
    }),
  );
});
