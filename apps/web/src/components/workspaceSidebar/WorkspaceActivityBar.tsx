import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useQuery } from "@tanstack/react-query";
import { isElectron } from "~/env";
import { shortcutLabelForCommand } from "~/keybindings";
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
import { CHAT_SURFACE_HEADER_ROW_CLASS_NAME } from "../chat/chatHeaderControls";
import { EMPTY_KEYBINDINGS } from "../sidebarSupport";
import { SIDEBAR_STATUS_DOT_CLASS_NAME } from "../SidebarStatusTrailingGlyph";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WORKSPACE_SIDEBAR_VIEW_META } from "./workspaceSidebarViews";

// The icon column on the window's right edge that picks the right sidebar's view.
export function WorkspaceActivityBar(props: { threadId: ThreadId; hasBrowserTabs: boolean }) {
  const open = useWorkspaceSidebarStore((store) => store.open);
  const activeView = useWorkspaceSidebarStore((store) => store.view);
  const toggle = useWorkspaceSidebarStore((store) => store.toggle);
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
      : props.hasBrowserTabs
        ? { label: "Open browser tabs", pulse: false }
        : null,
  };
  return (
    <nav
      aria-label="Workspace views"
      className="app-sidebar-surface flex h-full w-10 flex-none flex-col items-center border-l border-[var(--app-surface-divider)]"
    >
      <div className={cn(CHAT_SURFACE_HEADER_ROW_CLASS_NAME, "drag-region w-full")} />
      <div className="flex flex-col items-center gap-1 py-1.5">
        {WORKSPACE_SIDEBAR_VIEWS.filter((view) => view !== "browser" || isElectron).map((view) => {
          const { label, Icon, command } = WORKSPACE_SIDEBAR_VIEW_META[view];
          const shortcut = shortcutLabelForCommand(keybindings, command);
          const active = open && activeView === view;
          const dot = dots[view];
          return (
            <Tooltip key={view}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={active}
                    className={cn(
                      "relative flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground/75",
                      SIDEBAR_ROW_FOCUS_CLASS_NAME,
                      SIDEBAR_ROW_HOVER_CLASS_NAME,
                      active && SIDEBAR_ROW_ACTIVE_CLASS_NAME,
                    )}
                    onClick={() => toggle(view)}
                  />
                }
              >
                <Icon className="size-4" aria-hidden />
                {dot ? (
                  <span
                    role="img"
                    aria-label={dot.label}
                    className={cn(
                      SIDEBAR_STATUS_DOT_CLASS_NAME,
                      "absolute right-1 top-1",
                      dot.pulse && "animate-pulse motion-reduce:animate-none",
                    )}
                  />
                ) : null}
              </TooltipTrigger>
              <TooltipPopup side="left">{shortcut ? `${label} (${shortcut})` : label}</TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
