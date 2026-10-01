import type { MenuItemConstructorOptions } from "electron";

export interface DesktopKeyboardInput {
  type: string;
  key: string;
  code?: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export type DesktopPhysicalZoomAction = "zoomOut" | null;

export type DesktopZoomShortcutAction = "zoomIn" | "zoomOut" | "resetZoom";

export interface DesktopNativeZoomTarget {
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
}

export function resolveDesktopPhysicalZoomAction(
  platform: NodeJS.Platform,
  input: DesktopKeyboardInput,
): DesktopPhysicalZoomAction {
  if (
    platform !== "win32" ||
    input.type !== "keyDown" ||
    !input.control ||
    input.meta ||
    input.shift ||
    input.alt
  ) {
    return null;
  }

  const isMinusKey = input.key === "-" || input.code === "Minus" || input.code === "NumpadSubtract";
  return isMinusKey ? "zoomOut" : null;
}

export function applyDesktopPhysicalZoomAction(
  target: DesktopNativeZoomTarget,
  action: Exclude<DesktopPhysicalZoomAction, null>,
): void {
  if (action === "zoomOut") {
    // Electron's native zoomOut role subtracts half a zoom level. Reuse that exact step so alternating
    // native zoom-in and fallback zoom-out cannot drift.
    target.setZoomLevel(target.getZoomLevel() - 0.5);
  }
}

export function resolveDesktopZoomShortcutAction(
  platform: NodeJS.Platform,
  input: DesktopKeyboardInput,
): DesktopZoomShortcutAction | null {
  // Linux registers no native zoom accelerators (several desktops surface them as noisy native
  // keybinding notifications), so the main process applies these chords itself via
  // before-input-event. macOS/Windows keep their native zoom roles and must not double-handle here.
  if (
    platform !== "linux" ||
    input.type !== "keyDown" ||
    !input.control ||
    input.meta ||
    input.alt
  ) {
    return null;
  }

  if (input.code === "NumpadAdd" && input.key === "Add") return "zoomIn";
  if (input.code === "NumpadSubtract" && input.key === "Subtract") {
    return input.shift ? null : "zoomOut";
  }

  if (input.key === "+" || input.key === "=") return "zoomIn";
  if ((input.key === "-" || input.key === "_") && !input.shift) return "zoomOut";
  if (input.key === "0" && !input.shift) return "resetZoom";
  return null;
}

export function resolveDesktopMenuAccelerator(
  platform: NodeJS.Platform,
  accelerator: MenuItemConstructorOptions["accelerator"],
): MenuItemConstructorOptions["accelerator"] | undefined {
  return platform === "linux" ? undefined : accelerator;
}

export function shouldUseNativeZoomMenuRoles(platform: NodeJS.Platform): boolean {
  return platform !== "linux";
}

export function resolveKeyboardShortcutsMenuAccelerator(
  platform: NodeJS.Platform,
): MenuItemConstructorOptions["accelerator"] | undefined {
  return platform === "darwin" ? "Cmd+/" : undefined;
}
