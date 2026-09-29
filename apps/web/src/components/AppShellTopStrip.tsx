import { isElectron } from "~/env";
import { DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS } from "~/hooks/useDesktopTopBarGutter";
import { cn, isMacNavigatorPlatform } from "~/lib/utils";
import { CHAT_SURFACE_HEADER_HEIGHT_CLASS } from "./chat/chatHeaderControls";
import { SidebarLeadingControls } from "./SidebarHeaderNavigationControls";
import { useSidebar } from "./ui/sidebar";

export function AppShellTopStrip() {
  const { open } = useSidebar();
  return (
    // The padding (including the traffic-light gutter) lives on the inner row, because a box's own
    // padding still counts toward its width and would widen the column past the rail while the panel is
    // collapsed.
    <header
      className={cn(
        "drag-region flex w-0 min-w-full shrink-0 overflow-hidden font-system-ui",
        CHAT_SURFACE_HEADER_HEIGHT_CLASS,
      )}
    >
      <div
        className={cn(
          "app-shell-top-strip flex shrink-0 items-center ps-4 pe-3",
          isElectron && isMacNavigatorPlatform() && DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS,
        )}
      >
        {open ? <SidebarLeadingControls /> : null}
      </div>
    </header>
  );
}
