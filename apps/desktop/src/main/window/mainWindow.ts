import type { DesktopAppIcon, DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { getMacTrafficLightPosition } from "@glade/shared/platform/desktopChrome";
import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from "electron";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
} from "electron";
import * as Path from "node:path";
import { shouldDeferDesktopWindowClose } from "../../backend/backendShutdown";
import {
  APP_DISPLAY_NAME,
  CONTEXT_MENU_ICON_DATA_URL_PREFIX,
  CONTEXT_MENU_ICON_MAX_DATA_URL_LENGTH,
  DESKTOP_CUSTOM_TITLE_BAR_PATH,
  DESKTOP_LOG_FILE_NAME,
  DESKTOP_MENU_MAX_ZOOM_FACTOR,
  DESKTOP_MENU_MIN_ZOOM_FACTOR,
  DESKTOP_MENU_ZOOM_FACTOR_STEP,
  DESKTOP_WINDOW_STATE_PATH,
  desktopFlavor,
  desktopIdentity,
  isDevelopment,
  LOG_DIR,
  MIN_DESKTOP_WINDOW_HEIGHT,
  MIN_DESKTOP_WINDOW_WIDTH,
} from "../desktopEnvironment";
import { DESKTOP_IPC_CHANNELS } from "../ipc/ipcChannels";
import { getSafeExternalUrl } from "../ipc/ipcValidation";
import type { DesktopLog } from "../lifecycle/desktopLogging";
import { formatErrorMessage, safeConsoleError } from "../lifecycle/desktopLogging";
import {
  RENDERER_MAX_AUTOMATIC_RELOADS,
  RendererCrashPolicy,
  type RendererCrashResponse,
} from "../lifecycle/rendererCrashRecovery";
import { getAutoUpdateDisabledReason } from "../updates/updateState";
import { desktopAppIconResourceName } from "./desktopAppIcon";
import {
  readCustomTitleBarPreference,
  resolveDesktopCustomTitleBarState,
  resolveDesktopTitleBarFrameOptions,
} from "./desktopCustomTitleBar";
import {
  applyDesktopPhysicalZoomAction,
  resolveDesktopMenuAccelerator,
  resolveDesktopPhysicalZoomAction,
  resolveDesktopZoomShortcutAction,
  resolveKeyboardShortcutsMenuAccelerator,
  shouldUseNativeZoomMenuRoles,
} from "./menuShortcuts";
import {
  readDesktopWindowState,
  resolveVisibleWindowBounds,
  writeDesktopWindowState,
} from "./windowState";
import { createDesktopMenuShortcuts } from "./desktopMenuShortcuts";
import { windowMaterialOptions, readWindowMaterialState } from "./desktopWindowMaterial";

interface WindowIdentity {
  readDesktopAppIcon(): DesktopAppIcon;
  materializeWindowsShellIcon(icon: DesktopAppIcon, sourcePath: string): string;
  applyPersistedDesktopAppIcon(
    window?: BrowserWindow | null,
    options?: { reregisterTaskbarButton?: boolean; flushShellIconCache?: boolean },
  ): Promise<void>;
}
interface WindowResources {
  readAppUpdateYml(): Record<string, string> | null;
  resolveResourcePath(filename: string): string | null;
  resolveNotificationIconPath(): string | null;
}

interface WindowUpdates {
  check(reason: string): Promise<void>;
  getState(): DesktopUpdateState;
  emitState(): void;
  isInstallHandoff(): boolean;
}
interface WindowLifecycle {
  shutdownComplete(): boolean;
  isQuitting(): boolean;
  confirmRunningChatsThenQuit(reason: string): Promise<void>;
  requestGracefulAppQuit(reason: string): void;
  cancelPending(): void;
  rendererGone(): Promise<boolean> | null;
}
export interface WindowDependencies {
  identity: WindowIdentity;
  resources: WindowResources;
  updates: WindowUpdates;
  lifecycle: WindowLifecycle;
  log: DesktopLog;
  openDesktopLogDirectory(): Promise<void>;
}
export function createMainWindow({
  identity,
  resources,
  updates,
  lifecycle,
  log,
  openDesktopLogDirectory,
}: WindowDependencies) {
  const menuShortcuts = createDesktopMenuShortcuts(process.platform, configureApplicationMenu);
  let mainWindow: BrowserWindow | null = null;
  let customTitleBarActive = false;
  let unreadBackgroundNotificationCount = 0;
  const retainedNotifications = new Set<Notification>();
  app.once("will-quit", () => {
    for (const notification of retainedNotifications) {
      notification.removeAllListeners();
      notification.close();
    }
    retainedNotifications.clear();
  });
  const rendererCrashPolicy = new RendererCrashPolicy();
  let rendererCrashDialogInFlight: Promise<void> | null = null;
  function getDesktopWindowState(window: BrowserWindow): {
    isMaximized: boolean;
    isFullscreen: boolean;
  } {
    return {
      isMaximized: window.isMaximized(),
      isFullscreen: window.isFullScreen(),
    };
  }

  function emitDesktopWindowState(window: BrowserWindow | null = mainWindow): void {
    if (!window || window.isDestroyed()) return;
    window.webContents.send(DESKTOP_IPC_CHANNELS.windowState, getDesktopWindowState(window));
  }

  function getIconOption(): { icon: string } | Record<string, never> {
    if (process.platform === "darwin") return {};
    if (process.platform !== "linux" && process.platform !== "win32") return {};
    const icon = identity.readDesktopAppIcon();
    const resourceName = desktopAppIconResourceName({
      icon,
      platform: process.platform,
    });
    const iconPath =
      desktopFlavor === "development"
        ? Path.resolve(
            import.meta.dirname,
            "../../../assets/dev",
            process.platform === "win32" ? "blueprint-windows.ico" : "blueprint-universal-1024.png",
          )
        : resources.resolveResourcePath(resourceName);
    if (!iconPath) return {};
    if (process.platform !== "win32") return { icon: iconPath };
    try {
      return { icon: identity.materializeWindowsShellIcon(icon, iconPath) };
    } catch (error) {
      console.warn(
        `[desktop] Failed to materialize Windows window icon: ${formatErrorMessage(error)}`,
      );
      return { icon: iconPath };
    }
  }

  function getWindowMaterialOptions(): BrowserWindowConstructorOptions {
    return windowMaterialOptions(readWindowMaterialState().enabled);
  }

  function getTitleBarOptions(): BrowserWindowConstructorOptions {
    if (process.platform === "darwin") {
      return {
        titleBarStyle: "hiddenInset",

        trafficLightPosition: getMacTrafficLightPosition(),
      };
    }
    const preference = readCustomTitleBarPreference(DESKTOP_CUSTOM_TITLE_BAR_PATH);
    const frameOptions = resolveDesktopTitleBarFrameOptions({
      platform: process.platform,
      preference,
    });
    customTitleBarActive = "frame" in frameOptions && frameOptions.frame === false;
    return frameOptions;
  }

  function getDesktopCustomTitleBarState() {
    return resolveDesktopCustomTitleBarState({
      platform: process.platform,
      preference: readCustomTitleBarPreference(DESKTOP_CUSTOM_TITLE_BAR_PATH),
      active: customTitleBarActive,
    });
  }

  function createWindow(): BrowserWindow {
    const savedWindowState = readDesktopWindowState(DESKTOP_WINDOW_STATE_PATH);
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
          minimumWidth: MIN_DESKTOP_WINDOW_WIDTH,
          minimumHeight: MIN_DESKTOP_WINDOW_HEIGHT,
        })
      : { width: 1100, height: 780 };
    const window = new BrowserWindow({
      ...restoredBounds,
      minWidth: MIN_DESKTOP_WINDOW_WIDTH,
      minHeight: MIN_DESKTOP_WINDOW_HEIGHT,
      show: false,
      autoHideMenuBar: true,
      ...getIconOption(),
      title: APP_DISPLAY_NAME,
      ...getTitleBarOptions(),
      ...getWindowMaterialOptions(),
      webPreferences: {
        preload: Path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true,
      },
    });
    attachDesktopZoomFactorSync(window);
    attachRendererCrashRecovery(window);
    attachDesktopPhysicalZoomShortcuts(window);

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

    // Generated srcdoc visuals may run scripts, but cannot navigate into the authenticated app
    // or issue navigation requests outside their opaque sandbox.
    window.webContents.on("will-frame-navigate", (event) => {
      if (!event.isMainFrame && event.frame?.url.startsWith("about:srcdoc")) event.preventDefault();
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      const externalUrl = getSafeExternalUrl(url);
      if (externalUrl) {
        void shell.openExternal(externalUrl);
      }
      return { action: "deny" };
    });

    window.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle(APP_DISPLAY_NAME);
    });
    window.webContents.on("did-finish-load", () => {
      window.setTitle(APP_DISPLAY_NAME);
      updates.emitState();
    });
    window.once("ready-to-show", () => {
      if (!savedWindowState || savedWindowState.isMaximized) {
        window.maximize();
      }
      window.show();
      if (process.platform === "win32") {
        void identity.applyPersistedDesktopAppIcon(window);
      }
      emitDesktopWindowState(window);
    });

    window.on("maximize", () => emitDesktopWindowState(window));
    window.on("unmaximize", () => emitDesktopWindowState(window));
    window.on("enter-full-screen", () => emitDesktopWindowState(window));
    window.on("leave-full-screen", () => emitDesktopWindowState(window));
    window.on("close", (event) => {
      try {
        writeDesktopWindowState(DESKTOP_WINDOW_STATE_PATH, {
          version: 1,
          bounds: window.getNormalBounds(),
          isMaximized: window.isMaximized(),
        });
      } catch (error) {
        console.warn(`[desktop] Failed to persist window state: ${formatErrorMessage(error)}`);
      }

      if (
        shouldDeferDesktopWindowClose({
          platform: process.platform,
          shutdownComplete: lifecycle.shutdownComplete(),
          updaterHandoffActive: updates.isInstallHandoff(),
        })
      ) {
        event.preventDefault();
        void lifecycle.confirmRunningChatsThenQuit("window-close");
        return;
      }

      if (
        process.platform === "linux" &&
        !lifecycle.shutdownComplete() &&
        !updates.isInstallHandoff()
      ) {
        event.preventDefault();
        void lifecycle.confirmRunningChatsThenQuit("window-close");
      }
    });

    if (isDevelopment) {
      void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    } else {
      void window.loadURL(desktopIdentity.entryUrl);
    }

    if (process.platform === "linux" || process.platform === "win32") {
      try {
        void identity.applyPersistedDesktopAppIcon(window, {
          reregisterTaskbarButton: false,
        });
      } catch (error) {
        console.warn(`[desktop] Failed to apply startup app icon: ${formatErrorMessage(error)}`);
      }
    }

    window.on("closed", () => {
      lifecycle.cancelPending();
      menuShortcuts.reset();
      if (mainWindow === window) {
        mainWindow = null;
      }
    });

    mainWindow = window;
    return window;
  }

  function syncUnreadNotificationBadge(): void {
    app.setBadgeCount(unreadBackgroundNotificationCount);
  }

  function isMainWindowForeground(window: BrowserWindow | null): boolean {
    if (!window || window.isDestroyed()) {
      return false;
    }
    return window.isVisible() && !window.isMinimized() && window.isFocused();
  }

  function incrementUnreadNotificationBadge(): void {
    unreadBackgroundNotificationCount = Math.min(unreadBackgroundNotificationCount + 1, 99);
    syncUnreadNotificationBadge();
  }

  function clearUnreadNotificationBadge(): void {
    if (unreadBackgroundNotificationCount === 0) {
      return;
    }
    unreadBackgroundNotificationCount = 0;
    syncUnreadNotificationBadge();
  }

  function focusMainWindow(options: { stealAppFocus?: boolean } = {}): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = null;
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (process.platform === "darwin" && options.stealAppFocus === true) {
      app.show();
      app.focus({ steal: true });
    }
    mainWindow.focus();
  }

  function showDesktopNotification(input: {
    title: string;
    body?: string;
    silent?: boolean;
    suppressWhenForeground?: boolean;
    threadId?: string;
  }): boolean {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const body = typeof input.body === "string" ? input.body.trim() : "";
    const threadId = typeof input.threadId === "string" ? input.threadId.trim() : "";
    if (title.length === 0 || !Notification.isSupported()) {
      return false;
    }
    if (input.suppressWhenForeground === true && isMainWindowForeground(mainWindow)) {
      return false;
    }

    const iconPath = resources.resolveNotificationIconPath();
    const notification = new Notification({
      title,
      body,
      silent: input.silent === true,
      ...(iconPath ? { icon: iconPath } : {}),
    });
    if (!isMainWindowForeground(mainWindow)) {
      incrementUnreadNotificationBadge();
    }

    const release = () => {
      retainedNotifications.delete(notification);
      notification.removeAllListeners();
    };
    retainedNotifications.add(notification);
    while (retainedNotifications.size > 128) {
      const oldest = retainedNotifications.values().next().value;
      if (!oldest) break;
      retainedNotifications.delete(oldest);
      oldest.removeAllListeners();
      oldest.close();
    }
    notification.once("failed", release);
    notification.on("close", () => {
      if (process.platform !== "win32") release();
    });
    notification.on("click", () => {
      release();
      clearUnreadNotificationBadge();
      focusMainWindow();
      if (!mainWindow) {
        return;
      }
      if (threadId.length > 0) {
        mainWindow.webContents.send(
          DESKTOP_IPC_CHANNELS.menuAction,
          `notification-open-thread:${threadId}`,
        );
      }
    });

    notification.show();
    return true;
  }

  function attachRendererCrashRecovery(window: BrowserWindow): void {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const clearReloadTimer = (): void => {
      if (reloadTimer === null) return;
      clearTimeout(reloadTimer);
      reloadTimer = null;
    };

    const recoverFromRendererCrash = (reason: string): void => {
      const response = rendererCrashPolicy.respondToCrash({
        reason,
        quitting: lifecycle.isQuitting(),
        nowMs: Date.now(),
      });

      switch (response.kind) {
        case "ignore":
          return;
        case "reload":
          log.writeDesktopLogHeader(
            `renderer reload scheduled attempt=${response.attempt}/${RENDERER_MAX_AUTOMATIC_RELOADS} delayMs=${response.delayMs}`,
          );
          clearReloadTimer();
          reloadTimer = setTimeout(() => {
            reloadTimer = null;
            if (lifecycle.isQuitting() || window.isDestroyed()) return;
            window.webContents.reload();
          }, response.delayMs);
          return;
        case "prompt":
          log.writeDesktopLogHeader(
            `renderer recovery prompt cause=${response.cause} crashes=${response.crashes}`,
          );
          presentRendererCrashRecovery(window, reason, response);
          return;
      }
    };

    window.webContents.on("render-process-gone", (_event, details) => {
      const description = `reason=${details.reason} exitCode=${details.exitCode}`;
      log.writeDesktopLogHeader(`renderer process gone ${description}`);
      safeConsoleError(`[desktop] renderer process gone (${description})`);

      // A renderer that dies while hosting the quit ask can never answer it, so the ask moves to a
      // native confirmation. Recovery waits for that decision; a declined quit must not leave a dead UI.
      const pendingQuitDecision = lifecycle.rendererGone();
      if (pendingQuitDecision === null) {
        recoverFromRendererCrash(details.reason);
        return;
      }
      void pendingQuitDecision.then((allowed) => {
        if (!allowed) recoverFromRendererCrash(details.reason);
      });
    });

    // A hung renderer is not a crash — Chromium keeps the process alive — so it never reaches the
    // listener above. Logging both edges makes a freeze that the user reports as "the app died"
    // distinguishable from an actual crash in the same log.
    window.webContents.on("unresponsive", () => {
      log.writeDesktopLogHeader("renderer unresponsive");
    });
    window.webContents.on("responsive", () => {
      log.writeDesktopLogHeader("renderer responsive");
    });

    window.webContents.on("did-start-loading", () => {
      lifecycle.cancelPending();
    });

    window.on("closed", clearReloadTimer);
  }

  function presentRendererCrashRecovery(
    window: BrowserWindow,
    reason: string,
    response: Extract<RendererCrashResponse, { kind: "prompt" }>,
  ): void {
    if (lifecycle.isQuitting() || rendererCrashDialogInFlight) return;

    const message =
      response.cause === "reload-budget-exhausted"
        ? `Glade's window crashed ${response.crashes} times in a row.`
        : "Glade's window stopped unexpectedly.";
    const detail = [
      `The window's renderer process exited (${reason}).`,
      response.cause === "reload-budget-exhausted"
        ? "Glade paused automatic reloads so a repeating crash can't keep reloading in the background."
        : "This exit reason repeats on reload, so Glade did not retry automatically.",
      `Log file:\n${Path.join(LOG_DIR, DESKTOP_LOG_FILE_NAME)}`,
    ].join("\n\n");

    const task = (async () => {
      for (;;) {
        const result = await dialog.showMessageBox({
          type: "error",
          title: "Glade's window stopped",
          message,
          detail,
          buttons: ["Reload", "Open logs", "Quit"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });

        if (result.response === 1) {
          await openDesktopLogDirectory();
          continue;
        }

        if (result.response === 0) {
          rendererCrashPolicy.reset();
          if (!window.isDestroyed()) {
            window.webContents.reload();
          }
          return;
        }

        lifecycle.requestGracefulAppQuit("renderer crashed");
        return;
      }
    })().finally(() => {
      if (rendererCrashDialogInFlight === task) {
        rendererCrashDialogInFlight = null;
      }
    });
    rendererCrashDialogInFlight = task;
  }

  function dispatchMenuAction(action: string): void {
    const existingWindow =
      BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
    const targetWindow = existingWindow ?? createWindow();

    const send = () => {
      if (targetWindow.isDestroyed()) return;
      targetWindow.webContents.send(DESKTOP_IPC_CHANNELS.menuAction, action);
      if (!targetWindow.isVisible()) {
        targetWindow.show();
      }
      targetWindow.focus();
    };

    if (targetWindow.webContents.isLoadingMainFrame()) {
      targetWindow.webContents.once("did-finish-load", send);
      return;
    }

    send();
  }

  function resolveMenuTargetWindow(): BrowserWindow | null {
    return (
      BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null
    );
  }

  function sendDesktopZoomFactor(webContents: Electron.WebContents): void {
    if (webContents.isDestroyed()) return;
    webContents.send(DESKTOP_IPC_CHANNELS.zoomFactorChanged, webContents.getZoomFactor());
  }

  function attachDesktopZoomFactorSync(window: BrowserWindow): void {
    const notify = () => sendDesktopZoomFactor(window.webContents);
    window.webContents.on("zoom-changed", notify);
    window.webContents.on("did-finish-load", notify);
  }

  // Programmatic zoom emits no zoom-changed event, so the renderer's cached factor is pushed here.
  function setWebContentsZoomFactor(webContents: Electron.WebContents, zoomFactor: number): void {
    webContents.setZoomFactor(zoomFactor);
    sendDesktopZoomFactor(webContents);
  }

  function adjustWebContentsZoom(webContents: Electron.WebContents, multiplier: number): void {
    const nextZoomFactor = Math.min(
      DESKTOP_MENU_MAX_ZOOM_FACTOR,
      Math.max(DESKTOP_MENU_MIN_ZOOM_FACTOR, webContents.getZoomFactor() * multiplier),
    );
    setWebContentsZoomFactor(webContents, nextZoomFactor);
  }

  function handleDesktopPhysicalZoomShortcut(
    event: Electron.Event,
    input: Electron.Input,
    target: Electron.WebContents,
  ): boolean {
    const action = resolveDesktopPhysicalZoomAction(process.platform, input);
    if (!action || target.isDestroyed()) {
      return false;
    }

    event.preventDefault();
    applyDesktopPhysicalZoomAction(target, action);
    sendDesktopZoomFactor(target);
    return true;
  }

  function attachDesktopPhysicalZoomShortcuts(window: BrowserWindow): void {
    window.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) menuShortcuts.reset();
    });
    window.webContents.on("before-input-event", (event, input) => {
      // The renderer owns configurable commands, focus guards and recording. Native menu clicks
      // remain available, but their accelerator must not execute the same keydown a second time.
      window.webContents.setIgnoreMenuShortcuts(menuShortcuts.shouldIgnoreNativeShortcut(input));
      if (menuShortcuts.isCapturing()) return;
      if (handleDesktopPhysicalZoomShortcut(event, input, window.webContents)) return;
      handleDesktopZoomShortcut(event, input, window.webContents);
    });
  }

  function handleDesktopZoomShortcut(
    event: Electron.Event,
    input: Electron.Input,
    target: Electron.WebContents,
  ): boolean {
    const action = resolveDesktopZoomShortcutAction(process.platform, input);
    if (!action || target.isDestroyed()) {
      return false;
    }

    event.preventDefault();
    if (action === "resetZoom") {
      setWebContentsZoomFactor(target, 1);
    } else {
      adjustWebContentsZoom(
        target,
        action === "zoomIn" ? DESKTOP_MENU_ZOOM_FACTOR_STEP : 1 / DESKTOP_MENU_ZOOM_FACTOR_STEP,
      );
    }
    return true;
  }

  function resetWindowZoomFromMenu(): void {
    const webContents = resolveMenuTargetWindow()?.webContents;
    if (webContents) setWebContentsZoomFactor(webContents, 1);
  }

  function adjustWindowZoomFromMenu(multiplier: number): void {
    const webContents = resolveMenuTargetWindow()?.webContents;
    if (!webContents) return;
    adjustWebContentsZoom(webContents, multiplier);
  }

  function hasConfiguredUpdateFeed(): boolean {
    return resources.readAppUpdateYml() !== null || Boolean(process.env.GLADE_DESKTOP_MOCK_UPDATES);
  }

  function resolveAutoUpdateDisabledReason(): string | null {
    return getAutoUpdateDisabledReason({
      isDevelopment: isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv:
        desktopIdentity.usesScriptedUpdates || process.env.GLADE_DISABLE_AUTO_UPDATE === "1",
      hasUpdateFeedConfig: hasConfiguredUpdateFeed(),
    });
  }

  function handleCheckForUpdatesMenuClick(): void {
    const disabledReason = resolveAutoUpdateDisabledReason();
    if (disabledReason) {
      console.info("[desktop-updater] Manual update check requested, but updates are disabled.");
      void dialog.showMessageBox({
        type: "info",
        title: "Updates unavailable",
        message: "Automatic updates are not available right now.",
        detail: disabledReason,
        buttons: ["OK"],
      });
      return;
    }

    if (!BrowserWindow.getAllWindows().length) {
      createWindow();
    }
    void checkForUpdatesFromMenu();
  }

  async function checkForUpdatesFromMenu(): Promise<void> {
    await updates.check("menu");

    if (updates.getState().status === "up-to-date") {
      void dialog.showMessageBox({
        type: "info",
        title: "You're up to date!",
        message: `Glade ${updates.getState().currentVersion} is currently the newest version available.`,
        buttons: ["OK"],
      });
    } else if (
      updates.getState().status === "downloading" ||
      updates.getState().status === "available"
    ) {
      void dialog.showMessageBox({
        type: "info",
        title: "Update found",
        message: "Glade is preparing the update in the background.",
        buttons: ["OK"],
      });
    } else if (updates.getState().status === "downloaded") {
      void dialog.showMessageBox({
        type: "info",
        title: "Update ready",
        message: "Click Update in the sidebar when you’re ready to restart and install it.",
        buttons: ["OK"],
      });
    } else if (updates.getState().status === "error") {
      void dialog.showMessageBox({
        type: "warning",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail: updates.getState().message ?? "An unknown error occurred. Please try again later.",
        buttons: ["OK"],
      });
    }
  }

  function configureApplicationMenu(): void {
    const template: MenuItemConstructorOptions[] = [];
    const keyboardShortcutsAccelerator = resolveKeyboardShortcutsMenuAccelerator(process.platform);
    const updateMenuIcon =
      process.platform === "darwin"
        ? nativeImage.createMenuSymbol("arrow.triangle.2.circlepath")
        : undefined;
    const acceleratorProps = (
      accelerator: MenuItemConstructorOptions["accelerator"],
    ): Pick<MenuItemConstructorOptions, "accelerator"> => {
      const resolved = resolveDesktopMenuAccelerator(process.platform, accelerator);
      return resolved ? { accelerator: resolved } : {};
    };
    const zoomMenuItems: MenuItemConstructorOptions[] = shouldUseNativeZoomMenuRoles(
      process.platform,
    )
      ? [
          { role: "resetZoom" },
          { role: "zoomIn", ...acceleratorProps("CmdOrCtrl+=") },
          { role: "zoomIn", ...acceleratorProps("CmdOrCtrl+Plus"), visible: false },
          { role: "zoomOut" },
        ]
      : [
          { label: "Reset Zoom", click: () => resetWindowZoomFromMenu() },
          {
            label: "Zoom In",
            click: () => adjustWindowZoomFromMenu(DESKTOP_MENU_ZOOM_FACTOR_STEP),
          },
          {
            label: "Zoom Out",
            click: () => adjustWindowZoomFromMenu(1 / DESKTOP_MENU_ZOOM_FACTOR_STEP),
          },
        ];

    if (process.platform === "darwin") {
      template.push({
        label: app.name,
        submenu: [
          { role: "about" },
          {
            label: "Check for Updates...",
            ...(updateMenuIcon ? { icon: updateMenuIcon } : {}),
            click: () => handleCheckForUpdatesMenuClick(),
          },
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "CmdOrCtrl+,",
            click: () => dispatchMenuAction("open-settings"),
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      });
    }

    template.push(
      {
        label: "File",
        submenu: [
          ...(process.platform === "darwin"
            ? []
            : [
                {
                  label: "Settings...",
                  ...acceleratorProps("CmdOrCtrl+,"),
                  click: () => dispatchMenuAction("open-settings"),
                },
                { type: "separator" as const },
              ]),
          {
            label: "Close Tab",
            accelerator: "CmdOrCtrl+W",
            click: () => dispatchMenuAction("close-workspace-tab"),
          },
          ...(process.platform === "darwin"
            ? []
            : [{ type: "separator" as const }, { role: "quit" as const }]),
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            label: "New Terminal Tab",
            ...acceleratorProps(menuShortcuts.getAccelerator("terminal.new")),
            click: () => dispatchMenuAction("new-terminal-tab"),
          },
          { type: "separator" },
          {
            label: "Toggle Sidebar",
            ...acceleratorProps(menuShortcuts.getAccelerator("sidebar.toggle")),
            click: () => dispatchMenuAction("toggle-sidebar"),
          },
          { type: "separator" },
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          ...zoomMenuItems,
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Keyboard Shortcuts",
            ...(keyboardShortcutsAccelerator ? { accelerator: keyboardShortcutsAccelerator } : {}),
            click: () => dispatchMenuAction("show-shortcuts"),
          },
          { type: "separator" },
          {
            label: "Check for Updates...",
            ...(updateMenuIcon ? { icon: updateMenuIcon } : {}),
            click: () => handleCheckForUpdatesMenuClick(),
          },
        ],
      },
    );

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  let destructiveMenuIconCache: Electron.NativeImage | null | undefined;

  function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
    if (process.platform !== "darwin") return undefined;
    if (destructiveMenuIconCache !== undefined) {
      return destructiveMenuIconCache ?? undefined;
    }
    try {
      const icon = nativeImage.createFromNamedImage("trash").resize({
        width: 14,
        height: 14,
      });
      if (icon.isEmpty()) {
        destructiveMenuIconCache = null;
        return undefined;
      }
      icon.setTemplateImage(true);
      destructiveMenuIconCache = icon;
      return icon;
    } catch {
      destructiveMenuIconCache = null;
      return undefined;
    }
  }

  function createContextMenuIcon(
    dataUrl: unknown,
    template = true,
  ): Electron.NativeImage | undefined {
    if (
      process.platform !== "darwin" ||
      typeof dataUrl !== "string" ||
      dataUrl.length > CONTEXT_MENU_ICON_MAX_DATA_URL_LENGTH ||
      !dataUrl.startsWith(CONTEXT_MENU_ICON_DATA_URL_PREFIX)
    ) {
      return undefined;
    }
    const icon = nativeImage.createFromBuffer(
      Buffer.from(dataUrl.slice(CONTEXT_MENU_ICON_DATA_URL_PREFIX.length), "base64"),
      { scaleFactor: 2 },
    );
    if (icon.isEmpty()) return undefined;
    icon.setTemplateImage(template);
    return icon;
  }
  return {
    getDesktopWindowState,
    getDesktopCustomTitleBarState,
    createWindow,
    clearUnreadNotificationBadge,
    focusMainWindow,
    showDesktopNotification,
    getMainWindow: () => mainWindow,
    dispatchMenuAction,
    resolveMenuTargetWindow,
    attachDesktopZoomFactorSync,
    handleDesktopPhysicalZoomShortcut,
    attachDesktopPhysicalZoomShortcuts,
    handleDesktopZoomShortcut,
    resolveAutoUpdateDisabledReason,
    configureApplicationMenu,
    setMenuShortcuts: menuShortcuts.apply,
    getDestructiveMenuIcon,
    createContextMenuIcon,
  };
}
