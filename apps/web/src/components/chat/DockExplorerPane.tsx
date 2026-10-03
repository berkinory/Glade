import { useEffect, useId, useState, useCallback, useSyncExternalStore } from "react";

import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { isNormalizedWindowsAbsolutePath } from "@glade/shared/platform/path";
import { useQueryClient } from "@tanstack/react-query";

import { directoryChain, useExplorerRevealRequestStore } from "~/explorerRevealRequestStore";
import type { ChatFileReference } from "~/lib/chatReferences";
import { basenameOfPath } from "~/file-icons";
import { selectRightDockState, useRightDockStore } from "~/rightDockStore";
import {
  dirtyWorkspaceEditorPaths,
  dirtyWorkspaceEditorRevision,
  subscribeDirtyWorkspaceEditors,
} from "~/lib/workspaceEditorSession";
import { PanelTabBar } from "./PanelTabBar";
import { FileEntryIcon } from "./FileEntryIcon";
import { projectListDirectoriesQueryOptions } from "~/lib/projectReactQuery";
import { WorkspaceFilePreview } from "../WorkspaceFilePreview";
import { PanelStateMessage } from "./PanelStateMessage";
import { WorkspaceCodeSearch } from "./WorkspaceCodeSearch";
import { IconButton } from "../ui/icon-button";
import { disclosureWidthClassName } from "~/lib/disclosureMotion";
import { cn } from "~/lib/utils";
import { FolderIcon, PanelLeftIcon, SearchIcon } from "~/lib/icons";
import { WorkspaceExplorerSidebar } from "./workspaceExplorer";

const DOCK_EXPLORER_SIDEBAR_CLASS = "h-full min-h-0 shrink-0 bg-[var(--color-background-surface)]";

export const DockExplorerPane = function DockExplorerPane(props: {
  threadId: ThreadId;
  workspaceRoot: string | null;
  isVisible: boolean;
  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const sidebarId = useId();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const dockState = useRightDockStore((state) => selectRightDockState(props.threadId)(state));
  const openFile = useRightDockStore((state) => state.openFile);
  const closeFile = useRightDockStore((state) => state.closeFile);
  const selectedFilePath = dockState.activeFilePath;
  const subscribeDirty = useCallback(
    (listener: () => void) => subscribeDirtyWorkspaceEditors(queryClient, listener),
    [queryClient],
  );
  const readDirty = useCallback(() => dirtyWorkspaceEditorRevision(queryClient), [queryClient]);
  useSyncExternalStore(subscribeDirty, readDirty, readDirty);
  const dirtyPaths = props.workspaceRoot
    ? dirtyWorkspaceEditorPaths(queryClient, props.workspaceRoot)
    : new Set<string>();
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [codeQuery, setCodeQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [revealPosition, setRevealPosition] = useState<{
    lineNumber: number;
    column?: number;
    requestId: number;
  }>();

  const revealRequest = useExplorerRevealRequestStore(
    (state) => state.requestsByThreadId[props.threadId],
  );
  const acknowledgeRequest = useExplorerRevealRequestStore((state) => state.acknowledgeRequest);
  useEffect(() => {
    if (!revealRequest) return;
    setSearchQuery("");
    setSearchMode(false);
    setRevealPosition(
      revealRequest.position
        ? { ...revealRequest.position, requestId: revealRequest.nonce }
        : undefined,
    );
    if (revealRequest.filePath) openFile(props.threadId, revealRequest.filePath);
    const workspaceRoot = props.workspaceRoot;
    let cancelled = false;
    const expand = (paths: string[]) => {
      if (cancelled) return;
      setExpandedDirectories((current) => new Set([...current, ...paths]));
      acknowledgeRequest(props.threadId, revealRequest.nonce);
    };
    if (!workspaceRoot || !isNormalizedWindowsAbsolutePath(workspaceRoot.replaceAll("\\", "/"))) {
      expand(directoryChain(revealRequest.path));
      return;
    }

    const reveal = async () => {
      let parentPath = "";
      const paths: string[] = [];
      for (const segment of revealRequest.path.split("/").filter(Boolean)) {
        const listing = await queryClient.fetchQuery(
          projectListDirectoriesQueryOptions({ cwd: workspaceRoot, relativePath: parentPath }),
        );
        if (cancelled) return;
        const entry = listing.entries.find(
          (candidate) =>
            candidate.kind === "directory" &&
            candidate.name.toLowerCase() === segment.toLowerCase(),
        );
        if (!entry) break;
        parentPath = entry.path;
        paths.push(parentPath);
      }
      expand(paths);
    };
    // A failed listing must not mark a guessed path expanded or disturb the current tree state.
    void reveal().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    revealRequest,
    props.workspaceRoot,
    props.threadId,
    queryClient,
    openFile,
    acknowledgeRequest,
  ]);

  const handleSelectFile = (path: string) => {
    openFile(props.threadId, path);
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    setExpandedDirectories((current) => new Set([...current, ...directoryChain(parent)]));
    setRevealPosition(undefined);
  };

  const handleToggleDirectory = (path: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <PanelTabBar
        label="Explorer files"
        activeId={selectedFilePath}
        onSelect={(path) => {
          openFile(props.threadId, path);
          setRevealPosition(undefined);
        }}
        tabs={dockState.filePaths.map((path) => ({
          id: path,
          label: basenameOfPath(path),
          icon: <FileEntryIcon pathValue={path} kind="file" className="size-3.5" />,
          trailing: dirtyPaths.has(path) ? <span aria-label="Unsaved changes">●</span> : null,
          onClose: () => closeFile(props.threadId, path),
        }))}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          id={sidebarId}
          className={cn(disclosureWidthClassName(sidebarOpen, "w-44"), DOCK_EXPLORER_SIDEBAR_CLASS)}
          inert={!sidebarOpen}
          aria-hidden={!sidebarOpen}
        >
          <div className="flex h-full min-h-0 w-44 flex-col border-r border-border/65">
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/65 px-2">
              <span className="flex-1 text-ui-xs text-muted-foreground">
                {searchMode ? "Search" : "Explorer"}
              </span>
              <IconButton
                label="Show files"
                tooltip="Show files"
                variant={!searchMode ? "secondary" : "ghost"}
                aria-pressed={!searchMode}
                onClick={() => setSearchMode(false)}
              >
                <FolderIcon className="size-3.5" />
              </IconButton>
              <IconButton
                label="Search file contents"
                tooltip="Search file contents"
                variant={searchMode ? "secondary" : "ghost"}
                aria-pressed={searchMode}
                onClick={() => setSearchMode(true)}
              >
                <SearchIcon className="size-3.5" />
              </IconButton>
            </div>
            {searchMode ? (
              <WorkspaceCodeSearch
                key={props.workspaceRoot}
                cwd={props.workspaceRoot}
                selectedFilePath={selectedFilePath}
                query={codeQuery}
                onQueryChange={setCodeQuery}
                onSelect={(match) => {
                  handleSelectFile(match.path);
                  setSearchQuery("");
                  setRevealPosition((previous) => ({
                    lineNumber: match.lineNumber,
                    requestId: (previous?.requestId ?? 0) + 1,
                  }));
                }}
              />
            ) : (
              <WorkspaceExplorerSidebar
                key={props.workspaceRoot}
                isVisible={props.isVisible && sidebarOpen}
                workspaceRoot={props.workspaceRoot}
                selectedFilePath={selectedFilePath}
                expandedDirectories={expandedDirectories}
                query={searchQuery}
                onQueryChange={setSearchQuery}
                containerClassName="flex min-h-0 flex-1 flex-col"
                onSelectFile={handleSelectFile}
                onDeleted={(path) => {
                  for (const file of dockState.filePaths) {
                    if ((file === path || file.startsWith(`${path}/`)) && !dirtyPaths.has(file))
                      closeFile(props.threadId, file);
                  }
                }}
                onToggleDirectory={handleToggleDirectory}
                onReferenceInChat={props.onReferenceInChat}
              />
            )}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">
          <WorkspaceFilePreview
            headerLeading={
              <IconButton
                label={sidebarOpen ? "Hide Explorer sidebar" : "Show Explorer sidebar"}
                tooltip={sidebarOpen ? "Hide Explorer sidebar" : "Show Explorer sidebar"}
                aria-expanded={sidebarOpen}
                aria-controls={sidebarId}
                onClick={() => setSidebarOpen((open) => !open)}
                className="shrink-0"
              >
                <PanelLeftIcon className="size-3.5" />
              </IconButton>
            }
            workspaceRoot={props.workspaceRoot}
            filePath={selectedFilePath}
            revealPosition={revealPosition}
            liveRevalidationEnabled={props.isVisible}
            editable
            emptyState={
              <PanelStateMessage density="compact" fill="flex">
                <p>Select a file from the tree to view it.</p>
              </PanelStateMessage>
            }
            onReferenceInChat={props.onReferenceInChat}
          />
        </div>
      </div>
    </div>
  );
};
