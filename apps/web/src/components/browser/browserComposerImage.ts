import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useComposerDraftStore } from "~/composerDraftStore";
import { prepareComposerImageAttachmentsFromFiles } from "~/lib/composerSend";
import { toastManager } from "../ui/toast";

// Attaches a JPEG from the browser to the thread's composer. Returns false and warns with
// `warning` when it could not be attached, such as when the message is full.
export async function addBrowserImageToComposer(
  threadId: ThreadId,
  image: { readonly data: string; readonly fileName: string; readonly warning: string },
): Promise<boolean> {
  const bytes = Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0));
  const file = new File([bytes], image.fileName, { type: "image/jpeg" });
  const { images, error } = await prepareComposerImageAttachmentsFromFiles({
    files: [file],
    existingAttachmentCount: 0,
  });
  const added = useComposerDraftStore.getState().addImages(threadId, images);
  if (!error && added === images.length) return true;
  toastManager.add({
    type: "warning",
    title: image.warning,
    description: error ?? "This message already has the most attachments it can carry.",
  });
  return false;
}
