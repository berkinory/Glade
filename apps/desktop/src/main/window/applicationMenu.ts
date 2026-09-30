import type { MenuItemConstructorOptions } from "electron";
import { app, BrowserWindow, dialog, Menu, nativeImage } from "electron";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import { getAutoUpdateDisabledReason } from "../updates/updateState";
import {
  applyDesktopPhysicalZoomAction,
  resolveDesktopMenuAccelerator,
  resolveDesktopPhysicalZoomAction,
  resolveDesktopZoomShortcutAction,
  resolveKeyboardShortcutsMenuAccelerator,
  shouldUseNativeZoomMenuRoles,
} from "./menuShortcuts";

export function createApplicationMenu(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "mainWindow"
    | "createWindow"
    | "IPC"
    | "DESKTOP_MENU_MAX_ZOOM_FACTOR"
    | "DESKTOP_MENU_MIN_ZOOM_FACTOR"
    | "DESKTOP_MENU_ZOOM_FACTOR_STEP"
    | "readAppUpdateYml"
    | "isDevelopment"
    | "desktopIdentity"
    | "checkForUpdates"
    | "updateState"
  >,
) {
  function dispatchMenuAction(action: string): void {
    const existingWindow =
      BrowserWindow.getFocusedWindow() ??
      desktopRuntime.mainWindow ??
      BrowserWindow.getAllWindows()[0];
    const targetWindow = existingWindow ?? desktopRuntime.createWindow();
    if (!existingWindow) {
      desktopRuntime.mainWindow = targetWindow;
    }

    const send = () => {
      if (targetWindow.isDestroyed()) return;
      targetWindow.webContents.send(desktopRuntime.IPC.menuAction, action);
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
      BrowserWindow.getFocusedWindow() ??
      desktopRuntime.mainWindow ??
      BrowserWindow.getAllWindows()[0] ??
      null
    );
  }

  function sendDesktopZoomFactor(webContents: Electron.WebContents): void {
    if (webContents.isDestroyed()) return;
    webContents.send(desktopRuntime.IPC.zoomFactorChanged, webContents.getZoomFactor());
  }

  function attachDesktopZoomFactorSync(window: BrowserWindow): void {
    const notify = () => sendDesktopZoomFactor(window.webContents);
    window.webContents.on("zoom-changed", notify);
    window.webContents.on("did-finish-load", notify);
  }

  function adjustWebContentsZoom(webContents: Electron.WebContents, multiplier: number): void {
    const nextZoomFactor = Math.min(
      desktopRuntime.DESKTOP_MENU_MAX_ZOOM_FACTOR,
      Math.max(
        desktopRuntime.DESKTOP_MENU_MIN_ZOOM_FACTOR,
        webContents.getZoomFactor() * multiplier,
      ),
    );
    webContents.setZoomFactor(nextZoomFactor);
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
    return true;
  }

  function attachDesktopPhysicalZoomShortcuts(window: BrowserWindow): void {
    window.webContents.on("before-input-event", (event, input) => {
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
      target.setZoomFactor(1);
    } else {
      adjustWebContentsZoom(
        target,
        action === "zoomIn"
          ? desktopRuntime.DESKTOP_MENU_ZOOM_FACTOR_STEP
          : 1 / desktopRuntime.DESKTOP_MENU_ZOOM_FACTOR_STEP,
      );
    }
    return true;
  }

  function resetWindowZoomFromMenu(): void {
    resolveMenuTargetWindow()?.webContents.setZoomFactor(1);
  }

  function adjustWindowZoomFromMenu(multiplier: number): void {
    const webContents = resolveMenuTargetWindow()?.webContents;
    if (!webContents) return;
    adjustWebContentsZoom(webContents, multiplier);
  }

  function hasConfiguredUpdateFeed(): boolean {
    return (
      desktopRuntime.readAppUpdateYml() !== null || Boolean(process.env.GLADE_DESKTOP_MOCK_UPDATES)
    );
  }

  function resolveAutoUpdateDisabledReason(): string | null {
    return getAutoUpdateDisabledReason({
      isDevelopment: desktopRuntime.isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv:
        desktopRuntime.desktopIdentity.usesScriptedUpdates ||
        process.env.GLADE_DISABLE_AUTO_UPDATE === "1",
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
      desktopRuntime.mainWindow = desktopRuntime.createWindow();
    }
    void checkForUpdatesFromMenu();
  }

  async function checkForUpdatesFromMenu(): Promise<void> {
    await desktopRuntime.checkForUpdates("menu");

    if (desktopRuntime.updateState.status === "up-to-date") {
      void dialog.showMessageBox({
        type: "info",
        title: "You're up to date!",
        message: `Glade ${desktopRuntime.updateState.currentVersion} is currently the newest version available.`,
        buttons: ["OK"],
      });
    } else if (
      desktopRuntime.updateState.status === "downloading" ||
      desktopRuntime.updateState.status === "available"
    ) {
      void dialog.showMessageBox({
        type: "info",
        title: "Update found",
        message: "Glade is preparing the update in the background.",
        buttons: ["OK"],
      });
    } else if (desktopRuntime.updateState.status === "downloaded") {
      void dialog.showMessageBox({
        type: "info",
        title: "Update ready",
        message: "Click Update in the sidebar when you’re ready to restart and install it.",
        buttons: ["OK"],
      });
    } else if (desktopRuntime.updateState.status === "error") {
      void dialog.showMessageBox({
        type: "warning",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail:
          desktopRuntime.updateState.message ??
          "An unknown error occurred. Please try again later.",
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
            click: () => adjustWindowZoomFromMenu(desktopRuntime.DESKTOP_MENU_ZOOM_FACTOR_STEP),
          },
          {
            label: "Zoom Out",
            click: () => adjustWindowZoomFromMenu(1 / desktopRuntime.DESKTOP_MENU_ZOOM_FACTOR_STEP),
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
          { role: process.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            label: "New Terminal Tab",
            ...acceleratorProps("CmdOrCtrl+T"),
            click: () => dispatchMenuAction("new-terminal-tab"),
          },
          { type: "separator" },
          {
            label: "Toggle Sidebar",
            ...acceleratorProps("CmdOrCtrl+B"),
            click: () => dispatchMenuAction("toggle-sidebar"),
          },
          {
            label: "Toggle Browser",
            ...acceleratorProps("CmdOrCtrl+Shift+B"),
            click: () => dispatchMenuAction("toggle-browser"),
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
  return {
    dispatchMenuAction,
    resolveMenuTargetWindow,
    attachDesktopZoomFactorSync,
    handleDesktopPhysicalZoomShortcut,
    attachDesktopPhysicalZoomShortcuts,
    handleDesktopZoomShortcut,
    resolveAutoUpdateDisabledReason,
    configureApplicationMenu,
  };
}
