import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { selectThreadBrowserState, useBrowserStateStore } from "~/browserStateStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { basenameOfPath } from "~/file-icons";
import { WorkspaceHeaderContext } from "./WorkspaceHeaderContext";
import { ProviderIcon } from "../ProviderIcon";
import { useTerminalSurfaceController } from "~/hooks/useTerminalSurfaceController";
import { resolveThreadDisplayProvider } from "~/lib/threadDisplayProvider";
import { resolveTerminalCloseTitle } from "~/lib/terminalCloseConfirmation";
import {
  dirtyWorkspaceEditorPaths,
  dirtyWorkspaceEditorRevision,
  subscribeDirtyWorkspaceEditors,
} from "~/lib/workspaceEditorSession";
import { selectMainWorkspace, useMainWorkspaceStore } from "~/mainWorkspaceStore";
import { selectRightDockState, useRightDockStore } from "~/rightDockStore";
import { useStore } from "~/store";
import { GlobeIcon, GitCommitIcon, ChangesIcon, TerminalIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { runBrowserCommand } from "../browser/controller/browserActions";
import { toastManager } from "../ui/toast";
import { WorkspaceFilePreview } from "../WorkspaceFilePreview";
import type { ChatFileReference } from "~/lib/chatReferences";
import { LazyBrowserPanel } from "./ChatThreadSurfacePrimitives";
import { WorkspaceGitDiff } from "./WorkspaceGitDiff";
import { CommitDetail } from "./CommitDetail";
import { SourceControlTurnChanges } from "./SourceControlTurnChanges";
import { FileEntryIcon } from "./FileEntryIcon";
import { type PanelTab } from "./PanelTabBar";
import { PanelStateMessage } from "./PanelStateMessage";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import { terminalTabGroups } from "~/terminalLayout";
import { Spinner } from "../ui/spinner";
import { useWorkspaceTabSelection } from "./useWorkspaceTabSelection";

const DockTerminalPane = lazy(() => import("./DockTerminalPane"));

export function MainWorkspace(props: {
  threadId: ThreadId;
  projectId: ProjectId | null;
  workspaceRoot: string | null;
  revealPosition?:
    | { filePath: string; lineNumber: number; column?: number; requestId: number }
    | undefined;
  onReferenceInChat: (reference: ChatFileReference) => void;
  onAddPane: (kind: "terminal" | "browser" | "explorer" | "git") => void;
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
  const closePane = useRightDockStore((store) => store.closePane);
  const terminal = useTerminalSurfaceController(props.threadId);
  const browser = useBrowserStateStore(selectThreadBrowserState(props.threadId));
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
  const terminalPane = dock.panes.find((pane) => pane.kind === "terminal");
  const browserPane = dock.panes.find((pane) => pane.kind === "browser");
  const reportBrowserError = (description: string | null) => {
    if (description)
      toastManager.add({ type: "error", title: "Browser action failed", description });
  };
  const closeTerminalPane = () => {
    if (terminalPane) closePane(props.threadId, terminalPane.id);
  };
  const closeBrowserPane = () => {
    if (browserPane) closePane(props.threadId, browserPane.id);
  };
  const terminalGroups = terminalTabGroups(terminal.terminalState);
  const activeTerminalGroup = terminalGroups.find((group) =>
    group.terminalIds.includes(terminal.terminalState.activeTerminalId),
  );
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
          <GitCommitIcon className="size-3.5" />
        ) : (
          <ChangesIcon className="size-3.5" />
        ),
      onClose: () => closeReview(props.threadId, tab.id),
    })),
    ...(terminalPane
      ? terminalGroups.map((group) => ({
          id: `terminal:${group.id}`,
          label: resolveTerminalCloseTitle({
            terminalId: group.terminalIds[0]!,
            ...terminal.terminalState,
          }),
          icon: <TerminalIcon className="size-3.5" />,
          trailing: group.terminalIds.some((id) =>
            terminal.terminalState.runningTerminalIds.includes(id),
          ) ? (
            <Spinner className="size-3" aria-label="Terminal running" />
          ) : null,
          onClose: () => {
            void terminal
              .closeTerminalGroup(group.terminalIds, closeTerminalPane)
              .catch((error: unknown) => {
                toastManager.add({
                  type: "error",
                  title: "Could not close terminal",
                  description: String(error),
                });
              });
          },
        }))
      : []),
    ...(browserPane
      ? browser?.tabs.length
        ? browser.tabs.map((tab) => ({
            id: `browser:${tab.id}`,
            label: tab.title || tab.url || "Browser",
            icon: <GlobeIcon className="size-3.5" />,
            onClose: () => {
              void runBrowserCommand(
                props.threadId,
                { kind: "close", tabId: tab.id },
                reportBrowserError,
              ).then((next) => {
                if (next && next.tabs.length === 0) closeBrowserPane();
              });
            },
          }))
        : [
            {
              id: "browser",
              label: "Browser",
              icon: <GlobeIcon className="size-3.5" />,
              onClose: closeBrowserPane,
            },
          ]
      : []),
  ];
  const activeId =
    state.activeTabId === "terminal"
      ? `terminal:${activeTerminalGroup?.id ?? terminal.terminalState.activeTerminalId}`
      : state.activeTabId === "browser"
        ? browser?.activeTabId
          ? `browser:${browser.activeTabId}`
          : "browser"
        : state.activeTabId;
  const select = (id: string) => {
    if (id.startsWith("file:")) {
      const path = id.slice(5);
      openFile(props.threadId, path, { preview: dock.previewFilePath === path });
    } else if (id.startsWith("terminal:")) {
      const group = terminalGroups.find((tab) => tab.id === id.slice(9));
      if (group)
        terminal.activateTerminal(
          group.terminalIds.includes(terminal.terminalState.activeTerminalId)
            ? terminal.terminalState.activeTerminalId
            : group.terminalIds[0]!,
        );
      selectTab(props.threadId, "terminal");
    } else if (id.startsWith("browser:")) {
      selectTab(props.threadId, "browser");
      void runBrowserCommand(
        props.threadId,
        { kind: "select", tabId: id.slice(8) },
        reportBrowserError,
      );
    } else selectTab(props.threadId, id);
  };
  const resolvedId = useWorkspaceTabSelection({
    tabIds: tabs.map((tab) => tab.id),
    activeId,
    onSelect: select,
  });
  const terminalVisible = resolvedId.startsWith("terminal:");
  const browserVisible = resolvedId === "browser" || resolvedId.startsWith("browser:");
  const filePath = resolvedId.startsWith("file:") ? resolvedId.slice(5) : null;
  const review = state.reviews.find((tab) => tab.id === resolvedId);
  useWorkspaceShortcuts({
    terminalActive: terminalVisible,
    onSplitTerminal: terminal.splitTerminal,
    onClose: () => {
      if (resolvedId === "chat") {
        if (tabs.length === 1) void navigate({ to: "/" });
      } else if (terminalVisible) {
        void terminal
          .closeTerminal(terminal.terminalState.activeTerminalId, closeTerminalPane)
          .catch((error: unknown) => {
            toastManager.add({
              type: "error",
              title: "Could not close terminal",
              description: String(error),
            });
          });
      } else tabs.find((tab) => tab.id === resolvedId)?.onClose?.();
    },
  });
  const tabBar = (
    <WorkspaceTabBar
      tabs={tabs}
      activeId={resolvedId}
      onSelect={select}
      onSplitTerminal={terminalVisible ? terminal.splitTerminal : undefined}
      onAddTerminal={() => {
        if (terminalPane) terminal.createTerminal();
        props.onAddPane("terminal");
      }}
      onAddBrowser={() => {
        props.onAddPane("browser");
        if (browser?.tabs.length)
          void runBrowserCommand(props.threadId, { kind: "new" }, reportBrowserError);
      }}
    />
  );
  return (
    <WorkspaceHeaderContext value={{ host: headerHost, tabs: tabBar }}>
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
              onCurrentChanges={() => props.onAddPane("git")}
            />
          ) : null}
          {terminalPane ? (
            <div
              className={cn(
                "absolute inset-0",
                !terminalVisible && "invisible pointer-events-none",
              )}
              inert={!terminalVisible}
              aria-hidden={!terminalVisible}
            >
              <Suspense fallback={<PanelStateMessage loadingLabel="Loading terminal" />}>
                <DockTerminalPane
                  hostThreadId={props.threadId}
                  projectId={props.projectId}
                  workspaceRoot={props.workspaceRoot}
                  isActive={terminalVisible}
                  focusRequestId={terminal.focusRequestId}
                  onClosePanel={closeTerminalPane}
                />
              </Suspense>
            </div>
          ) : null}
          {browserPane ? (
            <div
              className={cn("absolute inset-0", !browserVisible && "invisible pointer-events-none")}
              inert={!browserVisible}
              aria-hidden={!browserVisible}
              data-native-browser-surface={browserVisible ? "true" : undefined}
            >
              <Suspense fallback={<PanelStateMessage loadingLabel="Loading browser" />}>
                <LazyBrowserPanel
                  mode="sidebar"
                  threadId={props.threadId}
                  hideTabs
                  runtimeMode="live"
                  isVisible={browserVisible}
                  onClosePanel={closeBrowserPane}
                />
              </Suspense>
            </div>
          ) : null}
        </div>
      </div>
    </WorkspaceHeaderContext>
  );
}
