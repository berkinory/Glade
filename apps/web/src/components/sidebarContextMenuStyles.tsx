import type { IconComponent } from "~/lib/iconComponent";
export const SIDEBAR_CONTEXT_MENU_PANEL_CLASS_NAME = "w-48 min-w-48";
export const SIDEBAR_CONTEXT_MENU_ITEM_CLASS_NAME =
  "text-[var(--color-text-foreground)] data-highlighted:text-[var(--color-text-foreground)]";
export const SIDEBAR_CONTEXT_MENU_ICON_CLASS_NAME =
  "inline-flex size-3.5 shrink-0 items-center justify-center text-[var(--color-text-foreground-secondary)] [&>svg]:size-3.5 [&>[data-slot=central-icon]]:size-3.5";
export function SidebarContextMenuIcon({ icon: Icon }: { icon: IconComponent }) {
  return (
    <span className={SIDEBAR_CONTEXT_MENU_ICON_CLASS_NAME}>
      <Icon aria-hidden="true" />
    </span>
  );
}
