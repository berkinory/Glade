import { it, assert } from "@effect/vitest";
import { Layer, Effect, FileSystem, Path } from "effect";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../../server/config.ts";
import {
  ThreadId,
  EventId,
  ProjectId,
  CommandId,
  TurnId,
  CheckpointRef,
  MessageId,
} from "@glade/contracts/core/baseSchemas";
import { CorrelationId } from "@glade/contracts/orchestration/threadEntities";
import { runManagedAttachmentCleanupBatch } from "../../attachments/managedAttachmentCleanup.ts";
import {
  makeProjectionPipelinePrefixedTestLayer,
  makeAppendAndProject,
  exists,
} from "./projectionTestFixtures";

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-projection-attachments-overwrite-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("prunes legacy and managed attachments through their existing authorities", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const managedAttachments = yield* ManagedAttachmentRepository;
      const sql = yield* SqlClient.SqlClient;
      const { attachmentsDir } = yield* ServerConfig;
      const now = new Date().toISOString();
      const threadId = ThreadId.makeUnsafe("Thread Revert.Files");
      const keepAttachmentId = "thread-revert-files-00000000-0000-4000-8000-000000000001";
      const removeAttachmentId = "thread-revert-files-00000000-0000-4000-8000-000000000002";
      const removeFileAttachmentId = "thread-revert-files-00000000-0000-4000-8000-000000000004";
      const otherThreadAttachmentId =
        "thread-revert-files-extra-00000000-0000-4000-8000-000000000003";
      const keepManagedAttachmentId = "att_v2_33333333333333333333333333333333";
      const removeManagedAttachmentId = "att_v2_44444444444444444444444444444444";
      const keepManagedRelativePath = `objects/33/${keepManagedAttachmentId}.txt`;
      const removeManagedRelativePath = `objects/44/${removeManagedAttachmentId}.txt`;

      const appendAndProject = makeAppendAndProject(eventStore, projectionPipeline);

      for (const [attachmentId, relativePath, commandId, messageId] of [
        [
          keepManagedAttachmentId,
          keepManagedRelativePath,
          "command-managed-coexist-keep",
          "message-keep",
        ],
        [
          removeManagedAttachmentId,
          removeManagedRelativePath,
          "command-managed-coexist-remove",
          "message-remove",
        ],
      ] as const) {
        assert.strictEqual(
          (yield* managedAttachments.reserve({
            attachmentId,
            ownerThreadId: threadId,
            ownerKind: "principal",
            ownerId: "principal-managed-coexist",
            kind: "file",
            originalName: `${attachmentId}.txt`,
            mimeType: "text/plain",
            reservedBytes: 5,
            relativePath,
            now,
          })).status,
          "reserved",
        );
        assert.strictEqual(
          (yield* managedAttachments.finalizeStaged({
            attachmentId,
            ownerThreadId: threadId,
            ownerKind: "principal",
            ownerId: "principal-managed-coexist",
            sizeBytes: 5,
            sha256: "b".repeat(64),
            stagingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            now,
          })).status,
          "staged",
        );
        assert.strictEqual(
          (yield* managedAttachments.claimForAcceptedTurn({
            attachmentIds: [attachmentId],
            ownerThreadId: threadId,
            ownerKind: "principal",
            ownerId: "principal-managed-coexist",
            commandId,
            messageId,
            now,
          })).status,
          "claimed",
        );
      }

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-revert-files-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-revert-files"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-revert-files"),
          title: "Project Revert Files",
          workspaceRoot: "/tmp/project-revert-files",
          defaultModelSelection: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-revert-files-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-2"),
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.makeUnsafe("project-revert-files"),
          title: "Thread Revert Files",
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

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.makeUnsafe("evt-revert-files-3"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-3"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-3"),
        metadata: {},
        payload: {
          threadId,
          turnId: TurnId.makeUnsafe("turn-keep"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe(
            "refs/historical/checkpoints/thread-revert-files/turn/1",
          ),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.makeUnsafe("message-keep"),
          completedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-revert-files-4"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-4"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-4"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-keep"),
          role: "assistant",
          text: "Keep",
          attachments: [
            {
              type: "image",
              id: keepAttachmentId,
              name: "keep.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
            {
              type: "file",
              id: keepManagedAttachmentId,
              name: "managed-keep.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
            },
          ],
          turnId: TurnId.makeUnsafe("turn-keep"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.makeUnsafe("evt-revert-files-5"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-5"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-5"),
        metadata: {},
        payload: {
          threadId,
          turnId: TurnId.makeUnsafe("turn-remove"),
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.makeUnsafe(
            "refs/historical/checkpoints/thread-revert-files/turn/2",
          ),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.makeUnsafe("message-remove"),
          completedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-revert-files-6"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-6"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-6"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-remove"),
          role: "assistant",
          text: "Remove",
          attachments: [
            {
              type: "image",
              id: removeAttachmentId,
              name: "remove.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
            {
              type: "file",
              id: removeFileAttachmentId,
              name: "remove.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
            },
            {
              type: "file",
              id: removeManagedAttachmentId,
              name: "managed-remove.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
            },
          ],
          turnId: TurnId.makeUnsafe("turn-remove"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      const keepPath = path.join(attachmentsDir, `${keepAttachmentId}.png`);
      const removePath = path.join(attachmentsDir, `${removeAttachmentId}.png`);
      const removeFilePath = path.join(attachmentsDir, `${removeFileAttachmentId}.txt`);
      const keepManagedPath = path.join(attachmentsDir, keepManagedRelativePath);
      const removeManagedPath = path.join(attachmentsDir, removeManagedRelativePath);
      yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
      yield* fileSystem.makeDirectory(path.dirname(keepManagedPath), { recursive: true });
      yield* fileSystem.makeDirectory(path.dirname(removeManagedPath), { recursive: true });
      yield* fileSystem.writeFileString(keepPath, "keep");
      yield* fileSystem.writeFileString(removePath, "remove");
      yield* fileSystem.writeFileString(removeFilePath, "remove-file");
      yield* fileSystem.writeFileString(keepManagedPath, "keep!");
      yield* fileSystem.writeFileString(removeManagedPath, "drop!");
      const otherThreadPath = path.join(attachmentsDir, `${otherThreadAttachmentId}.png`);
      yield* fileSystem.writeFileString(otherThreadPath, "other");
      assert.isTrue(yield* exists(keepPath));
      assert.isTrue(yield* exists(removePath));
      assert.isTrue(yield* exists(removeFilePath));
      assert.isTrue(yield* exists(otherThreadPath));
      assert.isTrue(yield* exists(keepManagedPath));
      assert.isTrue(yield* exists(removeManagedPath));

      yield* appendAndProject({
        type: "thread.reverted",
        eventId: EventId.makeUnsafe("evt-revert-files-7"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-7"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-7"),
        metadata: {},
        payload: {
          threadId,
          turnCount: 1,
        },
      });

      assert.isTrue(yield* exists(keepPath));
      assert.isFalse(yield* exists(removePath));
      assert.isFalse(yield* exists(removeFilePath));
      assert.isTrue(yield* exists(otherThreadPath));
      assert.isTrue(yield* exists(keepManagedPath));
      assert.isTrue(yield* exists(removeManagedPath));

      const statesBeforeCleanup = yield* sql<{
        readonly attachmentId: string;
        readonly state: string;
      }>`
        SELECT attachment_id AS "attachmentId", state
        FROM managed_attachment_blobs
        WHERE attachment_id IN (${keepManagedAttachmentId}, ${removeManagedAttachmentId})
        ORDER BY attachment_id ASC
      `;
      assert.deepStrictEqual(statesBeforeCleanup, [
        { attachmentId: keepManagedAttachmentId, state: "claimed" },
        { attachmentId: removeManagedAttachmentId, state: "deleting" },
      ]);

      yield* runManagedAttachmentCleanupBatch;

      assert.isTrue(yield* exists(keepManagedPath));
      assert.isFalse(yield* exists(removeManagedPath));
      const statesAfterCleanup = yield* sql<{
        readonly attachmentId: string;
        readonly state: string;
      }>`
        SELECT attachment_id AS "attachmentId", state
        FROM managed_attachment_blobs
        WHERE attachment_id IN (${keepManagedAttachmentId}, ${removeManagedAttachmentId})
        ORDER BY attachment_id ASC
      `;
      assert.deepStrictEqual(statesAfterCleanup, [
        { attachmentId: keepManagedAttachmentId, state: "claimed" },
        { attachmentId: removeManagedAttachmentId, state: "deleted" },
      ]);
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-projection-attachments-revert-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("removes thread attachment directory when thread is deleted", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const { attachmentsDir } = yield* ServerConfig;
      const now = new Date().toISOString();
      const threadId = ThreadId.makeUnsafe("Thread Delete.Files");
      const attachmentId = "thread-delete-files-00000000-0000-4000-8000-000000000001";
      const otherThreadAttachmentId =
        "thread-delete-files-extra-00000000-0000-4000-8000-000000000002";

      const appendAndProject = makeAppendAndProject(eventStore, projectionPipeline);

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-delete-files-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-delete-files"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-delete-files-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-delete-files-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-delete-files"),
          title: "Project Delete Files",
          workspaceRoot: "/tmp/project-delete-files",
          defaultModelSelection: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-delete-files-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-delete-files-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-delete-files-2"),
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.makeUnsafe("project-delete-files"),
          title: "Thread Delete Files",
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

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-delete-files-3"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-delete-files-3"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-delete-files-3"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-delete-files"),
          role: "user",
          text: "Delete",
          attachments: [
            {
              type: "image",
              id: attachmentId,
              name: "delete.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      const threadAttachmentPath = path.join(attachmentsDir, `${attachmentId}.png`);
      const otherThreadAttachmentPath = path.join(attachmentsDir, `${otherThreadAttachmentId}.png`);
      yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(threadAttachmentPath, "delete");
      yield* fileSystem.writeFileString(otherThreadAttachmentPath, "other-thread");
      assert.isTrue(yield* exists(threadAttachmentPath));
      assert.isTrue(yield* exists(otherThreadAttachmentPath));

      yield* appendAndProject({
        type: "thread.deleted",
        eventId: EventId.makeUnsafe("evt-delete-files-4"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-delete-files-4"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-delete-files-4"),
        metadata: {},
        payload: {
          threadId,
          deletedAt: now,
        },
      });

      assert.isFalse(yield* exists(threadAttachmentPath));
      assert.isTrue(yield* exists(otherThreadAttachmentPath));
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-projection-attachments-delete-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("ignores unsafe thread ids for attachment cleanup paths", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const now = new Date().toISOString();
      const { attachmentsDir: attachmentsRootDir, stateDir } = yield* ServerConfig;
      const attachmentsSentinelPath = path.join(attachmentsRootDir, "sentinel.txt");
      const stateDirSentinelPath = path.join(stateDir, "state-sentinel.txt");
      yield* fileSystem.makeDirectory(attachmentsRootDir, { recursive: true });
      yield* fileSystem.writeFileString(attachmentsSentinelPath, "keep-attachments-root");
      yield* fileSystem.writeFileString(stateDirSentinelPath, "keep-state-dir");

      yield* eventStore.append({
        type: "thread.deleted",
        eventId: EventId.makeUnsafe("evt-unsafe-thread-delete"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe(".."),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-unsafe-thread-delete"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-unsafe-thread-delete"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe(".."),
          deletedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      assert.isTrue(yield* exists(attachmentsRootDir));
      assert.isTrue(yield* exists(attachmentsSentinelPath));
      assert.isTrue(yield* exists(stateDirSentinelPath));
    }),
  );
});
