import { basenameOfPath } from "~/file-icons";
import { cn } from "~/lib/utils";
import { FileEntryIcon } from "./FileEntryIcon";

const CHIP_CLASS_NAME =
  "inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-[var(--color-background-button-secondary)] px-1.5 align-middle leading-[1.6]";

// A file a tool read or changed: its type icon and base name. The tool says it is a file, so an
// extensionless name such as `.hushlogin` is not guessed to be a folder. With `onOpen` it opens;
// inside a row's own button it stays plain so the row is the only control.
export function FileNameChip({
  path,
  onOpen,
  className,
}: {
  path: string;
  onOpen?: (() => void) | undefined;
  className?: string;
}) {
  const content = (
    <>
      <FileEntryIcon pathValue={path} kind="file" className="size-[1.1em]" />
      <span className="truncate">{basenameOfPath(path)}</span>
    </>
  );
  return onOpen ? (
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
