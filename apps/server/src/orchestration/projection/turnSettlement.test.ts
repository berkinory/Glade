import { it, assert } from "@effect/vitest";
import { Layer, Effect, FileSystem, Path } from "effect";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ThreadId, TurnId, EventId, CommandId, MessageId } from "@glade/contracts/core/baseSchemas";
import { CorrelationId } from "@glade/contracts/orchestration/threadEntities";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ServerConfig } from "../../server/config.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import { runManagedAttachmentCleanupBatch } from "../../attachments/managedAttachmentCleanup.ts";
import { makeProjectionPipelinePrefixedTestLayer, exists } from "./projectionTestFixtures";

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-projection-pipeline-turn-finish-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("keeps assistant message completions from settling a running turn early", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.makeUnsafe("thread-turn-finish");
      const turnId = TurnId.makeUnsafe("turn-turn-finish");
      const startedAt = "2026-02-27T09:00:00.000Z";
      const assistantCompletedAt = "2026-02-27T09:00:02.000Z";
      const turnFinishedAt = "2026-02-27T09:00:05.000Z";

      yield* eventStore.append({
        type: "thread.turn-start-requested",
        eventId: EventId.makeUnsafe("evt-turn-finish-1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: startedAt,
        commandId: CommandId.makeUnsafe("cmd-turn-finish-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-turn-finish-1"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-turn-finish"),
          runtimeMode: "full-access",
          createdAt: startedAt,
        },
      });

      yield* eventStore.append({
        type: "thread.session-set",
        eventId: EventId.makeUnsafe("evt-turn-finish-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: startedAt,
        commandId: CommandId.makeUnsafe("cmd-turn-finish-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-turn-finish-2"),
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

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-turn-finish-3"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: assistantCompletedAt,
        commandId: CommandId.makeUnsafe("cmd-turn-finish-3"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-turn-finish-3"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("assistant-turn-finish"),
          role: "assistant",
          text: "",
          turnId,
          streaming: false,
          createdAt: assistantCompletedAt,
          updatedAt: assistantCompletedAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rowsAfterAssistantComplete = yield* sql<{
        readonly state: string;
        readonly completedAt: string | null;
        readonly assistantMessageId: string | null;
      }>`
        SELECT
          state,
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
      `;
      assert.deepEqual(rowsAfterAssistantComplete, [
        {
          state: "running",
          completedAt: null,
          assistantMessageId: "assistant-turn-finish",
        },
      ]);

      yield* eventStore.append({
        type: "thread.session-set",
        eventId: EventId.makeUnsafe("evt-turn-finish-4"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: turnFinishedAt,
        commandId: CommandId.makeUnsafe("cmd-turn-finish-4"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-turn-finish-4"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "ready",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: turnFinishedAt,
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const rowsAfterSessionReady = yield* sql<{
        readonly state: string;
        readonly completedAt: string | null;
      }>`
        SELECT
          state,
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
      `;
      assert.deepEqual(rowsAfterSessionReady, [
        {
          state: "completed",
          completedAt: turnFinishedAt,
        },
      ]);
    }),
  );

  it.effect("matches in-memory turn settlement for terminal session statuses", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      const scenarios = [
        {
          key: "ready-cleared",
          status: "ready",
          retainsActiveTurn: false,
          expectedState: "completed",
          expectedCompleted: true,
        },
        {
          key: "interrupted-cleared",
          status: "interrupted",
          retainsActiveTurn: false,
          expectedState: "interrupted",
          expectedCompleted: true,
        },
        {
          key: "stopped-cleared",
          status: "stopped",
          retainsActiveTurn: false,
          expectedState: "interrupted",
          expectedCompleted: true,
        },
        {
          key: "error-retained",
          status: "error",
          retainsActiveTurn: true,
          expectedState: "error",
          expectedCompleted: true,
        },
        {
          key: "interrupted-retained",
          status: "interrupted",
          retainsActiveTurn: true,
          expectedState: "running",
          expectedCompleted: false,
        },
        {
          key: "stopped-retained",
          status: "stopped",
          retainsActiveTurn: true,
          expectedState: "running",
          expectedCompleted: false,
        },
      ] as const;

      for (const [index, scenario] of scenarios.entries()) {
        const threadId = ThreadId.makeUnsafe(`thread-session-settlement-${scenario.key}`);
        const turnId = TurnId.makeUnsafe(`turn-session-settlement-${scenario.key}`);
        const startedAt = `2026-02-27T12:00:${String(index * 2).padStart(2, "0")}.000Z`;
        const settledAt = `2026-02-27T12:00:${String(index * 2 + 1).padStart(2, "0")}.000Z`;

        yield* eventStore.append({
          type: "thread.session-set",
          eventId: EventId.makeUnsafe(`evt-session-settlement-${scenario.key}-running`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: startedAt,
          commandId: CommandId.makeUnsafe(`cmd-session-settlement-${scenario.key}-running`),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe(`cmd-session-settlement-${scenario.key}-running`),
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

        yield* eventStore.append({
          type: "thread.session-set",
          eventId: EventId.makeUnsafe(`evt-session-settlement-${scenario.key}-terminal`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: settledAt,
          commandId: CommandId.makeUnsafe(`cmd-session-settlement-${scenario.key}-terminal`),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe(
            `cmd-session-settlement-${scenario.key}-terminal`,
          ),
          metadata: {},
          payload: {
            threadId,
            session: {
              threadId,
              status: scenario.status,
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: scenario.retainsActiveTurn ? turnId : null,
              lastError: scenario.status === "error" ? "provider crashed" : null,
              updatedAt: settledAt,
            },
          },
        });
      }

      yield* projectionPipeline.bootstrap;

      for (const [index, scenario] of scenarios.entries()) {
        const threadId = ThreadId.makeUnsafe(`thread-session-settlement-${scenario.key}`);
        const turnId = TurnId.makeUnsafe(`turn-session-settlement-${scenario.key}`);
        const settledAt = `2026-02-27T12:00:${String(index * 2 + 1).padStart(2, "0")}.000Z`;
        const rows = yield* sql<{
          readonly state: string;
          readonly completedAt: string | null;
        }>`
          SELECT state, completed_at AS "completedAt"
          FROM projection_turns
          WHERE thread_id = ${threadId}
            AND turn_id = ${turnId}
        `;

        assert.deepEqual(rows, [
          {
            state: scenario.expectedState,
            completedAt: scenario.expectedCompleted ? settledAt : null,
          },
        ]);
      }
    }),
  );

  it.effect("projects steer dispatch mode onto the triggering user message", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.makeUnsafe("thread-steer-chip");
      const messageId = MessageId.makeUnsafe("message-steer-chip");
      const createdAt = "2026-02-27T11:00:00.000Z";

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-steer-chip-1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("cmd-steer-chip-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-steer-chip-1"),
        metadata: {},
        payload: {
          threadId,
          messageId,
          role: "user",
          text: "hello",
          dispatchMode: "steer",
          turnId: null,
          streaming: false,
          createdAt,
          updatedAt: createdAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{ readonly dispatchMode: string | null }>`
        SELECT dispatch_mode AS "dispatchMode"
        FROM projection_thread_messages
        WHERE message_id = ${messageId}
      `;

      assert.deepEqual(rows, [{ dispatchMode: "steer" }]);
    }),
  );

  it.effect("preserves exact managed attachment references during projection rebuild", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const managedAttachments = yield* ManagedAttachmentRepository;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { attachmentsDir } = yield* ServerConfig;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.makeUnsafe("thread-managed-rebuild");
      const retainedAttachmentId = "att_v2_11111111111111111111111111111111";
      const prunedAttachmentId = "att_v2_22222222222222222222222222222222";
      const retainedLegacyId = "thread-managed-rebuild-11111111-1111-4111-8111-111111111111";
      const prunedLegacyId = "thread-managed-rebuild-22222222-2222-4222-8222-222222222222";
      const retainedMessageId = MessageId.makeUnsafe("message-managed-retained");
      const prunedMessageId = MessageId.makeUnsafe("message-managed-pruned");
      const createdAt = "2020-07-14T14:00:00.000Z";

      for (const [attachmentId, messageId, commandId] of [
        [retainedAttachmentId, retainedMessageId, "command-managed-retained"],
        [prunedAttachmentId, prunedMessageId, "command-managed-pruned"],
      ] as const) {
        const reserved = yield* managedAttachments.reserve({
          attachmentId,
          ownerThreadId: threadId,
          ownerKind: "principal",
          ownerId: "principal-managed-rebuild",
          kind: "file",
          originalName: `${attachmentId}.txt`,
          mimeType: "text/plain",
          reservedBytes: 4,
          relativePath: `objects/${attachmentId.slice(7, 9)}/${attachmentId}.txt`,
          now: createdAt,
        });
        assert.strictEqual(reserved.status, "reserved");
        const staged = yield* managedAttachments.finalizeStaged({
          attachmentId,
          ownerThreadId: threadId,
          ownerKind: "principal",
          ownerId: "principal-managed-rebuild",
          sizeBytes: 4,
          sha256: "a".repeat(64),
          stagingExpiresAt: "2020-07-14T15:00:00.000Z",
          now: "2020-07-14T14:00:01.000Z",
        });
        assert.strictEqual(staged.status, "staged");
        const claimed = yield* managedAttachments.claimForAcceptedTurn({
          attachmentIds: [attachmentId],
          ownerThreadId: threadId,
          ownerKind: "principal",
          ownerId: "principal-managed-rebuild",
          commandId,
          messageId,
          now: "2020-07-14T14:00:02.000Z",
        });
        assert.strictEqual(claimed.status, "claimed");
      }

      for (const [eventId, commandId, messageId, attachmentId, text, occurredAt] of [
        [
          "evt-managed-rebuild-retained",
          "cmd-managed-rebuild-retained",
          retainedMessageId,
          retainedAttachmentId,
          "retained",
          "2020-07-14T14:00:03.000Z",
        ],
        [
          "evt-managed-rebuild-pruned",
          "cmd-managed-rebuild-pruned",
          prunedMessageId,
          prunedAttachmentId,
          "pruned",
          "2020-07-14T14:00:04.000Z",
        ],
      ] as const) {
        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe(eventId),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt,
          commandId: CommandId.makeUnsafe(commandId),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe(commandId),
          metadata: {},
          payload: {
            threadId,
            messageId,
            role: "user",
            text,
            attachments: [
              {
                type: "file",
                id: attachmentId,
                name: `${text}.txt`,
                mimeType: "text/plain",
                sizeBytes: 4,
              },
              {
                type: "file",
                id: text === "retained" ? retainedLegacyId : prunedLegacyId,
                name: `${text}-legacy.txt`,
                mimeType: "text/plain",
                sizeBytes: 4,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
        });
      }

      yield* eventStore.append({
        type: "thread.conversation-rolled-back",
        eventId: EventId.makeUnsafe("evt-managed-rebuild-rollback"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2020-07-14T14:00:05.000Z",
        commandId: CommandId.makeUnsafe("cmd-managed-rebuild-rollback"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-managed-rebuild-rollback"),
        metadata: {},
        payload: {
          threadId,
          messageId: prunedMessageId,
          numTurns: 1,
          removedTurnIds: [],
        },
      });

      const retainedManagedPath = path.join(
        attachmentsDir,
        `objects/11/${retainedAttachmentId}.txt`,
      );
      const prunedManagedPath = path.join(attachmentsDir, `objects/22/${prunedAttachmentId}.txt`);
      const retainedLegacyPath = path.join(attachmentsDir, `${retainedLegacyId}.txt`);
      const prunedLegacyPath = path.join(attachmentsDir, `${prunedLegacyId}.txt`);
      for (const filePath of [
        retainedManagedPath,
        prunedManagedPath,
        retainedLegacyPath,
        prunedLegacyPath,
      ]) {
        yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
        yield* fileSystem.writeFileString(filePath, "data");
      }

      const highWaterSequence = yield* eventStore.getHighWaterSequence();
      yield* projectionPipeline.bootstrap;
      yield* projectionPipeline.bootstrap;

      assert.isTrue(yield* exists(retainedLegacyPath));
      assert.isFalse(yield* exists(prunedLegacyPath));
      assert.isTrue(yield* exists(retainedManagedPath));
      assert.isTrue(yield* exists(prunedManagedPath));

      const messages = yield* sql<{ readonly messageId: string }>`
        SELECT message_id AS "messageId"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY sequence ASC
      `;
      assert.deepStrictEqual(messages, [{ messageId: retainedMessageId }]);

      const blobs = yield* sql<{ readonly attachmentId: string; readonly state: string }>`
        SELECT attachment_id AS "attachmentId", state
        FROM managed_attachment_blobs
        WHERE owner_thread_id = ${threadId}
        ORDER BY attachment_id ASC
      `;
      assert.deepStrictEqual(blobs, [
        { attachmentId: retainedAttachmentId, state: "claimed" },
        { attachmentId: prunedAttachmentId, state: "deleting" },
      ]);

      const cleanupJobs = yield* sql<{
        readonly attachmentId: string;
        readonly reason: string;
      }>`
        SELECT attachment_id AS "attachmentId", reason
        FROM managed_attachment_cleanup_jobs
        WHERE attachment_id IN (${retainedAttachmentId}, ${prunedAttachmentId})
        ORDER BY attachment_id ASC
      `;
      assert.deepStrictEqual(cleanupJobs, [
        { attachmentId: prunedAttachmentId, reason: "projection-pruned" },
      ]);

      const projectorState = yield* sql<{ readonly lastAppliedSequence: number }>`
        SELECT last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadMessages}
      `;
      assert.deepStrictEqual(projectorState, [{ lastAppliedSequence: highWaterSequence }]);

      yield* runManagedAttachmentCleanupBatch;
      assert.isTrue(yield* exists(retainedLegacyPath));
      assert.isTrue(yield* exists(retainedManagedPath));
      assert.isFalse(yield* exists(prunedManagedPath));
      const completedBlobs = yield* sql<{
        readonly attachmentId: string;
        readonly state: string;
      }>`
        SELECT attachment_id AS "attachmentId", state
        FROM managed_attachment_blobs
        WHERE owner_thread_id = ${threadId}
        ORDER BY attachment_id ASC
      `;
      assert.deepStrictEqual(completedBlobs, [
        { attachmentId: retainedAttachmentId, state: "claimed" },
        { attachmentId: prunedAttachmentId, state: "deleted" },
      ]);
    }),
  );
});
