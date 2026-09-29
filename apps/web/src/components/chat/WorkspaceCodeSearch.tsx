import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import type { ProjectContentMatch } from "@glade/contracts";
import { projectSearchContentQueryOptions } from "~/lib/projectReactQuery";
import { ContentSearchMatchText } from "../ContentSearchMatchText";
import { SearchInput } from "../ui/search-input";
import { ExplorerLoadingRows } from "./ExplorerLoadingRows";
import { IconButton } from "../ui/icon-button";
import { IconLetterCase } from "@tabler/icons-react";
import { fileRowClassName } from "./fileRowStyles";
import { FileEntryIcon } from "./FileEntryIcon";
import { EXPLORER_ROW_PROPS, useExplorerListNavigation } from "./explorerListNavigation";

export function WorkspaceCodeSearch(props: {
  cwd: string | null;
  selectedFilePath: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (match: ProjectContentMatch) => void;
}) {
  const [debounced] = useDebouncedValue(props.query.trim(), { wait: 250 });
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [request, setRequest] = useState({ query: debounced, matchCase, wholeWord });
  const result = useQuery({
    ...projectSearchContentQueryOptions({ cwd: props.cwd, ...request, limit: 100 }),
    retry: false,
  });
  // Finish the bounded scan before starting the latest query; intermediate
  // keystrokes never queue additional full-workspace scans.
  useEffect(() => {
    if (
      !result.isFetching &&
      (request.query !== debounced ||
        request.matchCase !== matchCase ||
        request.wholeWord !== wholeWord)
    )
      setRequest({ query: debounced, matchCase, wholeWord });
  }, [debounced, matchCase, wholeWord, request, result.isFetching]);
  const query = props.query.trim();
  const pending =
    query !== request.query ||
    matchCase !== request.matchCase ||
    wholeWord !== request.wholeWord ||
    result.isFetching ||
    result.isPlaceholderData;
  const matches = !pending && query.length >= 2 ? (result.data?.matches ?? []) : [];
  const groups = new Map<string, ProjectContentMatch[]>();
  for (const match of matches) {
    const group = groups.get(match.path) ?? [];
    group.push(match);
    groups.set(match.path, group);
  }
  const navigate = useExplorerListNavigation();
  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={navigate}>
      <div className="shrink-0 border-b border-border/65 p-2">
        <SearchInput
          trailingAction={
            <div className="flex items-center gap-0.5">
              <IconButton
                size="icon-chip"
                label="Match case"
                tooltip="Match case"
                aria-pressed={matchCase}
                variant="ghost"
                className="rounded-[4px] text-muted-foreground aria-pressed:bg-primary/15 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-primary/60"
                onClick={() => setMatchCase(!matchCase)}
              >
                <IconLetterCase className="size-3.5" />
              </IconButton>
              <IconButton
                size="icon-chip"
                label="Match whole word"
                tooltip="Match whole word"
                aria-pressed={wholeWord}
                variant="ghost"
                className="rounded-[4px] text-muted-foreground aria-pressed:bg-primary/15 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-primary/60"
                onClick={() => setWholeWord(!wholeWord)}
              >
                <span className="text-ui-xs underline underline-offset-2">ab</span>
              </IconButton>
            </div>
          }
          autoFocus
          value={props.query}
          maxLength={256}
          placeholder="Search in files…"
          aria-label="Search file contents"
          spellCheck={false}
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) props.onSelect(matches[0]);
            if (event.key === "Escape") props.onQueryChange("");
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto" aria-busy={query.length >= 2 && pending}>
        {props.cwd && query.length >= 2 ? (
          pending ? (
            <div className="px-1 py-1">
              <ExplorerLoadingRows depth={0} label="Searching file contents…" />
            </div>
          ) : (
            <div className="px-3 py-2 text-ui-xs text-muted-foreground" role="status">
              {result.error ? (
                <span className="text-destructive">{result.error.message}</span>
              ) : (
                `${matches.length} matching lines in ${groups.size} files`
              )}
            </div>
          )
        ) : null}
        {[...groups].map(([path, fileMatches]) => (
          <section key={path} className="px-1">
            <button
              {...EXPLORER_ROW_PROPS}
              type="button"
              onClick={() => {
                if (fileMatches[0]) props.onSelect(fileMatches[0]);
              }}
              className={fileRowClassName(
                props.selectedFilePath === path,
                "px-2 py-1 text-ui-xs transition-none",
              )}
              aria-current={props.selectedFilePath === path ? "true" : undefined}
              data-selected={props.selectedFilePath === path}
              title={path}
            >
              <FileEntryIcon pathValue={path} kind="file" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{path}</span>
              <span className="text-muted-foreground tabular-nums">{fileMatches.length}</span>
            </button>
            {fileMatches.map((match) => (
              <button
                {...EXPLORER_ROW_PROPS}
                key={match.lineNumber}
                type="button"
                className={fileRowClassName(
                  false,
                  "items-baseline gap-2 px-3 py-1 text-ui-xs transition-none",
                )}
                aria-label={`${path}, line ${match.lineNumber}: ${match.lineText}`}
                title={match.lineText}
                onClick={() => props.onSelect(match)}
              >
                <span className="min-w-0 truncate font-mono">
                  <ContentSearchMatchText
                    text={match.lineText}
                    query={query}
                    matchCase={matchCase}
                    wholeWord={wholeWord}
                  />
                </span>
              </button>
            ))}
          </section>
        ))}
        {!pending && query.length >= 2 && result.data?.truncated ? (
          <p className="px-3 py-2 text-ui-xs text-muted-foreground">
            Search limit reached. Narrow your query to see more specific results.
          </p>
        ) : null}
      </div>
    </div>
  );
}
