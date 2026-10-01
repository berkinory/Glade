import { useAppSettings, type SidebarLayout } from "../appSettings";
import { useIsMobile } from "./useMediaQuery";

export type { SidebarLayout };

function resolveSidebarLayout(input: { setting: SidebarLayout; isMobile: boolean }): SidebarLayout {
  return input.setting === "rail" && !input.isMobile ? "rail" : "classic";
}

export function useSidebarLayout(): SidebarLayout {
  const { settings } = useAppSettings();
  const isMobile = useIsMobile();
  return resolveSidebarLayout({
    setting: settings.sidebarLayout,
    isMobile,
  });
}
