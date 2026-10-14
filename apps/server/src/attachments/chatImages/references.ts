import { asRecord } from "@glade/shared/transport/payloadValues";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { chatImageSnapshotName } from "@glade/shared/attachments/chatImageSnapshots";
import { Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

export function recordChatImageReferences(sql: SqlClient.SqlClient, event: OrchestrationEvent) {
  return Effect.gen(function* () {
    if (event.type === "thread.deleted") {
      yield* sql`DELETE FROM chat_image_snapshot_references WHERE thread_id = ${event.payload.threadId}`;
      return;
    }
    if (event.type === "thread.reverted" || event.type === "thread.conversation-rolled-back") {
      yield* sql`DELETE FROM chat_image_snapshot_references AS ref WHERE thread_id = ${event.payload.threadId}
        AND ((owner_kind = 'message' AND NOT EXISTS (SELECT 1 FROM projection_thread_messages AS message WHERE message.thread_id = ref.thread_id AND message.message_id = ref.owner_id))
        OR (owner_kind = 'activity' AND NOT EXISTS (SELECT 1 FROM projection_thread_activities AS activity WHERE activity.thread_id = ref.thread_id AND activity.activity_id = ref.owner_id)))`;
      if (
        event.type === "thread.conversation-rolled-back" &&
        event.payload.replacementText !== undefined
      ) {
        yield* sql`DELETE FROM chat_image_snapshot_references WHERE thread_id = ${event.payload.threadId} AND owner_kind = 'message' AND owner_id = ${event.payload.messageId}`;
        for (const url of chatImageSnapshotReferences(event.payload.replacementText)) {
          yield* sql`INSERT OR IGNORE INTO chat_image_snapshot_references (thread_id, owner_kind, owner_id, name)
            VALUES (${event.payload.threadId}, 'message', ${event.payload.messageId}, ${chatImageSnapshotName(url)!})`;
        }
      }
      return;
    }
    if (event.type !== "thread.message-sent" && event.type !== "thread.activity-appended") return;
    const message = event.type === "thread.message-sent" ? event.payload : null;
    const activity = event.type === "thread.activity-appended" ? event.payload.activity : null;
    const activityPayload = asRecord(activity?.payload);
    const text =
      message?.text ??
      (typeof activityPayload?.imageSnapshotUrl === "string"
        ? activityPayload.imageSnapshotUrl
        : "");
    const captureKey =
      typeof activityPayload?.imageSnapshotKey === "string"
        ? activityPayload.imageSnapshotKey
        : null;
    // Empty completions keep the existing message; streaming events only append references.
    if (!text) return;
    const ownerKind = message ? "message" : "activity";
    const ownerId = message?.messageId ?? activity!.id;
    if (!message?.streaming) {
      yield* sql`DELETE FROM chat_image_snapshot_references
        WHERE thread_id = ${event.payload.threadId} AND owner_kind = ${ownerKind} AND owner_id = ${ownerId}`;
    }
    for (const url of chatImageSnapshotReferences(text)) {
      yield* sql`INSERT OR IGNORE INTO chat_image_snapshot_references (thread_id, owner_kind, owner_id, name, capture_key)
        VALUES (${event.payload.threadId}, ${ownerKind}, ${ownerId}, ${chatImageSnapshotName(url)!}, ${captureKey})`;
    }
  });
}

function chatImageSnapshotReferences(text: string): readonly string[] {
  return [
    ...new Set(
      Array.from(
        text.matchAll(/\/attachments\/chat-images\/([a-f0-9]{64}\.[a-z]+)/g),
        (match) => match[0],
      ).filter((url) => chatImageSnapshotName(url) !== null),
    ),
  ];
}
