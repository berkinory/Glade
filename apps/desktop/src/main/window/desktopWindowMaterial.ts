import type { DesktopWindowMaterialState } from "@glade/contracts/ipc/ipc";
import { nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { DESKTOP_WINDOW_MATERIAL_PATH } from "../desktopEnvironment";

function supportsWindowMaterial(): boolean {
  if (process.platform === "darwin") return true;
  if (process.platform !== "win32") return false;
  const [major, , build] = OS.release().split(".").map(Number);
  return major !== undefined && build !== undefined && major >= 10 && build >= 22621;
}

export function readWindowMaterialState(): DesktopWindowMaterialState {
  const supported = supportsWindowMaterial();
  try {
    const stored: unknown = JSON.parse(FS.readFileSync(DESKTOP_WINDOW_MATERIAL_PATH, "utf8"));
    const enabled =
      supported &&
      typeof stored === "object" &&
      stored !== null &&
      "version" in stored &&
      stored.version === 1 &&
      "enabled" in stored &&
      stored.enabled === true;
    return { supported, enabled };
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return { supported, enabled: false };
  }
}

export function windowMaterialOptions(enabled: boolean): BrowserWindowConstructorOptions {
  if (!enabled) {
    return { backgroundColor: nativeTheme.shouldUseDarkColors ? "#181818" : "#ffffff" };
  }
  // Native backdrops keep the window opaque to the window manager; transparent windows
  // introduce a separate compositor path with different shadow and resize behavior.
  return {
    backgroundColor: "#00000000",
    ...(process.platform === "darwin"
      ? ({ vibrancy: "under-window", visualEffectState: "followWindow", hasShadow: false } as const)
      : ({ backgroundMaterial: "mica" } as const)),
  };
}

export function applyWindowMaterial(window: BrowserWindow, enabled: boolean): void {
  if (process.platform === "darwin") {
    // A native shadow on translucent content can retain shapes from hover overlays.
    window.setHasShadow(!enabled);
    window.setVibrancy(enabled ? "under-window" : null);
  }
  if (process.platform === "win32" && supportsWindowMaterial()) {
    window.setBackgroundMaterial(enabled ? "mica" : "none");
  }
  window.setBackgroundColor(windowMaterialOptions(enabled).backgroundColor!);
}

export function persistWindowMaterial(enabled: boolean): DesktopWindowMaterialState {
  const state = { supported: supportsWindowMaterial(), enabled };
  if (!state.supported) throw new Error("Native window material is unavailable on this system.");
  FS.mkdirSync(Path.dirname(DESKTOP_WINDOW_MATERIAL_PATH), { recursive: true });
  FS.writeFileSync(DESKTOP_WINDOW_MATERIAL_PATH, JSON.stringify({ version: 1, enabled }), "utf8");
  return state;
}
