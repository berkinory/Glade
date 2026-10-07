import type { DesktopBridge } from "@glade/contracts/ipc/ipc";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import { DESKTOP_IPC_CHANNELS } from "./main/ipc/ipcChannels";
import { normalizeDesktopWsUrl, resolveDesktopWsUrlFromEnv } from "./main/ipc/ipcValidation";
import {
  parseQuitConfirmationRequest,
  parseQuitConfirmationResponse,
} from "./main/lifecycle/runningChatsQuitGuard";

const IPC = DESKTOP_IPC_CHANNELS;

function getDesktopWsUrl(): string | null {
  try {
    const ipcWsUrl = normalizeDesktopWsUrl(ipcRenderer.sendSync(IPC.wsUrl));
    return ipcWsUrl ?? resolveDesktopWsUrlFromEnv(process.env);
  } catch {
    return resolveDesktopWsUrlFromEnv(process.env);
  }
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: getDesktopWsUrl,

  getPathForFile: (file: File) => {
    try {
      const path = webUtils.getPathForFile(file);
      return typeof path === "string" && path.trim().length > 0 ? path : null;
    } catch {
      return null;
    }
  },
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  saveFile: (input) => ipcRenderer.invoke(IPC.saveFile, input),
  confirm: (message) => ipcRenderer.invoke(IPC.confirm, message),
  setTheme: (theme) => ipcRenderer.invoke(IPC.setTheme, theme),
  windowMaterial: {
    getState: () => ipcRenderer.invoke(IPC.windowMaterialGetState),
    setEnabled: (enabled) => ipcRenderer.invoke(IPC.windowMaterialSetEnabled, enabled),
  },
  getAppIcon: () => ipcRenderer.invoke(IPC.getAppIcon),
  setAppIcon: (icon) => ipcRenderer.invoke(IPC.setAppIcon, icon),
  showContextMenu: (items, position) => ipcRenderer.invoke(IPC.contextMenu, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  showInFolder: (path: string) => ipcRenderer.invoke(IPC.showInFolder, path),
  shell: {
    showInFolder: (path: string) => ipcRenderer.invoke(IPC.showInFolder, path),
  },
  clipboard: {
    readFiles: () => ipcRenderer.invoke(IPC.clipboardReadFiles),
    writeImagePngDataUrl: (dataUrl: string) => ipcRenderer.invoke(IPC.clipboardWriteImage, dataUrl),
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    getState: () => ipcRenderer.invoke(IPC.windowGetState),
    onState: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as Parameters<typeof listener>[0]);
      };

      ipcRenderer.on(IPC.windowState, wrappedListener);
      return () => {
        ipcRenderer.removeListener(IPC.windowState, wrappedListener);
      };
    },
  },
  customTitleBar: {
    getState: () => ipcRenderer.invoke(IPC.customTitleBarGetState),
    setPreference: (enabled) => ipcRenderer.invoke(IPC.customTitleBarSetPreference, enabled),
    relaunch: () => ipcRenderer.invoke(IPC.customTitleBarRelaunch),
  },
  setMenuShortcuts: (state) => ipcRenderer.invoke(IPC.setMenuShortcuts, state),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(IPC.menuAction, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IPC.menuAction, wrappedListener);
    };
  },
  onQuitConfirmationRequest: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const request = parseQuitConfirmationRequest(payload);
      if (request) listener(request);
    };

    ipcRenderer.on(IPC.quitConfirmationRequest, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IPC.quitConfirmationRequest, wrappedListener);
    };
  },
  replyQuitConfirmation: (response) => {
    const parsed = parseQuitConfirmationResponse(response);
    if (!parsed) return;
    ipcRenderer.send(IPC.quitConfirmationResponse, parsed);
  },
  getZoomFactor: () => {
    const factor = ipcRenderer.sendSync(IPC.zoomFactor);
    return typeof factor === "number" && Number.isFinite(factor) && factor > 0 ? factor : 1;
  },
  onZoomFactorChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, factor: unknown) => {
      if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) return;
      listener(factor);
    };

    ipcRenderer.on(IPC.zoomFactorChanged, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IPC.zoomFactorChanged, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(IPC.updateGetState),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IPC.updateState, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IPC.updateState, wrappedListener);
    };
  },
  notifications: {
    getPermission: () => ipcRenderer.invoke(IPC.notificationsGetPermission),
    requestPermission: () => ipcRenderer.invoke(IPC.notificationsRequestPermission),
    openSettings: () => ipcRenderer.invoke(IPC.notificationsOpenSettings),
    isSupported: () => ipcRenderer.invoke(IPC.notificationsIsSupported),
    show: (input) => ipcRenderer.invoke(IPC.notificationsShow, input),
  },
  server: {
    transcribeVoice: (input) => ipcRenderer.invoke(IPC.transcribeVoice, input),
  },
  computer: {
    getPermissions: () => ipcRenderer.invoke(IPC.computerPermissionsGet),
    requestPermissions: () => ipcRenderer.invoke(IPC.computerPermissionsRequest),
    openSettings: () => ipcRenderer.invoke(IPC.computerPermissionsOpenSettings),
  },
  browser: {
    placeView: (placement) => ipcRenderer.send(IPC.browserPlaceView, placement),
    pickElement: (request) => ipcRenderer.invoke(IPC.browserPickElement, request),
    cancelPick: (threadId) => ipcRenderer.send(IPC.browserCancelPick, threadId),
    capture: (target) => ipcRenderer.invoke(IPC.browserCapture, target),
    freezeFrame: (target) => ipcRenderer.invoke(IPC.browserFreezeFrame, target),
    toggleDevTools: (target) => ipcRenderer.send(IPC.browserToggleDevTools, target),
    clearSiteData: (target) => ipcRenderer.invoke(IPC.browserClearSiteData, target),
    contentBlocker: {
      getEnabled: () => ipcRenderer.invoke(IPC.browserContentBlockerGet),
      setEnabled: (enabled) => ipcRenderer.invoke(IPC.browserContentBlockerSet, enabled),
    },
  },
} satisfies DesktopBridge);
