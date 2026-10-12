import { basenameOfPath, inferEntryKindFromPath } from "~/file-icons";
import { cn } from "~/lib/utils";
import { FileEntryIcon } from "./FileEntryIcon";

const CHIP_CLASS_NAME =
  "inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-[var(--color-background-button-secondary)] px-1.5 align-middle leading-[1.6]";

// A file or folder named in a tool row or its details: its type icon and base name. With `onOpen` a
// file opens; inside a row's own button it stays plain so the row is the only control.
export function FileNameChip({
  path,
  onOpen,
  className,
}: {
  path: string;
  onOpen?: (() => void) | undefined;
  className?: string;
}) {
  const kind = inferEntryKindFromPath(path);
  const content = (
    <>
      <FileEntryIcon pathValue={path} kind={kind} className="size-[1.1em]" />
      <span className="truncate">{basenameOfPath(path)}</span>
    </>
  );
  return onOpen && kind === "file" ? (
    <button
      type="button"
      title={`Open ${path}`}
      className={cn(
        CHIP_CLASS_NAME,
        "hover:bg-[var(--color-background-button-secondary-hover)]",
        className,
      )}
      onClick={onOpen}
    >
      {content}
    </button>
  ) : (
    <span title={path} className={cn(CHIP_CLASS_NAME, className)}>
      {content}
    </span>
  );
}
