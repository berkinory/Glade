import { SearchIcon } from "~/lib/icons";
import { useSidebarStateStore } from "~/sidebarStateStore";
import { SidebarIconButton } from "./SidebarIconButton";
import { AppNavigationButtons } from "./AppNavigationButtons";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { cn } from "~/lib/utils";

// Keeping it in ONE component is what makes those two states visually identical: same trigger tone,
// icon size, and gap, so toggling the sidebar never changes the button's brightness or the cluster
// spacing. The wrapper layout (hidden/md:flex, ml-auto, …) varies per host, so it is passed in via
// `className`; the inner controls stay constant.
export function SidebarLeadingControls({ className }: { className?: string }) {
  const setSearchPaletteOpen = useSidebarStateStore((state) => state.setSearchPaletteOpen);
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)}>
      <SidebarTrigger
        className="size-7 shrink-0 text-muted-foreground/75 hover:text-foreground"
        aria-label="Toggle chat sidebar"
      />
      <AppNavigationButtons className="ms-0" />
      <SidebarIconButton
        icon={SearchIcon}
        label="Search"
        size="header"
        tooltip="Search"
        tooltipSide="bottom"
        onClick={() => setSearchPaletteOpen(true)}
      />
    </div>
  );
}

// When the sidebar is open on desktop the in-sidebar header owns the cluster, so this renders
// nothing to avoid a duplicate set of controls.
export function SidebarHeaderNavigationControls() {
  const { isMobile, open } = useSidebar();

  if (!isMobile && open) {
    return null;
  }

  return <SidebarLeadingControls />;
}
