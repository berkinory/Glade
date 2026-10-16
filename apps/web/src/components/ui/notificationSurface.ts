import { cn } from "~/lib/utils";

// Every notification card shares the same popover chrome. Children reference `--notification-fg`
// via `text-[var(--notification-fg)]` so text/icon/control color lives in one place for both
// toasts and inline notification banners.
//
// `[-webkit-app-region:no-drag]` keeps the card (and every control inside it,
// notably the dismiss "X") clickable in the desktop app. Toasts render at the
// top edge over Electron's draggable titlebar region; without this the OS
// captures clicks in that band for window dragging and the X stops working.
const NOTIFICATION_SURFACE_BASE_CLASS_NAME =
  "border border-border bg-popover/94 [--notification-fg:var(--popover-foreground)] text-[var(--notification-fg)] shadow-lg/10 backdrop-blur-xl before:hidden [-webkit-app-region:no-drag] dark:shadow-lg/15";

export const EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME = `w-full rounded-2xl ${NOTIFICATION_SURFACE_BASE_CLASS_NAME}`;

// The icon carries the tone color while the copy stays on the neutral
// `--notification-fg`, so tones only need to set `--notification-icon-fg`.
export const NOTIFICATION_ICON_CLASS_NAME =
  "text-[var(--notification-icon-fg,var(--notification-fg))]/92";

export type NotificationTone = "neutral" | "info" | "success" | "warning" | "error";

const TONE_COLOR_CLASS_NAME: Record<Exclude<NotificationTone, "neutral">, string> = {
  info: "[--notification-tone:var(--info)]",
  success: "[--notification-tone:var(--success)]",
  warning: "[--notification-tone:var(--warning)]",
  error: "[--notification-tone:var(--destructive)]",
};

// Toned cards keep the same geometry and swap the neutral popover for a light wash of the tone.
// The copy deliberately keeps the theme foreground instead of the role color, which reads muddy
// against the tint; the icon carries the color instead.
const TONED_SURFACE_CLASS_NAME =
  "border-[color-mix(in_srgb,var(--notification-tone)_16%,transparent)] bg-[color-mix(in_srgb,var(--notification-tone)_5%,var(--popover))] [--notification-icon-fg:var(--notification-tone)] dark:border-[color-mix(in_srgb,var(--notification-tone)_13%,transparent)] dark:bg-[color-mix(in_srgb,var(--notification-tone)_8%,var(--popover))]";

export function toastSurfaceClassName(tone: NotificationTone): string {
  return cn(
    "w-max max-w-full rounded-xl",
    NOTIFICATION_SURFACE_BASE_CLASS_NAME,
    tone !== "neutral" && [TONE_COLOR_CLASS_NAME[tone], TONED_SURFACE_CLASS_NAME],
  );
}
