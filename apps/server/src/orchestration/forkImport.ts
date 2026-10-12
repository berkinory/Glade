import { Option, Schema } from "effect";
import type { MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  ChatAttachment,
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationThreadActivity,
} from "@glade/contracts/orchestration/threadEntities";
import {
  VisualReply,
  VISUAL_REPLY_ACTIVITY_KIND,
} from "@glade/contracts/orchestration/visualReply";
import {
  derivedManagedAttachmentId,
  isManagedAttachmentId,
} from "../attachments/managedAttachmentStore";

interface ForkVisualReply {
  readonly activity: OrchestrationThreadActivity;
  readonly reply: VisualReply;
}

export interface ForkImport {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly visualReplies: ReadonlyArray<ForkVisualReply>;
}

// Visual replies are part of the assistant's answer, so a fork carries those published up to the
// fork message. The rest of the work log stays with the source.
export function selectForkImport(
  source: OrchestrationThread,
  forkMessageId: MessageId,
): ForkImport | null {
  const forkIndex = source.messages.findIndex((message) => message.id === forkMessageId);
  const forkMessage = source.messages[forkIndex];
  if (!forkMessage) return null;
  const messages = source.messages.slice(0, forkIndex + 1);
  const turnIds = new Set(messages.flatMap((message) => (message.turnId ? [message.turnId] : [])));
  const visualReplies = source.activities.flatMap((activity): ForkVisualReply[] => {
    if (
      activity.kind !== VISUAL_REPLY_ACTIVITY_KIND ||
      activity.createdAt > forkMessage.updatedAt ||
      (activity.turnId !== null && !turnIds.has(activity.turnId))
    ) {
      return [];
    }
    const reply = Schema.decodeUnknownOption(VisualReply)(activity.payload);
    return Option.isSome(reply) ? [{ activity, reply: reply.value }] : [];
  });
  return { messages, visualReplies };
}

export function forkAttachmentId(forkThreadId: ThreadId, sourceAttachmentId: string): string {
  return derivedManagedAttachmentId(`fork\0${forkThreadId}\0${sourceAttachmentId}`);
}

function isCopiedAttachment(attachment: ChatAttachment): boolean {
  return attachment.type !== "assistant-selection" && isManagedAttachmentId(attachment.id);
}

export function forkMessageAttachment(
  forkThreadId: ThreadId,
  attachment: ChatAttachment,
): ChatAttachment {
  return isCopiedAttachment(attachment)
    ? { ...attachment, id: forkAttachmentId(forkThreadId, attachment.id) }
    : attachment;
}

export function forkVisualReplyPayload(forkThreadId: ThreadId, reply: VisualReply) {
  return {
    version: reply.version,
    threadId: forkThreadId,
    title: reply.title,
    attachmentId: forkAttachmentId(forkThreadId, reply.attachmentId),
    ...(reply.height !== undefined ? { height: reply.height } : {}),
    ...(reply.heights ? { heights: reply.heights.map(([width, height]) => [width, height]) } : {}),
    ...(reply.previewAttachmentId
      ? { previewAttachmentId: forkAttachmentId(forkThreadId, reply.previewAttachmentId) }
      : {}),
  };
}

export function forkImportSourceAttachmentIds(forkImport: ForkImport): ReadonlyArray<string> {
  return [
    ...new Set([
      ...forkImport.messages.flatMap((message) =>
        (message.attachments ?? []).filter(isCopiedAttachment).map((attachment) => attachment.id),
      ),
      ...forkImport.visualReplies.flatMap(({ reply }) => [
        reply.attachmentId,
        ...(reply.previewAttachmentId ? [reply.previewAttachmentId] : []),
      ]),
    ]),
  ];
}
