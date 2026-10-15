import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AppSettingsBinding } from "~/appSettings";
import {
  readNotificationPermission,
  requestBrowserNotificationPermission,
} from "~/notifications/notificationPermission";

import {
  describeNotificationPermission,
  type NotificationPermissionNextStep,
  type NotificationPermissionPresentation,
} from "./DesktopSettingsPanels.logic";
import { SettingResetButton } from "./SettingControls";
import { SettingsStatusButton, SettingsStatus, type SettingsStatusAction } from "./SettingsStatus";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

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
      throw new Error(describeNotificationPermission(current, Boolean(window.desktopBridge)).label);
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

  const permissionActions: Record<NotificationPermissionNextStep, SettingsStatusAction> = {
    allow: { label: "Allow", run: () => void runAction(requestPermission) },
    "open-settings": {
      label: "Open system settings",
      run: () =>
        void runAction(async () => {
          await window.desktopBridge?.notifications.openSettings();
        }),
    },
    test: { label: "Send test", run: () => void runAction(sendTestNotification) },
  };
  const permissionStatus: NotificationPermissionPresentation = permission.isError
    ? { tone: "blocked", label: "Could not read permission", nextStep: null }
    : permission.data
      ? describeNotificationPermission(permission.data, Boolean(window.desktopBridge))
      : { tone: "checking", label: "Checking permission", nextStep: null };
  const permissionAction: SettingsStatusAction | undefined = permission.isError
    ? { label: "Retry", run: () => void refetch() }
    : permissionStatus.nextStep
      ? permissionActions[permissionStatus.nextStep]
      : undefined;

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
          status={<SettingsStatus tone={permissionStatus.tone} label={permissionStatus.label} />}
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
            <>
              {permissionAction ? (
                <SettingsStatusButton action={permissionAction} disabled={busy} />
              ) : null}
              <Switch
                checked={settings.enableSystemTaskCompletionNotifications}
                disabled={busy}
                onCheckedChange={(checked) => {
                  void runAction(() => setSystemNotificationsEnabled(Boolean(checked)));
                }}
                aria-label="Desktop activity notifications"
              />
            </>
          }
        />
      </SettingsSection>
    </div>
  );
}
