import Crypto from "node:crypto";
import Path from "node:path";

import type { BrowserWindow } from "electron";

const WINDOWS_TASKBAR_ICON_REFRESH_DELAY_MS = 400;

interface WindowsTaskbarIconIdentity {
  readonly appId: string;
  readonly relaunchCommand: string;
  readonly relaunchDisplayName: string;
}

export interface ApplyWindowsTaskbarIconInput {
  readonly window: BrowserWindow | null;
  readonly iconPath: string;
  readonly identity: WindowsTaskbarIconIdentity;
  readonly reregisterTaskbarButton?: boolean;
}

let taskbarReregisterTimer: ReturnType<typeof setTimeout> | null = null;

let windowsShellIconGeneration = 0;
let lastMaterializedIconKey: string | null = null;

export function windowsShellIconCachePath(cacheDirectory: string, iconKey: string): string {
  return Path.join(cacheDirectory, `taskbar-${iconKey}.ico`);
}

export function windowsShellIconContentKey(iconKey: string, ico: Buffer): string {
  const digest = Crypto.createHash("sha256").update(ico).digest("hex").slice(0, 12);
  return `${iconKey}-${digest}`;
}

export function resolveWindowsShellIconCacheDirectory(input: {
  readonly executablePath: string;
  readonly fallbackDirectory: string;
}): string {
  if (/^electron(?:\.exe)?$/i.test(Path.basename(input.executablePath))) {
    return input.fallbackDirectory;
  }
  return Path.dirname(input.executablePath);
}

export function nextWindowsShellIconCacheKey(iconKey: string): string {
  if (lastMaterializedIconKey !== iconKey) {
    windowsShellIconGeneration += 1;
    lastMaterializedIconKey = iconKey;
  }
  return `${iconKey}-${windowsShellIconGeneration}`;
}

export interface WindowsShortcutDetails {
  readonly target?: string;
  readonly appUserModelId?: string;
  readonly icon?: string;
  readonly iconIndex?: number;
}

export function collectWindowsShortcutPaths(input: {
  readonly directories: readonly string[];
  readonly readdir: (directory: string) => readonly string[];
  readonly isDirectory: (path: string) => boolean;
}): string[] {
  const shortcuts: string[] = [];
  for (const directory of input.directories) {
    let entries: readonly string[] = [];
    try {
      entries = input.readdir(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = Path.join(directory, entry);
      if (entry.toLowerCase().endsWith(".lnk")) {
        shortcuts.push(fullPath);
        continue;
      }
      if (!input.isDirectory(fullPath)) continue;
      let nested: readonly string[] = [];
      try {
        nested = input.readdir(fullPath);
      } catch {
        continue;
      }
      for (const nestedEntry of nested) {
        if (nestedEntry.toLowerCase().endsWith(".lnk")) {
          shortcuts.push(Path.join(fullPath, nestedEntry));
        }
      }
    }
  }
  return shortcuts;
}

export function syncWindowsShortcutIcons(input: {
  readonly iconPath: string;
  readonly iconIndex?: number;
  readonly appId: string;
  readonly executablePath: string;
  readonly shortcutPaths: readonly string[];
  readonly readShortcut: (shortcutPath: string) => WindowsShortcutDetails | null;
  readonly updateShortcut: (shortcutPath: string, iconPath: string, iconIndex: number) => boolean;
  readonly onMatched?: (shortcutPath: string) => void;
}): { matched: string[]; updated: string[] } {
  const iconIndex = input.iconIndex ?? 0;
  const normalizedExe = Path.normalize(input.executablePath);
  const canMatchByTarget = !/^electron(?:\.exe)?$/i.test(Path.basename(input.executablePath));
  const matched: string[] = [];
  const updated: string[] = [];
  for (const shortcutPath of input.shortcutPaths) {
    const details = input.readShortcut(shortcutPath);
    if (!details) continue;
    const matchesId = details.appUserModelId === input.appId;
    const matchesTarget =
      canMatchByTarget &&
      typeof details.target === "string" &&
      (Path.normalize(details.target) === normalizedExe ||
        Path.basename(details.target).toLowerCase() === Path.basename(normalizedExe).toLowerCase());
    if (!matchesId && !matchesTarget) continue;
    matched.push(shortcutPath);
    input.onMatched?.(shortcutPath);
    if (details.icon === input.iconPath && (details.iconIndex ?? 0) === iconIndex) continue;
    if (input.updateShortcut(shortcutPath, input.iconPath, iconIndex)) {
      updated.push(shortcutPath);
    }
  }
  return { matched, updated };
}

function clearWindowsTaskbarIconRefresh(): void {
  if (taskbarReregisterTimer === null) return;
  clearTimeout(taskbarReregisterTimer);
  taskbarReregisterTimer = null;
}

function windowsTaskbarIconPropertyUpdates(input: {
  readonly iconPath: string;
  readonly identity: WindowsTaskbarIconIdentity;
}): {
  readonly iconOnly: {
    readonly appIconPath: string;
    readonly appIconIndex: number;
    readonly relaunchCommand: string;
    readonly relaunchDisplayName: string;
  };
  readonly withAppId: {
    readonly appId: string;
    readonly appIconPath: string;
    readonly appIconIndex: number;
    readonly relaunchCommand: string;
    readonly relaunchDisplayName: string;
  };
} {
  const iconOnly = {
    appIconPath: input.iconPath,
    appIconIndex: 0,
    relaunchCommand: input.identity.relaunchCommand,
    relaunchDisplayName: input.identity.relaunchDisplayName,
  };
  return {
    iconOnly,
    withAppId: {
      appId: input.identity.appId,
      ...iconOnly,
    },
  };
}

export function applyWindowsTaskbarIcon(input: ApplyWindowsTaskbarIconInput): void {
  const { window } = input;
  if (!window || window.isDestroyed()) return;

  bindWindowsTaskbarIcon(window, input);
  if (input.reregisterTaskbarButton !== true) return;
  if (!window.isVisible()) return;

  scheduleWindowsTaskbarReregister(window, input);
}

function bindWindowsTaskbarIcon(window: BrowserWindow, input: ApplyWindowsTaskbarIconInput): void {
  window.setIcon(input.iconPath);
  const updates = windowsTaskbarIconPropertyUpdates(input);
  try {
    // Chromium's setAppDetails writes the ID first and notifies Explorer immediately, so a single call
    // publishes the exe icon.
    window.setAppDetails(updates.iconOnly);
    window.setAppDetails(updates.withAppId);
  } catch {}
}

function scheduleWindowsTaskbarReregister(
  window: BrowserWindow,
  input: ApplyWindowsTaskbarIconInput,
): void {
  clearWindowsTaskbarIconRefresh();
  window.setSkipTaskbar(true);
  taskbarReregisterTimer = setTimeout(() => {
    taskbarReregisterTimer = null;
    if (window.isDestroyed()) return;
    bindWindowsTaskbarIcon(window, input);

    window.setSkipTaskbar(!window.isVisible());
    if (window.isVisible()) {
      bindWindowsTaskbarIcon(window, input);
    }
  }, WINDOWS_TASKBAR_ICON_REFRESH_DELAY_MS);
}
