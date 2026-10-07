import type { DesktopComputerPermissions } from "@glade/contracts/ipc/ipc";
import { shell } from "electron";
import { loadCuaElectron, loadCuaSdk } from "./cuaSdk";

export interface ComputerPermissions {
  readonly read: () => Promise<DesktopComputerPermissions>;
  readonly request: () => Promise<DesktopComputerPermissions>;
  readonly openSettings: () => Promise<void>;
}

const ACCESSIBILITY_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

const NOT_APPLICABLE: DesktopComputerPermissions = {
  status: "not-applicable",
  accessibility: true,
  screenRecording: true,
};

const toPermissions = (status: {
  readonly accessibility: boolean;
  readonly screenRecording: boolean;
}): DesktopComputerPermissions => ({
  status: status.accessibility && status.screenRecording ? "granted" : "missing",
  accessibility: status.accessibility,
  screenRecording: status.screenRecording,
});

// The probes run in this (Electron main) process so macOS attributes the grants to Glade. Only
// macOS gates the driver on TCC; elsewhere there is nothing to grant.
export function createComputerPermissions(platform: NodeJS.Platform): ComputerPermissions {
  if (platform !== "darwin") {
    return {
      read: async () => NOT_APPLICABLE,
      request: async () => NOT_APPLICABLE,
      openSettings: async () => undefined,
    };
  }
  const read = async () => toPermissions((await loadCuaSdk()).currentMacOsPermissionStatus());
  return {
    read,
    request: async () => toPermissions((await loadCuaElectron()).requestMacOSPermissions()),
    // Screen Recording has no prompt on current macOS: the user adds Glade in its settings pane.
    openSettings: async () => {
      const status = await read();
      if (!status.screenRecording) {
        await (await loadCuaElectron()).openMacOSScreenRecordingSettings();
        return;
      }
      if (!status.accessibility) await shell.openExternal(ACCESSIBILITY_SETTINGS_URL);
    },
  };
}
