import type { DesktopAppIcon } from "@glade/contracts/ipc/ipc";
import {
  canOverrideDesktopSmokeUserData,
  GLADE_DESKTOP_SMOKE_USER_DATA_ENV,
} from "@glade/shared/platform/desktopIdentity";
import { app, BrowserWindow, nativeImage, nativeTheme, shell } from "electron";
import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import {
  repairBrowserProfileFromBridgeManifest,
  resolveDesktopAppDataBase,
  resolveDesktopUserDataPath,
} from "../../storage/desktopUserDataProfile";
import {
  applyWindowsShellAppUserModel,
  nativeWindowHandleToHwnd,
} from "../../windowsShell/windowsShellAppUserModel";
import { extractIcoPngImages, toWindowsShellIco } from "../../windowsShell/windowsShellIco";
import {
  applyWindowsTaskbarIcon,
  collectWindowsShortcutPaths,
  nextWindowsShellIconCacheKey,
  resolveWindowsShellIconCacheDirectory,
  syncWindowsShortcutIcons,
  windowsShellIconCachePath,
  windowsShellIconContentKey,
} from "../../windowsShell/windowsTaskbarIcon";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import {
  desktopAppIconResourceName,
  isDesktopAppIcon,
  usesMacBundleAppIcon,
} from "./desktopAppIcon";
import { persistMacAppIcon } from "./macAppIcon";
import {
  LSREGISTER_PATH,
  parseLastLaunchVersion,
  resolveLaunchVersionRecordPath,
  resolveMacAppBundlePath,
  serializeLaunchVersionRecord,
  shouldRefreshIconCache,
} from "./macIconCacheRefresh";

export function createAppIdentity(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "desktopIdentity"
    | "packagedDesktopFlavor"
    | "requestedSourceBuildMarker"
    | "APP_DISPLAY_NAME"
    | "resolveAboutCommitHash"
    | "APP_USER_MODEL_ID"
    | "DESKTOP_APP_ICON_PATH"
    | "STATE_DIR"
    | "windowsTaskbarIcoBytesCache"
    | "lastPersistedMacAppIcon"
    | "windowsShellStampTimer"
    | "windowsShellStampResolve"
    | "formatErrorMessage"
    | "mainWindow"
    | "desktopAppIconApplyTail"
    | "desktopFlavor"
    | "resolveResourcePath"
  >,
) {
  function resolveUserDataPath(): string {
    const appDataBase = resolveDesktopAppDataBase();
    return resolveDesktopUserDataPath({
      appDataBase,
      userDataDirectoryName: desktopRuntime.desktopIdentity.userDataDirectoryName,
      testOverridePath: canOverrideDesktopSmokeUserData({
        packagedFlavor: desktopRuntime.packagedDesktopFlavor,
        sourceBuildMarker: desktopRuntime.requestedSourceBuildMarker,
      })
        ? process.env[GLADE_DESKTOP_SMOKE_USER_DATA_ENV]
        : undefined,
    });
  }

  function repairBrowserProfileBeforeElectronReady(userDataPath: string): void {
    const browserProfileRepair = repairBrowserProfileFromBridgeManifest(userDataPath);
    if (browserProfileRepair.status === "repaired") {
      console.info("[desktop] Completed Glade browser profile bridge repair", {
        sourcePath: browserProfileRepair.sourcePath,
        targetPath: browserProfileRepair.targetPath,
        copiedEntries: browserProfileRepair.copiedEntries,
      });
    } else if (browserProfileRepair.status === "repair-failed") {
      console.warn("[desktop] Failed to complete Glade browser profile bridge repair", {
        sourcePath: browserProfileRepair.sourcePath,
        targetPath: browserProfileRepair.targetPath,
        error: browserProfileRepair.error,
      });
    }
  }

  function configureAppIdentity(): void {
    app.setName(desktopRuntime.APP_DISPLAY_NAME);
    const commitHash = desktopRuntime.resolveAboutCommitHash();
    app.setAboutPanelOptions({
      applicationName: desktopRuntime.APP_DISPLAY_NAME,
      applicationVersion: app.getVersion(),
      version: commitHash ?? "unknown",
      copyright: `© ${new Date().getFullYear()} Emanuele Di Pietro`,
    });

    if (process.platform === "win32") {
      app.setAppUserModelId(desktopRuntime.APP_USER_MODEL_ID);
    }
  }

  function usesLegacyMacDockIcon(): boolean {
    if (process.platform !== "darwin") return false;
    const darwinMajor = Number.parseInt(OS.release().split(".")[0] ?? "", 10);
    return Number.isFinite(darwinMajor) && darwinMajor < 25;
  }

  function readDesktopAppIcon(): DesktopAppIcon {
    try {
      const storedIcon = FS.readFileSync(desktopRuntime.DESKTOP_APP_ICON_PATH, "utf8").trim();
      return isDesktopAppIcon(storedIcon) ? storedIcon : "default";
    } catch {
      return "default";
    }
  }

  function persistDesktopAppIcon(icon: DesktopAppIcon): void {
    FS.mkdirSync(Path.dirname(desktopRuntime.DESKTOP_APP_ICON_PATH), { recursive: true });
    FS.writeFileSync(desktopRuntime.DESKTOP_APP_ICON_PATH, icon, "utf8");
  }

  function windowsShortcutSearchDirectories(): string[] {
    const appData = process.env.APPDATA?.trim() ?? "";
    const programData =
      process.env.ProgramData?.trim() ?? Path.join(Path.parse(OS.homedir()).root, "ProgramData");
    return [
      Path.join(OS.homedir(), "Desktop"),
      Path.join(OS.homedir(), "OneDrive", "Desktop"),
      Path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs"),
      Path.join(OS.homedir(), "..", "Public", "Desktop"),
      ...(appData.length > 0
        ? [
            Path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
            Path.join(
              appData,
              "Microsoft",
              "Internet Explorer",
              "Quick Launch",
              "User Pinned",
              "TaskBar",
            ),
          ]
        : []),
    ];
  }

  function syncWindowsTaskbarShortcuts(shellIconPath: string): string[] {
    const shortcutIconPath = shellIconPath;
    const shortcutPaths = collectWindowsShortcutPaths({
      directories: windowsShortcutSearchDirectories(),
      readdir: (directory) => FS.readdirSync(directory),
      isDirectory: (path) => {
        try {
          return FS.statSync(path).isDirectory();
        } catch {
          return false;
        }
      },
    });
    const { matched } = syncWindowsShortcutIcons({
      iconPath: shortcutIconPath,
      iconIndex: 0,
      appId: desktopRuntime.APP_USER_MODEL_ID,
      executablePath: process.execPath,
      shortcutPaths,
      readShortcut: (shortcutPath) => {
        try {
          return shell.readShortcutLink(shortcutPath);
        } catch {
          return null;
        }
      },
      updateShortcut: (shortcutPath, iconPath, iconIndex) => {
        try {
          const current = shell.readShortcutLink(shortcutPath);
          return shell.writeShortcutLink(shortcutPath, "update", {
            ...current,
            icon: iconPath,
            iconIndex,
            appUserModelId: desktopRuntime.APP_USER_MODEL_ID,
          });
        } catch {
          return false;
        }
      },
    });
    return matched;
  }

  function materializeWindowsShellIcon(icon: DesktopAppIcon, sourcePath: string): string {
    const bytes = toWindowsTaskbarIcoBytes(sourcePath);
    const contentKey = windowsShellIconContentKey(icon, bytes);
    const cacheKey = nextWindowsShellIconCacheKey(contentKey);
    const fallbackDirectory = Path.join(desktopRuntime.STATE_DIR, "taskbar-icons");
    const directories = [
      ...new Set([
        resolveWindowsShellIconCacheDirectory({
          executablePath: process.execPath,
          fallbackDirectory,
        }),
        fallbackDirectory,
      ]),
    ];
    let lastError: unknown;
    for (const directory of directories) {
      try {
        FS.mkdirSync(directory, { recursive: true });
        const destinationPath = windowsShellIconCachePath(directory, cacheKey);
        if (FS.existsSync(destinationPath)) return destinationPath;
        try {
          FS.writeFileSync(destinationPath, bytes);
        } catch (error) {
          if (!FS.existsSync(destinationPath)) throw error;
        }
        return destinationPath;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Failed to materialize Windows shell icon");
  }

  function toWindowsTaskbarIcoBytes(sourcePath: string): Buffer {
    const cached = desktopRuntime.windowsTaskbarIcoBytesCache.get(sourcePath);
    if (cached) return cached;
    const sourceBytes = FS.readFileSync(sourcePath);
    try {
      if (extractIcoPngImages(sourceBytes).length === 0) {
        desktopRuntime.windowsTaskbarIcoBytesCache.set(sourcePath, sourceBytes);
        return sourceBytes;
      }
      const converted = toWindowsShellIco(sourceBytes, (png, size) => {
        const image = nativeImage.createFromBuffer(png);
        if (image.isEmpty()) return null;
        const resized = image.resize({ width: size, height: size });
        const bgra = resized.toBitmap();
        if (bgra.length !== size * size * 4) return null;
        return { width: size, height: size, bgra };
      });
      desktopRuntime.windowsTaskbarIcoBytesCache.set(sourcePath, converted);
      return converted;
    } catch {
      return sourceBytes;
    }
  }

  async function syncMacAppBundleIcon(
    icon: DesktopAppIcon,
    image: Electron.NativeImage | null,
  ): Promise<void> {
    if (!app.isPackaged || desktopRuntime.lastPersistedMacAppIcon === icon) return;
    const bundlePath = resolveMacAppBundlePath(process.execPath, process.platform);
    if (!bundlePath) return;
    await persistMacAppIcon({
      bundlePath,
      cacheDirectory: Path.join(desktopRuntime.STATE_DIR, "mac-app-icons"),
      png: icon === "default" ? null : (image?.toPNG() ?? null),
    });
    desktopRuntime.lastPersistedMacAppIcon = icon;
  }

  function cancelDeferredWindowsShellStamp(): void {
    if (desktopRuntime.windowsShellStampTimer === null) return;
    clearImmediate(desktopRuntime.windowsShellStampTimer);
    desktopRuntime.windowsShellStampTimer = null;
    const resolve = desktopRuntime.windowsShellStampResolve;
    desktopRuntime.windowsShellStampResolve = null;
    resolve?.();
  }

  function stampWindowsShellAppUserModel(
    input: Parameters<typeof applyWindowsShellAppUserModel>[0],
    options?: {
      flush?: boolean;
    },
  ): void {
    try {
      applyWindowsShellAppUserModel(
        input,
        Path.join(desktopRuntime.STATE_DIR, "taskbar-icons"),
        options,
      );
    } catch (error) {
      console.warn(
        `[desktop] Failed to stamp Windows AppUserModel icon properties: ${desktopRuntime.formatErrorMessage(error)}`,
      );
    }
  }

  function queueWindowsShellAppUserModelStamp(
    input: Parameters<typeof applyWindowsShellAppUserModel>[0],
    options?: {
      flush?: boolean;
      immediate?: boolean;
    },
  ): Promise<void> {
    cancelDeferredWindowsShellStamp();
    if (options?.immediate === true) {
      stampWindowsShellAppUserModel(input, options);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      desktopRuntime.windowsShellStampResolve = resolve;
      desktopRuntime.windowsShellStampTimer = setImmediate(() => {
        desktopRuntime.windowsShellStampTimer = null;
        desktopRuntime.windowsShellStampResolve = null;
        stampWindowsShellAppUserModel(input, options);
        resolve();
      });
    });
  }

  async function applyDesktopAppIcon(
    icon: DesktopAppIcon,
    window: BrowserWindow | null = desktopRuntime.mainWindow,
    options?: { reregisterTaskbarButton?: boolean; flushShellIconCache?: boolean },
  ): Promise<void> {
    return enqueueDesktopAppIconJob(() => applyDesktopAppIconUnlocked(icon, window, options));
  }

  function applyPersistedDesktopAppIcon(
    window: BrowserWindow | null = desktopRuntime.mainWindow,
    options?: { reregisterTaskbarButton?: boolean; flushShellIconCache?: boolean },
  ): Promise<void> {
    return enqueueDesktopAppIconJob(() =>
      applyDesktopAppIconUnlocked(readDesktopAppIcon(), window, options),
    );
  }

  function enqueueDesktopAppIconJob(job: () => Promise<void>): Promise<void> {
    const run = desktopRuntime.desktopAppIconApplyTail.then(job, job);
    desktopRuntime.desktopAppIconApplyTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function applyDesktopAppIconUnlocked(
    icon: DesktopAppIcon,
    window: BrowserWindow | null = desktopRuntime.mainWindow,
    options?: { reregisterTaskbarButton?: boolean; flushShellIconCache?: boolean },
  ): Promise<void> {
    if (
      process.platform !== "darwin" &&
      process.platform !== "linux" &&
      process.platform !== "win32"
    ) {
      return;
    }
    if (
      usesMacBundleAppIcon({
        icon,
        platform: process.platform,
        usesLegacyDockIcon: usesLegacyMacDockIcon(),
      })
    ) {
      // Remove the persistent override before asking AppKit to reload the bundle icon, otherwise it can
      // read the previous custom artwork again.
      await syncMacAppBundleIcon(icon, null);
      app.dock?.setIcon(null as unknown as Electron.NativeImage);
      return;
    }

    const resourceName = desktopAppIconResourceName({
      icon,
      platform: process.platform,
      isDarkAppearance: process.platform === "darwin" && nativeTheme.shouldUseDarkColors,
    });
    const iconPath =
      desktopRuntime.desktopFlavor === "development"
        ? Path.resolve(
            import.meta.dirname,
            "../../../assets/dev",
            process.platform === "win32"
              ? "blueprint-windows.ico"
              : process.platform === "darwin"
                ? "blueprint-macos-1024.png"
                : "blueprint-universal-1024.png",
          )
        : desktopRuntime.resolveResourcePath(resourceName);
    if (!iconPath) return;

    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;

    if (process.platform === "darwin") {
      app.dock?.setIcon(image);
      await syncMacAppBundleIcon(icon, image);
      return;
    }
    if (process.platform === "win32") {
      let shellIconPath = iconPath;
      try {
        shellIconPath = materializeWindowsShellIcon(icon, iconPath);
      } catch (error) {
        console.warn(
          `[desktop] Failed to materialize Windows taskbar icon: ${desktopRuntime.formatErrorMessage(error)}`,
        );
      }
      let matchedShortcuts: string[] = [];
      try {
        matchedShortcuts = syncWindowsTaskbarShortcuts(shellIconPath);
      } catch (error) {
        console.warn(
          `[desktop] Failed to sync Windows shortcut icons: ${desktopRuntime.formatErrorMessage(error)}`,
        );
      }
      let hwnd: bigint | null = null;
      try {
        const handle = window?.getNativeWindowHandle();
        if (handle) hwnd = nativeWindowHandleToHwnd(handle);
      } catch {
        hwnd = null;
      }
      // Never block window creation/show on Explorer COM. The helper used to wait on a synchronous window
      // icon message while Electron waited in spawnSync — deadlock, no window. Stamp properties on the
      // next turn.
      try {
        applyWindowsTaskbarIcon({
          window,
          iconPath: shellIconPath,
          identity: {
            appId: desktopRuntime.APP_USER_MODEL_ID,
            relaunchCommand: `"${process.execPath}"`,
            relaunchDisplayName: desktopRuntime.APP_DISPLAY_NAME,
          },
          reregisterTaskbarButton: false,
        });
      } catch (error) {
        console.warn(
          `[desktop] Failed to apply Windows taskbar icon: ${desktopRuntime.formatErrorMessage(error)}`,
        );
        try {
          window?.setIcon(shellIconPath);
        } catch (iconError) {
          console.warn(
            `[desktop] Failed to set Windows window icon: ${desktopRuntime.formatErrorMessage(iconError)}`,
          );
        }
      }

      await queueWindowsShellAppUserModelStamp(
        {
          appId: desktopRuntime.APP_USER_MODEL_ID,
          iconPath: shellIconPath,
          relaunchCommand: `"${process.execPath}"`,
          displayName: desktopRuntime.APP_DISPLAY_NAME,
          shortcutPaths: matchedShortcuts,
          hwnd,
        },
        {
          flush: options?.flushShellIconCache === true,
          immediate: options?.flushShellIconCache === true,
        },
      );
      return;
    }
    window?.setIcon(image);
  }

  function applyInitialMacDockIcon(): void {
    if (process.platform !== "darwin" || !app.dock) {
      return;
    }
    void applyPersistedDesktopAppIcon().catch((error) => {
      console.warn("[desktop] Failed to persist the macOS app icon", error);
    });
  }

  function registerMacAppearanceIconSync(): void {
    if (process.platform !== "darwin") {
      return;
    }

    nativeTheme.on("updated", () => {
      void applyPersistedDesktopAppIcon().catch((error) => {
        console.warn("[desktop] Failed to persist the macOS app icon", error);
      });
    });
  }

  function readLaunchVersionRecordContents(): string | null {
    try {
      return FS.readFileSync(resolveLaunchVersionRecordPath(app.getPath("userData")), "utf8");
    } catch {
      return null;
    }
  }

  function persistLastLaunchVersion(version: string): void {
    const recordPath = resolveLaunchVersionRecordPath(app.getPath("userData"));
    try {
      FS.mkdirSync(Path.dirname(recordPath), { recursive: true });
      FS.writeFileSync(recordPath, serializeLaunchVersionRecord(version));
    } catch (error) {
      console.warn("[desktop] Failed to persist last launch version", error);
    }
  }

  function refreshMacIconCacheOnVersionChange(): void {
    if (process.platform !== "darwin" || !app.isPackaged) {
      return;
    }

    const currentVersion = app.getVersion();
    const previousVersion = parseLastLaunchVersion(readLaunchVersionRecordContents());
    if (!shouldRefreshIconCache(previousVersion, currentVersion)) {
      return;
    }

    persistLastLaunchVersion(currentVersion);

    const bundlePath = resolveMacAppBundlePath(process.execPath, process.platform);
    if (!bundlePath || !FS.existsSync(LSREGISTER_PATH)) {
      return;
    }

    try {
      const now = new Date();
      FS.utimesSync(bundlePath, now, now);
    } catch {}

    const child = ChildProcess.spawn(LSREGISTER_PATH, ["-f", bundlePath], { stdio: "ignore" });
    child.unref();
    child.once("error", (error) => {
      console.warn("[desktop] Failed to refresh macOS icon cache after update", error);
    });
    child.once("exit", (code) => {
      console.info(
        `[desktop] Refreshed macOS icon registration after update ${previousVersion ?? "(none)"} -> ${currentVersion} (lsregister exit ${code ?? "unknown"}).`,
      );
    });
  }
  return {
    resolveUserDataPath,
    repairBrowserProfileBeforeElectronReady,
    configureAppIdentity,
    readDesktopAppIcon,
    persistDesktopAppIcon,
    materializeWindowsShellIcon,
    applyDesktopAppIcon,
    applyPersistedDesktopAppIcon,
    applyInitialMacDockIcon,
    registerMacAppearanceIconSync,
    refreshMacIconCacheOnVersionChange,
  };
}
