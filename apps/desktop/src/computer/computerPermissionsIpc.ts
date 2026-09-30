import type { IpcMain, WebContents } from "electron";
import type {
  DesktopComputerPermissionGuideState,
  DesktopComputerPermissionKind,
  DesktopComputerSettingsPane,
  DesktopComputerState,
} from "@glade/contracts/ipc/ipc";

import type { DesktopComputerManager } from "./computerPermissions";
import { COMPUTER_PERMISSIONS_IPC_CHANNELS } from "../main/ipc/ipcChannels";

const MAX_PERMISSION_KINDS = 8;

export const COMPUTER_SETTINGS_PANE_URLS: Record<DesktopComputerSettingsPane, string> = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  "input-monitoring": "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  "screen-recording":
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

export interface ComputerIpcHandlerOptions {
  openPermissionSettingsPane: (pane: DesktopComputerSettingsPane) => Promise<boolean>;
  restartApp: () => void;
}

function parseSettingsPane(value: unknown): DesktopComputerSettingsPane | null {
  return value === "accessibility" || value === "input-monitoring" || value === "screen-recording"
    ? value
    : null;
}

function parsePermissionKinds(value: unknown): DesktopComputerPermissionKind[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PERMISSION_KINDS) {
    return null;
  }
  const kinds = new Set<DesktopComputerPermissionKind>();
  for (const entry of value) {
    if (entry !== "accessibility" && entry !== "inputMonitoring" && entry !== "screenRecording") {
      return null;
    }
    kinds.add(entry);
  }
  return [...kinds];
}

export function sendComputerState(
  webContents: WebContents | null | undefined,
  state: DesktopComputerState,
): void {
  webContents?.send(COMPUTER_PERMISSIONS_IPC_CHANNELS.state, state);
}

export function sendComputerPermissionGuideState(
  webContents: WebContents | null | undefined,
  state: DesktopComputerPermissionGuideState,
): void {
  webContents?.send(COMPUTER_PERMISSIONS_IPC_CHANNELS.permissionGuideState, state);
}

export function registerComputerIpcHandlers(
  ipcMain: IpcMain,
  manager: DesktopComputerManager,
  options: ComputerIpcHandlerOptions,
): void {
  ipcMain.removeHandler(COMPUTER_PERMISSIONS_IPC_CHANNELS.getState);
  ipcMain.handle(COMPUTER_PERMISSIONS_IPC_CHANNELS.getState, async (_event, permissions: unknown) =>
    manager.refreshState(parsePermissionKinds(permissions) ?? undefined),
  );

  ipcMain.removeHandler(COMPUTER_PERMISSIONS_IPC_CHANNELS.requestPermissions);
  ipcMain.handle(
    COMPUTER_PERMISSIONS_IPC_CHANNELS.requestPermissions,
    async (_event, permissions: unknown) =>
      manager.requestPermissions(parsePermissionKinds(permissions) ?? undefined),
  );

  ipcMain.removeHandler(COMPUTER_PERMISSIONS_IPC_CHANNELS.startPermissionSetup);
  ipcMain.handle(
    COMPUTER_PERMISSIONS_IPC_CHANNELS.startPermissionSetup,
    async (_event, permissions: unknown) => {
      const kinds = parsePermissionKinds(permissions);
      if (!kinds) throw new Error("Permission setup requires at least one grant.");
      return manager.startPermissionSetup(kinds);
    },
  );

  ipcMain.removeHandler(COMPUTER_PERMISSIONS_IPC_CHANNELS.openPermissionSettings);
  ipcMain.handle(
    COMPUTER_PERMISSIONS_IPC_CHANNELS.openPermissionSettings,
    async (_event, pane: unknown) => {
      const settingsPane = parseSettingsPane(pane);
      if (!settingsPane) return false;
      return options.openPermissionSettingsPane(settingsPane);
    },
  );

  ipcMain.removeHandler(COMPUTER_PERMISSIONS_IPC_CHANNELS.restartApp);
  ipcMain.handle(COMPUTER_PERMISSIONS_IPC_CHANNELS.restartApp, async () => {
    options.restartApp();
  });

  ipcMain.removeHandler(COMPUTER_PERMISSIONS_IPC_CHANNELS.showPermissionGuide);
  ipcMain.handle(
    COMPUTER_PERMISSIONS_IPC_CHANNELS.showPermissionGuide,
    async (_event, pane: unknown) => {
      const settingsPane = parseSettingsPane(pane);
      if (!settingsPane) return;
      manager.showPermissionGuide(settingsPane);
    },
  );

  ipcMain.removeHandler(COMPUTER_PERMISSIONS_IPC_CHANNELS.hidePermissionGuide);
  ipcMain.handle(COMPUTER_PERMISSIONS_IPC_CHANNELS.hidePermissionGuide, async () => {
    manager.hidePermissionGuide();
  });
}
