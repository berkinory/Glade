import { DesktopMenuShortcutState } from "@glade/contracts/ipc/menuShortcuts";
import type { IpcMain, WebContents } from "electron";
import { Option, Schema } from "effect";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

const decodeShortcutState = Schema.decodeUnknownOption(DesktopMenuShortcutState);

export function registerMenuShortcutsIpc(
  ipc: Pick<IpcMain, "removeHandler" | "handle">,
  mainContents: () => WebContents | null,
  apply: (state: DesktopMenuShortcutState) => void,
): void {
  ipc.removeHandler(DESKTOP_IPC_CHANNELS.setMenuShortcuts);
  ipc.handle(DESKTOP_IPC_CHANNELS.setMenuShortcuts, (event, payload: unknown) => {
    const owner = mainContents();
    if (
      !owner ||
      owner.isDestroyed() ||
      event.sender !== owner ||
      event.senderFrame !== owner.mainFrame
    )
      throw new Error("Untrusted menu shortcut sender.");
    const state = decodeShortcutState(payload, { onExcessProperty: "error" });
    if (Option.isNone(state)) throw new Error("Invalid menu shortcuts.");
    apply(state.value);
  });
}
