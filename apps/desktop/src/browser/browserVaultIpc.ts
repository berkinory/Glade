import { BrowserVaultSettings } from "@glade/contracts/browser/browserVault";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { Schema } from "effect";
import type { DesktopBrowserManager } from "./browserManager";
import type { BrowserVault } from "./automation/browserVault";
import { BROWSER_IPC_CHANNELS } from "../main/ipc/ipcChannels";

const Response = Schema.Struct({ id: Schema.String, save: Schema.Boolean });
const Password = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024));
const Reveal = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(256)),
  password: Password,
});

export function registerBrowserVaultIpc(
  ipcMain: IpcMain,
  manager: DesktopBrowserManager,
  vault: BrowserVault,
  notify: () => void,
): () => void {
  const channels = BROWSER_IPC_CHANNELS.vault;
  const handle = (channel: string, action: (input: unknown) => unknown) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, input: unknown) => {
      if (
        !manager.isTrustedRenderer(event.sender.id) ||
        event.senderFrame !== event.sender.mainFrame
      ) {
        throw new Error("Browser vault access denied.");
      }
      try {
        return await action(input);
      } catch {
        throw new Error("The browser vault operation could not be completed.");
      }
    });
  };
  handle(channels.snapshot, () => vault.snapshot());
  handle(channels.configure, (input) =>
    vault.configure(Schema.decodeUnknownSync(BrowserVaultSettings)(input)),
  );
  handle(channels.remove, (input) => vault.remove(Schema.decodeUnknownSync(Schema.String)(input)));
  handle(channels.respond, (input) => vault.respond(Schema.decodeUnknownSync(Response)(input)));
  handle(channels.setupMaster, (input) =>
    vault.setupMaster(Schema.decodeUnknownSync(Password)(input)),
  );
  handle(channels.unlock, (input) => vault.unlock(Schema.decodeUnknownSync(Password)(input)));
  handle(channels.lock, () => vault.lock());
  handle(channels.reveal, (input) => vault.reveal(Schema.decodeUnknownSync(Reveal)(input)));
  const unsubscribe = vault.onChanged(notify);
  return () => {
    unsubscribe();
    for (const channel of Object.values(channels))
      if (channel !== channels.changed) ipcMain.removeHandler(channel);
  };
}
