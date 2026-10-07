import { GitCommitHorizontalIcon, PlusMinusSquare01Icon } from "~/lib/icons";
import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { basenameOfPath } from "~/file-icons";
import { WorkspaceHeaderContext } from "./WorkspaceHeaderContext";
import { ProviderIcon } from "../ProviderIcon";
import { resolveThreadDisplayProvider } from "~/lib/threadDisplayProvider";
import { isTerminalFocused } from "~/lib/terminalFocus";
import {
  dirtyWorkspaceEditorPaths,
  dirtyWorkspaceEditorRevision,
  subscribeDirtyWorkspaceEditors,
} from "~/lib/workspaceEditorSession";
import { selectMainWorkspace, useMainWorkspaceStore } from "~/mainWorkspaceStore";
import { selectRightDockState, useRightDockStore } from "~/rightDockStore";
import { useStore } from "~/store";
import { cn } from "~/lib/utils";
import { WorkspaceFilePreview } from "../WorkspaceFilePreview";
import type { ChatFileReference } from "~/lib/chatReferences";
import { WorkspaceGitDiff } from "./WorkspaceGitDiff";
import { CommitDetail } from "./CommitDetail";
import { SourceControlTurnChanges } from "./SourceControlTurnChanges";
import { FileEntryIcon } from "./FileEntryIcon";
import { PanelTabBar, type PanelTab } from "./PanelTabBar";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import { useWorkspaceTabSelection } from "./useWorkspaceTabSelection";
import { useWorkspaceSidebarStore } from "~/workspaceSidebarStore";
export function MainWorkspace(props: {
  threadId: ThreadId;
  projectId: ProjectId | null;
  workspaceRoot: string | null;
  revealPosition?:
    | {
        filePath: string;
        lineNumber: number;
        column?: number;
        requestId: number;
      }
    | undefined;
  onReferenceInChat: (reference: ChatFileReference) => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const state = useMainWorkspaceStore(selectMainWorkspace(props.threadId));
  const selectTab = useMainWorkspaceStore((store) => store.selectTab);
  const pinReview = useMainWorkspaceStore((store) => store.pinReview);
  const closeReview = useMainWorkspaceStore((store) => store.closeReview);
  const dock = useRightDockStore(selectRightDockState(props.threadId));
  const closeFile = useRightDockStore((store) => store.closeFile);
  const openFile = useRightDockStore((store) => store.openFile);
  const pinFile = useRightDockStore((store) => store.pinFile);
  const provider = useStore((store) => {
    const thread = store.threadShellById?.[props.threadId];
    return thread ? resolveThreadDisplayProvider(thread) : null;
  });
  const draftProvider = useComposerDraftStore(
    (store) => store.draftsByThreadId[props.threadId]?.activeProvider,
  );
  const chatProvider = draftProvider ?? provider ?? "codex";
  const chatLabel = chatProvider === "claudeAgent" ? "Claude" : "Codex";
  const [headerHost, setHeaderHost] = useState<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const subscribeDirty = useCallback(
    (listener: () => void) => subscribeDirtyWorkspaceEditors(queryClient, listener),
    [queryClient],
  );
  const readDirty = useCallback(() => dirtyWorkspaceEditorRevision(queryClient), [queryClient]);
  useSyncExternalStore(subscribeDirty, readDirty, readDirty);
  const dirtyPaths = props.workspaceRoot
    ? dirtyWorkspaceEditorPaths(queryClient, props.workspaceRoot)
    : new Set<string>();
  const previewDirty = dock.previewFilePath ? dirtyPaths.has(dock.previewFilePath) : false;
  useEffect(() => {
    if (previewDirty && dock.previewFilePath) pinFile(props.threadId, dock.previewFilePath);
  }, [previewDirty, dock.previewFilePath, pinFile, props.threadId]);
  const tabs: PanelTab[] = [
    {
      id: "chat",
      label: chatLabel,
      icon: <ProviderIcon provider={chatProvider} tone="header" className="size-3.5" />,
    },
    ...dock.filePaths.map((path) => ({
      id: `file:${path}`,
      preview: dock.previewFilePath === path,
      onDoubleClick: () => pinFile(props.threadId, path),
      label: basenameOfPath(path),
      icon: <FileEntryIcon pathValue={path} kind="file" className="size-3.5" />,
      trailing: dirtyPaths.has(path) ? <span aria-label="Unsaved changes">●</span> : null,
      onClose: () => closeFile(props.threadId, path),
    })),
    ...state.reviews.map((tab) => ({
      id: tab.id,
      label: tab.filePath
        ? basenameOfPath(tab.filePath)
        : tab.kind === "commit"
          ? tab.subject || tab.sha.slice(0, 7)
          : "Turn changes",
      preview: state.previewReviewId === tab.id,
      onDoubleClick: () => pinReview(props.threadId, tab.id),
      icon:
        tab.kind === "commit" ? (
          <GitCommitHorizontalIcon className="size-3.5" />
        ) : (
          <PlusMinusSquare01Icon className="size-3.5" />
        ),
      onClose: () => closeReview(props.threadId, tab.id),
    })),
  ];
  const select = (id: string) => {
    if (id.startsWith("file:")) {
      const path = id.slice(5);
      openFile(props.threadId, path, {
        preview: dock.previewFilePath === path,
      });
    } else selectTab(props.threadId, id);
  };
  const resolvedId = useWorkspaceTabSelection({
    tabIds: tabs.map((tab) => tab.id),
    activeId: state.activeTabId,
    onSelect: select,
  });
  const filePath = resolvedId.startsWith("file:") ? resolvedId.slice(5) : null;
  const review = state.reviews.find((tab) => tab.id === resolvedId);
  useWorkspaceShortcuts({
    threadId: props.threadId,
    onNavigate: (direction) => {
      const index = tabs.findIndex((tab) => tab.id === resolvedId);
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      if (!next) return;
      select(next.id);
      const tabElement = Array.from(
        headerHost?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [],
      ).find((element) => element.dataset.tabId === next.id);
      tabElement?.querySelector<HTMLButtonElement>("button[aria-pressed]")?.focus();
    },
    onClose: () => {
      // A focused shell closes itself in the terminal view.
      if (isTerminalFocused()) return;
      if (resolvedId === "chat") {
        if (tabs.length === 1)
          void navigate({
            to: "/",
          });
      } else tabs.find((tab) => tab.id === resolvedId)?.onClose?.();
    },
  });
  const tabBar = (
    <PanelTabBar
      label="Workspace tabs"
      pinnedTabId="chat"
      contentTabs
      className="h-auto flex-1 border-0 bg-transparent p-0"
      tabs={tabs}
      activeId={resolvedId}
      onSelect={select}
    />
  );
  return (
    <WorkspaceHeaderContext
      value={{
        host: headerHost,
        tabs: tabBar,
      }}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div ref={setHeaderHost} className="shrink-0" />
        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            className={cn(
              "absolute inset-0 flex min-h-0 flex-col",
              resolvedId !== "chat" && "invisible pointer-events-none",
            )}
            inert={resolvedId !== "chat"}
            aria-hidden={resolvedId !== "chat"}
          >
            {props.children}
          </div>
          {filePath ? (
            <WorkspaceFilePreview
              key={filePath}
              workspaceRoot={props.workspaceRoot}
              filePath={filePath}
              editable
              onEdit={() => pinFile(props.threadId, filePath)}
              liveRevalidationEnabled
              revealPosition={
                props.revealPosition?.filePath === filePath ? props.revealPosition : undefined
              }
              onReferenceInChat={props.onReferenceInChat}
            />
          ) : null}
          {review?.kind === "commit" && props.workspaceRoot ? (
            <div className="flex h-full min-h-0 flex-col">
              <CommitDetail
                key={review.id}
                cwd={props.workspaceRoot}
                filePath={review.filePath}
                commit={review}
                onClose={() => closeReview(props.threadId, review.id)}
                onOpenFile={(path) => openFile(props.threadId, path)}
              />
            </div>
          ) : null}
          {review?.kind === "gitFile" && props.workspaceRoot ? (
            <WorkspaceGitDiff
              key={review.id}
              cwd={props.workspaceRoot}
              filePath={review.filePath}
              scope={review.scope}
              onOpenFile={(path) => openFile(props.threadId, path)}
            />
          ) : null}
          {review?.kind === "diff" ? (
            <SourceControlTurnChanges
              key={review.id}
              threadId={props.threadId}
              turnId={review.turnId}
              filePath={review.filePath}
              cwd={props.workspaceRoot}
              onOpenFile={(path) => openFile(props.threadId, path)}
              onCurrentChanges={() => useWorkspaceSidebarStore.getState().show("git")}
            />
          ) : null}
        </div>
      </div>
    </WorkspaceHeaderContext>
  );
}
