import { spawn } from "node:child_process";

import { buildNotificationPermissions } from "./build-notification-permissions.mjs";
import { buildComputerHelper } from "./build-computer-helper.mjs";
import { configureMacLauncher, desktopDir, resolveElectronPath } from "./electron-launcher.mjs";
import { spawnSourceDesktop } from "./source-desktop-launch.mjs";

if (process.platform === "darwin") {
  buildComputerHelper({ arch: process.arch });
  buildNotificationPermissions();
}

const electronPath = resolveElectronPath();
if (process.platform === "darwin") configureMacLauncher(electronPath);
const child = spawnSourceDesktop({
  desktopDirectory: desktopDir,
  electronPath,
  spawnProcess: spawn,
  launchViaMacOS: process.platform === "darwin",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
