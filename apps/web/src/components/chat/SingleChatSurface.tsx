import { isTerminalFocused } from "~/lib/terminalFocus";
import { hasOpenKeyboardOverlay } from "~/lib/keyboardOverlay";
import type { ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  lazy,
  type ReactNode,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import type { DiffRouteSearch } from "../../diffRouteSearch";
import { stripDiffSearchParams } from "../../diffRouteSearch";
import { useBrowserPanelDesktopBridge } from "../../hooks/useBrowserPanelDesktopBridge";
import { useDockPaneRuntimeActivation } from "../../hooks/useDockPaneRuntimeActivation";
import { appendChatFileReference, type ChatFileReference } from "../../lib/chatReferences";
import { SINGLE_CHAT_PANE_SCOPE_ID } from "../../lib/chatPaneScope";
import type { DockPaneRuntimeMode } from "../../lib/dockPaneActivation";
import { canComposerHandlePanelWidth } from "../../lib/panelResize";
import {
  prefetchWorkspaceFile,
  resolveDockFileOpenTarget,
  resolveWorkspaceDirectoryOpenTarget,
  resolveWorkspaceFileOpenTarget,
  WorkspaceFileOpenerContext,
  type WorkspaceFileOpener,
} from "../../lib/workspaceFileOpener";
import { requestExplorerFileReveal, requestExplorerReveal } from "../../explorerRevealRequestStore";
import { selectRightDockState, useRightDockStore } from "../../rightDockStore";
import { useTerminalStateStore } from "../../terminalStateStore";
import {
  resolveActivePane,
  type OpenPaneInput,
  type RightDockPane,
  type RightDockPaneKind,
} from "../../rightDockStore.logic";
import { useSplitViewStore } from "../../splitViewStore";
import {
  type SplitDirection,
  type SplitDropSide,
  type SplitViewPanePanelState,
} from "../../splitViewModel";
import { useStore } from "../../store";
import { createProjectSelector, createThreadWorkspaceMetadataSelector } from "../../storeSelectors";
import { ChatPaneDropOverlay } from "../chat-drop-overlay/ChatPaneDropOverlay";
import { DeferredChatView } from "./ChatThreadSurfacePrimitives";
import { MainWorkspace } from "./MainWorkspace";
import {
  selectMainWorkspace,
  useMainWorkspaceStore,
  type WorkspaceReviewTab,
} from "../../mainWorkspaceStore";
import { PanelStateMessage } from "./PanelStateMessage";
import { RightDock } from "./RightDock";
import { getRightDockPaneMeta } from "./rightDockPaneMeta";
import {
  CHAT_BACKGROUND_CLASS_NAME,
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "./composerPickerStyles";
import { routeSingleDockPaneOpenRequest } from "./dockPaneOpenRequest";
import { RouteInsetSurface } from "../RouteInsetSurface";
import { WorkspaceSearchPalette, type WorkspaceSearchPaletteMode } from "../WorkspaceSearchPalette";
import {
  resolveFilePreviewWorkspaceRoot,
  resolveRoutePanelBootstrap,
} from "../../routes/-chatThreadRoute.logic";
import { cn } from "~/lib/utils";

const PRIMARY_DOCK_PANE_KINDS = ["explorer", "git"] as const;
const SourceControlDockPane = lazy(() =>
  import("./SourceControlDockPane").then((module) => ({
    default: module.SourceControlDockPane,
  })),
);
const DockExplorerPane = lazy(() =>
  import("./DockExplorerPane").then((module) => ({
    default: module.DockExplorerPane,
  })),
);
const RIGHT_SIDEBAR_DEFAULT_WIDTH = "22rem";

const allowAnySplitDirection = (_direction: SplitDirection) => true;

function shouldAcceptDockWidth({
  currentWidth,
  nextWidth,
  wrapper,
}: {
  currentWidth: number;
  nextWidth: number;
  wrapper: HTMLElement;
}) {
  if (nextWidth <= currentWidth) return true;
  const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
  return canComposerHandlePanelWidth({
    nextWidth,

    paneScopeId: SINGLE_CHAT_PANE_SCOPE_ID,
    applyWidth: (width) => {
      wrapper.style.setProperty("--sidebar-width", `${width}px`);
    },
    resetWidth: () => {
      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }
    },
  });
}

function RightDockPanePlaceholder(props: { kind: RightDockPaneKind }) {
  const { label } = getRightDockPaneMeta(props.kind);
  return <PanelStateMessage>{label} panel is coming soon.</PanelStateMessage>;
}

export function SingleChatSurface(props: {
  threadId: ThreadId;
  search: DiffRouteSearch;
  projectId: ProjectId | null;
}) {
  const navigate = useNavigate();
  const createSplitView = useSplitViewStore((store) => store.createFromThread);
  const createSplitViewFromDrop = useSplitViewStore((store) => store.createFromDrop);
  const dockState = useRightDockStore(
    useMemo(() => selectRightDockState(props.threadId), [props.threadId]),
  );
  const openDockPane = useRightDockStore((store) => store.openPane);
  const selectMainTab = useMainWorkspaceStore((store) => store.selectTab);
  const openReview = useMainWorkspaceStore((store) => store.openReview);
  const mainWorkspace = useMainWorkspaceStore(selectMainWorkspace(props.threadId));
  const openPane = useCallback(
    (threadId: ThreadId, input: Omit<OpenPaneInput, "paneId">) => {
      if (input.kind === "terminal" || input.kind === "browser") {
        openDockPane(threadId, { ...input, activate: false });
        selectMainTab(threadId, input.kind);
      } else if (input.kind === "git" && input.diffTurnId) {
        openReview(threadId, {
          id: `diff:${input.diffTurnId}`,
          kind: "diff",
          turnId: input.diffTurnId,
          filePath: input.diffFilePath ?? null,
        });
      } else openDockPane(threadId, input);
    },
    [openDockPane, selectMainTab, openReview],
  );
  const closePane = useRightDockStore((store) => store.closePane);
  const setActivePane = useRightDockStore((store) => store.setActivePane);
  const setDockOpen = useRightDockStore((store) => store.setDockOpen);
  const updatePane = useRightDockStore((store) => store.updatePane);
  const terminalPresentation = useTerminalStateStore((store) => {
    const state = store.terminalStateByThreadId[props.threadId];
    return state?.terminalOpen && state.presentationMode === "workspace";
  });
  const terminalOpen = useTerminalStateStore(
    (store) => store.terminalStateByThreadId[props.threadId]?.terminalOpen ?? false,
  );
  const setTerminalOpen = useTerminalStateStore((store) => store.setTerminalOpen);
  const setTerminalPresentationMode = useTerminalStateStore(
    (store) => store.setTerminalPresentationMode,
  );
  const activeProject = useStore(
    useMemo(() => createProjectSelector(props.projectId), [props.projectId]),
  );
  const threadWorkspaceMetadata = useStore(
    useMemo(() => createThreadWorkspaceMetadataSelector(props.threadId), [props.threadId]),
  );
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[props.threadId] ?? null,
  );
  // Defer that mount behind the chat mount loader so the paint is never blocked.
  const isBrandNewDraftThread = draftThread !== null;

  const workspaceRoot = resolveFilePreviewWorkspaceRoot({
    projectCwd: activeProject?.cwd ?? null,
    threadEnvMode: threadWorkspaceMetadata.envMode ?? draftThread?.envMode ?? null,
    threadWorktreePath: threadWorkspaceMetadata.worktreePath ?? draftThread?.worktreePath ?? null,
    threadWorkingDirectory:
      threadWorkspaceMetadata.workingDirectory ?? draftThread?.workingDirectory ?? null,
  });
  const queryClient = useQueryClient();
  const lastAppliedRoutePanelSearchKeyRef = useRef<string | null>(null);
  const [searchPaletteOpen, setSearchPaletteOpen] = useState(false);
  const [searchPaletteMode, setSearchPaletteMode] = useState<WorkspaceSearchPaletteMode>("files");
  const [revealPosition, setRevealPosition] = useState<{
    filePath: string;
    lineNumber: number;
    column?: number;
    requestId: number;
  }>();
  const sidebarPanes = dockState.panes.filter(
    (pane) => pane.kind === "explorer" || pane.kind === "git",
  );
  const sidebarState = {
    ...dockState,
    panes: sidebarPanes,
    activePaneId: sidebarPanes.some((pane) => pane.id === dockState.activePaneId)
      ? dockState.activePaneId
      : (sidebarPanes[0]?.id ?? null),
  };
  const activePane = resolveActivePane(sidebarState);
  const { activePaneRuntimeMode, requestImmediateHydration: requestImmediateDockHydration } =
    useDockPaneRuntimeActivation({
      threadId: props.threadId,
      activePane,
    });

  const chatPanelState: SplitViewPanePanelState = {
    panel:
      mainWorkspace.activeTabId === "browser"
        ? "browser"
        : activePane?.kind === "git" && activePane.sourceControlView === "changes"
          ? "diff"
          : null,
    diffTurnId: activePane?.kind === "git" ? activePane.diffTurnId : null,
    diffFilePath: activePane?.kind === "git" ? activePane.diffFilePath : null,
    hasOpenedPanel: dockState.panes.length > 0,
    lastOpenPanel: "browser",
  };

  const handleToggleDiff = () => {
    requestImmediateDockHydration("git");
    if (activePane?.kind === "git" && activePane.sourceControlView === "changes") {
      setDockOpen(props.threadId, false);
    } else {
      openPane(props.threadId, { kind: "git", sourceControlView: "changes" });
    }
  };
  const handleToggleBrowser = () => {
    requestImmediateDockHydration("browser");
    if (mainWorkspace.activeTabId === "browser") selectMainTab(props.threadId, "chat");
    else openPane(props.threadId, { kind: "browser" });
  };
  const handleToggleRightDock = () => {
    if (!dockState.open && sidebarState.activePaneId === null) {
      requestImmediateDockHydration("explorer");
      openPane(props.threadId, { kind: "explorer" });
      return;
    }
    setDockOpen(props.threadId, !dockState.open);
  };
  const handleOpenBrowserUrl = () => {
    requestImmediateDockHydration("browser");
    openPane(props.threadId, { kind: "browser" });
  };
  const handleOpenTurnDiff = (turnId: TurnId, filePath?: string) => {
    requestImmediateDockHydration("git");
    openPane(props.threadId, {
      kind: "git",
      sourceControlView: "changes",
      diffTurnId: turnId,
      diffFilePath: filePath ?? null,
    });
  };

  const handleOpenWorkspaceSearchFile = useCallback(
    (relativePath: string) => {
      requestImmediateDockHydration("explorer");
      openPane(props.threadId, { kind: "explorer" });
      requestExplorerFileReveal(props.threadId, relativePath, undefined, { preview: true });
    },
    [requestImmediateDockHydration, openPane, props.threadId],
  );

  const handleOpenWorkspaceSearchDirectory = useCallback(
    (relativePath: string) => {
      requestImmediateDockHydration("explorer");
      openPane(props.threadId, { kind: "explorer" });
      requestExplorerReveal(props.threadId, relativePath);
    },
    [requestImmediateDockHydration, openPane, props.threadId],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        hasOpenKeyboardOverlay() ||
        isTerminalFocused() ||
        event.repeat ||
        event.altKey
      )
        return;
      const isPrimaryModifier = event.ctrlKey || event.metaKey;
      if (!isPrimaryModifier) return;
      const key = event.key.toLowerCase();
      if (key !== "p" && key !== "f") return;
      if (key === "f" && !event.shiftKey) return;
      if (key === "p" && event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      setSearchPaletteMode(key === "p" ? "files" : "snippets");
      setSearchPaletteOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  const handleReferenceInChat = (reference: ChatFileReference) => {
    appendChatFileReference(props.threadId, reference);
    selectMainTab(props.threadId, "chat");
  };
  const prefetchOpenerFile = useCallback(
    (path: string) => {
      if (!workspaceRoot || resolveWorkspaceDirectoryOpenTarget(path, workspaceRoot) !== null) {
        return;
      }
      const relativePath = resolveWorkspaceFileOpenTarget(path, workspaceRoot);
      if (relativePath) {
        prefetchWorkspaceFile(queryClient, workspaceRoot, relativePath);
      }
    },
    [workspaceRoot, queryClient],
  );

  const dockFileOpener = useMemo<WorkspaceFileOpener>(
    () => ({
      openFile: (path) => {
        const directoryPath = resolveWorkspaceDirectoryOpenTarget(path, workspaceRoot);
        if (directoryPath !== null) {
          requestImmediateDockHydration("explorer");
          openPane(props.threadId, { kind: "explorer" });
          requestExplorerReveal(props.threadId, directoryPath);
          return true;
        }

        const targetPath = resolveDockFileOpenTarget(path, workspaceRoot);
        if (!targetPath) {
          return false;
        }
        requestImmediateDockHydration("explorer");
        openPane(props.threadId, { kind: "explorer" });
        const position = /:(\d+)(?::(\d+))?$/.exec(path);
        requestExplorerFileReveal(
          props.threadId,
          targetPath,
          position
            ? { lineNumber: Number(position[1]), column: Number(position[2] ?? 1) }
            : undefined,
        );
        return true;
      },
      prefetchFile: prefetchOpenerFile,
    }),
    [workspaceRoot, requestImmediateDockHydration, openPane, props.threadId, prefetchOpenerFile],
  );
  const handleSplitSurface = () => {
    if (!props.projectId) return;
    const splitViewId = createSplitView({
      sourceThreadId: props.threadId,
      ownerProjectId: props.projectId,
    });
    startTransition(() => {
      void navigate({
        to: "/$threadId",
        params: { threadId: props.threadId },
        replace: true,
        search: () => ({ splitViewId }),
      });
    });
  };

  const handleDropThread = (payload: {
    threadId: ThreadId;
    direction: SplitDirection;
    side: SplitDropSide;
  }) => {
    if (!props.projectId) return;
    if (payload.threadId === props.threadId) return;
    const splitViewId = createSplitViewFromDrop({
      sourceThreadId: props.threadId,
      ownerProjectId: props.projectId,
      droppedThreadId: payload.threadId,
      direction: payload.direction,
      side: payload.side,
    });
    startTransition(() => {
      void navigate({
        to: "/$threadId",
        params: { threadId: payload.threadId },
        replace: true,
        search: () => ({ splitViewId }),
      });
    });
  };

  useEffect(() => {
    const { nextAppliedSearchKey, panelPatch } = resolveRoutePanelBootstrap({
      scopeId: props.threadId,
      search: props.search,
      lastAppliedSearchKey: lastAppliedRoutePanelSearchKeyRef.current,
    });

    lastAppliedRoutePanelSearchKeyRef.current = nextAppliedSearchKey;
    if (!panelPatch) {
      return;
    }

    if (panelPatch.panel === "browser") {
      requestImmediateDockHydration("browser");
      openPane(props.threadId, { kind: "browser" });
    } else if (panelPatch.panel === "diff") {
      requestImmediateDockHydration("git");
      openPane(props.threadId, {
        kind: "git",
        sourceControlView: "changes",
        diffTurnId: panelPatch.diffTurnId ?? null,
        diffFilePath: panelPatch.diffFilePath ?? null,
      });
    } else {
      setDockOpen(props.threadId, false);
    }
    void navigate({
      to: "/$threadId",
      params: { threadId: props.threadId },
      replace: true,
      search: (previous) => stripDiffSearchParams(previous),
    });
  }, [
    navigate,
    openPane,
    props.search,
    props.threadId,
    requestImmediateDockHydration,
    setDockOpen,
  ]);

  useBrowserPanelDesktopBridge({
    onToggle: () => {
      requestImmediateDockHydration("browser");
      if (mainWorkspace.activeTabId === "browser") selectMainTab(props.threadId, "chat");
      else openPane(props.threadId, { kind: "browser" });
    },
    onOpen: (requestedThreadId) => {
      routeSingleDockPaneOpenRequest({
        currentThreadId: props.threadId,
        requestedThreadId,
        requestImmediateHydration: () => requestImmediateDockHydration("browser"),
        openPane: (threadId) => openPane(threadId, { kind: "browser" }),
      });
    },
  });

  const excludedThreadIds = new Set<ThreadId>([props.threadId]);

  const openGitPreview = (tab: WorkspaceReviewTab, preview: boolean) => {
    const replacesPreview =
      !mainWorkspace.reviews.some((review) => review.id === tab.id) ||
      mainWorkspace.previewReviewId === tab.id;
    if (preview && replacesPreview && dockState.previewFilePath) {
      useRightDockStore.getState().closeFile(props.threadId, dockState.previewFilePath);
    }
    openReview(props.threadId, tab, preview);
  };

  const handleAddDockPane = (kind: RightDockPaneKind) => {
    requestImmediateDockHydration(kind);
    if (kind === "terminal") {
      setTerminalPresentationMode(props.threadId, "drawer");
    }
    openPane(props.threadId, { kind });
  };

  const handleToggleTerminalPane = () => {
    if (mainWorkspace.activeTabId === "terminal") {
      selectMainTab(props.threadId, "chat");
    } else {
      handleAddDockPane("terminal");
    }
  };

  useEffect(() => {
    if (dockState.open && sidebarState.activePaneId === null) {
      requestImmediateDockHydration("explorer");
      openPane(props.threadId, { kind: "explorer" });
    }
  }, [
    sidebarState.activePaneId,
    dockState.open,
    openPane,
    props.threadId,
    requestImmediateDockHydration,
  ]);

  useEffect(() => {
    if (!terminalPresentation) return;
    setTerminalPresentationMode(props.threadId, "drawer");
    openPane(props.threadId, { kind: "terminal" });
  }, [openPane, props.threadId, setTerminalPresentationMode, terminalPresentation]);

  useEffect(() => {
    if (terminalPresentation) return;
    const terminalVisible = mainWorkspace.activeTabId === "terminal";
    if (terminalOpen !== terminalVisible) {
      setTerminalOpen(props.threadId, terminalVisible);
    }
  }, [
    mainWorkspace.activeTabId,
    props.threadId,
    setTerminalOpen,
    terminalOpen,
    terminalPresentation,
  ]);

  const renderDockPane = (
    pane: RightDockPane,
    context: { runtimeMode: DockPaneRuntimeMode; isActive: boolean; isVisible: boolean },
  ): ReactNode => {
    switch (pane.kind) {
      case "git":
        return (
          <Suspense fallback={<PanelStateMessage loadingLabel="Loading source control" />}>
            <SourceControlDockPane
              threadId={props.threadId}
              workspaceRoot={workspaceRoot}
              onSelectCommitFile={(commit, filePath, preview) =>
                openGitPreview(
                  {
                    id: `commit:${commit.sha}:${filePath}`,
                    kind: "commit",
                    sha: commit.sha,
                    subject: commit.subject,
                    filePath,
                  },
                  preview,
                )
              }
              onSelectDiff={(scope, filePath, preview) =>
                openGitPreview(
                  {
                    id: `git:${scope}:${filePath}`,
                    kind: "gitFile",
                    filePath,
                    scope,
                  },
                  preview,
                )
              }
              onOpenFile={(filePath) => {
                requestImmediateDockHydration("explorer");
                openPane(props.threadId, { kind: "explorer" });
                requestExplorerFileReveal(props.threadId, filePath);
              }}
              view={pane.sourceControlView}
              diffTurnId={null}
              diffFilePath={null}
              onViewChange={(sourceControlView) =>
                updatePane(props.threadId, pane.id, { sourceControlView })
              }
              onCurrentChanges={() =>
                updatePane(props.threadId, pane.id, { diffTurnId: null, diffFilePath: null })
              }
            />
          </Suspense>
        );
      case "explorer":
        return (
          <Suspense fallback={<PanelStateMessage loadingLabel="Loading explorer" />}>
            <DockExplorerPane
              navigationOnly
              onRevealPosition={setRevealPosition}
              threadId={props.threadId}
              workspaceRoot={workspaceRoot}
              isVisible={context.isVisible}
              onReferenceInChat={handleReferenceInChat}
            />
          </Suspense>
        );
      default:
        return <RightDockPanePlaceholder kind={pane.kind} />;
    }
  };

  const handleSelectDockPane = (paneId: string) => {
    requestImmediateDockHydration(dockState.panes.find((pane) => pane.id === paneId)?.kind);
    setActivePane(props.threadId, paneId);
  };

  return (
    <WorkspaceFileOpenerContext.Provider value={dockFileOpener}>
      <div
        className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
      >
        <ChatPaneDropOverlay
          canDropInDirection={allowAnySplitDirection}
          excludedThreadIds={excludedThreadIds}
          onDrop={handleDropThread}
          className="flex h-full min-h-0 min-w-0 flex-1"
        >
          <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
            <MainWorkspace
              key={props.threadId}
              threadId={props.threadId}
              projectId={props.projectId}
              workspaceRoot={workspaceRoot}
              revealPosition={revealPosition}
              onReferenceInChat={handleReferenceInChat}
              onAddPane={handleAddDockPane}
            >
              <DeferredChatView
                threadId={props.threadId}
                paneScopeId={SINGLE_CHAT_PANE_SCOPE_ID}
                deferMount={isBrandNewDraftThread}
                surfaceMode="single"
                isFocusedPane
                panelState={chatPanelState}
                onToggleDiff={handleToggleDiff}
                onToggleRightDock={handleToggleRightDock}
                onToggleTerminal={handleToggleTerminalPane}
                onOpenTerminal={() => handleAddDockPane("terminal")}
                onToggleBrowser={handleToggleBrowser}
                onOpenBrowserUrl={handleOpenBrowserUrl}
                onOpenTurnDiff={handleOpenTurnDiff}
                onSplitSurface={handleSplitSurface}
              />
            </MainWorkspace>
          </RouteInsetSurface>
        </ChatPaneDropOverlay>
        <RightDock
          state={sidebarState}
          initialWidth="fixed"
          minWidth={288}
          maxWidth={368}
          defaultWidth={RIGHT_SIDEBAR_DEFAULT_WIDTH}
          shouldAcceptWidth={shouldAcceptDockWidth}
          addMenuKinds={[]}
          primaryKinds={PRIMARY_DOCK_PANE_KINDS}
          motionKey={props.threadId}
          activePaneRuntimeMode={activePaneRuntimeMode}
          onSelectPane={handleSelectDockPane}
          onClosePane={(paneId) => {
            if (dockState.panes.find((pane) => pane.id === paneId)?.kind !== "explorer") {
              closePane(props.threadId, paneId);
              return;
            }
            closePane(props.threadId, paneId);
          }}
          onOpenChange={(open) => setDockOpen(props.threadId, open)}
          onAddPane={handleAddDockPane}
          renderPane={renderDockPane}
        />
        <WorkspaceSearchPalette
          open={searchPaletteOpen}
          mode={searchPaletteMode}
          onOpenChange={setSearchPaletteOpen}
          cwd={workspaceRoot}
          onOpenFile={handleOpenWorkspaceSearchFile}
          onOpenDirectory={handleOpenWorkspaceSearchDirectory}
        />
      </div>
    </WorkspaceFileOpenerContext.Provider>
  );
}
