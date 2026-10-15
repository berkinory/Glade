import type { SettingsStatusTone } from "./SettingsStatus";
import type { NotificationPermissionState } from "~/notifications/notificationPermission";

export type NotificationPermissionNextStep = "allow" | "open-settings" | "test";

export interface NotificationPermissionPresentation {
  readonly tone: SettingsStatusTone;
  readonly label: string;
  readonly nextStep: NotificationPermissionNextStep | null;
}

export function describeNotificationPermission(
  permission: {
    readonly status: NotificationPermissionState;
    readonly canRequest: boolean;
    readonly canOpenSettings: boolean;
  },
  isDesktop: boolean,
): NotificationPermissionPresentation {
  const openSettings = permission.canOpenSettings ? "open-settings" : null;
  switch (permission.status) {
    case "granted":
      return { tone: "granted", label: "Allowed", nextStep: "test" };
    case "unknown":
      return { tone: "granted", label: "Permission status unavailable", nextStep: "test" };
    case "provisional":
      return { tone: "needed", label: "Delivered quietly", nextStep: openSettings ?? "test" };
    case "not-determined":
    case "default":
      return {
        tone: "needed",
        label: "Not allowed yet",
        nextStep: permission.canRequest ? "allow" : openSettings,
      };
    case "denied":
      return {
        tone: "blocked",
        label: isDesktop ? "Blocked in system settings" : "Blocked in site settings",
        nextStep: openSettings,
      };
    case "restricted":
      return { tone: "blocked", label: "Restricted by system policy", nextStep: null };
    case "unsupported":
      return { tone: "blocked", label: "Not supported on this device", nextStep: null };
    case "insecure":
      return { tone: "blocked", label: "Requires HTTPS or localhost", nextStep: null };
  }
}
