import { it, assert } from "@effect/vitest";
import { Layer, Effect } from "effect";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  MessageId,
  ThreadId,
  EventId,
  CommandId,
  ProjectId,
} from "@glade/contracts/core/baseSchemas";
import { CorrelationId } from "@glade/contracts/orchestration/threadEntities";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import {
  makeProjectionPipelinePrefixedTestLayer,
  readProjectedMessage,
} from "./projectionTestFixtures";

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-message-identity-scope-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("keeps reused provider message ids thread-scoped through replay", () =>
      Effect.gen(function* () {
        const eventStore = yield* OrchestrationEventStore;
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const sql = yield* SqlClient.SqlClient;
        const messageId = MessageId.makeUnsafe("shared-provider-message-id");
        const firstThreadId = ThreadId.makeUnsafe("thread-shared-provider-message-a");
        const secondThreadId = ThreadId.makeUnsafe("thread-shared-provider-message-b");

        const appendMessage = (input: {
          readonly eventId: string;
          readonly commandId: string;
          readonly threadId: ThreadId;
          readonly text: string;
          readonly streaming: boolean;
          readonly attachmentId?: string;
          readonly occurredAt: string;
        }) =>
          eventStore.append({
            type: "thread.message-sent",
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
              messageId,
              role: "assistant" as const,
              text: input.text,
              ...(input.attachmentId
                ? {
                    attachments: [
                      {
                        type: "file" as const,
                        id: input.attachmentId,
                        name: `${input.attachmentId}.txt`,
                        mimeType: "text/plain",
                        sizeBytes: 1,
                      },
                    ],
                  }
                : {}),
              turnId: null,
              streaming: input.streaming,
              createdAt: input.occurredAt,
              updatedAt: input.occurredAt,
            },
          });

        yield* appendMessage({
          eventId: "evt-shared-provider-message-a-1",
          commandId: "cmd-shared-provider-message-a-1",
          threadId: firstThreadId,
          text: "first",
          streaming: false,
          attachmentId: "attachment-shared-provider-a",
          occurredAt: "2026-07-14T11:00:00.000Z",
        });
        yield* appendMessage({
          eventId: "evt-shared-provider-message-b-1",
          commandId: "cmd-shared-provider-message-b-1",
          threadId: secondThreadId,
          text: "second",
          streaming: false,
          attachmentId: "attachment-shared-provider-b",
          occurredAt: "2026-07-14T11:00:01.000Z",
        });
        yield* appendMessage({
          eventId: "evt-shared-provider-message-a-2",
          commandId: "cmd-shared-provider-message-a-2",
          threadId: firstThreadId,
          text: " thread",
          streaming: true,
          occurredAt: "2026-07-14T11:00:02.000Z",
        });

        const readRows = () =>
          sql<{ readonly threadId: string; readonly text: string; readonly attachments: string }>`
          SELECT
            thread_id AS "threadId",
            text,
            attachments_json AS attachments
          FROM projection_thread_messages
          WHERE message_id = ${messageId}
          ORDER BY thread_id ASC
        `.pipe(
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) =>
                readProjectedMessage(ThreadId.makeUnsafe(row.threadId), messageId).pipe(
                  Effect.map((message) => ({ ...row, text: message.text })),
                ),
              ),
            ),
          );
        const expectedRows = [
          {
            threadId: firstThreadId,
            text: "first thread",
            attachments: JSON.stringify([
              {
                type: "file",
                id: "attachment-shared-provider-a",
                name: "attachment-shared-provider-a.txt",
                mimeType: "text/plain",
                sizeBytes: 1,
              },
            ]),
          },
          {
            threadId: secondThreadId,
            text: "second",
            attachments: JSON.stringify([
              {
                type: "file",
                id: "attachment-shared-provider-b",
                name: "attachment-shared-provider-b.txt",
                mimeType: "text/plain",
                sizeBytes: 1,
              },
            ]),
          },
        ];

        yield* projectionPipeline.bootstrap;
        assert.deepEqual(yield* readRows(), expectedRows);

        yield* sql`DELETE FROM projection_thread_messages`;
        yield* sql`
        DELETE FROM projection_state
        WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadMessages}
      `;
        yield* projectionPipeline.bootstrap;
        assert.deepEqual(yield* readRows(), expectedRows);
      }),
    );
  },
);

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("glade-text-segment-scope-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect(
      "keeps interleaved assistant text segments through streaming deltas and completion",
      () =>
        Effect.gen(function* () {
          const eventStore = yield* OrchestrationEventStore;
          const projectionPipeline = yield* OrchestrationProjectionPipeline;
          const sql = yield* SqlClient.SqlClient;
          const projectId = ProjectId.makeUnsafe("project-text-segments");
          const threadId = ThreadId.makeUnsafe("thread-text-segments");
          const messageId = MessageId.makeUnsafe("assistant-text-segment-message");

          const append = (input: {
            readonly eventId: string;
            readonly commandId: string;
            readonly occurredAt: string;
            readonly text: string;
            readonly streaming: boolean;
            readonly segmentStartedAt?: string;
          }) =>
            eventStore.append({
              type: "thread.message-sent",
              eventId: EventId.makeUnsafe(input.eventId),
              aggregateKind: "thread",
              aggregateId: threadId,
              occurredAt: input.occurredAt,
              commandId: CommandId.makeUnsafe(input.commandId),
              causationEventId: null,
              correlationId: CorrelationId.makeUnsafe(input.commandId),
              metadata: {},
              payload: {
                threadId,
                messageId,
                role: "assistant" as const,
                text: input.text,
                ...(input.segmentStartedAt ? { segmentStartedAt: input.segmentStartedAt } : {}),
                turnId: null,
                streaming: input.streaming,
                createdAt: input.occurredAt,
                updatedAt: input.occurredAt,
              },
            });

          yield* eventStore.append({
            type: "project.created",
            eventId: EventId.makeUnsafe("evt-text-segments-project"),
            aggregateKind: "project",
            aggregateId: projectId,
            occurredAt: "2026-07-14T10:00:00.000Z",
            commandId: CommandId.makeUnsafe("cmd-text-segments-project"),
            causationEventId: null,
            correlationId: CorrelationId.makeUnsafe("cmd-text-segments-project"),
            metadata: {},
            payload: {
              projectId,
              title: "Text Segments",
              workspaceRoot: "/tmp/text-segments",
              defaultModelSelection: null,
              createdAt: "2026-07-14T10:00:00.000Z",
              updatedAt: "2026-07-14T10:00:00.000Z",
            },
          });
          yield* eventStore.append({
            type: "thread.created",
            eventId: EventId.makeUnsafe("evt-text-segments-thread"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: "2026-07-14T10:00:01.000Z",
            commandId: CommandId.makeUnsafe("cmd-text-segments-thread"),
            causationEventId: null,
            correlationId: CorrelationId.makeUnsafe("cmd-text-segments-thread"),
            metadata: {},
            payload: {
              threadId,
              projectId,
              title: "Text Segments Thread",
              modelSelection: { provider: "codex", model: "gpt-5-codex" },
              runtimeMode: "full-access",
              branch: null,
              worktreePath: null,
              createdAt: "2026-07-14T10:00:01.000Z",
              updatedAt: "2026-07-14T10:00:01.000Z",
            },
          });

          yield* append({
            eventId: "evt-text-segments-delta-1",
            commandId: "cmd-text-segments-delta-1",
            occurredAt: "2026-07-14T10:00:02.000Z",
            text: "Plan: ",
            streaming: true,
            segmentStartedAt: "2026-07-14T10:00:02.000Z",
          });

          yield* append({
            eventId: "evt-text-segments-delta-2",
            commandId: "cmd-text-segments-delta-2",
            occurredAt: "2026-07-14T10:00:03.000Z",
            text: "scan files.",
            streaming: true,
          });

          yield* append({
            eventId: "evt-text-segments-delta-3",
            commandId: "cmd-text-segments-delta-3",
            // A causal boundary can share a millisecond with the first segment; its persisted identity must not
            // overwrite the earlier segment.
            occurredAt: "2026-07-14T10:00:02.000Z",
            text: "Found the largest test file: ",
            streaming: true,
            segmentStartedAt: "2026-07-14T10:00:02.000Z",
          });

          yield* append({
            eventId: "evt-text-segments-delta-4",
            commandId: "cmd-text-segments-delta-4",
            occurredAt: "2026-07-14T10:00:21.000Z",
            text: "ClaudeAdapter.test.ts (~357KB).",
            streaming: true,
          });

          yield* append({
            eventId: "evt-text-segments-complete",
            commandId: "cmd-text-segments-complete",
            occurredAt: "2026-07-14T10:00:25.000Z",
            text: "Plan: scan files.Found the largest test file: ClaudeAdapter.test.ts (~357KB).",
            streaming: false,
          });

          yield* projectionPipeline.bootstrap;

          const segmentRows = yield* sql<{
            readonly messageId: string;
            readonly startedAt: string;
            readonly endedAt: string;
            readonly text: string;
          }>`
          SELECT
            message_id AS "messageId",
            started_at AS "startedAt",
            ended_at AS "endedAt",
            text
          FROM message_text_segments
          WHERE thread_id = ${threadId}
          ORDER BY sequence ASC
        `;
          assert.deepEqual(segmentRows, [
            {
              messageId,
              startedAt: "2026-07-14T10:00:02.000Z",
              endedAt: "2026-07-14T10:00:03.000Z",
              text: "Plan: scan files.",
            },
            {
              messageId,
              startedAt: "2026-07-14T10:00:02.000Z",
              endedAt: "2026-07-14T10:00:25.000Z",
              text: "Found the largest test file: ClaudeAdapter.test.ts (~357KB).",
            },
          ]);

          const messageRow = yield* sql<{ readonly text: string }>`
          SELECT text
          FROM projection_thread_messages
          WHERE thread_id = ${threadId}
            AND message_id = ${messageId}
        `;
          assert.deepEqual(messageRow, [
            {
              text: "Plan: scan files.Found the largest test file: ClaudeAdapter.test.ts (~357KB).",
            },
          ]);
        }),
    );
  },
);
