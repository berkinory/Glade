import {
  DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CSS_VAR,
  resolveMacDesktopTopBarTrafficLightGutterCssPx,
} from "@glade/shared/platform/desktopChrome";
import { useLayoutEffect } from "react";

import { isElectron } from "~/env";
import { useSidebar } from "~/components/ui/sidebar";
import { useDesktopCustomTitleBarActive } from "~/hooks/useDesktopCustomTitleBar";
import { useSidebarLayout } from "~/hooks/useSidebarLayout";
import { readDesktopZoomFactor, subscribeDesktopZoomFactor } from "~/lib/desktopZoom";
import { isMacNavigatorPlatform } from "~/lib/utils";

export const DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS = "desktop-top-bar-traffic-light-gutter";

const RAIL_LAYOUT_TOP_BAR_CLASS = "app-top-bar";

function withRailLayoutTopBarClass(
  gutterClassName: string | null,
  isRailLayout: boolean,
): string | null {
  if (!isRailLayout) return gutterClassName;
  return gutterClassName
    ? `${RAIL_LAYOUT_TOP_BAR_CLASS} ${gutterClassName}`
    : RAIL_LAYOUT_TOP_BAR_CLASS;
}

function shouldReserveDesktopTopBarTrafficLightGutter(input: {
  isElectron: boolean;
  isMacDesktop: boolean;
  sidebarOpen: boolean;
  isMobile: boolean;
}): boolean {
  if (!input.isElectron) return false;
  if (!input.isMacDesktop) return false;

  if (input.isMobile) return true;
  return !input.sidebarOpen;
}

function applyTrafficLightGutterCssVar(zoomFactor: number): void {
  document.documentElement.style.setProperty(
    DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CSS_VAR,
    `${resolveMacDesktopTopBarTrafficLightGutterCssPx(zoomFactor)}px`,
  );
}

export function useSyncDesktopTopBarTrafficLightGutterZoom(): void {
  const isMacDesktop = isMacNavigatorPlatform();

  useLayoutEffect(() => {
    if (!isElectron || !isMacDesktop) {
      return;
    }

    applyTrafficLightGutterCssVar(readDesktopZoomFactor());

    const unsubscribe = subscribeDesktopZoomFactor(applyTrafficLightGutterCssVar);

    const frame = requestAnimationFrame(() => {
      applyTrafficLightGutterCssVar(readDesktopZoomFactor());
    });

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      document.documentElement.style.removeProperty(DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CSS_VAR);
    };
  }, [isMacDesktop]);
}

export function useDesktopTopBarTrafficLightGutterClassName(): string | null {
  const { isMobile, open } = useSidebar();
  const isRailLayout = useSidebarLayout() === "rail";
  const isMacDesktop = isMacNavigatorPlatform();
  const gutterClassName = shouldReserveDesktopTopBarTrafficLightGutter({
    isElectron,
    isMacDesktop,
    sidebarOpen: open,
    isMobile,
  })
    ? DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS
    : null;
  return withRailLayoutTopBarClass(gutterClassName, isRailLayout);
}

// Each caption button is 46px wide (matching {@link CHAT_SURFACE_HEADER_HEIGHT_PX}), so the
// three-button cluster spans 138px. Any top bar that can sit flush against the window's right edge
// reserves that width here so its trailing controls never slide underneath the floating buttons.
// The `!` (important) modifier is required for the same reason as the traffic-light gutter: host
// headers carry their own `px-*` padding that `twMerge` does not treat as conflicting with `pr-*`,
// so the override must win the cascade outright. Both the base and `sm:` variants are emitted so it
// also beats `sm:px-*`.
const DESKTOP_TOP_BAR_WINDOW_CONTROLS_GUTTER_CLASS = "pr-[138px]! sm:pr-[138px]!";

function shouldReserveDesktopTopBarWindowControlsGutter(input: {
  isElectron: boolean;
  customTitleBarActive: boolean;
}): boolean {
  return input.isElectron && input.customTitleBarActive;
}

export function useDesktopTopBarWindowControlsGutterClassName(): string | null {
  const customTitleBarActive = useDesktopCustomTitleBarActive();
  const isRailLayout = useSidebarLayout() === "rail";
  const gutterClassName = shouldReserveDesktopTopBarWindowControlsGutter({
    isElectron,
    customTitleBarActive,
  })
    ? DESKTOP_TOP_BAR_WINDOW_CONTROLS_GUTTER_CLASS
    : null;
  return withRailLayoutTopBarClass(gutterClassName, isRailLayout);
}
