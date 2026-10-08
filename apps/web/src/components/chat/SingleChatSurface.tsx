import { isTerminalFocused } from "~/lib/terminalFocus";
import { hasOpenKeyboardOverlay } from "~/lib/keyboardOverlay";
import type { ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import type { DiffRouteSearch } from "../../diffRouteSearch";
import { appendChatFileReference, type ChatFileReference } from "../../lib/chatReferences";
import {
  prefetchWorkspaceFile,
  resolveDockFileOpenTarget,
  resolveWorkspaceDirectoryOpenTarget,
  resolveWorkspaceFileOpenTarget,
  WorkspaceFileOpenerContext,
  type WorkspaceFileOpener,
} from "../../lib/workspaceFileOpener";
import { requestExplorerFileReveal, requestExplorerReveal } from "../../explorerRevealRequestStore";
import { selectWorkspaceFileTabs, useWorkspaceFileTabsStore } from "../../workspaceFileTabsStore";
import { useWorkspaceSidebarStore } from "../../workspaceSidebarStore";
import { useStore } from "../../store";
import { createProjectSelector, createThreadWorkspaceMetadataSelector } from "../../storeSelectors";
import { DeferredChatView } from "./ChatThreadSurfacePrimitives";
import { MainWorkspace } from "./MainWorkspace";
import {
  selectMainWorkspace,
  useMainWorkspaceStore,
  type WorkspaceReviewTab,
} from "../../mainWorkspaceStore";
import { PanelStateMessage } from "./PanelStateMessage";
import { WorkspaceSidebar } from "../workspaceSidebar/WorkspaceSidebar";
import {
  CHAT_BACKGROUND_CLASS_NAME,
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "./composerPickerStyles";
import { RouteInsetSurface } from "../RouteInsetSurface";
import { WorkspaceSearchPalette, type WorkspaceSearchPaletteMode } from "../WorkspaceSearchPalette";
import {
  resolveFilePreviewWorkspaceRoot,
  resolveRoutePanelBootstrap,
} from "../../routes/-chatThreadRoute.logic";
import { cn } from "~/lib/utils";

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
export function SingleChatSurface(props: {
  threadId: ThreadId;
  search: DiffRouteSearch;
  projectId: ProjectId | null;
}) {
  const navigate = useNavigate();
  const fileTabs = useWorkspaceFileTabsStore(
    useMemo(() => selectWorkspaceFileTabs(props.threadId), [props.threadId]),
  );
  const selectMainTab = useMainWorkspaceStore((store) => store.selectTab);
  const openReview = useMainWorkspaceStore((store) => store.openReview);
  const mainWorkspace = useMainWorkspaceStore(selectMainWorkspace(props.threadId));
  const sidebarOpen = useWorkspaceSidebarStore((store) => store.open);
  const sidebarView = useWorkspaceSidebarStore((store) => store.view);
  const showView = useWorkspaceSidebarStore((store) => store.show);
  const toggleView = useWorkspaceSidebarStore((store) => store.toggle);
  const setSidebarOpen = useWorkspaceSidebarStore((store) => store.setOpen);
  const setSourceControlView = useWorkspaceFileTabsStore((store) => store.setSourceControlView);
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
  const diffPanelOpen = sidebarOpen && sidebarView === "git";
  const handleToggleDiff = () => toggleView("git");
  const handleOpenTurnDiff = (turnId: TurnId, filePath?: string) =>
    openReview(props.threadId, {
      id: `diff:${turnId}`,
      kind: "diff",
      turnId,
      filePath: filePath ?? null,
    });

  const handleOpenWorkspaceSearchFile = useCallback(
    (relativePath: string) => {
      showView("explorer");
      requestExplorerFileReveal(props.threadId, relativePath, undefined, { preview: true });
    },
    [showView, props.threadId],
  );

  const handleOpenWorkspaceSearchDirectory = useCallback(
    (relativePath: string) => {
      showView("explorer");
      requestExplorerReveal(props.threadId, relativePath);
    },
    [showView, props.threadId],
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
          showView("explorer");
          requestExplorerReveal(props.threadId, directoryPath);
          return true;
        }

        const targetPath = resolveDockFileOpenTarget(path, workspaceRoot);
        if (!targetPath) {
          return false;
        }
        showView("explorer");
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
    [workspaceRoot, showView, props.threadId, prefetchOpenerFile],
  );
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

    if (panelPatch.panel !== "diff") setSidebarOpen(false);
    else if (panelPatch.diffTurnId)
      openReview(props.threadId, {
        id: `diff:${panelPatch.diffTurnId}`,
        kind: "diff",
        turnId: panelPatch.diffTurnId,
        filePath: panelPatch.diffFilePath ?? null,
      });
    else showView("git");
    void navigate({
      to: "/$threadId",
      params: { threadId: props.threadId },
      replace: true,
      search: {},
    });
  }, [navigate, openReview, props.search, props.threadId, setSidebarOpen, showView]);

  const openGitPreview = (tab: WorkspaceReviewTab, preview: boolean) => {
    const replacesPreview =
      !mainWorkspace.reviews.some((review) => review.id === tab.id) ||
      mainWorkspace.previewReviewId === tab.id;
    if (preview && replacesPreview && fileTabs.previewFilePath) {
      useWorkspaceFileTabsStore.getState().closeFile(props.threadId, fileTabs.previewFilePath);
    }
    openReview(props.threadId, tab, preview);
  };

  const renderToolView = (view: "explorer" | "git", visible: boolean): ReactNode => {
    switch (view) {
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
                showView("explorer");
                requestExplorerFileReveal(props.threadId, filePath);
              }}
              view={fileTabs.sourceControlView}
              onViewChange={(view) => setSourceControlView(props.threadId, view)}
              visible={visible}
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
              isVisible={visible}
              onReferenceInChat={handleReferenceInChat}
            />
          </Suspense>
        );
    }
  };

  return (
    <WorkspaceFileOpenerContext.Provider value={dockFileOpener}>
      <div
        className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
      >
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
            <MainWorkspace
              key={props.threadId}
              threadId={props.threadId}
              projectId={props.projectId}
              workspaceRoot={workspaceRoot}
              revealPosition={revealPosition}
              onReferenceInChat={handleReferenceInChat}
            >
              <DeferredChatView
                threadId={props.threadId}
                deferMount={isBrandNewDraftThread}
                diffPanelOpen={diffPanelOpen}
                onToggleDiff={handleToggleDiff}
                onToggleTerminal={() => toggleView("terminal")}
                onOpenTerminal={() => showView("terminal")}
                onOpenTurnDiff={handleOpenTurnDiff}
              />
            </MainWorkspace>
          </RouteInsetSurface>
        </div>
        <WorkspaceSidebar
          threadId={props.threadId}
          projectId={props.projectId}
          workspaceRoot={workspaceRoot}
          renderToolView={renderToolView}
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
