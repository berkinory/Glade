import { Effect, Option } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert } from "@effect/vitest";
import { ApprovalRequestId, CommandId } from "@glade/contracts/core/baseSchemas";
import { projectionSnapshotLayer, asThreadId, asMessageId } from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot messageReads", (it) => {
  it.effect("keeps UI thread detail capped while export detail includes all messages", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const threadId = asThreadId("thread-export-message-cap");
      const messageCount = 2_005;

      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_pending_interactions`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-export-message-cap',
          'Project Export Message Cap',
          '/tmp/project-export-message-cap',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:00.000Z',
          NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-export-message-cap',
          'project-export-message-cap',
          'Thread Export Message Cap',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          NULL,
          NULL,
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:00.000Z',
          NULL
        )
      `;

      const humanAt = "2026-02-24T00:00:00.000Z";
      yield* sql`UPDATE projection_threads SET latest_human_message_at = ${humanAt} WHERE thread_id = ${threadId}`;
      for (let index = 0; index < messageCount; index += 1) {
        const createdAt = new Date(Date.UTC(2026, 1, 24, 0, 0, index)).toISOString();
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id,
            thread_id,
            turn_id,
            role,
            text,
            is_streaming,
            created_at,
            updated_at
          )
          VALUES (
            ${`message-${index}`},
            'thread-export-message-cap',
            NULL,
            ${index === 0 ? "user" : "assistant"},
            ${`message ${index}`},
            0,
            ${createdAt},
            ${createdAt}
          )
        `;
      }

      yield* sql`DELETE FROM message_text_segments`;
      for (const index of [0, 2_004]) {
        yield* sql`
          INSERT INTO message_text_segments (
            thread_id, message_id, sequence, started_at, ended_at, text
          ) VALUES (
            ${threadId}, ${`message-${index}`}, ${index},
            '2026-02-24T00:00:00.000Z', '2026-02-24T00:00:01.000Z', ${`segment ${index}`}
          )
        `;
      }
      // Providers can reuse a message id in another thread. Its segments must never be joined to the
      // retained message in this thread.
      yield* sql`
        INSERT INTO message_text_segments (
          thread_id, message_id, sequence, started_at, ended_at, text
        ) VALUES (
          'other-segment-owner', 'message-2004', 2004,
          '2026-02-24T00:00:00.000Z', '2026-02-24T00:00:01.000Z', 'other thread text'
        )
      `;

      const cappedDetail = yield* snapshotQuery.getThreadDetailById(threadId);
      const exportDetail = yield* snapshotQuery.getThreadDetailForExportById(threadId);
      const bulk = yield* snapshotQuery.getSnapshot();

      assert.isTrue(Option.isSome(cappedDetail));
      assert.isTrue(Option.isSome(exportDetail));
      const cappedMessages = Option.isSome(cappedDetail) ? cappedDetail.value.messages : [];
      const exportMessages = Option.isSome(exportDetail) ? exportDetail.value.messages : [];
      assert.equal(Option.getOrThrow(cappedDetail).latestHumanMessageAt, humanAt);
      assert.equal(Option.getOrThrow(exportDetail).latestHumanMessageAt, humanAt);
      assert.equal(bulk.threads[0]?.latestHumanMessageAt, humanAt);
      assert.equal(cappedMessages.length, 2_000);
      assert.equal(cappedMessages[0]?.text, "message 5");
      assert.equal(cappedMessages.at(-1)?.text, "message 2004");
      assert.equal(exportMessages.length, messageCount);
      assert.equal(exportMessages[0]?.text, "message 0");
      assert.equal(exportMessages.at(-1)?.text, "message 2004");
      assert.equal(cappedMessages.at(-1)?.textSegments?.[0]?.text, "segment 2004");
      assert.equal(exportMessages[0]?.textSegments?.[0]?.text, "segment 0");
      assert.equal(exportMessages.at(-1)?.textSegments?.[0]?.text, "segment 2004");
      assert.equal(cappedMessages.at(-1)?.textSegments?.length, 1);
      assert.equal(bulk.threads[0]?.messages.length, 2_000);
      assert.equal(bulk.threads[0]?.messages.at(-1)?.textSegments?.[0]?.text, "segment 2004");
      assert.equal(bulk.threads[0]?.messages.at(-1)?.textSegments?.length, 1);
      yield* sql`DELETE FROM message_text_segments`;
    }),
  );

  it.effect("orders snapshot and thread-detail messages by server sequence", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const threadId = asThreadId("thread-causal-message-snapshot");

      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_pending_interactions`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-causal-message-snapshot', 'Causal Message Snapshot',
          '/tmp/project-causal-message-snapshot',
          '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-07-14T12:00:00.000Z', '2026-07-14T12:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          latest_turn_id, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-causal-message-snapshot', 'project-causal-message-snapshot',
          'Causal Message Snapshot', '{"provider":"codex","model":"gpt-5-codex"}',
          NULL, NULL, NULL,
          '2026-07-14T12:00:00.000Z', '2026-07-14T12:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming, source,
          sequence, created_at, updated_at
        ) VALUES
          (
            'message-causal-first', 'thread-causal-message-snapshot', NULL, 'user',
            'accepted first', 0, 'native', 10,
            '2026-07-14T12:10:00.000Z', '2026-07-14T12:10:00.000Z'
          ),
          (
            'message-causal-second', 'thread-causal-message-snapshot', NULL, 'assistant',
            'accepted second despite older clock', 0, 'native', 11,
            '2026-07-14T11:59:00.000Z', '2026-07-14T11:59:00.000Z'
          )
      `;
      yield* sql`
        INSERT INTO projection_pending_interactions (
          interaction_kind, request_id, thread_id, turn_id, lifecycle_generation, status,
          decision, response_command_id, response_requested_at, created_at, resolved_at
        ) VALUES
          (
            'userInput', 'request-retryable', 'thread-causal-message-snapshot', NULL,
            'generation-current', 'retryable', NULL, 'command-response',
            '2026-07-14T12:11:00.000Z', '2026-07-14T12:10:30.000Z', NULL
          ),
          (
            'approval', 'request-confirmed', 'thread-causal-message-snapshot', NULL,
            'generation-current', 'confirmed', 'accept', 'command-approval',
            '2026-07-14T12:12:00.000Z', '2026-07-14T12:11:30.000Z',
            '2026-07-14T12:12:01.000Z'
          )
      `;

      const snapshot = yield* snapshotQuery.getSnapshot();
      const detail = yield* snapshotQuery.getThreadDetailById(threadId);
      const expectedPendingInteractions = [
        {
          interactionKind: "userInput" as const,
          requestId: ApprovalRequestId.makeUnsafe("request-retryable"),
          threadId,
          turnId: null,
          lifecycleGeneration: "generation-current",
          status: "retryable" as const,
          decision: null,
          responseCommandId: CommandId.makeUnsafe("command-response"),
          responseRequestedAt: "2026-07-14T12:11:00.000Z",
          createdAt: "2026-07-14T12:10:30.000Z",
          resolvedAt: null,
        },
      ];
      assert.isTrue(Option.isSome(detail));
      assert.deepStrictEqual(
        snapshot.threads[0]?.messages.map((message) => message.id),
        [asMessageId("message-causal-first"), asMessageId("message-causal-second")],
      );
      assert.deepStrictEqual(
        Option.isSome(detail) ? detail.value.messages.map((message) => message.id) : [],
        [asMessageId("message-causal-first"), asMessageId("message-causal-second")],
      );
      assert.deepStrictEqual(snapshot.threads[0]?.pendingInteractions, expectedPendingInteractions);
      assert.deepStrictEqual(
        Option.isSome(detail) ? detail.value.pendingInteractions : [],
        expectedPendingInteractions,
      );
    }),
  );
});
