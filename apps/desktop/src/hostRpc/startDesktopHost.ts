import { BROWSER_TABS_CHANGED_NOTIFICATION } from "@glade/contracts/browser/browserHost";
import {
  COMPUTER_CONNECTION_NOTIFICATION,
  COMPUTER_KILL_SWITCH_NOTIFICATION,
} from "@glade/contracts/computer/computerHost";
import { session, type BrowserWindow } from "electron";
import * as Crypto from "node:crypto";
import { createBrowserHostDispatch } from "../browser/browserHostDispatch";
import { BROWSER_PARTITION } from "../browser/browserTab";
import { BrowserTabs } from "../browser/browserTabs";
import { createBrowserViewParking } from "../browser/browserViewParking";
import { ContentBlocker } from "../browser/contentBlocker";
import { BrowserViewSurface } from "../browser/browserViewSurface";
import { dispatchComputerHost } from "../computer/computerHostDispatch";
import { createComputerKillSwitch } from "../computer/computerKillSwitch";
import type { CuaBinary } from "../computer/cuaBinary";
import { startCuaHost, type CuaHost } from "../computer/cuaHost";
import type { ComputerPermissions } from "../computer/cuaPermissions";
import { startDesktopHostRpcServer } from "./desktopHostRpcServer";

export interface DesktopHost {
  readonly path: string;
  readonly token: string;
  readonly tabs: BrowserTabs;
  readonly views: BrowserViewSurface;
  readonly blocker: ContentBlocker;
  readonly computer: CuaHost;
  readonly close: () => Promise<void>;
}

// Must run after Electron is ready: tabs create WebContentsViews on the browser partition, and the
// macOS permission probes need the app's identity.
export async function startDesktopHost(input: {
  readonly gladePorts: () => ReadonlySet<number>;
  readonly mainWindow: () => BrowserWindow | null;
  readonly contentBlocker: { readonly cache: string; readonly setting: string };
  readonly log: (message: string) => void;
  readonly computer: {
    readonly binary: Promise<CuaBinary>;
    readonly permissions: ComputerPermissions;
    readonly hostBundleId: string;
    readonly log: (message: string) => void;
  };
}): Promise<DesktopHost> {
  const token = Crypto.randomBytes(32).toString("base64url");
  let notify: (method: string, params: unknown) => void = () => undefined;
  const blocker = new ContentBlocker(
    session.fromPartition(BROWSER_PARTITION),
    input.contentBlocker,
    input.log,
  );
  blocker.start();
  const parking = createBrowserViewParking(process.platform, input.mainWindow);
  const tabs = new BrowserTabs({
    gladePorts: input.gladePorts,
    onChanged: (states) => notify(BROWSER_TABS_CHANGED_NOTIFICATION, { tabs: states }),
    blocker,
    parking,
  });
  const browserDispatch = createBrowserHostDispatch(tabs, input.gladePorts, blocker);
  const killSwitch = createComputerKillSwitch({
    onPressed: () => notify(COMPUTER_KILL_SWITCH_NOTIFICATION, {}),
    log: input.computer.log,
  });
  const computer = startCuaHost({
    ...input.computer,
    publish: (connection) => {
      killSwitch.setEnabled(connection.state === "ready");
      notify(COMPUTER_CONNECTION_NOTIFICATION, connection);
    },
  });
  const server = await startDesktopHostRpcServer({
    token,
    dispatch: (method, params) =>
      method.startsWith("computer.")
        ? dispatchComputerHost(method, params)
        : browserDispatch(method, params),
    onAuthenticated: () => {
      tabs.announce();
      notify(COMPUTER_CONNECTION_NOTIFICATION, computer.connection());
    },
  });
  notify = server.notify;
  return {
    path: server.path,
    token,
    tabs,
    views: new BrowserViewSurface(tabs, parking),
    blocker,
    computer,
    close: async () => {
      tabs.closeAll();
      blocker.stop();
      killSwitch.dispose();
      await computer.stop();
      await server.close();
    },
  };
}
