import { PanelLeftIcon } from "~/lib/icons";
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
import { IconButton } from "../ui/icon-button";
import { disclosureWidthClassName } from "~/lib/disclosureMotion";
import { cn } from "~/lib/utils";
import { WorkspaceExplorerSidebar } from "./workspaceExplorer";
const DOCK_EXPLORER_SIDEBAR_CLASS = "h-full min-h-0 shrink-0 bg-[var(--app-content-surface)]";
export const DockExplorerPane = function DockExplorerPane(props: {
  navigationOnly?: boolean;
  onRevealPosition?: (
    position:
      | {
          filePath: string;
          lineNumber: number;
          column?: number;
          requestId: number;
        }
      | undefined,
  ) => void;
  threadId: ThreadId;
  workspaceRoot: string | null;
  isVisible: boolean;
  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;
}) {
  const { onRevealPosition } = props;
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
  const [codeQuery, setCodeQuery] = useState("");
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
    setCodeQuery("");
    const nextPosition = revealRequest.position
      ? {
          ...revealRequest.position,
          requestId: revealRequest.nonce,
        }
      : undefined;
    setRevealPosition(nextPosition);
    onRevealPosition?.(
      nextPosition && revealRequest.filePath
        ? {
            ...nextPosition,
            filePath: revealRequest.filePath,
          }
        : undefined,
    );
    if (revealRequest.filePath)
      openFile(props.threadId, revealRequest.filePath, {
        preview: props.navigationOnly === true && revealRequest.preview === true,
      });
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
          projectListDirectoriesQueryOptions({
            cwd: workspaceRoot,
            relativePath: parentPath,
          }),
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
    props.navigationOnly,
    props.threadId,
    queryClient,
    openFile,
    acknowledgeRequest,
    onRevealPosition,
  ]);
  const handleSelectFile = (
    path: string,
    options?: {
      preview?: boolean;
    },
  ) => {
    openFile(props.threadId, path, {
      preview: props.navigationOnly === true && options?.preview === true && !dirtyPaths.has(path),
    });
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    setExpandedDirectories((current) => new Set([...current, ...directoryChain(parent)]));
    setRevealPosition(undefined);
    onRevealPosition?.(undefined);
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
      {!props.navigationOnly ? (
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
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          id={sidebarId}
          className={cn(
            props.navigationOnly ? "w-full" : disclosureWidthClassName(sidebarOpen, "w-44"),
            DOCK_EXPLORER_SIDEBAR_CLASS,
          )}
          inert={!sidebarOpen}
          aria-hidden={!sidebarOpen}
        >
          <div
            className={cn(
              "flex h-full min-h-0 flex-col",
              props.navigationOnly ? "w-full" : "w-44 border-r border-border/65",
            )}
          >
            <WorkspaceExplorerSidebar
              key={props.workspaceRoot}
              isVisible={props.isVisible && sidebarOpen}
              workspaceRoot={props.workspaceRoot}
              selectedFilePath={selectedFilePath}
              expandedDirectories={expandedDirectories}
              query={codeQuery}
              onQueryChange={setCodeQuery}
              onSelectMatch={(match) => {
                handleSelectFile(match.path, {
                  preview: true,
                });
                const position = {
                  lineNumber: match.lineNumber,
                  requestId: Date.now(),
                };
                setRevealPosition(position);
                onRevealPosition?.({
                  ...position,
                  filePath: match.path,
                });
              }}
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
          </div>
        </div>
        {!props.navigationOnly ? (
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
        ) : null}
      </div>
    </div>
  );
};
