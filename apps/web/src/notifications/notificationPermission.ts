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

export function notificationPermissionText(status: NotificationPermissionState): string {
  switch (status) {
    case "granted":
      return "Permission granted. Notifications are allowed; Focus or Do Not Disturb may silence alerts.";
    case "denied":
      return window.desktopBridge
        ? "Permission denied. Allow notifications in system settings."
        : "Permission denied. Allow notifications in your browser's site settings.";
    case "not-determined":
    case "default":
      return "Permission not requested. Allow notifications to receive background alerts.";
    case "provisional":
      return "Quiet notifications allowed. Enable alerts in system settings.";
    case "restricted":
      return "Notifications are restricted by system policy.";
    case "unsupported":
      return "Notifications are not supported on this device.";
    case "insecure":
      return "Notifications require HTTPS or localhost.";
    case "unknown":
      return "This desktop environment does not expose notification permission status. Check its notification settings.";
  }
}
