import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useRef,
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
import type { ChatFileReference } from "~/lib/chatReferences";
import { FileEntryIcon } from "./FileEntryIcon";
import { type PanelTab } from "./PanelTabBar";

import { reconcileWorkspaceTabs, type WorkspaceSplitDirection } from "~/mainWorkspaceLayout";
import {
  writeWorkspaceResourceDrag,
  type WorkspaceResourceDrag,
} from "~/lib/workspaceResourceDrag";
import { showContextMenuFallback } from "~/contextMenuFallback";
import { WorkspaceResource } from "./WorkspaceResource";
import { WorkspaceGroupTabBar } from "./WorkspaceGroupTabBar";
import {
  WorkspaceSplitSurface,
  workspaceGroupPlacement,
  useWorkspaceDragging,
} from "./WorkspaceSplitSurface";

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
  const dirtyPreviews = (dock.previewFilePaths ?? []).filter((path) => dirtyPaths.has(path));
  const dirtyPreviewsKey = JSON.stringify(dirtyPreviews);
  const pinDirtyPreviews = useEffectEvent(() => {
    for (const path of dirtyPreviews) pinFile(props.threadId, path);
  });
  useEffect(() => pinDirtyPreviews(), [dirtyPreviewsKey]);
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
  const tabs: PanelTab[] = [
    {
      id: "chat",
      label: chatLabel,
      icon: <ProviderIcon provider={chatProvider} tone="header" className="size-3.5" />,
    },
    ...dock.filePaths.map((path) => ({
      id: `file:${path}`,
      preview: dock.previewFilePaths?.includes(path) ?? false,
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
      preview: state.previewReviewIds.includes(tab.id),
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
      ? terminal.terminalState.terminalIds.map((terminalId) => ({
          id: `terminal:${terminalId}`,
          label: resolveTerminalCloseTitle({
            terminalId,
            ...terminal.terminalState,
          }),
          icon: <TerminalIcon className="size-3.5" />,
          onClose: () => {
            void terminal.closeTerminal(terminalId, closeTerminalPane).catch((error: unknown) => {
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
      ? `terminal:${terminal.terminalState.activeTerminalId}`
      : state.activeTabId === "browser"
        ? browser?.activeTabId
          ? `browser:${browser.activeTabId}`
          : "browser"
        : state.activeTabId;
  const tabIds = tabs.map((tab) => tab.id);
  const tabIdsKey = JSON.stringify(tabIds);
  const layout = reconcileWorkspaceTabs(state.layout, tabIds, activeId);
  const split = layout.groups.length > 1;
  const dragging = useWorkspaceDragging();
  const synchronize = useEffectEvent(() => {
    useMainWorkspaceStore.getState().reconcileTabs(props.threadId, tabIds, activeId);
    if (!tabIds.includes(activeId)) {
      const browserId = layout.groups.find((group) =>
        group.activeTabId?.startsWith("browser:"),
      )?.activeTabId;
      if (browserId && browserId.slice(8) !== browser?.activeTabId)
        void runBrowserCommand(
          props.threadId,
          { kind: "select", tabId: browserId.slice(8) },
          reportBrowserError,
        );
    }
  });
  useEffect(() => synchronize(), [tabIdsKey, activeId]);
  const previousBrowserSelection = useRef(browser?.activeTabId);
  const synchronizeBrowserSelection = useEffectEvent(() => {
    const changed = previousBrowserSelection.current !== browser?.activeTabId;
    previousBrowserSelection.current = browser?.activeTabId;
    if (!changed || !browser?.activeTabId || !tabIds.includes(activeId)) return;
    const browserVisible = layout.groups.some(
      (group) => group.activeTabId === "browser" || group.activeTabId?.startsWith("browser:"),
    );
    if (browserVisible) selectTab(props.threadId, `browser:${browser.activeTabId}`);
  });
  useEffect(() => synchronizeBrowserSelection(), [browser?.activeTabId]);
  const select = (id: string) => {
    if (id.startsWith("file:")) {
      const path = id.slice(5);
      openFile(props.threadId, path, { preview: dock.previewFilePaths?.includes(path) ?? false });
    }
    if (id.startsWith("terminal:")) terminal.activateTerminal(id.slice(9));
    if (id.startsWith("browser:"))
      void runBrowserCommand(
        props.threadId,
        { kind: "select", tabId: id.slice(8) },
        reportBrowserError,
      );
    selectTab(props.threadId, id);
  };
  const focus = (group: number) => {
    if (layout.activeGroup === group) return;
    useMainWorkspaceStore.getState().focusGroup(props.threadId, group);
    const id = layout.groups[group]?.activeTabId;
    if (id) select(id);
  };
  const pin = (id: string) => {
    if (id.startsWith("file:")) pinFile(props.threadId, id.slice(5));
    else if (state.reviews.some((review) => review.id === id)) pinReview(props.threadId, id);
  };
  const move = (id: string, group: number) => {
    pin(id);
    useMainWorkspaceStore.getState().moveTab(props.threadId, id, group);
    select(id);
  };
  const splitTab = (id: string, direction: WorkspaceSplitDirection) => {
    pin(id);
    useMainWorkspaceStore.getState().splitTab(props.threadId, id, direction);
    select(id);
  };
  const showTabMenu = async (tab: PanelTab, group: number, position: { x: number; y: number }) => {
    if (tabs.length === 1 && !tab.onClose) return;
    const clicked = await showContextMenuFallback(
      [
        ...(tabs.length > 1
          ? [
              { id: "right", label: split ? "Arrange side by side" : "Split right" },
              { id: "down", label: split ? "Arrange stacked" : "Split down" },
            ]
          : []),
        ...(split ? [{ id: "move", label: "Move to other group" }] : []),
        ...(tab.onClose ? [{ id: "close", label: "Close tab", separatorBefore: true }] : []),
      ],
      position,
    );
    if (clicked === "right" || clicked === "down")
      splitTab(tab.id, clicked === "right" ? "horizontal" : "vertical");
    if (clicked === "move") move(tab.id, group === 0 ? 1 : 0);
    if (clicked === "close") tab.onClose?.();
  };
  const groupTabs = (group: number) =>
    layout.groups[group]!.tabIds.flatMap((id) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      return tab
        ? [
            {
              ...tab,
              onDragStart: (data: DataTransfer) => {
                data.effectAllowed = "move";
                writeWorkspaceResourceDrag(data, {
                  kind: "tab",
                  threadId: props.threadId,
                  tabId: id,
                });
              },
              onContextMenu: (position: { x: number; y: number }) => {
                void showTabMenu(tab, group, position);
              },
            },
          ]
        : [];
    });
  const closeActive = useEffectEvent(() => {
    const id = layout.groups[layout.activeGroup]?.activeTabId;
    if (id === "chat") {
      if (tabs.length === 1) void navigate({ to: "/" });
    } else tabs.find((tab) => tab.id === id)?.onClose?.();
  });
  useEffect(() => {
    window.addEventListener("glade:close-workspace-tab", closeActive);
    const unsubscribe = window.desktopBridge?.onMenuAction?.((action) => {
      if (action === "close-workspace-tab") closeActive();
    });
    return () => {
      window.removeEventListener("glade:close-workspace-tab", closeActive);
      unsubscribe?.();
    };
  }, []);
  const header = (group: number) => (
    <div className="flex min-w-0 flex-1 items-center" onPointerDownCapture={() => focus(group)}>
      <WorkspaceGroupTabBar
        tabs={groupTabs(group)}
        activeId={layout.groups[group]!.activeTabId}
        focused={layout.activeGroup === group}
        split={split}
        onSelect={select}
        onAddTerminal={() => {
          focus(group);
          if (terminalPane) terminal.createTerminal();
          props.onAddPane("terminal");
        }}
        onAddBrowser={() => {
          focus(group);
          props.onAddPane("browser");
          if (browser?.tabs.length)
            void runBrowserCommand(props.threadId, { kind: "new" }, reportBrowserError);
        }}
      />
    </div>
  );
  const tabBar =
    split && layout.direction === "horizontal" ? (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div style={{ flex: layout.ratio }} className="flex min-w-0">
          {header(0)}
        </div>
        <div
          style={{ flex: 1 - layout.ratio }}
          className="flex min-w-0 border-l border-border/65 pl-2"
        >
          {header(1)}
        </div>
      </div>
    ) : (
      header(0)
    );
  const workspace = {
    threadId: props.threadId,
    projectId: props.projectId,
    root: props.workspaceRoot,
    revealPosition: props.revealPosition,
    terminalFocusRequestId: terminal.focusRequestId,
  };
  const owner = (id: string) =>
    Math.max(
      0,
      layout.groups.findIndex((group) => group.tabIds.includes(id)),
    );
  const shown = (id: string) => layout.groups[owner(id)]?.activeTabId === id;
  const browserGroup = layout.groups.findIndex((group) =>
    group.tabIds.some((id) => id === "browser" || id.startsWith("browser:")),
  );
  const resources = tabs.filter(
    (tab) =>
      tab.id !== "chat" &&
      !tab.id.startsWith("browser") &&
      (tab.id.startsWith("terminal:") || shown(tab.id)),
  );
  const chatGroup = owner("chat");
  const secondaryHeader = split && layout.direction === "vertical";
  const panelStyle = (group: number) => ({
    ...workspaceGroupPlacement(layout, group),
    ...(secondaryHeader && group === 1 ? { paddingTop: 37 } : {}),
  });
  return (
    <WorkspaceHeaderContext value={{ host: headerHost, tabs: tabBar }}>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div ref={setHeaderHost} className="shrink-0" />
        <WorkspaceSplitSurface
          layout={layout}
          dragging={dragging}
          onFocus={focus}
          onResize={(ratio) => useMainWorkspaceStore.getState().resizeSplit(props.threadId, ratio)}
          onDropResource={(resource: WorkspaceResourceDrag, target) => {
            if (
              resource.kind === "tab" &&
              (resource.threadId !== props.threadId || !tabIds.includes(resource.tabId))
            )
              return;
            if (resource.kind === "file" && resource.workspaceRoot !== props.workspaceRoot) return;
            const id = resource.kind === "tab" ? resource.tabId : `file:${resource.path}`;
            if (resource.kind === "file") {
              focus(target.group);
              openFile(props.threadId, resource.path, { preview: !target.split });
            }
            if (target.split) splitTab(id, target.split);
            else if (resource.kind === "tab" || tabIds.includes(id)) move(id, target.group);
          }}
        >
          {secondaryHeader ? (
            <div
              className="z-10 flex h-[37px] min-w-0 items-center border-b border-border/65 px-2"
              style={workspaceGroupPlacement(layout, 1)}
            >
              {header(1)}
            </div>
          ) : null}
          <div
            key="chat-surface"
            data-workspace-group={chatGroup}
            style={panelStyle(chatGroup)}
            className={cn(
              "relative flex min-h-0 min-w-0 flex-col",
              !shown("chat") && "invisible pointer-events-none",
            )}
            inert={!shown("chat")}
            aria-hidden={!shown("chat")}
          >
            {props.children}
          </div>
          {resources.map((tab) => (
            <div
              key={tab.id}
              data-workspace-group={owner(tab.id)}
              style={panelStyle(owner(tab.id))}
              className={cn(
                "relative flex min-h-0 min-w-0 flex-col overflow-hidden",
                !shown(tab.id) && "invisible pointer-events-none",
              )}
              inert={!shown(tab.id)}
              aria-hidden={!shown(tab.id)}
            >
              <WorkspaceResource
                id={tab.id}
                review={state.reviews.find((review) => review.id === tab.id)}
                workspace={workspace}
                visible={shown(tab.id)}
                focused={layout.activeGroup === owner(tab.id) && shown(tab.id)}
                onOpenFile={(path, edit) => {
                  focus(owner(tab.id));
                  if (edit) pinFile(props.threadId, path);
                  else openFile(props.threadId, path);
                }}
                onReferenceInChat={props.onReferenceInChat}
                actions={{
                  close: tab.id.startsWith("terminal:") ? closeTerminalPane : () => tab.onClose?.(),
                  currentChanges: () => props.onAddPane("git"),
                }}
              />
            </div>
          ))}
          {browserPane ? (
            <div
              key="browser-surface"
              data-workspace-group={Math.max(0, browserGroup)}
              style={panelStyle(Math.max(0, browserGroup))}
              className={cn(
                "relative min-h-0 min-w-0 overflow-hidden",
                !layout.groups[browserGroup]?.activeTabId?.startsWith("browser") &&
                  "invisible pointer-events-none",
              )}
              inert={!layout.groups[browserGroup]?.activeTabId?.startsWith("browser")}
              data-native-browser-surface={
                layout.groups[browserGroup]?.activeTabId?.startsWith("browser") ? "true" : undefined
              }
            >
              <WorkspaceResource
                id="browser"
                workspace={workspace}
                visible={
                  !dragging &&
                  Boolean(layout.groups[browserGroup]?.activeTabId?.startsWith("browser"))
                }
                focused={layout.activeGroup === browserGroup}
                onOpenFile={(_path) => {}}
                onReferenceInChat={props.onReferenceInChat}
                actions={{ close: closeBrowserPane, currentChanges: () => props.onAddPane("git") }}
              />
            </div>
          ) : null}
        </WorkspaceSplitSurface>
      </div>
    </WorkspaceHeaderContext>
  );
}
