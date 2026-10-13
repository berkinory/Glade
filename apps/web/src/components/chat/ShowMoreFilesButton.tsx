import { pluralize } from "@glade/shared/text/text";
import { useState } from "react";
import { cn } from "~/lib/utils";

const FILE_LIST_PAGE_SIZE = 50;

// One turn, commit or restore can touch thousands of files. Lists of them grow a page at a time so
// opening one never mounts every row at once.
export function usePagedFiles<T>(files: ReadonlyArray<T>) {
  const [limit, setLimit] = useState(FILE_LIST_PAGE_SIZE);
  return {
    visibleFiles: files.length > limit ? files.slice(0, limit) : files,
    hiddenCount: Math.max(0, files.length - limit),
    showMore: () => setLimit((current) => current + FILE_LIST_PAGE_SIZE),
  };
}

export function ShowMoreFilesButton(props: {
  hiddenCount: number;
  onClick: () => void;
  className?: string;
  fontSizePx?: number;
}) {
  if (props.hiddenCount <= 0) return null;
  const hiddenFiles = `${props.hiddenCount.toLocaleString()} ${pluralize(props.hiddenCount, "file")}`;
  return (
    <button
      type="button"
      className={cn(
        "font-system-ui text-left text-muted-foreground transition-colors hover:text-foreground",
        props.fontSizePx === undefined && "text-ui-sm",
        props.className,
      )}
      style={props.fontSizePx === undefined ? undefined : { fontSize: `${props.fontSizePx}px` }}
      onClick={props.onClick}
    >
      {props.hiddenCount > FILE_LIST_PAGE_SIZE
        ? `Show ${FILE_LIST_PAGE_SIZE} more · ${hiddenFiles} hidden`
        : `Show ${hiddenFiles} more`}
    </button>
  );
}
