import { nativeTheme } from "electron";

export function opaqueWindowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#111111" : "#e2e3e5";
}
