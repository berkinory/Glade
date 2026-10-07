import { ipcMain } from "electron";
import type { CuaHost } from "../../computer/cuaHost";
import type { ComputerPermissions } from "../../computer/cuaPermissions";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

// Each call also nudges the driver host to re-read the grants, so it starts as soon as the user
// grants them instead of on the next poll.
export function registerComputerPermissionsIpc(
  permissions: ComputerPermissions,
  host: () => CuaHost | null,
): void {
  const withRefresh =
    <T>(operation: () => Promise<T>) =>
    async () => {
      try {
        return await operation();
      } finally {
        host()?.refresh();
      }
    };
  for (const [channel, operation] of [
    [DESKTOP_IPC_CHANNELS.computerPermissionsGet, permissions.read],
    [DESKTOP_IPC_CHANNELS.computerPermissionsRequest, permissions.request],
    [DESKTOP_IPC_CHANNELS.computerPermissionsOpenSettings, permissions.openSettings],
  ] as const) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, withRefresh<unknown>(operation));
  }
}
