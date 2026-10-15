import type { DesktopNotificationPermission } from "@glade/contracts/ipc/ipc";

export type BrowserNotificationPermissionState =
  | NotificationPermission
  | "unsupported"
  | "insecure";

function isBrowserNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function readBrowserNotificationPermissionState(): BrowserNotificationPermissionState {
  if (typeof window === "undefined") {
    return "unsupported";
  }
  if (!isBrowserNotificationSupported()) {
    return "unsupported";
  }
  if (!window.isSecureContext) {
    return "insecure";
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  const current = readBrowserNotificationPermissionState();
  if (current === "unsupported" || current === "insecure" || current === "denied") {
    return current;
  }
  if (current === "granted") {
    return current;
  }
  return Notification.requestPermission();
}

export type NotificationPermissionState =
  | DesktopNotificationPermission["status"]
  | BrowserNotificationPermissionState;

export async function readNotificationPermission() {
  if (window.desktopBridge) return window.desktopBridge.notifications.getPermission();
  const status = readBrowserNotificationPermissionState();
  return { status, canRequest: status === "default", canOpenSettings: false };
}
