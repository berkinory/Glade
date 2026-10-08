import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocalDesktopActive } from "~/environments/activeEnvironment";
import { useDesktopTopBarWindowControlsGutterClassName } from "~/hooks/useDesktopTopBarGutter";
import { shortcutLabelForCommand } from "~/keybindings";
import { LayoutAlignRightIcon } from "~/lib/icons";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import {
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_FOCUS_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
} from "~/sidebarRowStyles";
import { useStore } from "~/store";
import { selectThreadTerminalState, useTerminalStateStore } from "~/terminalStateStore";
import { WORKSPACE_SIDEBAR_VIEWS, useWorkspaceSidebarStore } from "~/workspaceSidebarStore";
import { selectBrowserAgentActivity } from "../browser/BrowserAgentActivity.logic";
import { CHAT_SURFACE_HEADER_HEIGHT_CLASS } from "../chat/chatHeaderControls";
import { EMPTY_KEYBINDINGS } from "../sidebarSupport";
import { SIDEBAR_STATUS_DOT_CLASS_NAME } from "../SidebarStatusTrailingGlyph";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WORKSPACE_SIDEBAR_VIEW_META } from "./workspaceSidebarViews";
import { CHAT_SURFACE_HEADER_HEIGHT_PX } from "@glade/shared/platform/desktopChrome";

const BUTTON_SIZE_PX = 32;
const SEPARATOR_GAP_PX = 10;

function ActivityBarButton(props: {
  label: string;
  tooltip: string;
  active?: boolean;
  expanded?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            aria-pressed={props.active}
            aria-expanded={props.expanded}
            className={cn(
              "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground",
              SIDEBAR_ROW_FOCUS_CLASS_NAME,
              SIDEBAR_ROW_HOVER_CLASS_NAME,
              props.active && SIDEBAR_ROW_ACTIVE_CLASS_NAME,
            )}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="left">{props.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

// The strip on the window's right edge: a toggle for the right sidebar, then one icon per view.
export function WorkspaceActivityBar(props: { threadId: ThreadId; hasBrowserPages: boolean }) {
  const isLocalDesktop = useLocalDesktopActive();
  const open = useWorkspaceSidebarStore((store) => store.open);
  const activeView = useWorkspaceSidebarStore((store) => store.view);
  const toggle = useWorkspaceSidebarStore((store) => store.toggle);
  const setOpen = useWorkspaceSidebarStore((store) => store.setOpen);
  // Window caption buttons cover the top right corner, so the toggle moves below them.
  const captionButtonsOverlap = useDesktopTopBarWindowControlsGutterClassName() !== null;
  const keybindings =
    useQuery({ ...serverConfigQueryOptions(), select: (config) => config.keybindings }).data ??
    EMPTY_KEYBINDINGS;
  const terminalRunning = useTerminalStateStore(
    (store) =>
      selectThreadTerminalState(store.terminalStateByThreadId, props.threadId).runningTerminalIds
        .length > 0,
  );
  const browserAgentActive = useStore(selectBrowserAgentActivity(props.threadId)) !== null;
  const dots = {
    explorer: null,
    git: null,
    terminal: terminalRunning ? { label: "Terminal running", pulse: false } : null,
    browser: browserAgentActive
      ? { label: "Agent is using the browser", pulse: true }
      : props.hasBrowserPages
        ? { label: "Open browser pages", pulse: false }
        : null,
  };
  const sidebarToggle = (
    <ActivityBarButton
      label="Toggle sidebar"
      tooltip={open ? "Hide sidebar" : "Show sidebar"}
      expanded={open}
      onClick={() => setOpen(!open)}
    >
      <LayoutAlignRightIcon className="size-4" aria-hidden />
    </ActivityBarButton>
  );
  return (
    <nav
      aria-label="Workspace views"
      className="app-sidebar-surface flex h-full w-10 flex-none flex-col items-center border-l border-[var(--app-surface-divider)]"
    >
      <div
        className={cn(
          CHAT_SURFACE_HEADER_HEIGHT_CLASS,
          "drag-region flex w-full shrink-0 items-center justify-center",
        )}
      >
        {captionButtonsOverlap ? null : sidebarToggle}
      </div>
      {captionButtonsOverlap ? <div className="pt-2.5">{sidebarToggle}</div> : null}
      <div
        aria-hidden
        className="h-px w-5 shrink-0 bg-[var(--app-surface-divider)]"
        // Same gap above as below: the header-row toggle already sits (header − button) / 2 above
        // the header's bottom edge.
        style={{
          marginTop: captionButtonsOverlap
            ? SEPARATOR_GAP_PX
            : SEPARATOR_GAP_PX - (CHAT_SURFACE_HEADER_HEIGHT_PX - BUTTON_SIZE_PX) / 2,
        }}
      />
      <div className="flex flex-col items-center gap-2 pt-2.5">
        {WORKSPACE_SIDEBAR_VIEWS.filter((view) => view !== "browser" || isLocalDesktop).map(
          (view) => {
            const { label, Icon, command } = WORKSPACE_SIDEBAR_VIEW_META[view];
            const shortcut = shortcutLabelForCommand(keybindings, command);
            const dot = dots[view];
            return (
              <ActivityBarButton
                key={view}
                label={label}
                tooltip={shortcut ? `${label} (${shortcut})` : label}
                active={open && activeView === view}
                onClick={() => toggle(view)}
              >
                <span className="relative flex">
                  <Icon className="size-4" aria-hidden />
                  {dot ? (
                    <span
                      role="img"
                      aria-label={dot.label}
                      className={cn(
                        SIDEBAR_STATUS_DOT_CLASS_NAME,
                        "absolute -right-1 -top-1",
                        dot.pulse && "animate-pulse motion-reduce:animate-none",
                      )}
                    />
                  ) : null}
                </span>
              </ActivityBarButton>
            );
          },
        )}
      </div>
    </nav>
  );
}
