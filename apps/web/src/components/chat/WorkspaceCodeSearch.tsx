import { CaseSensitiveIcon } from "~/lib/icons";
import { WorkspaceCodeSearchResults } from "./WorkspaceCodeSearchResults";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import type { ProjectContentMatch } from "@glade/contracts/workspace/project";
import { projectSearchContentQueryOptions } from "~/lib/projectReactQuery";
import { SearchInput } from "../ui/search-input";
import { IconButton } from "../ui/icon-button";
import { useExplorerListNavigation } from "./explorerListNavigation";
export function WorkspaceCodeSearch(props: {
  cwd: string | null;
  selectedFilePath: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (match: ProjectContentMatch) => void;
  headerActions?: ReactNode;
  emptyContent?: ReactNode;
}) {
  const [debounced] = useDebouncedValue(props.query.trim(), {
    wait: 250,
  });
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const result = useQuery({
    ...projectSearchContentQueryOptions({
      cwd: props.cwd,
      query: debounced,
      matchCase,
      wholeWord,
      limit: 100,
    }),
    retry: false,
  });
  const query = props.query.trim();
  const pending = query !== debounced || result.isFetching || result.isPlaceholderData;
  const matches = !pending && query.length >= 2 ? (result.data?.matches ?? []) : [];
  const navigate = useExplorerListNavigation();
  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={navigate}>
      <div className="flex shrink-0 items-center gap-1 border-b border-border/65 p-2">
        <div className="min-w-0 flex-1">
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
                  <CaseSensitiveIcon className="size-3.5" />
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
            value={props.query}
            maxLength={256}
            placeholder="Search contents…"
            aria-label="Search file contents"
            spellCheck={false}
            onChange={(event) => props.onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches[0]) props.onSelect(matches[0]);
              if (event.key === "Escape") props.onQueryChange("");
            }}
          />
        </div>
        {props.headerActions}
      </div>
      {query.length < 2 ? (
        props.emptyContent
      ) : (
        <WorkspaceCodeSearchResults
          matches={matches}
          selectedFilePath={props.selectedFilePath}
          onSelect={props.onSelect}
          search={{
            query,
            matchCase,
            wholeWord,
          }}
          pending={pending}
          error={result.error}
          truncated={result.data?.truncated ?? false}
        />
      )}
    </div>
  );
}
