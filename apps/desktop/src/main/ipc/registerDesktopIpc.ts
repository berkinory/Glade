import type {
  DesktopAppIcon,
  DesktopContextMenuItem,
  DesktopUpdateActionResult,
  DesktopUpdateState,
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
import type { BrowserVault } from "../../browser/automation/browserVault";
import { registerBrowserIpcHandlers } from "../../browser/browserIpc";
import type { DesktopBrowserManager } from "../../browser/browserManager";
import { registerBrowserVaultIpc } from "../../browser/browserVaultIpc";
import {
  normalizeAgentCursorStylePreference,
  writeAgentCursorPreference,
} from "../../computer/agentCursorPreference";
import type { DesktopComputerManager } from "../../computer/computerPermissions";
import {
  COMPUTER_SETTINGS_PANE_URLS,
  registerComputerIpcHandlers,
} from "../../computer/computerPermissionsIpc";
import type { CuaDriverHost } from "../../computer/cua/cuaDriverHost";
import {
  acknowledgeGladeStorageSnapshot,
  readGladeStorageSnapshot,
  resolveGladeStorageSnapshotPath,
} from "../../storage/desktopStorageMigration";
import {
  AGENT_CURSOR_PREFERENCE_PATH,
  DESKTOP_CUSTOM_TITLE_BAR_PATH,
  MAC_CONTEXT_MENU_LABEL_TRAILING_PADDING,
  MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH,
} from "../desktopEnvironment";
import { safeConsoleError } from "../lifecycle/desktopLogging";
import { showDesktopConfirmDialog } from "../window/confirmDialog";
import {
  createExclusiveApplyQueue,
  isDesktopAppIcon,
  shouldUpdateDesktopAppIcon,
} from "../window/desktopAppIcon";
import { writeCustomTitleBarPreference } from "../window/desktopCustomTitleBar";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";
import {
  getSafeExternalUrl,
  getSafeTheme,
  isSaveFileInput,
  normalizeDesktopWsUrl,
  resolveDesktopWsUrlFromEnv,
} from "./ipcValidation";
import { registerDesktopVoiceTranscriptionHandler } from "./voiceTranscription";
interface IpcWindow {
  getMainWindow(): BrowserWindow | null;
  getDesktopWindowState: (window: BrowserWindow) => { isMaximized: boolean; isFullscreen: boolean };
  getDesktopCustomTitleBarState: () => {
    readonly supported: boolean;
    readonly preference: boolean;
    readonly active: boolean;
    readonly restartRequired: boolean;
  };
  showDesktopNotification: (input: {
    title: string;
    body?: string;
    silent?: boolean;
    suppressWhenForeground?: boolean;
    threadId?: string;
  }) => boolean;
}
interface IpcIdentity {
  readDesktopAppIcon: () => DesktopAppIcon;
  persistDesktopAppIcon: (icon: DesktopAppIcon) => void;
  applyDesktopAppIcon: (
    icon: DesktopAppIcon,
    window?: BrowserWindow | null,
    options?: { reregisterTaskbarButton?: boolean; flushShellIconCache?: boolean },
  ) => Promise<void>;
}
interface IpcMenu {
  createContextMenuIcon: (dataUrl: unknown, template?: boolean) => Electron.NativeImage | undefined;
  getDestructiveMenuIcon: () => Electron.NativeImage | undefined;
}
interface IpcBrowser {
  getManager(): DesktopBrowserManager;
  getVault(): BrowserVault;
  startBrowserPerformanceLogging(): void;
}
interface IpcComputer {
  getManager(): DesktopComputerManager | null;
  getHost(): CuaDriverHost | undefined;
}
interface IpcUpdates {
  getState(): DesktopUpdateState;
  check: (reason: string) => Promise<void>;
  download: () => Promise<{ accepted: boolean; completed: boolean }>;
  install: () => Promise<{ accepted: boolean; completed: boolean }>;
}
interface IpcControl {
  getWsUrl(): string;
  resolveQuitConfirmation(payload: unknown): void;
  requestGracefulAppQuit(reason: string): void;
  isQuitting(): boolean;
}
export interface DesktopIpcDependencies {
  windows: IpcWindow;
  identity: IpcIdentity;
  contextMenu: IpcMenu;
  browser: IpcBrowser;
  computer: IpcComputer;
  updates: IpcUpdates;
  control: IpcControl;
}
export function createRegisterDesktopIpc({
  windows,
  identity,
  contextMenu,
  browser,
  computer,
  updates,
  control,
}: DesktopIpcDependencies) {
  function registerIpcHandlers(): void {
    const storageSnapshotPath = resolveGladeStorageSnapshotPath(app.getPath("userData"));

    ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.browser.webMcpCompatibilityPolicy);
    ipcMain.on(DESKTOP_IPC_CHANNELS.browser.webMcpCompatibilityPolicy, (event: IpcMainEvent) => {
      event.returnValue = browser.getManager().isWebMcpCompatibilityAllowed(event.sender.id);
    });

    ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.storageMigration.read);
    ipcMain.on(DESKTOP_IPC_CHANNELS.storageMigration.read, (event: IpcMainEvent) => {
      event.returnValue = readGladeStorageSnapshot(storageSnapshotPath);
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.storageMigration.acknowledge);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.storageMigration.acknowledge, async () => {
      await acknowledgeGladeStorageSnapshot(storageSnapshotPath);
    });

    ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.wsUrl);
    ipcMain.on(DESKTOP_IPC_CHANNELS.wsUrl, (event: IpcMainEvent) => {
      event.returnValue =
        normalizeDesktopWsUrl(control.getWsUrl()) ?? resolveDesktopWsUrlFromEnv(process.env);
    });

    ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.zoomFactor);
    ipcMain.on(DESKTOP_IPC_CHANNELS.zoomFactor, (event: IpcMainEvent) => {
      event.returnValue = event.sender.getZoomFactor();
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.pickFolder);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.pickFolder, async () => {
      const owner = BrowserWindow.getFocusedWindow() ?? windows.getMainWindow();
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

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.saveFile);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.saveFile, async (_event, input: unknown) => {
      if (!isSaveFileInput(input)) {
        throw new Error("Invalid save file input.");
      }

      const owner = BrowserWindow.getFocusedWindow() ?? windows.getMainWindow();
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

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.confirm);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.confirm, async (_event, message: unknown) => {
      if (typeof message !== "string") {
        return false;
      }

      const owner = BrowserWindow.getFocusedWindow() ?? windows.getMainWindow();
      return showDesktopConfirmDialog(message, owner);
    });

    ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.quitConfirmationResponse);
    ipcMain.on(DESKTOP_IPC_CHANNELS.quitConfirmationResponse, (_event, payload: unknown) => {
      control.resolveQuitConfirmation(payload);
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setTheme);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.setTheme, async (_event, rawTheme: unknown) => {
      const theme = getSafeTheme(rawTheme);
      if (!theme) {
        return;
      }

      nativeTheme.themeSource = theme;
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.getAppIcon);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.getAppIcon, () => identity.readDesktopAppIcon());

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setAppIcon);
    const enqueueDesktopAppIconApply = createExclusiveApplyQueue(async (icon: DesktopAppIcon) => {
      const shouldPersist = shouldUpdateDesktopAppIcon(identity.readDesktopAppIcon(), icon);
      if (shouldPersist) identity.persistDesktopAppIcon(icon);

      if (!shouldPersist && process.platform !== "win32" && process.platform !== "darwin") return;
      await identity.applyDesktopAppIcon(icon, windows.getMainWindow(), {
        flushShellIconCache: true,
      });
    });
    ipcMain.handle(DESKTOP_IPC_CHANNELS.setAppIcon, async (_event, rawIcon: unknown) => {
      if (!isDesktopAppIcon(rawIcon)) return;
      await enqueueDesktopAppIconApply(rawIcon);
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.contextMenu);
    ipcMain.handle(
      DESKTOP_IPC_CHANNELS.contextMenu,
      async (_event, items: DesktopContextMenuItem[], position?: { x: number; y: number }) => {
        const normalizedItems = items
          .filter((item) => typeof item.id === "string" && typeof item.label === "string")
          .map((item) => ({
            id: item.id,
            label: item.label,
            separatorBefore: item.separatorBefore === true,
            destructive: item.destructive === true,
            icon: contextMenu.createContextMenuIcon(item.iconDataUrl, item.iconTemplate !== false),
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

        const window = BrowserWindow.getFocusedWindow() ?? windows.getMainWindow();
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
                  ? `${item.label}${MAC_CONTEXT_MENU_LABEL_TRAILING_PADDING}`
                  : item.label,
              click: () => resolve(item.id),
            };
            const icon =
              item.icon ?? (item.destructive ? contextMenu.getDestructiveMenuIcon() : undefined);
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

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.openExternal);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.openExternal, async (_event, rawUrl: unknown) => {
      const externalUrl = getSafeExternalUrl(rawUrl);
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

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.clipboardWriteImage);
    ipcMain.handle(
      DESKTOP_IPC_CHANNELS.clipboardWriteImage,
      async (_event, rawDataUrl: unknown) => {
        if (typeof rawDataUrl !== "string") {
          return false;
        }
        if (rawDataUrl.length > MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH) {
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
      },
    );

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.showInFolder);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.showInFolder, async (_event, rawPath: unknown) => {
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

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.windowMinimize);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.windowMinimize, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? windows.getMainWindow();
      window?.minimize();
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.windowToggleMaximize);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.windowToggleMaximize, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? windows.getMainWindow();
      if (!window) {
        return { isMaximized: false, isFullscreen: false };
      }
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      const state = windows.getDesktopWindowState(window);
      window.webContents.send(DESKTOP_IPC_CHANNELS.windowState, state);
      return state;
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.windowClose);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.windowClose, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? windows.getMainWindow();
      window?.close();
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.windowGetState);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.windowGetState, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? windows.getMainWindow();
      return window
        ? windows.getDesktopWindowState(window)
        : { isMaximized: false, isFullscreen: false };
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.customTitleBarGetState);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.customTitleBarGetState, async () =>
      windows.getDesktopCustomTitleBarState(),
    );

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.customTitleBarSetPreference);
    ipcMain.handle(
      DESKTOP_IPC_CHANNELS.customTitleBarSetPreference,
      async (_event, rawEnabled: unknown) => {
        if (typeof rawEnabled !== "boolean") {
          return windows.getDesktopCustomTitleBarState();
        }
        const state = windows.getDesktopCustomTitleBarState();
        if (!state.supported) {
          return state;
        }
        writeCustomTitleBarPreference(DESKTOP_CUSTOM_TITLE_BAR_PATH, rawEnabled);
        return windows.getDesktopCustomTitleBarState();
      },
    );

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.customTitleBarRelaunch);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.customTitleBarRelaunch, async () => {
      app.relaunch();
      control.requestGracefulAppQuit("custom-title-bar-relaunch");
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.computerSetCursorStyle);
    ipcMain.handle(
      DESKTOP_IPC_CHANNELS.computerSetCursorStyle,
      async (_event, rawStyle: unknown) => {
        const style = normalizeAgentCursorStylePreference(rawStyle);
        writeAgentCursorPreference(AGENT_CURSOR_PREFERENCE_PATH, style);
        const host = computer.getHost();
        if (host) {
          await host.setCursorStyle(style).catch((error: unknown) => {
            safeConsoleError("[desktop] live cursor style push failed", error);
          });
        }
      },
    );

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.updateGetState);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.updateGetState, async () => updates.getState());

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.updateCheck);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.updateCheck, async () => {
      await updates.check("renderer");
      return updates.getState();
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.updateDownload);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.updateDownload, async () => {
      const result = await updates.download();
      return {
        accepted: result.accepted,
        completed: result.completed,
        state: updates.getState(),
      } satisfies DesktopUpdateActionResult;
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.updateInstall);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.updateInstall, async () => {
      if (control.isQuitting()) {
        return {
          accepted: false,
          completed: false,
          state: updates.getState(),
        } satisfies DesktopUpdateActionResult;
      }
      const result = await updates.install();
      return {
        accepted: result.accepted,
        completed: result.completed,
        state: updates.getState(),
      } satisfies DesktopUpdateActionResult;
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.notificationsIsSupported);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.notificationsIsSupported, async () =>
      Notification.isSupported(),
    );

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.notificationsShow);
    ipcMain.handle(
      DESKTOP_IPC_CHANNELS.notificationsShow,
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
        windows.showDesktopNotification({
          title: typeof input?.title === "string" ? input.title : "",
          body: typeof input?.body === "string" ? input.body : "",
          silent: input?.silent === true,
          suppressWhenForeground: input?.suppressWhenForeground === true,
          ...(typeof input?.threadId === "string" ? { threadId: input.threadId } : {}),
        }),
    );
    const computerManager = computer.getManager();
    if (computerManager) {
      registerComputerIpcHandlers(ipcMain, computerManager, {
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
          control.requestGracefulAppQuit("computer-permission-relaunch");
        },
      });
    }
    registerDesktopVoiceTranscriptionHandler();
    browser.startBrowserPerformanceLogging();
    registerBrowserIpcHandlers(ipcMain, browser.getManager());
    registerBrowserVaultIpc(ipcMain, browser.getManager(), browser.getVault(), () => {
      windows.getMainWindow()?.webContents.send(DESKTOP_IPC_CHANNELS.browser.vault.changed);
    });
  }
  return { registerIpcHandlers };
}
