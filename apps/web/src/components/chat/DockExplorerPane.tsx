import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  isNormalizedWindowsAbsolutePath,
  isWorkspaceRelativePathSafe,
} from "@glade/shared/platform/path";
import { useQueryClient } from "@tanstack/react-query";
import { directoryChain, useExplorerRevealRequestStore } from "~/explorerRevealRequestStore";
import type { ChatFileReference } from "~/lib/chatReferences";
import { selectMainWorkspace, useMainWorkspaceStore } from "~/mainWorkspaceStore";
import { selectWorkspaceFileTabs, useWorkspaceFileTabsStore } from "~/workspaceFileTabsStore";
import {
  dirtyWorkspaceEditorPaths,
  dirtyWorkspaceEditorRevision,
  subscribeDirtyWorkspaceEditors,
} from "~/lib/workspaceEditorSession";
import { projectListDirectoriesQueryOptions } from "~/lib/projectReactQuery";
import { WorkspaceExplorerSidebar } from "./workspaceExplorer";

function parentDirectoryChain(filePath: string): string[] {
  return directoryChain(filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "");
}

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
  const mainWorkspace = useMainWorkspaceStore(selectMainWorkspace(props.threadId));
  const closeReview = useMainWorkspaceStore((state) => state.closeReview);
  const subscribeDirty = useCallback(
    (listener: () => void) => subscribeDirtyWorkspaceEditors(queryClient, listener),
    [queryClient],
  );
  const readDirty = useCallback(() => dirtyWorkspaceEditorRevision(queryClient), [queryClient]);
  useSyncExternalStore(subscribeDirty, readDirty, readDirty);
  const dirtyPaths = props.workspaceRoot
    ? dirtyWorkspaceEditorPaths(queryClient, props.workspaceRoot)
    : new Set<string>();
  // The pane remounts per chat, so it reopens with the active file's folders expanded.
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        fileTabs.activeFilePath && isWorkspaceRelativePathSafe(fileTabs.activeFilePath)
          ? parentDirectoryChain(fileTabs.activeFilePath)
          : [],
      ),
  );
  const [codeQuery, setCodeQuery] = useState("");
  // The file tab's editor bundle is large; loading it with the explorer keeps the first file click
  // from waiting on it.
  useEffect(() => {
    void import("../WorkspaceFilePreview").catch(() => undefined);
  }, []);
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
    setExpandedDirectories((current) => new Set([...current, ...parentDirectoryChain(path)]));
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
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--color-background-surface)]">
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
        onRemoved={(path) => {
          const removed = (file: string | null) =>
            file !== null && (file === path || file.startsWith(`${path}/`));
          for (const file of fileTabs.filePaths) {
            if (removed(file)) closeFile(props.threadId, file);
          }
          // Commit tabs show history and stay; working tree and turn diffs of the file go with it.
          for (const review of mainWorkspace.reviews) {
            if ((review.kind === "gitFile" || review.kind === "diff") && removed(review.filePath))
              closeReview(props.threadId, review.id);
          }
        }}
        onToggleDirectory={handleToggleDirectory}
        onReferenceInChat={props.onReferenceInChat}
      />
    </div>
  );
};
