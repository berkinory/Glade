import { useEffect, useState } from "react";

import type { ThreadId } from "@glade/contracts";
import { isNormalizedWindowsAbsolutePath } from "@glade/shared/path";
import { useQueryClient } from "@tanstack/react-query";

import { directoryChain, useExplorerRevealRequestStore } from "~/explorerRevealRequestStore";
import type { ChatFileReference } from "~/lib/chatReferences";
import type { FileCommentSelection } from "~/lib/fileComments";
import { projectListDirectoriesQueryOptions } from "~/lib/projectReactQuery";
import { WorkspaceFilePreview } from "../WorkspaceFilePreview";
import { PanelStateMessage } from "./PanelStateMessage";
import { WorkspaceCodeSearch } from "./WorkspaceCodeSearch";
import { IconButton } from "../ui/icon-button";
import { FolderIcon, SearchIcon } from "~/lib/icons";
import { WorkspaceExplorerSidebar } from "./workspaceExplorer";

const DOCK_EXPLORER_SIDEBAR_CLASS =
  "flex h-full min-h-0 w-60 shrink-0 flex-col border-r border-border/65 bg-[var(--color-background-surface)]";

export const DockExplorerPane = function DockExplorerPane(props: {
  threadId: ThreadId;
  workspaceRoot: string | null;
  isVisible: boolean;
  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;
  onAskWhyInChat?: ((reference: ChatFileReference) => void) | undefined;
  onCommentInChat?: ((comment: FileCommentSelection) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [codeQuery, setCodeQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [revealPosition, setRevealPosition] = useState<{ lineNumber: number; requestId: number }>();

  const revealRequest = useExplorerRevealRequestStore(
    (state) => state.requestsByThreadId[props.threadId],
  );
  useEffect(() => {
    if (!revealRequest) return;
    setSearchQuery("");
    setSearchMode(false);
    setRevealPosition(undefined);
    if (revealRequest.filePath) setSelectedFilePath(revealRequest.filePath);
    const workspaceRoot = props.workspaceRoot;
    let cancelled = false;
    const expand = (paths: string[]) => {
      if (cancelled) return;
      setExpandedDirectories((current) => new Set([...current, ...paths]));
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
  }, [revealRequest, props.workspaceRoot, props.threadId, queryClient]);

  const handleSelectFile = (path: string) => {
    setSelectedFilePath(path);
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
    <div className="flex h-full min-h-0 w-full">
      <div className={DOCK_EXPLORER_SIDEBAR_CLASS}>
        <div className="flex shrink-0 items-center gap-1 border-b border-border/65 px-2 py-1">
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
            workspaceRoot={props.workspaceRoot}
            selectedFilePath={selectedFilePath}
            expandedDirectories={expandedDirectories}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            containerClassName="flex min-h-0 flex-1 flex-col"
            onSelectFile={handleSelectFile}
            onDeleted={(path) => {
              setSelectedFilePath((current) =>
                current === path || current?.startsWith(`${path}/`) ? null : current,
              );
            }}
            onToggleDirectory={handleToggleDirectory}
            onReferenceInChat={props.onReferenceInChat}
          />
        )}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <WorkspaceFilePreview
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
          onAskWhyInChat={props.onAskWhyInChat}
          onCommentInChat={props.onCommentInChat}
        />
      </div>
    </div>
  );
};
