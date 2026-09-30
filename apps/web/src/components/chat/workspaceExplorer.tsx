import type { ProjectEntry, ProjectFileSystemEntry } from "@glade/contracts/workspace/project";
import {
  isWorkspaceRelativePathSafe,
  joinWorkspaceRelativePath,
} from "@glade/shared/platform/path";
import { IconFilePlus, IconFolderPlus } from "@tabler/icons-react";
import { ExplorerInlineName } from "./ExplorerInlineName";
import { useWorkspaceExplorerActions } from "./useWorkspaceExplorerActions";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ComponentPropsWithoutRef,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  CHAT_FILE_REFERENCE_DRAG_TYPE,
  formatChatFileReference,
  type ChatFileReference,
} from "~/lib/chatReferences";
import { splitRepoRelativePath } from "~/lib/diffRendering";
import { showFileReferenceContextMenu } from "~/lib/fileReferenceContextMenu";
import {
  projectListDirectoriesQueryOptions,
  projectReadFileQueryOptions,
  projectSearchEntriesQueryOptions,
} from "~/lib/projectReactQuery";
import { getSyntaxHighlighterPromise, getSyntaxLanguageForPath } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import {
  dirtyWorkspaceEditorPaths,
  dirtyWorkspaceEditorRevision,
  subscribeDirtyWorkspaceEditors,
} from "~/lib/workspaceEditorSession";
import { ExplorerLoadingRows } from "./ExplorerLoadingRows";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { SearchInput } from "../ui/search-input";
import { EXPLORER_ROW_PROPS, useExplorerListNavigation } from "./explorerListNavigation";
import { FileEntryIcon } from "./FileEntryIcon";
import { fileRowClassName, fileRowIndentStyle } from "./fileRowStyles";
import { PanelStateMessage } from "./PanelStateMessage";

const EXPLORER_HIDDEN_DIRECTORY_NAMES = new Set([
  ".cache",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pnpm-store",
  ".svelte-kit",
  ".turbo",
  ".vite",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

const EXPLORER_SEARCH_QUERY_DEBOUNCE_MS = 120;
const EXPLORER_SEARCH_RESULTS_LIMIT = 80;
const EMPTY_WORKSPACE_SEARCH_FILE_MATCHES: ReadonlyArray<ProjectEntry> = [];

const EXPLORER_SIDEBAR_CONTAINER_CLASS =
  "flex min-h-[11rem] w-full shrink-0 flex-col border-b border-border/65 bg-[var(--color-background-surface)] lg:h-full lg:w-56 lg:border-b-0 lg:border-r";

function setFileReferenceDragData(dataTransfer: DataTransfer, path: string): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(CHAT_FILE_REFERENCE_DRAG_TYPE, formatChatFileReference({ path }));
  dataTransfer.setData("text/plain", path);
}

function shouldShowExplorerEntry(entry: ProjectFileSystemEntry): boolean {
  if (entry.kind !== "directory") {
    return true;
  }
  if (entry.name.startsWith(".glade")) {
    return false;
  }
  return !EXPLORER_HIDDEN_DIRECTORY_NAMES.has(entry.name);
}

function useExplorerEntryPrefetch(cwd: string | null) {
  const queryClient = useQueryClient();
  return (entry: Pick<ProjectFileSystemEntry, "path" | "kind">) => {
    if (!cwd) {
      return;
    }
    if (entry.kind === "directory") {
      void queryClient.prefetchQuery(
        projectListDirectoriesQueryOptions({
          cwd,
          relativePath: entry.path,
          includeFiles: true,
        }),
      );
      return;
    }
    void queryClient.prefetchQuery(projectReadFileQueryOptions({ cwd, relativePath: entry.path }));
    void getSyntaxHighlighterPromise(getSyntaxLanguageForPath(entry.path)).catch(() => undefined);
  };
}

const ExplorerRow = forwardRef<
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
  const handlePrefetch = () => {
    onPrefetchEntry(entry);
  };
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
      className={fileRowClassName(selected, cn("h-7 pr-2 transition-none", className))}
      data-selected-file={selected && !isDirectory ? "" : undefined}
      style={fileRowIndentStyle(depth)}
      title={dirty ? `${entry.path} (unsaved changes)` : entry.path}
      aria-label={dirty ? `${entry.name} (unsaved changes)` : undefined}
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onPointerEnter={handlePrefetch}
      onFocus={handlePrefetch}
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

function WorkspaceDirectory(props: {
  cwd: string;
  relativePath: string | null;
  depth: number;
  selectedFilePath: string | null;
  expandedDirectories: ReadonlySet<string>;
  dirtyPaths: ReadonlySet<string>;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onPrefetchEntry: (entry: ProjectFileSystemEntry) => void;
  actions: ReturnType<typeof useWorkspaceExplorerActions>;
  onEntryContextMenu: (entry: ProjectFileSystemEntry, position: { x: number; y: number }) => void;
}) {
  const query = useQuery(
    projectListDirectoriesQueryOptions({
      cwd: props.cwd,
      relativePath: props.relativePath,
      includeFiles: true,
    }),
  );

  if (query.isLoading && !query.data) {
    return <ExplorerLoadingRows depth={props.depth} />;
  }

  if (query.error) {
    return (
      <p className="px-3 py-2 text-ui-sm text-destructive/80">
        {query.error instanceof Error ? query.error.message : "Could not load directory."}
      </p>
    );
  }

  const edit = props.actions.edit;
  const inline = (depth: number) =>
    edit ? (
      <ExplorerInlineName
        key={`${edit.action}:${edit.entry?.path ?? edit.parent}:${edit.kind}`}
        kind={edit.kind}
        path={edit.entry?.path ?? (edit.parent ? `${edit.parent}/new` : "new")}
        depth={depth}
        initialName={edit.entry?.name ?? ""}
        creating={edit.action === "create"}
        onSubmit={props.actions.submitEdit}
        onCancel={props.actions.cancelEdit}
      />
    ) : null;
  return (
    <>
      {edit?.action === "create" && edit.parent === (props.relativePath ?? "")
        ? inline(props.depth)
        : null}
      {(query.data?.entries ?? []).filter(shouldShowExplorerEntry).map((entry) => {
        if (edit?.action === "rename" && edit.entry?.path === entry.path)
          return inline(props.depth);

        if (entry.kind !== "directory") {
          return (
            <ExplorerRow
              key={entry.path}
              entry={entry}
              depth={props.depth}
              selected={entry.path === props.selectedFilePath}
              expanded={false}
              dirty={props.dirtyPaths.has(entry.path)}
              onSelectFile={props.onSelectFile}
              onPrefetchEntry={props.onPrefetchEntry}
              onSelectDirectory={props.actions.setSelectedDirectory}
              onEntryContextMenu={props.onEntryContextMenu}
            />
          );
        }
        const expanded = props.expandedDirectories.has(entry.path);
        const dirty =
          !expanded && [...props.dirtyPaths].some((path) => path.startsWith(`${entry.path}/`));
        return (
          <Collapsible
            key={entry.path}
            open={expanded}
            onOpenChange={() => props.onToggleDirectory(entry.path)}
          >
            <CollapsibleTrigger
              render={
                <ExplorerRow
                  entry={entry}
                  depth={props.depth}
                  selected={props.actions.selectedDirectory === entry.path}
                  expanded={expanded}
                  dirty={dirty}
                  onSelectFile={props.onSelectFile}
                  onSelectDirectory={props.actions.setSelectedDirectory}
                  onPrefetchEntry={props.onPrefetchEntry}
                  onEntryContextMenu={props.onEntryContextMenu}
                />
              }
            />
            <CollapsiblePanel className="transition-none">
              <WorkspaceDirectory
                cwd={props.cwd}
                relativePath={entry.path}
                depth={props.depth + 1}
                selectedFilePath={props.selectedFilePath}
                expandedDirectories={props.expandedDirectories}
                dirtyPaths={props.dirtyPaths}
                onSelectFile={props.onSelectFile}
                onToggleDirectory={props.onToggleDirectory}
                onPrefetchEntry={props.onPrefetchEntry}
                actions={props.actions}
                onEntryContextMenu={props.onEntryContextMenu}
              />
            </CollapsiblePanel>
          </Collapsible>
        );
      })}
    </>
  );
}

function explorerRevealPath(
  workspaceRoot: string | null,
  relativePath: string,
): string | undefined {
  return workspaceRoot && isWorkspaceRelativePathSafe(relativePath)
    ? joinWorkspaceRelativePath(workspaceRoot, relativePath)
    : undefined;
}

function useTreeEntryContextMenu(
  workspaceRoot: string | null,
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined,
  actions: ReturnType<typeof useWorkspaceExplorerActions>,
) {
  return (entry: ProjectFileSystemEntry, position: { x: number; y: number }) => {
    const revealPath = explorerRevealPath(workspaceRoot, entry.path);
    void showFileReferenceContextMenu({
      path: entry.path,
      ...(revealPath ? { revealPath } : {}),
      revealKind: entry.kind,
      position,
      onReferenceInChat,
      ...(entry.kind === "directory"
        ? {
            onCreateFile: () => actions.create(entry.path, "file"),
            onCreateFolder: () => actions.create(entry.path, "directory"),
          }
        : {}),
      onRename: () => actions.rename(entry),
      onDelete: () => actions.deleteEntry(entry),
    });
  };
}

function useResultEntryContextMenu(
  workspaceRoot: string | null,
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined,
  actions?: ReturnType<typeof useWorkspaceExplorerActions>,
) {
  return (path: string, position: { x: number; y: number }) => {
    const revealPath = explorerRevealPath(workspaceRoot, path);
    void showFileReferenceContextMenu({
      path,
      ...(revealPath ? { revealPath } : {}),
      position,
      onReferenceInChat,
      ...(actions
        ? {
            onRename: () =>
              actions.rename({ path, name: splitRepoRelativePath(path).name, kind: "file" }),
            onDelete: () =>
              actions.deleteEntry({ path, name: splitRepoRelativePath(path).name, kind: "file" }),
          }
        : {}),
    });
  };
}

function ExplorerCreateButtons(props: {
  disabled?: boolean;
  onCreateFile: () => void;
  onCreateFolder: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        aria-label="New file"
        title="New file"
        disabled={props.disabled}
        onClick={props.onCreateFile}
      >
        <IconFilePlus className="size-4" />
      </button>
      <button
        type="button"
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        aria-label="New folder"
        title="New folder"
        disabled={props.disabled}
        onClick={props.onCreateFolder}
      >
        <IconFolderPlus className="size-4" />
      </button>
    </div>
  );
}

function WorkspaceFilesTreeBody(props: {
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  expandedDirectories: ReadonlySet<string>;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onPrefetchEntry: (entry: ProjectFileSystemEntry) => void;
  actions: ReturnType<typeof useWorkspaceExplorerActions>;
  onEntryContextMenu: (entry: ProjectFileSystemEntry, position: { x: number; y: number }) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => subscribeDirtyWorkspaceEditors(queryClient, listener),
    [queryClient],
  );
  const getRevision = useCallback(() => dirtyWorkspaceEditorRevision(queryClient), [queryClient]);
  const dirtyRevision = useSyncExternalStore(subscribe, getRevision, getRevision);
  const dirtyPaths = useMemo(() => {
    void dirtyRevision;
    return props.workspaceRoot
      ? dirtyWorkspaceEditorPaths(queryClient, props.workspaceRoot)
      : new Set<string>();
  }, [dirtyRevision, props.workspaceRoot, queryClient]);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !props.selectedFilePath) return;
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const row = container.querySelector<HTMLElement>("[data-selected-file]");
        if (!row) return;
        const viewport = container.getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        if (bounds.top < viewport.top) container.scrollTop += bounds.top - viewport.top;
        else if (bounds.bottom > viewport.bottom)
          container.scrollTop += bounds.bottom - viewport.bottom;
        observer.disconnect();
      });
    };

    const observer = new MutationObserver(reveal);
    observer.observe(container, { childList: true, subtree: true });
    reveal();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [props.selectedFilePath, props.workspaceRoot]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto px-1 py-1"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.actions.setSelectedDirectory("");
      }}
    >
      {props.workspaceRoot ? (
        <WorkspaceDirectory
          cwd={props.workspaceRoot}
          relativePath={null}
          depth={0}
          selectedFilePath={props.selectedFilePath}
          expandedDirectories={props.expandedDirectories}
          dirtyPaths={dirtyPaths}
          onSelectFile={props.onSelectFile}
          onToggleDirectory={props.onToggleDirectory}
          onPrefetchEntry={props.onPrefetchEntry}
          actions={props.actions}
          onEntryContextMenu={props.onEntryContextMenu}
        />
      ) : (
        <PanelStateMessage density="compact" fill="flex">
          <p>No workspace.</p>
        </PanelStateMessage>
      )}
    </div>
  );
}

function WorkspaceSearchResultRow(props: {
  entry: ProjectEntry;
  selected: boolean;
  onSelectFile: (path: string) => void;
  onPrefetchEntry: (entry: Pick<ProjectFileSystemEntry, "path" | "kind">) => void;
  onEntryContextMenu: (path: string, position: { x: number; y: number }) => void;
  actions?: ReturnType<typeof useWorkspaceExplorerActions> | undefined;
}) {
  const { entry, onEntryContextMenu, onPrefetchEntry, onSelectFile } = props;
  const { dir, name } = splitRepoRelativePath(entry.path);
  const handlePrefetch = () => {
    onPrefetchEntry(entry);
  };
  if (props.actions?.edit?.action === "rename" && props.actions.edit.entry?.path === entry.path) {
    return (
      <ExplorerInlineName
        kind="file"
        path={entry.path}
        depth={0}
        initialName={splitRepoRelativePath(entry.path).name}
        creating={false}
        onSubmit={props.actions.submitEdit}
        onCancel={props.actions.cancelEdit}
      />
    );
  }

  return (
    <button
      {...EXPLORER_ROW_PROPS}
      type="button"
      className={fileRowClassName(props.selected, "h-8 px-2 transition-none")}
      title={entry.path}
      draggable
      onDragStart={(event) => {
        setFileReferenceDragData(event.dataTransfer, entry.path);
      }}
      onClick={() => onSelectFile(entry.path)}
      onPointerEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onContextMenu={(event) => {
        event.preventDefault();
        onEntryContextMenu(entry.path, { x: event.clientX, y: event.clientY });
      }}
    >
      <FileEntryIcon pathValue={entry.path} kind="file" className="size-3.5 shrink-0 opacity-75" />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
        <span className="shrink-0 truncate font-medium">{name}</span>
        {dir ? (
          <span className="min-w-0 truncate text-ui-sm text-muted-foreground/55">{dir}</span>
        ) : null}
      </div>
    </button>
  );
}

interface WorkspaceFileSearchState {
  inputQuery: string;
  fileMatches: ReadonlyArray<ProjectEntry>;
  searchResultsPending: boolean;
  searchResultsCurrent: boolean;
  isFetching: boolean;
  error: Error | null;
  truncated: boolean;
}

function useWorkspaceFileSearch(
  workspaceRoot: string | null,
  query: string,
): WorkspaceFileSearchState {
  const [debouncedQuery] = useDebouncedValue(query, {
    wait: EXPLORER_SEARCH_QUERY_DEBOUNCE_MS,
  });
  const inputQuery = query.trim();
  const trimmedQuery = debouncedQuery.trim();
  const entriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: workspaceRoot,
      query: trimmedQuery,
      kind: "file",
      limit: EXPLORER_SEARCH_RESULTS_LIMIT,
    }),
  );
  // Results are tied to the debounced query. While the user is ahead of that query, keep old results
  // non-selectable so Enter cannot open a stale match.
  const searchResultsPending = inputQuery !== trimmedQuery || entriesQuery.isPlaceholderData;
  const searchResultsCurrent = !searchResultsPending;
  const fileMatches = searchResultsCurrent
    ? (entriesQuery.data?.entries ?? EMPTY_WORKSPACE_SEARCH_FILE_MATCHES)
    : EMPTY_WORKSPACE_SEARCH_FILE_MATCHES;
  return {
    inputQuery,
    fileMatches,
    searchResultsPending,
    searchResultsCurrent,
    isFetching: entriesQuery.isFetching,
    error: searchResultsCurrent ? entriesQuery.error : null,
    truncated: entriesQuery.data?.truncated ?? false,
  };
}

function WorkspaceSearchInputHeader(props: {
  query: string;
  search: WorkspaceFileSearchState;
  autoFocus?: boolean;
  onQueryChange: (query: string) => void;
  onSelectFile: (path: string) => void;
  onCreateFile?: (() => void) | undefined;
  onCreateFolder?: (() => void) | undefined;
}) {
  const { onQueryChange, onSelectFile, query, search } = props;
  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!search.searchResultsCurrent) {
        return;
      }
      const topMatch = search.fileMatches[0];
      if (topMatch) {
        onSelectFile(topMatch.path);
      }
      return;
    }
    if (event.key === "Escape" && query.length > 0) {
      event.stopPropagation();
      onQueryChange("");
    }
  };

  return (
    <div className="shrink-0 border-b border-border/65 p-2">
      <div className="flex items-center gap-1">
        <SearchInput
          value={query}
          autoFocus={props.autoFocus}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="Search files..."
          aria-label="Search files"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        {props.onCreateFile && props.onCreateFolder ? (
          <ExplorerCreateButtons
            onCreateFile={props.onCreateFile}
            onCreateFolder={props.onCreateFolder}
          />
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceSearchResultsBody(props: {
  workspaceRoot: string | null;
  search: WorkspaceFileSearchState;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onPrefetchEntry: (entry: Pick<ProjectFileSystemEntry, "path" | "kind">) => void;
  onEntryContextMenu: (path: string, position: { x: number; y: number }) => void;
  actions?: ReturnType<typeof useWorkspaceExplorerActions> | undefined;
}) {
  const { fileMatches } = props.search;
  return (
    <>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto px-1 py-1",
          fileMatches.length === 0 && "flex flex-col",
        )}
      >
        {!props.workspaceRoot ? (
          <PanelStateMessage density="compact" fill="flex">
            <p>No workspace.</p>
          </PanelStateMessage>
        ) : props.search.searchResultsCurrent && props.search.error ? (
          <PanelStateMessage density="compact" fill="flex">
            <p className="text-destructive/85">
              {props.search.error instanceof Error
                ? props.search.error.message
                : "Could not search files."}
            </p>
          </PanelStateMessage>
        ) : fileMatches.length === 0 ? (
          props.search.searchResultsPending || props.search.isFetching ? (
            <ExplorerLoadingRows depth={0} />
          ) : (
            <PanelStateMessage density="compact" fill="flex">
              <p>No matching files.</p>
            </PanelStateMessage>
          )
        ) : (
          fileMatches.map((entry) => (
            <WorkspaceSearchResultRow
              key={entry.path}
              entry={entry}
              selected={entry.path === props.selectedFilePath}
              onSelectFile={props.onSelectFile}
              onPrefetchEntry={props.onPrefetchEntry}
              onEntryContextMenu={props.onEntryContextMenu}
              actions={props.actions}
            />
          ))
        )}
      </div>
      {fileMatches.length > 0 && props.search.truncated ? (
        <p className="shrink-0 border-t border-border/45 px-3 py-1.5 text-ui-xs text-muted-foreground/70">
          Showing the top matches. Refine the search to narrow them down.
        </p>
      ) : null}
    </>
  );
}

export function WorkspaceExplorerSidebar(props: {
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  expandedDirectories: ReadonlySet<string>;
  query: string;
  onQueryChange: (query: string) => void;
  containerClassName?: string;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined;
  onDeleted?: ((path: string) => void) | undefined;
}) {
  const prefetchEntry = useExplorerEntryPrefetch(props.workspaceRoot);
  const actions = useWorkspaceExplorerActions(
    props.workspaceRoot,
    props.selectedFilePath,
    props.onSelectFile,
    props.expandedDirectories,
    props.onToggleDirectory,
    props.onDeleted,
  );
  const handleTreeEntryContextMenu = useTreeEntryContextMenu(
    props.workspaceRoot,
    props.onReferenceInChat,
    actions,
  );
  const handleResultEntryContextMenu = useResultEntryContextMenu(
    props.workspaceRoot,
    props.onReferenceInChat,
    actions,
  );
  const handleListKeyDown = useExplorerListNavigation();
  const search = useWorkspaceFileSearch(props.workspaceRoot, props.query);

  return (
    <aside
      className={props.containerClassName ?? EXPLORER_SIDEBAR_CONTAINER_CLASS}
      onKeyDown={handleListKeyDown}
    >
      <WorkspaceSearchInputHeader
        query={props.query}
        search={search}
        onCreateFile={
          props.workspaceRoot
            ? () => {
                props.onQueryChange("");
                actions.create(actions.selectedDirectory, "file");
              }
            : undefined
        }
        onCreateFolder={
          props.workspaceRoot
            ? () => {
                props.onQueryChange("");
                actions.create(actions.selectedDirectory, "directory");
              }
            : undefined
        }
        onQueryChange={props.onQueryChange}
        onSelectFile={props.onSelectFile}
      />
      {search.inputQuery.length === 0 ? (
        <WorkspaceFilesTreeBody
          actions={actions}
          workspaceRoot={props.workspaceRoot}
          selectedFilePath={props.selectedFilePath}
          expandedDirectories={props.expandedDirectories}
          onSelectFile={props.onSelectFile}
          onToggleDirectory={props.onToggleDirectory}
          onPrefetchEntry={prefetchEntry}
          onEntryContextMenu={handleTreeEntryContextMenu}
        />
      ) : (
        <WorkspaceSearchResultsBody
          workspaceRoot={props.workspaceRoot}
          search={search}
          selectedFilePath={props.selectedFilePath}
          onSelectFile={props.onSelectFile}
          onPrefetchEntry={prefetchEntry}
          onEntryContextMenu={handleResultEntryContextMenu}
          actions={actions}
        />
      )}
      {actions.dialogs}
    </aside>
  );
}
