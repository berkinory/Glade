import { registerMenuShortcutsIpc } from "./menuShortcutsIpc";
import type { DesktopMenuShortcutState } from "@glade/contracts/ipc/menuShortcuts";
import { readDesktopClipboardFiles } from "./clipboardFiles";
import type {
  DesktopAppIcon,
  DesktopEditCommand,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from "@glade/contracts/ipc/ipc";
import type { IpcMainEvent } from "electron";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  Notification,
  shell,
} from "electron";
import * as FS from "node:fs";
import * as Path from "node:path";
import {
  DESKTOP_CUSTOM_TITLE_BAR_PATH,
  MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH,
} from "../desktopEnvironment";
import { showDesktopConfirmDialog } from "../window/confirmDialog";
import {
  createExclusiveApplyQueue,
  isDesktopAppIcon,
  shouldUpdateDesktopAppIcon,
} from "../window/desktopAppIcon";
import {
  applyWindowMaterial,
  persistWindowMaterial,
  readWindowMaterialState,
} from "../window/desktopWindowMaterial";
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
import { registerNotificationPermissionIpc } from "./notificationPermissions";
import { registerBrowserViewIpc } from "./browserViewIpc";
import { registerComputerPermissionsIpc } from "./computerPermissionsIpc";
import type { DesktopHost } from "../../hostRpc/startDesktopHost";
import type { ComputerPermissions } from "../../computer/cuaPermissions";

interface IpcWindow {
  setMenuShortcuts: (state: DesktopMenuShortcutState) => void;
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
const DESKTOP_EDIT_COMMANDS: ReadonlySet<string> = new Set<DesktopEditCommand>([
  "cut",
  "copy",
  "paste",
  "selectAll",
]);

function isDesktopEditCommand(value: unknown): value is DesktopEditCommand {
  return typeof value === "string" && DESKTOP_EDIT_COMMANDS.has(value);
}

export interface DesktopIpcDependencies {
  windows: IpcWindow;
  identity: IpcIdentity;
  updates: IpcUpdates;
  control: IpcControl;
  desktopHost: () => DesktopHost | null;
  computerPermissions: ComputerPermissions;
}
export function createRegisterDesktopIpc({
  windows,
  identity,
  updates,
  control,
  desktopHost,
  computerPermissions,
}: DesktopIpcDependencies) {
  function registerIpcHandlers(): void {
    registerMenuShortcutsIpc(
      ipcMain,
      () => windows.getMainWindow()?.webContents ?? null,
      windows.setMenuShortcuts,
    );
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
      const window = windows.getMainWindow();
      if (window) applyWindowMaterial(window, readWindowMaterialState().enabled);
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.windowMaterialGetState);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.windowMaterialGetState, () => readWindowMaterialState());
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.windowMaterialSetEnabled);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.windowMaterialSetEnabled, (event, enabled: unknown) => {
      const window = windows.getMainWindow();
      if (!window || event.sender !== window.webContents) throw new Error("Invalid window owner.");
      if (typeof enabled !== "boolean")
        throw new Error("Expected a boolean window material preference.");
      const previous = readWindowMaterialState();
      if (!previous.supported)
        throw new Error("Native window material is unavailable on this system.");
      applyWindowMaterial(window, enabled);
      try {
        return persistWindowMaterial(enabled);
      } catch (error) {
        applyWindowMaterial(window, previous.enabled);
        throw error;
      }
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

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.editCommand);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.editCommand, (event, command: unknown) => {
      if (!isDesktopEditCommand(command)) return;
      event.sender[command]();
    });

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.copyImageAt);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.copyImageAt, (event, x: unknown, y: unknown) => {
      if (typeof x !== "number" || typeof y !== "number") return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // The renderer sends CSS pixels; copyImageAt expects zoomed window coordinates.
      const zoom = event.sender.getZoomFactor();
      event.sender.copyImageAt(Math.round(x * zoom), Math.round(y * zoom));
    });

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

    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.clipboardReadFiles);
    ipcMain.handle(DESKTOP_IPC_CHANNELS.clipboardReadFiles, () => readDesktopClipboardFiles());

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

    registerNotificationPermissionIpc();

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
    registerDesktopVoiceTranscriptionHandler();
    registerBrowserViewIpc(desktopHost);
    registerComputerPermissionsIpc(computerPermissions, () => desktopHost()?.computer ?? null);
  }
  return { registerIpcHandlers };
}
