import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import type { ProjectContentMatch, ProjectEntry } from "@glade/contracts";
import { PROJECT_SEARCH_CONTENT_MIN_QUERY_LENGTH } from "@glade/contracts";

import {
  prewarmProjectSearchIndex,
  projectSearchContentQueryOptions,
  projectSearchEntriesQueryOptions,
} from "~/lib/projectReactQuery";
import { ContentSearchMatchText } from "./ContentSearchMatchText";
import { cn } from "~/lib/utils";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandStatus,
} from "./ui/command";
import { FileEntryIcon } from "./chat/FileEntryIcon";

export type WorkspaceSearchPaletteMode = "files" | "snippets";

const SEARCH_DEBOUNCE_MS = 100;

const SEARCH_LIMIT = 30;
const SEARCH_STALE_TIME_MS = 10_000;

const POPUP_CLASS = "max-w-lg border-transparent before:shadow-none dark:before:shadow-none";

const INPUT_CLASS =
  "font-system-ui h-11 w-full min-w-0 bg-transparent px-3.5 text-ui-lg text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200 dark:placeholder:text-zinc-500";

const LIST_CLASS = "max-h-[min(30rem,60vh)]";

const GROUP_LABEL_CLASS =
  "px-2.5 pt-1.5 pb-1 font-normal text-ui-sm text-zinc-400 dark:text-zinc-500";

const ITEM_CLASS =
  "cursor-pointer gap-2 rounded-lg px-2.5 py-1 text-zinc-800 data-highlighted:bg-zinc-500/8 data-highlighted:text-zinc-900 dark:text-zinc-200 dark:data-highlighted:bg-zinc-400/10 dark:data-highlighted:text-zinc-100";

const ICON_CLASS = "size-3.5 text-zinc-500 dark:text-zinc-400";

const MUTED_TEXT_CLASS = "text-zinc-400 dark:text-zinc-500";

const EMPTY_FILE_ENTRIES: readonly ProjectEntry[] = [];
const EMPTY_SNIPPET_MATCHES: readonly ProjectContentMatch[] = [];

const MODE_COPY: Record<
  WorkspaceSearchPaletteMode,
  {
    groupLabel: string;
    placeholder: string;
    prompt: string;
    noResults: string;
    error: string;
  }
> = {
  files: {
    groupLabel: "Files",
    placeholder: "Search files",
    prompt: "Type to search for files",
    noResults: "No matching files",
    error: "File search failed. Try again.",
  },
  snippets: {
    groupLabel: "Matches",
    placeholder: "Search code",
    prompt: `Type at least ${PROJECT_SEARCH_CONTENT_MIN_QUERY_LENGTH} characters to search code`,
    noResults: "No matches",
    error: "Code search failed. Try again.",
  },
};

interface WorkspaceSearchPaletteProps {
  open: boolean;
  mode: WorkspaceSearchPaletteMode;
  onOpenChange: (open: boolean) => void;
  cwd: string | null;
  onOpenFile: (relativePath: string) => void;

  onOpenDirectory: (relativePath: string) => void;
}

function splitPath(path: string): { base: string; dir: string } {
  const separatorIndex = path.lastIndexOf("/");
  if (separatorIndex === -1) return { base: path, dir: "" };
  return { base: path.slice(separatorIndex + 1), dir: path.slice(0, separatorIndex) };
}

function DirectoryText(props: { dir: string; className?: string }) {
  return (
    <span
      className={cn("truncate text-start text-ui", MUTED_TEXT_CLASS, props.className)}
      dir="rtl"
      title={props.dir}
    >
      <bdi dir="ltr">{props.dir}</bdi>
    </span>
  );
}

const FileResultRow = memo(function FileResultRow(props: {
  entry: ProjectEntry;
  index: number;
  onOpenFile: (relativePath: string) => void;
  onOpenDirectory: (relativePath: string) => void;
}) {
  const { base, dir } = splitPath(props.entry.path);
  return (
    <CommandItem
      index={props.index}
      value={`${props.entry.kind}:${props.entry.path}`}
      className={`items-center ${ITEM_CLASS}`}
      onClick={() =>
        props.entry.kind === "directory"
          ? props.onOpenDirectory(props.entry.path)
          : props.onOpenFile(props.entry.path)
      }
    >
      <FileEntryIcon pathValue={props.entry.path} kind={props.entry.kind} className={ICON_CLASS} />
      <span className="min-w-0 flex-1 truncate text-ui-lg">{base}</span>
      {dir ? <DirectoryText className="max-w-[45%] shrink-0" dir={dir} /> : null}
    </CommandItem>
  );
});

const SnippetResultRow = memo(function SnippetResultRow(props: {
  match: ProjectContentMatch;
  index: number;
  highlightQuery: string;
  onOpenFile: (relativePath: string) => void;
}) {
  const { base, dir } = splitPath(props.match.path);
  return (
    <CommandItem
      index={props.index}
      value={`snippet:${props.match.path}:${props.match.lineNumber}`}
      className={`items-start py-1.5 ${ITEM_CLASS}`}
      onClick={() => props.onOpenFile(props.match.path)}
    >
      <FileEntryIcon pathValue={props.match.path} kind="file" className={`mt-0.5 ${ICON_CLASS}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-ui-lg">{base}</span>
          <DirectoryText
            className="max-w-[45%] shrink-0"
            dir={dir ? `${dir}:${props.match.lineNumber}` : `:${props.match.lineNumber}`}
          />
        </div>
        <div className={`truncate font-mono text-ui-sm leading-4 ${MUTED_TEXT_CLASS}`}>
          <ContentSearchMatchText text={props.match.lineText} query={props.highlightQuery} />
        </div>
      </div>
    </CommandItem>
  );
});

export function WorkspaceSearchPalette(props: WorkspaceSearchPaletteProps) {
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup className={POPUP_CLASS}>
        <WorkspaceSearchPaletteContent
          open={props.open}
          mode={props.mode}
          onOpenChange={props.onOpenChange}
          cwd={props.cwd}
          onOpenFile={props.onOpenFile}
          onOpenDirectory={props.onOpenDirectory}
        />
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function WorkspaceSearchPaletteContent(props: WorkspaceSearchPaletteProps) {
  const copy = MODE_COPY[props.mode];

  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const [debouncedQuery] = useDebouncedValue(trimmedQuery, { wait: SEARCH_DEBOUNCE_MS });

  useEffect(() => {
    prewarmProjectSearchIndex(props.cwd);
  }, [props.cwd]);

  const hasUsableQuery =
    props.mode === "files"
      ? trimmedQuery.length > 0
      : trimmedQuery.length >= PROJECT_SEARCH_CONTENT_MIN_QUERY_LENGTH;

  const fileSearchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: props.cwd,
      query: debouncedQuery,
      limit: SEARCH_LIMIT,
      enabled: props.open && props.mode === "files" && debouncedQuery.length > 0,
      staleTime: SEARCH_STALE_TIME_MS,
    }),
  );

  const snippetSearchQuery = useQuery(
    projectSearchContentQueryOptions({
      cwd: props.cwd,
      query: debouncedQuery,
      limit: SEARCH_LIMIT,
      enabled:
        props.open &&
        props.mode === "snippets" &&
        debouncedQuery.length >= PROJECT_SEARCH_CONTENT_MIN_QUERY_LENGTH,
      staleTime: SEARCH_STALE_TIME_MS,
    }),
  );

  const fileEntries =
    props.mode === "files" && hasUsableQuery
      ? (fileSearchQuery.data?.entries ?? EMPTY_FILE_ENTRIES)
      : EMPTY_FILE_ENTRIES;
  const snippetMatches =
    props.mode === "snippets" && hasUsableQuery
      ? (snippetSearchQuery.data?.matches ?? EMPTY_SNIPPET_MATCHES)
      : EMPTY_SNIPPET_MATCHES;

  const itemValues = useMemo(
    () =>
      props.mode === "files"
        ? fileEntries.map((entry) => `${entry.kind}:${entry.path}`)
        : snippetMatches.map((match) => `snippet:${match.path}:${match.lineNumber}`),
    [props.mode, fileEntries, snippetMatches],
  );

  const activeQuery = props.mode === "files" ? fileSearchQuery : snippetSearchQuery;
  // Only a settled response may claim "no results" — otherwise every keystroke would flash the
  // no-results state before data lands.
  const isSettled = trimmedQuery === debouncedQuery && !activeQuery.isFetching;
  const hasRows = fileEntries.length > 0 || snippetMatches.length > 0;

  const { onOpenChange, onOpenFile, onOpenDirectory } = props;
  const handleOpenFile = useCallback(
    (relativePath: string) => {
      onOpenChange(false);
      onOpenFile(relativePath);
    },
    [onOpenChange, onOpenFile],
  );
  const handleOpenDirectory = useCallback(
    (relativePath: string) => {
      onOpenChange(false);
      onOpenDirectory(relativePath);
    },
    [onOpenChange, onOpenDirectory],
  );

  const statusMessage = !hasRows
    ? activeQuery.isError
      ? copy.error
      : hasUsableQuery && isSettled
        ? copy.noResults
        : copy.prompt
    : null;

  return (
    <Command items={itemValues} mode="none">
      {}
      <div
        className={cn(
          "border-b",
          hasRows ? "border-zinc-950/5 dark:border-white/5" : "border-transparent",
        )}
      >
        <AutocompletePrimitive.Input
          autoFocus
          className={INPUT_CLASS}
          placeholder={copy.placeholder}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      {}
      <CommandStatus>
        {statusMessage ? (
          <div className="text-start">
            <div className={GROUP_LABEL_CLASS}>{copy.groupLabel}</div>
            <div className="px-2.5 pt-0.5 pb-2 text-ui-lg text-zinc-700 dark:text-zinc-300">
              {statusMessage}
            </div>
          </div>
        ) : null}
      </CommandStatus>

      <CommandList className={LIST_CLASS}>
        {props.mode === "files" && fileEntries.length > 0 ? (
          <CommandGroup>
            <CommandGroupLabel className={GROUP_LABEL_CLASS}>{copy.groupLabel}</CommandGroupLabel>
            {fileEntries.map((entry, index) => (
              <FileResultRow
                key={entry.path}
                entry={entry}
                index={index}
                onOpenFile={handleOpenFile}
                onOpenDirectory={handleOpenDirectory}
              />
            ))}
          </CommandGroup>
        ) : null}
        {props.mode === "snippets" && snippetMatches.length > 0 ? (
          <CommandGroup>
            <CommandGroupLabel className={GROUP_LABEL_CLASS}>{copy.groupLabel}</CommandGroupLabel>
            {snippetMatches.map((match, index) => (
              <SnippetResultRow
                key={`${match.path}:${match.lineNumber}`}
                match={match}
                index={index}
                highlightQuery={debouncedQuery}
                onOpenFile={handleOpenFile}
              />
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  );
}
