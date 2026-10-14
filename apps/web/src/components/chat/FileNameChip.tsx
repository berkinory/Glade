import type { MouseEvent } from "react";
import { basenameOfPath } from "~/file-icons";
import { cn } from "~/lib/utils";
import { FileEntryIcon } from "./FileEntryIcon";

const CHIP_CLASS_NAME =
  "inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-[var(--color-background-button-secondary)] px-1.5 align-middle leading-[1.6]";

// A file a tool read or changed: its type icon and base name. The tool says it is a file, so an
// extensionless name such as `.hushlogin` is not guessed to be a folder. With `onOpen` the chip opens
// the file on its own click. It sits inside the row's toggle button, so it is a span that stops
// the click from also toggling the row rather than a nested button.
export function FileNameChip({
  path,
  onOpen,
  className,
}: {
  path: string;
  onOpen?: (() => void) | undefined;
  className?: string;
}) {
  const open = onOpen
    ? (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }
    : undefined;
  return (
    <span
      title={onOpen ? `Open ${path}` : path}
      className={cn(
        CHIP_CLASS_NAME,
        onOpen &&
          "cursor-pointer transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground",
        className,
      )}
      onClick={open}
    >
      <FileEntryIcon pathValue={path} kind="file" className="size-[1.1em]" />
      <span className="truncate">{basenameOfPath(path)}</span>
    </span>
  );
}
