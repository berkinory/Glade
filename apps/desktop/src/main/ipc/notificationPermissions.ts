import type { DesktopNotificationPermission } from "@glade/contracts/ipc/ipc";
import { execProcessFile } from "@glade/shared/platform/processRuntime";
import { ipcMain, Notification, shell } from "electron";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { APP_USER_MODEL_ID } from "../desktopEnvironment";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

const requireNative = createRequire(__filename);

async function readPermission(request = false): Promise<DesktopNotificationPermission> {
  const canOpenSettings = process.platform === "darwin" || process.platform === "win32";
  if (!Notification.isSupported()) {
    return { status: "unsupported", canRequest: false, canOpenSettings: false };
  }
  let status: DesktopNotificationPermission["status"] = "unknown";
  if (process.platform === "darwin") {
    // Run inside Electron: a helper process would query its own notification identity.
    const native: { query: (request: boolean) => Promise<number> } = requireNative(
      resolve(__dirname, "../native-dist/notification-permissions.node"),
    );
    const value = await native.query(request);
    switch (value) {
      case 0:
        status = "not-determined";
        break;
      case 1:
        status = "denied";
        break;
      case 2:
        status = "granted";
        break;
      case 3:
        status = "provisional";
        break;
      default:
        throw new Error(`Unknown macOS notification authorization status: ${value}`);
    }
  } else if (process.platform === "win32") {
    const appId = APP_USER_MODEL_ID.replaceAll("'", "''");
    const script = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appId}').Setting.ToString()`;
    const value = await new Promise<string>((resolveResult, reject) => {
      execProcessFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", timeout: 10_000, maxBuffer: 4096 },
        (error, stdout) => (error ? reject(error) : resolveResult(stdout.trim())),
      );
    });
    switch (value) {
      case "Enabled":
        status = "granted";
        break;
      case "DisabledForApplication":
      case "DisabledForUser":
        status = "denied";
        break;
      case "DisabledByGroupPolicy":
        status = "restricted";
        break;
      case "DisabledByManifest":
        status = "unsupported";
        break;
      default:
        throw new Error(`Unknown Windows notification setting: ${value}`);
    }
  }
  return { status, canRequest: status === "not-determined", canOpenSettings };
}

export function registerNotificationPermissionIpc(): void {
  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.notificationsGetPermission);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.notificationsGetPermission, () => readPermission());
  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.notificationsRequestPermission);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.notificationsRequestPermission, async () => {
    const current = await readPermission();
    return current.canRequest ? readPermission(true) : current;
  });
  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.notificationsOpenSettings);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.notificationsOpenSettings, async () => {
    if (process.platform === "darwin") {
      await shell.openExternal(
        `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${encodeURIComponent(APP_USER_MODEL_ID)}`,
      );
    } else if (process.platform === "win32") {
      await shell.openExternal("ms-settings:notifications");
    } else {
      throw new Error("Open your desktop environment's notification settings manually.");
    }
  });
}
