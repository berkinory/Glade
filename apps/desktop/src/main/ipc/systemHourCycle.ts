import type { DesktopHourCycle } from "@glade/contracts/ipc/ipc";
import { app, systemPreferences } from "electron";

// The renderer formats with Chromium's UI language (often en-US), which loses both a region whose
// clock is 24-hour (en-TR) and the macOS "24-hour time" override.
// V8 ships Intl.Locale#getHourCycles, but TypeScript's lib does not declare it yet.
type LocaleWithHourCycles = Intl.Locale & { getHourCycles(): ReadonlyArray<string> };

// Answers a synchronous IPC call, so it must not throw: an unanswered sendSync freezes the renderer.
export function resolveSystemHourCycle(): DesktopHourCycle | null {
  if (process.platform === "darwin") {
    if (systemPreferences.getUserDefault("AppleICUForce24HourTime", "boolean")) return "h23";
    if (systemPreferences.getUserDefault("AppleICUForce12HourTime", "boolean")) return "h12";
  }
  // Linux reports POSIX locales such as LANG=C.UTF-8 as "en-US@posix", which Intl.Locale rejects.
  const [tag = ""] = app.getSystemLocale().split("@");
  let locale: LocaleWithHourCycles;
  try {
    locale = new Intl.Locale(tag) as LocaleWithHourCycles;
  } catch {
    return null;
  }
  const [preferred] = locale.getHourCycles();
  return preferred === "h23" || preferred === "h24" ? "h23" : "h12";
}
