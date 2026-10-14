import { GitCommitHorizontalIcon, GitPullRequestIcon, PlusMinusSquare01Icon } from "~/lib/icons";
import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
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
import {
  selectWorkspaceFileReveal,
  selectWorkspaceFileTabs,
  useWorkspaceFileTabsStore,
} from "~/workspaceFileTabsStore";
import { useStore } from "~/store";
import { cn } from "~/lib/utils";
import type { ChatFileReference } from "~/lib/chatReferences";
import { FileEntryIcon } from "./FileEntryIcon";
import { PanelTabBar, type PanelTab } from "./PanelTabBar";
import { PanelStateMessage } from "./PanelStateMessage";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import { useWorkspaceTabSelection } from "./useWorkspaceTabSelection";
import { useWorkspaceSidebarStore } from "~/workspaceSidebarStore";

// File previews and reviews carry the editor, diff renderer and HTML parser, so they load with the first
// tab that shows one instead of with every chat.
const WorkspaceFilePreview = lazy(() =>
  import("../WorkspaceFilePreview").then((module) => ({ default: module.WorkspaceFilePreview })),
);
const WorkspaceGitDiff = lazy(() =>
  import("./WorkspaceGitDiff").then((module) => ({ default: module.WorkspaceGitDiff })),
);
const CommitDetail = lazy(() =>
  import("./CommitDetail").then((module) => ({ default: module.CommitDetail })),
);
const PullRequestDetail = lazy(() =>
  import("../pullRequest/PullRequestDetail").then((module) => ({
    default: module.PullRequestDetail,
  })),
);
const SourceControlTurnChanges = lazy(() =>
  import("./SourceControlTurnChanges").then((module) => ({
    default: module.SourceControlTurnChanges,
  })),
);
const WORKSPACE_TAB_LOADING_FALLBACK = <PanelStateMessage loadingLabel="Loading" />;

// Recently viewed files stay mounted (hidden, like the chat tab) so switching tabs keeps their
// scroll, cursor and undo state. Each one holds its rendered contents, so only a few are kept.
const MOUNTED_FILE_PREVIEW_LIMIT = 3;

export function MainWorkspace(props: {
  threadId: ThreadId;
  projectId: ProjectId | null;
  workspaceRoot: string | null;
  onReferenceInChat: (reference: ChatFileReference) => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const state = useMainWorkspaceStore(selectMainWorkspace(props.threadId));
  const setTabOrder = useMainWorkspaceStore((store) => store.setTabOrder);
  const selectTab = useMainWorkspaceStore((store) => store.selectTab);
  const pinReview = useMainWorkspaceStore((store) => store.pinReview);
  const closeReview = useMainWorkspaceStore((store) => store.closeReview);
  const fileTabs = useWorkspaceFileTabsStore(selectWorkspaceFileTabs(props.threadId));
  const revealPosition = useWorkspaceFileTabsStore(selectWorkspaceFileReveal(props.threadId));
  const closeFile = useWorkspaceFileTabsStore((store) => store.closeFile);
  const openFile = useWorkspaceFileTabsStore((store) => store.openFile);
  const pinFile = useWorkspaceFileTabsStore((store) => store.pinFile);
  const provider = useStore((store) => {
    const thread = store.threadShellById?.[props.threadId];
    return thread ? resolveThreadDisplayProvider(thread) : null;
  });
  const draftProvider = useComposerDraftStore(
    (store) => store.draftsByThreadId[props.threadId]?.activeProvider,
  );
  const chatProvider = draftProvider ?? provider ?? "codex";
  const chatLabel = PROVIDER_DISPLAY_NAMES[chatProvider];
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
  const previewDirty = fileTabs.previewFilePath ? dirtyPaths.has(fileTabs.previewFilePath) : false;
  useEffect(() => {
    if (previewDirty && fileTabs.previewFilePath) pinFile(props.threadId, fileTabs.previewFilePath);
  }, [previewDirty, fileTabs.previewFilePath, pinFile, props.threadId]);
  const tabs: PanelTab[] = [
    {
      id: "chat",
      label: chatLabel,
      icon: <ProviderIcon provider={chatProvider} tone="header" className="size-3.5" />,
    },
    ...fileTabs.filePaths.map((path) => ({
      id: `file:${path}`,
      preview: fileTabs.previewFilePath === path,
      onDoubleClick: () => pinFile(props.threadId, path),
      label: basenameOfPath(path),
      icon: <FileEntryIcon pathValue={path} kind="file" className="size-3.5" />,
      trailing: dirtyPaths.has(path) ? <span aria-label="Unsaved changes">●</span> : null,
      onClose: () => closeFile(props.threadId, path),
    })),
    ...state.reviews.map((tab) => ({
      id: tab.id,
      label:
        tab.kind === "pullRequest"
          ? `#${tab.number} ${tab.title}`
          : tab.filePath
            ? basenameOfPath(tab.filePath)
            : tab.kind === "commit"
              ? tab.subject || tab.sha.slice(0, 7)
              : "Turn changes",
      preview: state.previewReviewId === tab.id,
      onDoubleClick: () => pinReview(props.threadId, tab.id),
      icon:
        tab.kind === "pullRequest" ? (
          <GitPullRequestIcon className="size-3.5" />
        ) : tab.kind === "commit" ? (
          <GitCommitHorizontalIcon className="size-3.5" />
        ) : (
          <PlusMinusSquare01Icon className="size-3.5" />
        ),
      onClose: () => closeReview(props.threadId, tab.id),
    })),
  ];
  const order = new Map(state.tabOrder.map((id, index) => [id, index]));
  tabs.sort((left, right) => {
    if (left.id === "chat") return -1;
    if (right.id === "chat") return 1;
    return (order.get(left.id) ?? order.size) - (order.get(right.id) ?? order.size);
  });
  const openTabOrder = tabs.filter((tab) => tab.id !== "chat").map((tab) => tab.id);
  const tabOrderKey = JSON.stringify(openTabOrder);
  const storedTabOrderKey = JSON.stringify(state.tabOrder);
  useEffect(() => {
    if (tabOrderKey !== storedTabOrderKey)
      setTabOrder(props.threadId, JSON.parse(tabOrderKey) as string[]);
  }, [props.threadId, tabOrderKey, storedTabOrderKey, setTabOrder]);
  const select = (id: string) => {
    if (id.startsWith("file:")) {
      const path = id.slice(5);
      openFile(props.threadId, path, {
        preview: fileTabs.previewFilePath === path,
      });
    } else selectTab(props.threadId, id);
  };
  const resolvedId = useWorkspaceTabSelection({
    tabIds: tabs.map((tab) => tab.id),
    activeId: state.activeTabId,
    onSelect: select,
  });
  const filePath = resolvedId.startsWith("file:") ? resolvedId.slice(5) : null;
  const [recentFilePaths, setRecentFilePaths] = useState<readonly string[]>([]);
  if (filePath && recentFilePaths[0] !== filePath) {
    setRecentFilePaths(
      [filePath, ...recentFilePaths.filter((path) => path !== filePath)].slice(
        0,
        MOUNTED_FILE_PREVIEW_LIMIT,
      ),
    );
  }
  const mountedFilePaths = recentFilePaths.filter((path) => fileTabs.filePaths.includes(path));
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
      onReorder={(ids) => setTabOrder(props.threadId, ids)}
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
          {mountedFilePaths.map((path) => (
            <div
              key={path}
              className={cn(
                "absolute inset-0 flex min-h-0 flex-col",
                path !== filePath && "invisible pointer-events-none",
              )}
              inert={path !== filePath}
              aria-hidden={path !== filePath}
            >
              <Suspense fallback={WORKSPACE_TAB_LOADING_FALLBACK}>
                <WorkspaceFilePreview
                  workspaceRoot={props.workspaceRoot}
                  filePath={path}
                  editable
                  onEdit={() => pinFile(props.threadId, path)}
                  liveRevalidationEnabled={path === filePath}
                  revealPosition={revealPosition?.filePath === path ? revealPosition : undefined}
                  onReferenceInChat={props.onReferenceInChat}
                />
              </Suspense>
            </div>
          ))}
          {review ? (
            <Suspense fallback={WORKSPACE_TAB_LOADING_FALLBACK}>
              {review.kind === "commit" && props.workspaceRoot ? (
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
              {review.kind === "gitFile" && props.workspaceRoot ? (
                <WorkspaceGitDiff
                  key={review.id}
                  cwd={props.workspaceRoot}
                  filePath={review.filePath}
                  scope={review.scope}
                  onOpenFile={(path) => openFile(props.threadId, path)}
                />
              ) : null}
              {review.kind === "pullRequest" ? (
                <PullRequestDetail
                  key={review.id}
                  cwd={review.cwd}
                  number={review.number}
                  threadId={props.threadId}
                  onOpenFile={(path) => openFile(props.threadId, path)}
                />
              ) : null}
              {review.kind === "diff" ? (
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
            </Suspense>
          ) : null}
        </div>
      </div>
    </WorkspaceHeaderContext>
  );
}
