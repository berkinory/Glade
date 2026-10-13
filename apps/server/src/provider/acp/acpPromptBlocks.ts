import { readFile } from "node:fs/promises";

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ChatAttachment } from "@glade/contracts/orchestration/threadEntities";

import { appendFileAttachmentsPromptBlock } from "../core/attachmentProjection.ts";
import { resolveProviderAttachmentPath } from "../core/providerAttachmentPaths.ts";

// The user's message as ACP content. Images go inline when the agent accepts image blocks;
// otherwise they are listed with the other attachments by saved path, for the agent's own tools.
export async function acpPromptBlocks(input: {
  readonly text: string | undefined;
  readonly attachments: ReadonlyArray<ChatAttachment> | undefined;
  readonly attachmentsDir: string;
  readonly acceptsImages: boolean;
}): Promise<ContentBlock[]> {
  const text = appendFileAttachmentsPromptBlock({
    text: input.text,
    attachments: input.attachments,
    attachmentsDir: input.attachmentsDir,
    include: "all-files",
    includeImage: () => !input.acceptsImages,
  });
  const blocks: ContentBlock[] = text ? [{ type: "text", text }] : [];
  if (!input.acceptsImages) return blocks;
  for (const attachment of input.attachments ?? []) {
    if (attachment.type !== "image") continue;
    const path = resolveProviderAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment,
    });
    if (!path) throw new Error(`Image attachment ${attachment.name} could not be found.`);
    blocks.push({
      type: "image",
      mimeType: attachment.mimeType,
      data: (await readFile(path)).toString("base64"),
    });
  }
  return blocks;
}
