import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ReactNode, useEffect, useState } from "react";
import { isElectron } from "~/env";
import { useDesktopTopBarWindowControlsGutterClassName } from "~/hooks/useDesktopTopBarGutter";
import { disclosureWidthClassName } from "~/lib/disclosureMotion";
import { cn } from "~/lib/utils";
import { SIDEBAR_SECTION_LABEL_CLASS_NAME } from "~/sidebarRowStyles";
import { useTerminalStateStore } from "~/terminalStateStore";
import {
  WORKSPACE_SIDEBAR_VIEWS,
  type WorkspaceSidebarView,
  useWorkspaceSidebarStore,
} from "~/workspaceSidebarStore";
import { BrowserPanel } from "../browser/BrowserPanel";
import { isBlankBrowserTab, useBrowserTabs } from "../browser/useBrowserTabs";
import { CHAT_SURFACE_HEADER_ROW_CLASS_NAME } from "../chat/chatHeaderControls";
import { CHAT_BACKGROUND_CLASS_NAME } from "../chat/composerPickerStyles";
import { PanelWidthResizeHandle, usePanelWidthResize } from "../chat/usePanelWidthResize";
import { TerminalView } from "./TerminalView";
import { WorkspaceActivityBar } from "./WorkspaceActivityBar";
import { WORKSPACE_SIDEBAR_VIEW_META } from "./workspaceSidebarViews";

const CHAT_MIN_WIDTH_PX = 20 * 16;
// Every view shares one width; the browser needs at least BROWSER_MIN_WIDTH_PX to be usable.
const SIDEBAR_WIDTH = {
  storageKey: "workspace_sidebar_width",
  defaultWidth: 30 * 16,
  minWidth: 18 * 16,
};
const BROWSER_MIN_WIDTH_PX = 32 * 16;

type ToolView = Exclude<WorkspaceSidebarView, "terminal" | "browser">;

// Keeps the thread's terminal flags in step with the terminal view.
function useTerminalViewSync(threadId: ThreadId, terminalVisible: boolean) {
  const show = useWorkspaceSidebarStore((store) => store.show);
  const terminal = useTerminalStateStore((store) => store.terminalStateByThreadId[threadId]);
  const setTerminalOpen = useTerminalStateStore((store) => store.setTerminalOpen);
  const setPresentationMode = useTerminalStateStore((store) => store.setTerminalPresentationMode);
  const requestedByWorkspace = Boolean(
    terminal?.terminalOpen && terminal.presentationMode === "workspace",
  );
  const terminalOpen = terminal?.terminalOpen ?? false;
  useEffect(() => {
    if (requestedByWorkspace) {
      setPresentationMode(threadId, "drawer");
      show("terminal");
    } else if (terminalOpen !== terminalVisible) setTerminalOpen(threadId, terminalVisible);
  }, [
    requestedByWorkspace,
    setPresentationMode,
    setTerminalOpen,
    show,
    terminalOpen,
    terminalVisible,
    threadId,
  ]);
}

// Views mount the first time they show and stay mounted, so switching only toggles visibility. Each
// view gets `visible` and pauses its own live work while hidden.
function WorkspaceSidebarViews(props: {
  visibleView: WorkspaceSidebarView | null;
  renderView: (view: WorkspaceSidebarView, visible: boolean) => ReactNode;
}) {
  const [visited, setVisited] = useState<ReadonlySet<WorkspaceSidebarView>>(() => new Set());
  const { visibleView } = props;
  if (visibleView && !visited.has(visibleView)) setVisited(new Set([...visited, visibleView]));
  return (
    <div className="relative min-h-0 flex-1">
      {WORKSPACE_SIDEBAR_VIEWS.map((view) => {
        const visible = view === visibleView;
        if (!visible && !visited.has(view)) return null;
        return (
          <div
            key={view}
            className={cn(
              "absolute inset-0 flex min-h-0 w-full",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={visible ? undefined : true}
            inert={!visible}
          >
            {props.renderView(view, visible)}
          </div>
        );
      })}
    </div>
  );
}

// The right sidebar and its activity bar. One view shows at a time.
export function WorkspaceSidebar(props: {
  threadId: ThreadId;
  projectId: ProjectId | null;
  workspaceRoot: string | null;
  renderToolView: (view: ToolView, visible: boolean) => ReactNode;
}) {
  const open = useWorkspaceSidebarStore((store) => store.open);
  const view = useWorkspaceSidebarStore((store) => store.view);
  const browserShown = open && view === "browser";
  const minWidth = browserShown ? BROWSER_MIN_WIDTH_PX : SIDEBAR_WIDTH.minWidth;
  const { wrapperRef, width, setWidth, startResize } = usePanelWidthResize({
    ...SIDEBAR_WIDTH,
    minWidth,
    chatMinWidth: CHAT_MIN_WIDTH_PX,
  });
  // Showing the browser widens a narrower shared width and keeps it.
  useEffect(() => {
    if (browserShown && width < BROWSER_MIN_WIDTH_PX) setWidth(BROWSER_MIN_WIDTH_PX);
  }, [browserShown, setWidth, width]);
  const gutterClassName = useDesktopTopBarWindowControlsGutterClassName();
  const browserTabs = useBrowserTabs(isElectron ? props.threadId : null);
  useTerminalViewSync(props.threadId, open && view === "terminal");
  const renderView = (shown: WorkspaceSidebarView, visible: boolean) => {
    if (shown === "browser")
      return <BrowserPanel threadId={props.threadId} tabs={browserTabs} visible={visible} />;
    if (shown === "terminal")
      return (
        <TerminalView
          threadId={props.threadId}
          projectId={props.projectId}
          workspaceRoot={props.workspaceRoot}
          visible={visible}
          onLastClosed={() => {
            const state = useWorkspaceSidebarStore.getState();
            if (state.view === "terminal") state.setOpen(false);
          }}
        />
      );
    return props.renderToolView(shown, visible);
  };
  return (
    <>
      <div
        ref={wrapperRef}
        className={disclosureWidthClassName(
          open,
          "border-l border-[var(--app-surface-divider)]",
          cn("relative flex h-full min-h-0 flex-none text-foreground", CHAT_BACKGROUND_CLASS_NAME),
        )}
        style={
          open
            ? {
                width: Math.max(minWidth, width),
                maxWidth: `calc(100% - ${CHAT_MIN_WIDTH_PX}px)`,
              }
            : undefined
        }
        aria-hidden={open ? undefined : true}
        inert={!open}
      >
        {open ? <PanelWidthResizeHandle onPointerDown={startResize} /> : null}
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
          <div
            className={cn(CHAT_SURFACE_HEADER_ROW_CLASS_NAME, "drag-region px-3", gutterClassName)}
          >
            <h2 className={cn("min-w-0 truncate", SIDEBAR_SECTION_LABEL_CLASS_NAME)}>
              {WORKSPACE_SIDEBAR_VIEW_META[view].label}
            </h2>
          </div>
          <WorkspaceSidebarViews
            key={props.threadId}
            visibleView={open ? view : null}
            renderView={renderView}
          />
        </div>
      </div>
      <WorkspaceActivityBar
        threadId={props.threadId}
        hasBrowserPages={browserTabs?.some((tab) => !isBlankBrowserTab(tab)) ?? false}
      />
    </>
  );
}
