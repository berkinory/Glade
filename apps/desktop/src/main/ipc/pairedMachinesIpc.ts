import { ipcMain } from "electron";
import type { PairedMachines } from "../../remote/paired/pairedMachines";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

function requireId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    throw new Error("Invalid machine id.");
  }
  return value;
}

function requireLink(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    throw new Error("Invalid pairing link.");
  }
  return value;
}

export function registerPairedMachinesIpc(machines: PairedMachines): void {
  const handlers: ReadonlyArray<readonly [string, (payload: unknown) => unknown]> = [
    [DESKTOP_IPC_CHANNELS.pairedMachinesList, () => machines.list()],
    [DESKTOP_IPC_CHANNELS.pairedMachinesGetStates, () => machines.states()],
    [DESKTOP_IPC_CHANNELS.pairedMachinesAdd, (payload) => machines.add(requireLink(payload))],
    [DESKTOP_IPC_CHANNELS.pairedMachinesRemove, (payload) => machines.remove(requireId(payload))],
    [DESKTOP_IPC_CHANNELS.pairedMachinesConnect, (payload) => machines.connect(requireId(payload))],
  ];
  for (const [channel, handle] of handlers) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_event, payload: unknown) => handle(payload));
  }
}
