import type {
  ChatAttachment,
  ChatImageAttachment,
} from "@glade/contracts/orchestration/threadEntities";

export function filterProviderPromptImageAttachments(
  attachments: ReadonlyArray<ChatAttachment> | undefined,
): ChatImageAttachment[] {
  return (attachments ?? []).filter(
    (attachment): attachment is ChatImageAttachment => attachment.type === "image",
  );
}
