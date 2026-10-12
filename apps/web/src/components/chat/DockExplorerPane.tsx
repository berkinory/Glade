import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { isNormalizedWindowsAbsolutePath } from "@glade/shared/platform/path";
import { useQueryClient } from "@tanstack/react-query";
import { directoryChain, useExplorerRevealRequestStore } from "~/explorerRevealRequestStore";
import type { ChatFileReference } from "~/lib/chatReferences";
import { selectWorkspaceFileTabs, useWorkspaceFileTabsStore } from "~/workspaceFileTabsStore";
import {
  dirtyWorkspaceEditorPaths,
  dirtyWorkspaceEditorRevision,
  subscribeDirtyWorkspaceEditors,
} from "~/lib/workspaceEditorSession";
import { projectListDirectoriesQueryOptions } from "~/lib/projectReactQuery";
import { WorkspaceExplorerSidebar } from "./workspaceExplorer";
export const DockExplorerPane = function DockExplorerPane(props: {
  threadId: ThreadId;
  workspaceRoot: string | null;
  isVisible: boolean;
  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const fileTabs = useWorkspaceFileTabsStore((state) =>
    selectWorkspaceFileTabs(props.threadId)(state),
  );
  const openFile = useWorkspaceFileTabsStore((state) => state.openFile);
  const closeFile = useWorkspaceFileTabsStore((state) => state.closeFile);
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
  const revealRequest = useExplorerRevealRequestStore(
    (state) => state.requestsByThreadId[props.threadId],
  );
  const acknowledgeRequest = useExplorerRevealRequestStore((state) => state.acknowledgeRequest);
  useEffect(() => {
    if (!revealRequest) return;
    setCodeQuery("");
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
  }, [revealRequest, props.workspaceRoot, props.threadId, queryClient, acknowledgeRequest]);
  const handleSelectFile = (
    path: string,
    options?: { preview?: boolean; position?: { lineNumber: number } },
  ) => {
    openFile(props.threadId, path, {
      preview: options?.preview === true && !dirtyPaths.has(path),
      ...(options?.position ? { position: options.position } : {}),
    });
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    setExpandedDirectories((current) => new Set([...current, ...directoryChain(parent)]));
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
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--app-content-surface)]">
      <WorkspaceExplorerSidebar
        key={props.workspaceRoot}
        isVisible={props.isVisible}
        workspaceRoot={props.workspaceRoot}
        selectedFilePath={fileTabs.activeFilePath}
        expandedDirectories={expandedDirectories}
        query={codeQuery}
        onQueryChange={setCodeQuery}
        onSelectMatch={(match) =>
          handleSelectFile(match.path, {
            preview: true,
            position: { lineNumber: match.lineNumber },
          })
        }
        containerClassName="flex min-h-0 flex-1 flex-col"
        onSelectFile={handleSelectFile}
        onDeleted={(path) => {
          for (const file of fileTabs.filePaths) {
            if ((file === path || file.startsWith(`${path}/`)) && !dirtyPaths.has(file))
              closeFile(props.threadId, file);
          }
        }}
        onToggleDirectory={handleToggleDirectory}
        onReferenceInChat={props.onReferenceInChat}
      />
    </div>
  );
};
