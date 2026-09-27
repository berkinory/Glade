// FILE: useSidebarLayout.ts
// Purpose: The single resolver for which app shell renders: classic sidebar or rail + panel.
// Layer: Web shell hook
// Exports: SidebarLayout, resolveSidebarLayout, useSidebarLayout

import { useAppSettings, type SidebarLayout } from "../appSettings";
import { useIsMobile } from "./useMediaQuery";

export type { SidebarLayout };

/**
 * The rail layout requires the user preference and a desktop
 * viewport. It is available in Dev and Prod; mobile stays classic.
 */
export function resolveSidebarLayout(input: {
  setting: SidebarLayout;
  isMobile: boolean;
}): SidebarLayout {
  return input.setting === "rail" && !input.isMobile ? "rail" : "classic";
}

/** Every shell consumer reads this hook; nobody re-derives the layout on its own. */
export function useSidebarLayout(): SidebarLayout {
  const { settings } = useAppSettings();
  const isMobile = useIsMobile();
  return resolveSidebarLayout({
    setting: settings.sidebarLayout,
    isMobile,
  });
}
