import { FilePlusIcon, FolderPlusIcon } from "~/lib/icons";
import type {
  ProjectContentMatch,
  ProjectFileSystemEntry,
} from "@glade/contracts/workspace/project";
import {
  isWorkspaceRelativePathSafe,
  joinWorkspaceRelativePath,
} from "@glade/shared/platform/path";
import { useProjectFileChangeSubscription } from "~/hooks/useProjectFileChangeSubscription";
import { refreshProjectDirectories } from "~/lib/projectDirectoryRefresh";
import { useExplorerIntake } from "./useExplorerIntake";
import { WorkspaceExplorerTree } from "./WorkspaceExplorerTree";
import {
  useWorkspaceExplorerActions,
  type WorkspaceExplorerActions,
} from "./useWorkspaceExplorerActions";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { basenameOfPath } from "~/file-icons";
import { type ChatFileReference } from "~/lib/chatReferences";
import { showFileReferenceContextMenu } from "~/lib/fileReferenceContextMenu";
import {
  projectQueryKeys,
  projectListDirectoriesQueryOptions,
  projectReadFileQueryOptions,
} from "~/lib/projectReactQuery";
import { getSyntaxHighlighterPromise, getSyntaxLanguageForPath } from "~/lib/syntaxHighlighting";
import {
  dirtyWorkspaceEditorPaths,
  dirtyWorkspaceEditorRevision,
  subscribeDirtyWorkspaceEditors,
} from "~/lib/workspaceEditorSession";
import { useExplorerListNavigation } from "./explorerListNavigation";
import { PanelStateMessage } from "./PanelStateMessage";
import { WorkspaceCodeSearch } from "./WorkspaceCodeSearch";
const EXPLORER_SIDEBAR_CONTAINER_CLASS =
  "flex min-h-[11rem] w-full shrink-0 flex-col border-b border-border/65 bg-[var(--app-content-surface)] lg:h-full lg:w-56 lg:border-b-0 lg:border-r";
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
    const language = getSyntaxLanguageForPath(entry.path);
    if (language === "text") return;
    void queryClient
      .fetchQuery({
        ...projectReadFileQueryOptions({
          cwd,
          relativePath: entry.path,
          maxBytes: 64 * 1024,
          requireComplete: true,
          gcTime: 30_000,
        }),
        queryKey: projectQueryKeys.prefetchFile(cwd, entry.path),
      })
      .then((file) => (file.truncated ? undefined : getSyntaxHighlighterPromise(language)))
      .catch(() => undefined);
  };
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
  actions: WorkspaceExplorerActions,
) {
  return (
    entry: ProjectFileSystemEntry,
    position: {
      x: number;
      y: number;
    },
  ) => {
    const revealPath = explorerRevealPath(workspaceRoot, entry.path);
    void showFileReferenceContextMenu({
      path: entry.path,
      ...(revealPath
        ? {
            revealPath,
          }
        : {}),
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
        <FilePlusIcon className="size-4" />
      </button>
      <button
        type="button"
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        aria-label="New folder"
        title="New folder"
        disabled={props.disabled}
        onClick={props.onCreateFolder}
      >
        <FolderPlusIcon className="size-4" />
      </button>
    </div>
  );
}
function WorkspaceFilesTreeBody(props: {
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  expandedDirectories: ReadonlySet<string>;
  onSelectFile: (
    path: string,
    options?: {
      preview?: boolean;
    },
  ) => void;
  onToggleDirectory: (path: string) => void;
  onPrefetchEntry: (entry: ProjectFileSystemEntry) => void;
  actions: WorkspaceExplorerActions;
  onEntryContextMenu: (
    entry: ProjectFileSystemEntry,
    position: {
      x: number;
      y: number;
    },
  ) => void;
}) {
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
  return props.workspaceRoot ? (
    <WorkspaceExplorerTree {...props} workspaceRoot={props.workspaceRoot} dirtyPaths={dirtyPaths} />
  ) : (
    <PanelStateMessage density="compact" fill="flex">
      <p>No workspace.</p>
    </PanelStateMessage>
  );
}
export function WorkspaceExplorerSidebar(props: {
  isVisible?: boolean;
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  expandedDirectories: ReadonlySet<string>;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectMatch: (match: ProjectContentMatch) => void;
  containerClassName?: string;
  onSelectFile: (
    path: string,
    options?: {
      preview?: boolean;
    },
  ) => void;
  onToggleDirectory: (path: string) => void;
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined;
  onDeleted?: ((path: string) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const onDirectoryChange = useCallback(
    (event: { relativePath: string }) => {
      if (props.workspaceRoot)
        void refreshProjectDirectories(queryClient, props.workspaceRoot, [
          event.relativePath,
        ]).catch(() => undefined);
    },
    [queryClient, props.workspaceRoot],
  );
  const watchedDirectories = [
    ".",
    ...[...props.expandedDirectories].filter((directory) => {
      const segments = directory.split("/");
      return segments.every(
        (_segment, index) =>
          index === 0 || props.expandedDirectories.has(segments.slice(0, index).join("/")),
      );
    }),
  ].toSorted();
  useProjectFileChangeSubscription({
    cwd: props.workspaceRoot,
    relativePath: ".",
    directoryPaths: JSON.stringify(watchedDirectories),
    enabled: props.isVisible ?? true,
    onChange: onDirectoryChange,
  });
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
  const intake = useExplorerIntake(props.workspaceRoot, actions.selectedDirectory);
  const handleListKeyDown = useExplorerListNavigation();
  const rootName = props.workspaceRoot
    ? basenameOfPath(props.workspaceRoot.replace(/[\\/]+$/, "")) || props.workspaceRoot
    : null;
  return (
    <aside
      className={props.containerClassName ?? EXPLORER_SIDEBAR_CONTAINER_CLASS}
      onKeyDown={(event) => {
        intake.onKeyDown(event);
        handleListKeyDown(event);
      }}
      onPaste={intake.onPaste}
      onDragOver={intake.onDragOver}
      onDragLeave={intake.onDragLeave}
      onDrop={intake.onDrop}
    >
      {intake.targetDirectory !== null && (
        <p role="status" className="shrink-0 bg-accent/20 px-2 py-1 text-ui-xs">
          Copy into {intake.targetDirectory || "workspace root"}
        </p>
      )}
      {rootName ? (
        <div className="shrink-0 truncate px-3 pt-2 text-ui-xs font-medium" title={rootName}>
          {rootName}
        </div>
      ) : null}
      <WorkspaceCodeSearch
        cwd={props.workspaceRoot}
        selectedFilePath={props.selectedFilePath}
        query={props.query}
        onQueryChange={props.onQueryChange}
        onSelect={props.onSelectMatch}
        headerActions={
          <ExplorerCreateButtons
            disabled={!props.workspaceRoot || actions.busy}
            onCreateFile={() => {
              props.onQueryChange("");
              actions.create(actions.selectedDirectory, "file");
            }}
            onCreateFolder={() => {
              props.onQueryChange("");
              actions.create(actions.selectedDirectory, "directory");
            }}
          />
        }
        emptyContent={
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
        }
      />
      {actions.dialogs}
    </aside>
  );
}
