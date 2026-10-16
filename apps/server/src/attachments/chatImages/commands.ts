import { CHAT_IMAGE_SNAPSHOT_PREFIX } from "@glade/shared/attachments/chatImageSnapshots";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { preserveChatImage } from "./storage";
import { preserveMarkdownImages } from "./markdown";

export function preserveCommandImages(input: {
  readonly command: OrchestrationCommand;
  readonly model: OrchestrationReadModel;
  readonly attachmentsDir: string;
  readonly sql: SqlClient.SqlClient;
}) {
  return Effect.gen(function* () {
    const { command, model } = input;
    if (
      command.type !== "thread.message.assistant.complete" &&
      command.type !== "thread.activity.append"
    )
      return { command, model };
    const thread = model.threads.find((thread) => thread.id === command.threadId);
    if (!thread) return { command, model };
    const cwd =
      thread.workingDirectory ??
      thread.worktreePath ??
      model.projects.find((project) => project.id === thread.projectId)?.workspaceRoot ??
      null;
    const preserve = (source: string) =>
      preserveChatImage({ source, cwd, attachmentsDir: input.attachmentsDir, sql: input.sql });
    if (command.type === "thread.message.assistant.complete") {
      const message = thread.messages.find((message) => message.id === command.messageId);
      if (!message) return { command, model };
      const text = yield* preserveMarkdownImages(message.text, preserve);
      if (text === message.text) return { command, model };
      return {
        command,
        model: {
          ...model,
          threads: model.threads.map((entry) =>
            entry.id === thread.id
              ? {
                  ...thread,
                  messages: thread.messages.map((entry) =>
                    entry.id === message.id ? { ...message, text } : entry,
                  ),
                }
              : entry,
          ),
        },
      };
    }
    const payload = asRecord(command.activity.payload);
    if (command.activity.kind !== "tool.completed" || !payload) return { command, model };
    const data = asRecord(payload.data);
    const item = asRecord(data?.item);
    // Adapters name the file a generic read showed as an image; image items carry their own path.
    const imageItem = payload.itemType === "image_view" || payload.itemType === "image_generation";
    const args =
      asRecord(data?.input) ??
      asRecord(data?.rawInput) ??
      asRecord(item?.arguments) ??
      asRecord(item?.input);
    const source =
      data?.viewedImagePath ??
      (imageItem
        ? (data?.path ?? item?.path ?? args?.path ?? args?.file_path ?? args?.filePath)
        : undefined);
    if (typeof source !== "string") return { command, model };
    const callId = data?.callId ?? data?.toolCallId ?? item?.id ?? command.activity.id;
    const captureKey = JSON.stringify([command.activity.turnId, callId]);
    const sql = input.sql;
    const existing = yield* sql<{ name: string }>`SELECT name FROM chat_image_snapshot_references
      WHERE thread_id = ${thread.id} AND capture_key = ${captureKey} LIMIT 1`;
    const snapshot = existing[0]
      ? `${CHAT_IMAGE_SNAPSHOT_PREFIX}${existing[0].name}`
      : yield* preserve(source).pipe(
          Effect.catch((error) =>
            Effect.logWarning("could not preserve tool image", { error }).pipe(Effect.as(null)),
          ),
        );
    return {
      command: {
        ...command,
        activity: {
          ...command.activity,
          payload: { ...payload, imageSnapshotUrl: snapshot, imageSnapshotKey: captureKey },
        },
      },
      model,
    };
  });
}
