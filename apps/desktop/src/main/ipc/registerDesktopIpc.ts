import type {
  DesktopAppIcon,
  DesktopContextMenuItem,
  DesktopUpdateActionResult,
} from "@glade/contracts/ipc/ipc";
import type { IpcMainEvent, MenuItemConstructorOptions } from "electron";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  shell,
} from "electron";
import * as FS from "node:fs";
import * as Path from "node:path";
import { registerBrowserIpcHandlers } from "../../browser/browserIpc";
import { registerBrowserVaultIpc } from "../../browser/browserVaultIpc";
import {
  normalizeAgentCursorStylePreference,
  writeAgentCursorPreference,
} from "../../computer/agentCursorPreference";
import {
  COMPUTER_SETTINGS_PANE_URLS,
  registerComputerIpcHandlers,
} from "../../computer/computerPermissionsIpc";
import {
  acknowledgeGladeStorageSnapshot,
  readGladeStorageSnapshot,
  resolveGladeStorageSnapshotPath,
} from "../../storage/desktopStorageMigration";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import { createExclusiveApplyQueue } from "../updates/exclusiveApplyQueue";
import { showDesktopConfirmDialog } from "../window/confirmDialog";
import { isDesktopAppIcon, shouldUpdateDesktopAppIcon } from "../window/desktopAppIcon";
import { writeCustomTitleBarPreference } from "../window/desktopCustomTitleBar";
import { normalizeDesktopWsUrl, resolveDesktopWsUrlFromEnv } from "./desktopWsBridge";
import { registerDesktopVoiceTranscriptionHandler } from "./voiceTranscription";

export function createRegisterDesktopIpc(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "IPC"
    | "browserManager"
    | "backendWsUrl"
    | "mainWindow"
    | "isSaveFileInput"
    | "runningChatsQuitGuard"
    | "getSafeTheme"
    | "readDesktopAppIcon"
    | "persistDesktopAppIcon"
    | "applyDesktopAppIcon"
    | "createContextMenuIcon"
    | "MAC_CONTEXT_MENU_LABEL_TRAILING_PADDING"
    | "getDestructiveMenuIcon"
    | "getSafeExternalUrl"
    | "MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH"
    | "getDesktopWindowState"
    | "getDesktopCustomTitleBarState"
    | "DESKTOP_CUSTOM_TITLE_BAR_PATH"
    | "requestGracefulAppQuit"
    | "AGENT_CURSOR_PREFERENCE_PATH"
    | "cuaDriverHost"
    | "safeConsoleError"
    | "updateState"
    | "checkForUpdates"
    | "downloadAvailableUpdate"
    | "isQuitting"
    | "installDownloadedUpdate"
    | "showDesktopNotification"
    | "computerManager"
    | "startBrowserPerformanceLogging"
    | "browserVault"
  >,
) {
  function registerIpcHandlers(): void {
    const storageSnapshotPath = resolveGladeStorageSnapshotPath(app.getPath("userData"));

    ipcMain.removeAllListeners(desktopRuntime.IPC.browser.webMcpCompatibilityPolicy);
    ipcMain.on(desktopRuntime.IPC.browser.webMcpCompatibilityPolicy, (event: IpcMainEvent) => {
      event.returnValue = desktopRuntime.browserManager.isWebMcpCompatibilityAllowed(
        event.sender.id,
      );
    });

    ipcMain.removeAllListeners(desktopRuntime.IPC.storageMigration.read);
    ipcMain.on(desktopRuntime.IPC.storageMigration.read, (event: IpcMainEvent) => {
      event.returnValue = readGladeStorageSnapshot(storageSnapshotPath);
    });

    ipcMain.removeHandler(desktopRuntime.IPC.storageMigration.acknowledge);
    ipcMain.handle(desktopRuntime.IPC.storageMigration.acknowledge, async () => {
      await acknowledgeGladeStorageSnapshot(storageSnapshotPath);
    });

    ipcMain.removeAllListeners(desktopRuntime.IPC.wsUrl);
    ipcMain.on(desktopRuntime.IPC.wsUrl, (event: IpcMainEvent) => {
      event.returnValue =
        normalizeDesktopWsUrl(desktopRuntime.backendWsUrl) ??
        resolveDesktopWsUrlFromEnv(process.env);
    });

    ipcMain.removeAllListeners(desktopRuntime.IPC.zoomFactor);
    ipcMain.on(desktopRuntime.IPC.zoomFactor, (event: IpcMainEvent) => {
      event.returnValue = event.sender.getZoomFactor();
    });

    ipcMain.removeHandler(desktopRuntime.IPC.pickFolder);
    ipcMain.handle(desktopRuntime.IPC.pickFolder, async () => {
      const owner = BrowserWindow.getFocusedWindow() ?? desktopRuntime.mainWindow;
      const result = owner
        ? await dialog.showOpenDialog(owner, {
            properties: ["openDirectory", "createDirectory"],
          })
        : await dialog.showOpenDialog({
            properties: ["openDirectory", "createDirectory"],
          });
      if (result.canceled) return null;
      return result.filePaths[0] ?? null;
    });

    ipcMain.removeHandler(desktopRuntime.IPC.saveFile);
    ipcMain.handle(desktopRuntime.IPC.saveFile, async (_event, input: unknown) => {
      if (!desktopRuntime.isSaveFileInput(input)) {
        throw new Error("Invalid save file input.");
      }

      const owner = BrowserWindow.getFocusedWindow() ?? desktopRuntime.mainWindow;
      const options = {
        defaultPath: input.defaultFilename,
        ...(input.filters ? { filters: input.filters } : {}),
      };
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return null;
      }

      await FS.promises.writeFile(result.filePath, input.contents, "utf8");
      return result.filePath;
    });

    ipcMain.removeHandler(desktopRuntime.IPC.confirm);
    ipcMain.handle(desktopRuntime.IPC.confirm, async (_event, message: unknown) => {
      if (typeof message !== "string") {
        return false;
      }

      const owner = BrowserWindow.getFocusedWindow() ?? desktopRuntime.mainWindow;
      return showDesktopConfirmDialog(message, owner);
    });

    ipcMain.removeAllListeners(desktopRuntime.IPC.quitConfirmationResponse);
    ipcMain.on(desktopRuntime.IPC.quitConfirmationResponse, (_event, payload: unknown) => {
      desktopRuntime.runningChatsQuitGuard.receiveResponse(payload);
    });

    ipcMain.removeHandler(desktopRuntime.IPC.setTheme);
    ipcMain.handle(desktopRuntime.IPC.setTheme, async (_event, rawTheme: unknown) => {
      const theme = desktopRuntime.getSafeTheme(rawTheme);
      if (!theme) {
        return;
      }

      nativeTheme.themeSource = theme;
    });

    ipcMain.removeHandler(desktopRuntime.IPC.getAppIcon);
    ipcMain.handle(desktopRuntime.IPC.getAppIcon, () => desktopRuntime.readDesktopAppIcon());

    ipcMain.removeHandler(desktopRuntime.IPC.setAppIcon);
    const enqueueDesktopAppIconApply = createExclusiveApplyQueue(async (icon: DesktopAppIcon) => {
      const shouldPersist = shouldUpdateDesktopAppIcon(desktopRuntime.readDesktopAppIcon(), icon);
      if (shouldPersist) desktopRuntime.persistDesktopAppIcon(icon);

      if (!shouldPersist && process.platform !== "win32" && process.platform !== "darwin") return;
      await desktopRuntime.applyDesktopAppIcon(icon, desktopRuntime.mainWindow, {
        flushShellIconCache: true,
      });
    });
    ipcMain.handle(desktopRuntime.IPC.setAppIcon, async (_event, rawIcon: unknown) => {
      if (!isDesktopAppIcon(rawIcon)) return;
      await enqueueDesktopAppIconApply(rawIcon);
    });

    ipcMain.removeHandler(desktopRuntime.IPC.contextMenu);
    ipcMain.handle(
      desktopRuntime.IPC.contextMenu,
      async (_event, items: DesktopContextMenuItem[], position?: { x: number; y: number }) => {
        const normalizedItems = items
          .filter((item) => typeof item.id === "string" && typeof item.label === "string")
          .map((item) => ({
            id: item.id,
            label: item.label,
            separatorBefore: item.separatorBefore === true,
            destructive: item.destructive === true,
            icon: desktopRuntime.createContextMenuIcon(
              item.iconDataUrl,
              item.iconTemplate !== false,
            ),
          }));
        if (normalizedItems.length === 0) {
          return null;
        }

        const popupPosition =
          position &&
          Number.isFinite(position.x) &&
          Number.isFinite(position.y) &&
          position.x >= 0 &&
          position.y >= 0
            ? {
                x: Math.floor(position.x),
                y: Math.floor(position.y),
              }
            : null;

        const window = BrowserWindow.getFocusedWindow() ?? desktopRuntime.mainWindow;
        if (!window) return null;

        return new Promise<string | null>((resolve) => {
          const template: MenuItemConstructorOptions[] = [];
          let hasInsertedDestructiveSeparator = false;
          for (const item of normalizedItems) {
            const shouldInsertSeparator =
              item.separatorBefore ||
              (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0);
            if (shouldInsertSeparator && template.length > 0) {
              template.push({ type: "separator" });
            }
            if (item.destructive) {
              hasInsertedDestructiveSeparator = true;
            }
            const itemOption: MenuItemConstructorOptions = {
              label:
                process.platform === "darwin"
                  ? `${item.label}${desktopRuntime.MAC_CONTEXT_MENU_LABEL_TRAILING_PADDING}`
                  : item.label,
              click: () => resolve(item.id),
            };
            const icon =
              item.icon ?? (item.destructive ? desktopRuntime.getDestructiveMenuIcon() : undefined);
            if (icon) {
              itemOption.icon = icon;
            }
            template.push(itemOption);
          }

          const menu = Menu.buildFromTemplate(template);
          menu.popup({
            window,
            ...popupPosition,
            callback: () => resolve(null),
          });
        });
      },
    );

    ipcMain.removeHandler(desktopRuntime.IPC.openExternal);
    ipcMain.handle(desktopRuntime.IPC.openExternal, async (_event, rawUrl: unknown) => {
      const externalUrl = desktopRuntime.getSafeExternalUrl(rawUrl);
      if (!externalUrl) {
        return false;
      }

      try {
        await shell.openExternal(externalUrl);
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.removeHandler(desktopRuntime.IPC.clipboardWriteImage);
    ipcMain.handle(desktopRuntime.IPC.clipboardWriteImage, async (_event, rawDataUrl: unknown) => {
      if (typeof rawDataUrl !== "string") {
        return false;
      }
      if (rawDataUrl.length > desktopRuntime.MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH) {
        return false;
      }

      const dataUrl = rawDataUrl.trim();
      if (!dataUrl.startsWith("data:image/png;base64,")) {
        return false;
      }

      const image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) {
        return false;
      }

      clipboard.writeImage(image);
      return true;
    });

    ipcMain.removeHandler(desktopRuntime.IPC.showInFolder);
    ipcMain.handle(desktopRuntime.IPC.showInFolder, async (_event, rawPath: unknown) => {
      if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
        throw new Error("Missing folder path.");
      }
      const resolvedPath = Path.resolve(rawPath);

      let stats: FS.Stats;
      try {
        stats = await FS.promises.stat(resolvedPath);
      } catch {
        throw new Error(`Folder not found: ${resolvedPath}`);
      }

      if (stats.isDirectory()) {
        const errorMessage = await shell.openPath(resolvedPath);
        if (errorMessage.trim().length > 0) {
          throw new Error(errorMessage);
        }
        return;
      }

      shell.showItemInFolder(resolvedPath);
    });

    ipcMain.removeHandler(desktopRuntime.IPC.windowMinimize);
    ipcMain.handle(desktopRuntime.IPC.windowMinimize, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? desktopRuntime.mainWindow;
      window?.minimize();
    });

    ipcMain.removeHandler(desktopRuntime.IPC.windowToggleMaximize);
    ipcMain.handle(desktopRuntime.IPC.windowToggleMaximize, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? desktopRuntime.mainWindow;
      if (!window) {
        return { isMaximized: false, isFullscreen: false };
      }
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      const state = desktopRuntime.getDesktopWindowState(window);
      window.webContents.send(desktopRuntime.IPC.windowState, state);
      return state;
    });

    ipcMain.removeHandler(desktopRuntime.IPC.windowClose);
    ipcMain.handle(desktopRuntime.IPC.windowClose, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? desktopRuntime.mainWindow;
      window?.close();
    });

    ipcMain.removeHandler(desktopRuntime.IPC.windowGetState);
    ipcMain.handle(desktopRuntime.IPC.windowGetState, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? desktopRuntime.mainWindow;
      return window
        ? desktopRuntime.getDesktopWindowState(window)
        : { isMaximized: false, isFullscreen: false };
    });

    ipcMain.removeHandler(desktopRuntime.IPC.customTitleBarGetState);
    ipcMain.handle(desktopRuntime.IPC.customTitleBarGetState, async () =>
      desktopRuntime.getDesktopCustomTitleBarState(),
    );

    ipcMain.removeHandler(desktopRuntime.IPC.customTitleBarSetPreference);
    ipcMain.handle(
      desktopRuntime.IPC.customTitleBarSetPreference,
      async (_event, rawEnabled: unknown) => {
        if (typeof rawEnabled !== "boolean") {
          return desktopRuntime.getDesktopCustomTitleBarState();
        }
        const state = desktopRuntime.getDesktopCustomTitleBarState();
        if (!state.supported) {
          return state;
        }
        writeCustomTitleBarPreference(desktopRuntime.DESKTOP_CUSTOM_TITLE_BAR_PATH, rawEnabled);
        return desktopRuntime.getDesktopCustomTitleBarState();
      },
    );

    ipcMain.removeHandler(desktopRuntime.IPC.customTitleBarRelaunch);
    ipcMain.handle(desktopRuntime.IPC.customTitleBarRelaunch, async () => {
      app.relaunch();
      desktopRuntime.requestGracefulAppQuit("custom-title-bar-relaunch");
    });

    ipcMain.removeHandler(desktopRuntime.IPC.computerSetCursorStyle);
    ipcMain.handle(desktopRuntime.IPC.computerSetCursorStyle, async (_event, rawStyle: unknown) => {
      const style = normalizeAgentCursorStylePreference(rawStyle);
      writeAgentCursorPreference(desktopRuntime.AGENT_CURSOR_PREFERENCE_PATH, style);
      if (desktopRuntime.cuaDriverHost) {
        await desktopRuntime.cuaDriverHost.setCursorStyle(style).catch((error: unknown) => {
          desktopRuntime.safeConsoleError("[desktop] live cursor style push failed", error);
        });
      }
    });

    ipcMain.removeHandler(desktopRuntime.IPC.updateGetState);
    ipcMain.handle(desktopRuntime.IPC.updateGetState, async () => desktopRuntime.updateState);

    ipcMain.removeHandler(desktopRuntime.IPC.updateCheck);
    ipcMain.handle(desktopRuntime.IPC.updateCheck, async () => {
      await desktopRuntime.checkForUpdates("renderer");
      return desktopRuntime.updateState;
    });

    ipcMain.removeHandler(desktopRuntime.IPC.updateDownload);
    ipcMain.handle(desktopRuntime.IPC.updateDownload, async () => {
      const result = await desktopRuntime.downloadAvailableUpdate();
      return {
        accepted: result.accepted,
        completed: result.completed,
        state: desktopRuntime.updateState,
      } satisfies DesktopUpdateActionResult;
    });

    ipcMain.removeHandler(desktopRuntime.IPC.updateInstall);
    ipcMain.handle(desktopRuntime.IPC.updateInstall, async () => {
      if (desktopRuntime.isQuitting) {
        return {
          accepted: false,
          completed: false,
          state: desktopRuntime.updateState,
        } satisfies DesktopUpdateActionResult;
      }
      const result = await desktopRuntime.installDownloadedUpdate();
      return {
        accepted: result.accepted,
        completed: result.completed,
        state: desktopRuntime.updateState,
      } satisfies DesktopUpdateActionResult;
    });

    ipcMain.removeHandler(desktopRuntime.IPC.notificationsIsSupported);
    ipcMain.handle(desktopRuntime.IPC.notificationsIsSupported, async () =>
      Notification.isSupported(),
    );

    ipcMain.removeHandler(desktopRuntime.IPC.notificationsShow);
    ipcMain.handle(
      desktopRuntime.IPC.notificationsShow,
      async (
        _event,
        input:
          | {
              title?: unknown;
              body?: unknown;
              silent?: unknown;
              suppressWhenForeground?: unknown;
              threadId?: unknown;
            }
          | null
          | undefined,
      ) =>
        desktopRuntime.showDesktopNotification({
          title: typeof input?.title === "string" ? input.title : "",
          body: typeof input?.body === "string" ? input.body : "",
          silent: input?.silent === true,
          suppressWhenForeground: input?.suppressWhenForeground === true,
          ...(typeof input?.threadId === "string" ? { threadId: input.threadId } : {}),
        }),
    );
    if (desktopRuntime.computerManager) {
      registerComputerIpcHandlers(ipcMain, desktopRuntime.computerManager, {
        openPermissionSettingsPane: (pane) => {
          const paneUrl = COMPUTER_SETTINGS_PANE_URLS[pane];
          if (!paneUrl) return Promise.resolve(false);
          return shell
            .openExternal(paneUrl)
            .then(() => true)
            .catch(() => false);
        },
        restartApp: () => {
          app.relaunch();
          desktopRuntime.requestGracefulAppQuit("computer-permission-relaunch");
        },
      });
    }
    registerDesktopVoiceTranscriptionHandler();
    desktopRuntime.startBrowserPerformanceLogging();
    registerBrowserIpcHandlers(ipcMain, desktopRuntime.browserManager);
    registerBrowserVaultIpc(
      ipcMain,
      desktopRuntime.browserManager,
      desktopRuntime.browserVault,
      () => {
        desktopRuntime.mainWindow?.webContents.send(desktopRuntime.IPC.browser.vault.changed);
      },
    );
  }
  return { registerIpcHandlers };
}
