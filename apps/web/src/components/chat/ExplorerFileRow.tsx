import type { ProjectFileSystemEntry } from "@glade/contracts/workspace/project";
import {
  forwardRef,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type MouseEvent as ReactMouseEvent,
  type DragEvent as ReactDragEvent,
} from "react";
import { CHAT_FILE_REFERENCE_DRAG_TYPE, formatChatFileReference } from "~/lib/chatReferences";
import { cn } from "~/lib/utils";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { EXPLORER_ROW_PROPS } from "./explorerListNavigation";
import { FileEntryIcon } from "./FileEntryIcon";
import { fileRowClassName, fileRowIndentStyle } from "./fileRowStyles";

export function setFileReferenceDragData(dataTransfer: DataTransfer, path: string): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(CHAT_FILE_REFERENCE_DRAG_TYPE, formatChatFileReference({ path }));
  dataTransfer.setData("text/plain", path);
}

export function usePrefetchIntent(prefetch: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, [prefetch]);
  return {
    onPointerEnter: () => {
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        prefetch();
      }, 150);
    },
    onPointerLeave: cancel,
    onFocus: prefetch,
    onBlur: cancel,
  };
}

export const ExplorerRow = forwardRef<
  HTMLButtonElement,
  {
    entry: ProjectFileSystemEntry;
    depth: number;
    selected: boolean;
    expanded: boolean;
    dirty: boolean;
    onSelectFile: (path: string) => void;
    onPrefetchEntry: (entry: ProjectFileSystemEntry) => void;
    onSelectDirectory: (path: string) => void;
    onEntryContextMenu: (entry: ProjectFileSystemEntry, position: { x: number; y: number }) => void;
  } & ComponentPropsWithoutRef<"button">
>(function ExplorerRow(
  {
    entry,
    depth,
    selected,
    expanded,
    dirty,
    onSelectFile,
    onPrefetchEntry,
    onSelectDirectory,
    onEntryContextMenu,
    className,
    onClick,
    ...rest
  },
  ref,
) {
  const isDirectory = entry.kind === "directory";

  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (isDirectory) {
      onSelectDirectory(entry.path);
      return;
    }
    onSelectDirectory(entry.parentPath ?? "");
    onSelectFile(entry.path);
  };
  const prefetchIntent = usePrefetchIntent(() => onPrefetchEntry(entry));
  const handleContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onEntryContextMenu(entry, { x: event.clientX, y: event.clientY });
  };
  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>) => {
    setFileReferenceDragData(event.dataTransfer, entry.path);
  };

  return (
    <button
      {...rest}
      {...EXPLORER_ROW_PROPS}
      ref={ref}
      type="button"
      className={fileRowClassName(
        selected,
        cn("h-7 pr-2 transition-none", entry.isGitIgnored && "opacity-50", className),
      )}
      data-selected-file={selected && !isDirectory ? "" : undefined}
      style={fileRowIndentStyle(depth)}
      title={dirty ? `${entry.path} (unsaved changes)` : entry.path}
      aria-label={dirty ? `${entry.name} (unsaved changes)` : undefined}
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      {...prefetchIntent}
      onContextMenu={handleContextMenu}
    >
      {isDirectory ? (
        <>
          <DisclosureChevron open={expanded} className="opacity-75 transition-none" />
          <FileEntryIcon
            pathValue={entry.path}
            kind="directory"
            className="size-3.5 shrink-0 opacity-75"
          />
        </>
      ) : (
        <FileEntryIcon
          pathValue={entry.path}
          kind={entry.kind}
          className="size-3.5 shrink-0 opacity-75"
        />
      )}
      <span className="min-w-0 truncate">{entry.name}</span>
      {dirty ? (
        <span
          aria-hidden="true"
          className="ml-1 size-1.5 shrink-0 rounded-full bg-[var(--color-text-accent)]"
        />
      ) : null}
    </button>
  );
});
