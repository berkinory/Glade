import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AppSettingsBinding } from "~/appSettings";
import {
  notificationPermissionText,
  readNotificationPermission,
  requestBrowserNotificationPermission,
} from "~/notifications/notificationPermission";

import { SettingResetButton } from "./SettingControls";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

import { Button } from "~/components/ui/button";

import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { useActivitySound } from "~/notifications/useActivitySound";

export function NotificationsSettingsPanel({
  settings,
  defaults,
  updateSettings,
  active,
}: AppSettingsBinding & { readonly active: boolean }) {
  const playSound = useActivitySound(settings.enableActivitySounds);
  const [busy, setBusy] = useState(false);
  const permission = useQuery({
    queryKey: ["notification-permission"],
    queryFn: readNotificationPermission,
    enabled: active,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: "always",
  });
  const { refetch } = permission;
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      void refetch();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [active, refetch]);

  async function runAction(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Notification action failed",
        description:
          error instanceof Error ? error.message : "Could not change notification permissions.",
      });
    } finally {
      await refetch();
      setBusy(false);
    }
  }

  async function requestPermission() {
    if (window.desktopBridge) {
      await window.desktopBridge.notifications.requestPermission();
    } else {
      await requestBrowserNotificationPermission();
    }
  }

  async function setSystemNotificationsEnabled(nextEnabled: boolean) {
    updateSettings({ enableSystemTaskCompletionNotifications: nextEnabled });
    if (nextEnabled && permission.data?.canRequest) await requestPermission();
  }

  async function sendTestNotification() {
    const title = "Activity notification";
    const body = "Notification test for chats and terminal agents.";
    const current = await readNotificationPermission();
    if (!["granted", "provisional", "unknown"].includes(current.status)) {
      throw new Error(notificationPermissionText(current.status));
    }
    if (window.desktopBridge) {
      const shown = await window.desktopBridge.notifications.show({ title, body, silent: true });
      if (!shown) throw new Error("The operating system could not display the notification.");
    } else {
      const notification = new Notification(title, {
        body,
        tag: "glade:test-notification",
        silent: true,
      });
      notification.addEventListener("click", () => window.focus());
    }
    playSound("complete");
    toastManager.add({
      type: "success",
      title: "Test notification sent",
      description: "Focus or Do Not Disturb may silence alerts.",
    });
  }

  if (!active) return null;

  return (
    <div className="space-y-6">
      <SettingsSection title="Activity alerts">
        <SettingsRow
          id="setting-activity-toasts"
          title="In-app notifications"
          description="Show an in-app toast when a chat or managed terminal agent finishes or needs input."
          resetAction={
            settings.enableTaskCompletionToasts !== defaults.enableTaskCompletionToasts ? (
              <SettingResetButton
                label="in-app notifications"
                onClick={() =>
                  updateSettings({
                    enableTaskCompletionToasts: defaults.enableTaskCompletionToasts,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableTaskCompletionToasts}
              onCheckedChange={(checked) =>
                updateSettings({ enableTaskCompletionToasts: Boolean(checked) })
              }
              aria-label="In-app notifications"
            />
          }
        />

        <SettingsRow
          id="setting-activity-sounds"
          title="Activity sounds"
          description="Play distinct sounds when a chat or managed terminal agent finishes or needs your approval or reply, even while you are viewing it."
          resetAction={
            settings.enableActivitySounds !== defaults.enableActivitySounds ? (
              <SettingResetButton
                label="activity sounds"
                onClick={() =>
                  updateSettings({ enableActivitySounds: defaults.enableActivitySounds })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableActivitySounds}
              onCheckedChange={(checked) =>
                updateSettings({ enableActivitySounds: Boolean(checked) })
              }
              aria-label="Activity sounds"
            />
          }
        />

        <SettingsRow
          id="setting-desktop-notifications"
          title="Desktop notifications"
          description="Show system alerts for activity while Glade is in the background."
          status={
            permission.isError ? (
              <span role="alert" className="text-destructive">
                Could not read notification permission. Retry to check again.
              </span>
            ) : permission.data ? (
              <span
                className={permission.data.status === "denied" ? "text-destructive" : undefined}
                role={permission.data.status === "denied" ? "alert" : undefined}
              >
                {notificationPermissionText(permission.data.status)}
              </span>
            ) : (
              "Checking notification permission"
            )
          }
          resetAction={
            settings.enableSystemTaskCompletionNotifications !==
            defaults.enableSystemTaskCompletionNotifications ? (
              <SettingResetButton
                label="desktop notifications"
                onClick={() =>
                  updateSettings({
                    enableSystemTaskCompletionNotifications:
                      defaults.enableSystemTaskCompletionNotifications,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
              {permission.isError ? (
                <Button size="xs" variant="outline" onClick={() => void refetch()}>
                  Retry
                </Button>
              ) : null}
              {permission.data?.canRequest ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void runAction(requestPermission)}
                >
                  Allow notifications
                </Button>
              ) : null}
              {permission.data?.canOpenSettings && !permission.data.canRequest ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      await window.desktopBridge?.notifications.openSettings();
                    })
                  }
                >
                  Open system settings
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="outline"
                disabled={
                  busy ||
                  permission.isError ||
                  !permission.data ||
                  !["granted", "provisional", "unknown"].includes(permission.data.status)
                }
                onClick={() => void runAction(sendTestNotification)}
              >
                Test
              </Button>
              <Switch
                checked={settings.enableSystemTaskCompletionNotifications}
                disabled={busy}
                onCheckedChange={(checked) => {
                  void runAction(() => setSystemNotificationsEnabled(Boolean(checked)));
                }}
                aria-label="Desktop activity notifications"
              />
            </div>
          }
        />
      </SettingsSection>
    </div>
  );
}
