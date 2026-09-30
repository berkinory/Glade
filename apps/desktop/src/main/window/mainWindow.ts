import { getMacTrafficLightPosition } from "@glade/shared/platform/desktopChrome";
import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from "electron";
import { BrowserWindow, Menu, nativeTheme, screen, shell } from "electron";
import * as Path from "node:path";
import { shouldDeferDesktopWindowClose } from "../../backend/backendShutdown";
import { hardenBrowserAnnotationWebviewPreferences } from "../../browser/annotations/webviewSecurity";
import { BROWSER_SESSION_PARTITION } from "../../browser/browserSessionPolicy";

import { type DesktopRuntime } from "../desktopRuntimeTypes";
import { desktopAppIconResourceName } from "./desktopAppIcon";
import {
  readCustomTitleBarPreference,
  resolveDesktopCustomTitleBarState,
  resolveDesktopTitleBarFrameOptions,
} from "./desktopCustomTitleBar";
import {
  readDesktopWindowState,
  resolveVisibleWindowBounds,
  writeDesktopWindowState,
} from "./windowState";

export function createMainWindow(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "mainWindow"
    | "IPC"
    | "readDesktopAppIcon"
    | "desktopFlavor"
    | "resolveResourcePath"
    | "materializeWindowsShellIcon"
    | "formatErrorMessage"
    | "DESKTOP_CUSTOM_TITLE_BAR_PATH"
    | "customTitleBarActive"
    | "DESKTOP_WINDOW_STATE_PATH"
    | "MIN_DESKTOP_WINDOW_WIDTH"
    | "MIN_DESKTOP_WINDOW_HEIGHT"
    | "APP_DISPLAY_NAME"
    | "browserManager"
    | "attachDesktopZoomFactorSync"
    | "attachRendererCrashRecovery"
    | "attachDesktopPhysicalZoomShortcuts"
    | "annotationGuestPreload"
    | "getSafeExternalUrl"
    | "emitUpdateState"
    | "applyPersistedDesktopAppIcon"
    | "desktopShutdownComplete"
    | "isUpdaterQuitAndInstallInFlight"
    | "confirmRunningChatsThenQuit"
    | "isDevelopment"
    | "desktopIdentity"
    | "runningChatsQuitGuard"
  >,
) {
  function getDesktopWindowState(window: BrowserWindow): {
    isMaximized: boolean;
    isFullscreen: boolean;
  } {
    return {
      isMaximized: window.isMaximized(),
      isFullscreen: window.isFullScreen(),
    };
  }

  function emitDesktopWindowState(window: BrowserWindow | null = desktopRuntime.mainWindow): void {
    if (!window || window.isDestroyed()) return;
    window.webContents.send(desktopRuntime.IPC.windowState, getDesktopWindowState(window));
  }

  function getIconOption(): { icon: string } | Record<string, never> {
    if (process.platform === "darwin") return {};
    if (process.platform !== "linux" && process.platform !== "win32") return {};
    const icon = desktopRuntime.readDesktopAppIcon();
    const resourceName = desktopAppIconResourceName({
      icon,
      platform: process.platform,
      isDarkAppearance: false,
    });
    const iconPath =
      desktopRuntime.desktopFlavor === "development"
        ? Path.resolve(
            import.meta.dirname,
            "../../../assets/dev",
            process.platform === "win32" ? "blueprint-windows.ico" : "blueprint-universal-1024.png",
          )
        : desktopRuntime.resolveResourcePath(resourceName);
    if (!iconPath) return {};
    if (process.platform !== "win32") return { icon: iconPath };
    try {
      return { icon: desktopRuntime.materializeWindowsShellIcon(icon, iconPath) };
    } catch (error) {
      console.warn(
        `[desktop] Failed to materialize Windows window icon: ${desktopRuntime.formatErrorMessage(error)}`,
      );
      return { icon: iconPath };
    }
  }

  function getWindowMaterialOptions(): BrowserWindowConstructorOptions {
    if (process.platform !== "darwin") {
      return { backgroundColor: nativeTheme.shouldUseDarkColors ? "#181818" : "#ffffff" };
    }
    return {
      vibrancy: "under-window",

      visualEffectState: "followWindow",
      backgroundColor: "#00000000",
    };
  }

  function getTitleBarOptions(): BrowserWindowConstructorOptions {
    if (process.platform === "darwin") {
      return {
        titleBarStyle: "hiddenInset",

        trafficLightPosition: getMacTrafficLightPosition(),
      };
    }
    const preference = readCustomTitleBarPreference(desktopRuntime.DESKTOP_CUSTOM_TITLE_BAR_PATH);
    const frameOptions = resolveDesktopTitleBarFrameOptions({
      platform: process.platform,
      preference,
    });
    desktopRuntime.customTitleBarActive = "frame" in frameOptions && frameOptions.frame === false;
    return frameOptions;
  }

  function getDesktopCustomTitleBarState() {
    return resolveDesktopCustomTitleBarState({
      platform: process.platform,
      preference: readCustomTitleBarPreference(desktopRuntime.DESKTOP_CUSTOM_TITLE_BAR_PATH),
      active: desktopRuntime.customTitleBarActive,
    });
  }

  function createWindow(): BrowserWindow {
    const savedWindowState = readDesktopWindowState(desktopRuntime.DESKTOP_WINDOW_STATE_PATH);
    const primaryDisplay = screen.getPrimaryDisplay();
    const restoredBounds = savedWindowState
      ? resolveVisibleWindowBounds({
          savedBounds: savedWindowState.bounds,
          displayWorkAreas: [
            primaryDisplay.workArea,
            ...screen
              .getAllDisplays()
              .filter((display) => display.id !== primaryDisplay.id)
              .map((display) => display.workArea),
          ],
          minimumWidth: desktopRuntime.MIN_DESKTOP_WINDOW_WIDTH,
          minimumHeight: desktopRuntime.MIN_DESKTOP_WINDOW_HEIGHT,
        })
      : { width: 1100, height: 780 };
    const window = new BrowserWindow({
      ...restoredBounds,
      minWidth: desktopRuntime.MIN_DESKTOP_WINDOW_WIDTH,
      minHeight: desktopRuntime.MIN_DESKTOP_WINDOW_HEIGHT,
      show: false,
      autoHideMenuBar: true,
      ...getIconOption(),
      title: desktopRuntime.APP_DISPLAY_NAME,
      ...getTitleBarOptions(),
      ...getWindowMaterialOptions(),
      webPreferences: {
        preload: Path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,

        backgroundThrottling: true,
      },
    });
    desktopRuntime.browserManager.setWindow(window);
    desktopRuntime.attachDesktopZoomFactorSync(window);
    desktopRuntime.attachRendererCrashRecovery(window);
    desktopRuntime.attachDesktopPhysicalZoomShortcuts(window);

    window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
      const partition = params.partition;
      if (
        partition === undefined ||
        !hardenBrowserAnnotationWebviewPreferences({
          partition,
          expectedPartition: BROWSER_SESSION_PARTITION,
          preloadPath: desktopRuntime.annotationGuestPreload,
          webPreferences,
        })
      ) {
        event.preventDefault();
      }
    });

    window.webContents.on("context-menu", (event, params) => {
      event.preventDefault();

      const menuTemplate: MenuItemConstructorOptions[] = [];

      if (params.misspelledWord) {
        for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
          menuTemplate.push({
            label: suggestion,
            click: () => window.webContents.replaceMisspelling(suggestion),
          });
        }
        if (params.dictionarySuggestions.length === 0) {
          menuTemplate.push({ label: "No suggestions", enabled: false });
        }
        menuTemplate.push({ type: "separator" });
      }

      if (params.mediaType === "image") {
        menuTemplate.push({
          label: "Copy Image",
          click: () => window.webContents.copyImageAt(params.x, params.y),
        });
        menuTemplate.push({ type: "separator" });
      }

      menuTemplate.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );

      Menu.buildFromTemplate(menuTemplate).popup({ window });
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      const externalUrl = desktopRuntime.getSafeExternalUrl(url);
      if (externalUrl) {
        void shell.openExternal(externalUrl);
      }
      return { action: "deny" };
    });

    window.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle(desktopRuntime.APP_DISPLAY_NAME);
    });
    window.webContents.on("did-finish-load", () => {
      window.setTitle(desktopRuntime.APP_DISPLAY_NAME);
      desktopRuntime.emitUpdateState();
    });
    window.once("ready-to-show", () => {
      if (!savedWindowState || savedWindowState.isMaximized) {
        window.maximize();
      }
      window.show();
      if (process.platform === "win32") {
        void desktopRuntime.applyPersistedDesktopAppIcon(window);
      }
      emitDesktopWindowState(window);
    });

    window.on("maximize", () => emitDesktopWindowState(window));
    window.on("unmaximize", () => emitDesktopWindowState(window));
    window.on("enter-full-screen", () => emitDesktopWindowState(window));
    window.on("leave-full-screen", () => emitDesktopWindowState(window));
    window.on("close", (event) => {
      try {
        writeDesktopWindowState(desktopRuntime.DESKTOP_WINDOW_STATE_PATH, {
          version: 1,
          bounds: window.getNormalBounds(),
          isMaximized: window.isMaximized(),
        });
      } catch (error) {
        console.warn(
          `[desktop] Failed to persist window state: ${desktopRuntime.formatErrorMessage(error)}`,
        );
      }

      if (
        shouldDeferDesktopWindowClose({
          platform: process.platform,
          shutdownComplete: desktopRuntime.desktopShutdownComplete,
          updaterHandoffActive: desktopRuntime.isUpdaterQuitAndInstallInFlight,
        })
      ) {
        event.preventDefault();
        void desktopRuntime.confirmRunningChatsThenQuit("window-close");
        return;
      }

      if (
        process.platform === "linux" &&
        !desktopRuntime.desktopShutdownComplete &&
        !desktopRuntime.isUpdaterQuitAndInstallInFlight
      ) {
        event.preventDefault();
        void desktopRuntime.confirmRunningChatsThenQuit("window-close");
      }
    });

    if (desktopRuntime.isDevelopment) {
      void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
      window.webContents.openDevTools({ mode: "detach" });
    } else {
      void window.loadURL(desktopRuntime.desktopIdentity.entryUrl);
    }

    if (process.platform === "linux" || process.platform === "win32") {
      try {
        void desktopRuntime.applyPersistedDesktopAppIcon(window, {
          reregisterTaskbarButton: false,
        });
      } catch (error) {
        console.warn(
          `[desktop] Failed to apply startup app icon: ${desktopRuntime.formatErrorMessage(error)}`,
        );
      }
    }

    window.on("closed", () => {
      desktopRuntime.runningChatsQuitGuard.cancelPending();
      if (desktopRuntime.mainWindow === window) {
        desktopRuntime.mainWindow = null;
      }
      desktopRuntime.browserManager.setWindow(null);
    });

    return window;
  }
  return { getDesktopWindowState, getDesktopCustomTitleBarState, createWindow };
}
