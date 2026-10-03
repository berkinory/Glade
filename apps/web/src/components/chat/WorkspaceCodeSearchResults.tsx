import { useRef, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ProjectContentMatch } from "@glade/contracts/workspace/project";
import type { ContentSearchOptions } from "@glade/shared/text/searchQuery";
import { fileRowClassName } from "./fileRowStyles";
import { FileEntryIcon } from "./FileEntryIcon";
import { EXPLORER_ROW_PROPS } from "./explorerListNavigation";
import { ExplorerLoadingRows } from "./ExplorerLoadingRows";
import { HighlightedContentSearchMatch } from "./HighlightedContentSearchMatch";

type SearchRow = {
  key: string;
  path: string;
  match: ProjectContentMatch;
  header: boolean;
  count: number;
};

export function WorkspaceCodeSearchResults(props: {
  matches: readonly ProjectContentMatch[];
  selectedFilePath: string | null;
  onSelect: (match: ProjectContentMatch) => void;
  search: { query: string } & ContentSearchOptions;
  pending: boolean;
  error: Error | null;
  truncated: boolean;
}) {
  const groups = new Map<string, ProjectContentMatch[]>();
  for (const match of props.matches) {
    const group = groups.get(match.path) ?? [];
    group.push(match);
    groups.set(match.path, group);
  }
  const rows: SearchRow[] = [...groups].flatMap(([path, matches]) => [
    { key: path, path, match: matches[0]!, header: true, count: matches.length },
    ...matches.map((match) => ({
      key: `${path}:${match.lineNumber}`,
      path,
      match,
      header: false,
      count: 0,
    })),
  ]);
  const viewport = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 28,
    getItemKey: (index) => rows[index]!.key,
    overscan: 4,
  });
  const navigate = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      rows.length === 0
    )
      return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const active = document.activeElement;
    const input = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (input && event.key !== "ArrowDown") return;
    const current = active?.closest<HTMLElement>("[data-search-index]");
    const index = current ? Number(current.dataset.searchIndex) : -1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : event.key === "ArrowDown"
            ? Math.min(rows.length - 1, index + 1)
            : Math.max(0, index - 1);
    event.preventDefault();
    virtualizer.scrollToIndex(next, { align: "auto" });
    const button = viewport.current?.querySelector<HTMLButtonElement>(
      `[data-search-index="${next}"]`,
    );
    if (button) button.focus({ preventScroll: true });
    else pendingFocus.current = next;
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={navigate}>
      {props.pending ? (
        <div className="px-1 py-1">
          <ExplorerLoadingRows depth={0} label="Searching file contents…" />
        </div>
      ) : (
        <div className="px-3 py-2 text-ui-xs text-muted-foreground" role="status">
          {props.error ? (
            <span className="text-destructive">{props.error.message}</span>
          ) : (
            `${props.matches.length} matching lines in ${groups.size} files`
          )}
        </div>
      )}
      <div ref={viewport} className="min-h-0 flex-1 overflow-auto" aria-busy={props.pending}>
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return (
              <div
                key={item.key}
                className="absolute top-0 left-0 w-full px-1"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <button
                  {...EXPLORER_ROW_PROPS}
                  data-search-index={item.index}
                  ref={(button) => {
                    if (button && pendingFocus.current === item.index) {
                      pendingFocus.current = null;
                      button.focus({ preventScroll: true });
                    }
                  }}
                  type="button"
                  className={fileRowClassName(
                    row.header && props.selectedFilePath === row.path,
                    "h-full px-2 text-ui-xs transition-none",
                  )}
                  title={row.header ? row.path : row.match.lineText}
                  aria-label={
                    row.header
                      ? row.path
                      : `${row.path}, line ${row.match.lineNumber}: ${row.match.lineText}`
                  }
                  aria-current={
                    row.header && props.selectedFilePath === row.path ? "true" : undefined
                  }
                  onClick={() => props.onSelect(row.match)}
                >
                  {row.header ? (
                    <>
                      <FileEntryIcon
                        pathValue={row.path}
                        kind="file"
                        className="size-3.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{row.path}</span>
                      <span className="text-muted-foreground tabular-nums">{row.count}</span>
                    </>
                  ) : (
                    <span className="min-w-0 truncate whitespace-pre font-mono">
                      <HighlightedContentSearchMatch
                        path={row.path}
                        text={row.match.lineText}
                        {...props.search}
                      />
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        {!props.pending && props.truncated ? (
          <p className="px-3 py-2 text-ui-xs text-muted-foreground">
            Search limit reached. Narrow your query to see more specific results.
          </p>
        ) : null}
      </div>
    </div>
  );
}
