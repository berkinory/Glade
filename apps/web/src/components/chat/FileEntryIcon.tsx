// Shared Symbols file/folder glyph for explorer, composer, diff, editor, and timeline.
import { getAttachmentIconUrl, getFileIconUrl, getFolderIconUrl } from "../../file-icons";
import { cn } from "~/lib/utils";

export const FileEntryIcon = function FileEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  mimeType?: string | null;
  theme?: "light" | "dark";
  className?: string;
}) {
  const src =
    props.kind === "directory"
      ? getFolderIconUrl(props.pathValue)
      : props.mimeType === undefined
        ? getFileIconUrl(props.pathValue)
        : getAttachmentIconUrl({ name: props.pathValue, mimeType: props.mimeType });

  return (
    <img src={src} alt="" aria-hidden="true" className={cn("size-4 shrink-0", props.className)} />
  );
};
