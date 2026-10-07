import { BROWSER_TABS_CHANGED_NOTIFICATION } from "@glade/contracts/browser/browserHost";
import * as Crypto from "node:crypto";
import { createBrowserHostDispatch } from "../browser/browserHostDispatch";
import { BrowserTabs } from "../browser/browserTabs";
import { startDesktopHostRpcServer } from "./desktopHostRpcServer";

export interface DesktopHost {
  readonly path: string;
  readonly token: string;
  readonly close: () => Promise<void>;
}

// Must run after Electron is ready: tabs create WebContentsViews on the browser partition.
export async function startDesktopHost(input: {
  readonly gladePorts: () => ReadonlySet<number>;
}): Promise<DesktopHost> {
  const token = Crypto.randomBytes(32).toString("base64url");
  let notify: (method: string, params: unknown) => void = () => undefined;
  const tabs = new BrowserTabs({
    gladePorts: input.gladePorts,
    onChanged: (states) => notify(BROWSER_TABS_CHANGED_NOTIFICATION, { tabs: states }),
  });
  const server = await startDesktopHostRpcServer({
    token,
    dispatch: createBrowserHostDispatch(tabs, input.gladePorts),
  });
  notify = server.notify;
  return {
    path: server.path,
    token,
    close: async () => {
      tabs.closeAll();
      await server.close();
    },
  };
}
