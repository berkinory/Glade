import { app, BrowserWindow, Notification } from "electron";
import { type DesktopRuntime } from "../desktopRuntimeTypes";

export function createDesktopNotifications(
  desktopRuntime: Pick<
    DesktopRuntime,
    "unreadBackgroundNotificationCount" | "mainWindow" | "resolveNotificationIconPath" | "IPC"
  >,
) {
  function syncUnreadNotificationBadge(): void {
    app.setBadgeCount(desktopRuntime.unreadBackgroundNotificationCount);
  }

  function isMainWindowForeground(window: BrowserWindow | null): boolean {
    if (!window || window.isDestroyed()) {
      return false;
    }
    return window.isVisible() && !window.isMinimized() && window.isFocused();
  }

  function incrementUnreadNotificationBadge(): void {
    desktopRuntime.unreadBackgroundNotificationCount = Math.min(
      desktopRuntime.unreadBackgroundNotificationCount + 1,
      99,
    );
    syncUnreadNotificationBadge();
  }

  function clearUnreadNotificationBadge(): void {
    if (desktopRuntime.unreadBackgroundNotificationCount === 0) {
      return;
    }
    desktopRuntime.unreadBackgroundNotificationCount = 0;
    syncUnreadNotificationBadge();
  }

  function focusMainWindow(options: { stealAppFocus?: boolean } = {}): void {
    if (!desktopRuntime.mainWindow || desktopRuntime.mainWindow.isDestroyed()) {
      desktopRuntime.mainWindow = null;
      return;
    }
    if (desktopRuntime.mainWindow.isMinimized()) {
      desktopRuntime.mainWindow.restore();
    }
    if (!desktopRuntime.mainWindow.isVisible()) {
      desktopRuntime.mainWindow.show();
    }
    if (process.platform === "darwin" && options.stealAppFocus === true) {
      app.show();
      app.focus({ steal: true });
    }
    desktopRuntime.mainWindow.focus();
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
    if (
      input.suppressWhenForeground === true &&
      isMainWindowForeground(desktopRuntime.mainWindow)
    ) {
      return false;
    }

    const iconPath = desktopRuntime.resolveNotificationIconPath();
    const notification = new Notification({
      title,
      body,
      silent: input.silent === true,
      ...(iconPath ? { icon: iconPath } : {}),
    });
    if (!isMainWindowForeground(desktopRuntime.mainWindow)) {
      incrementUnreadNotificationBadge();
    }

    notification.on("click", () => {
      clearUnreadNotificationBadge();
      focusMainWindow();
      if (!desktopRuntime.mainWindow) {
        return;
      }
      if (threadId.length > 0) {
        desktopRuntime.mainWindow.webContents.send(
          desktopRuntime.IPC.menuAction,
          `notification-open-thread:${threadId}`,
        );
      }
    });

    notification.show();
    return true;
  }
  return { clearUnreadNotificationBadge, focusMainWindow, showDesktopNotification };
}
