import { spawn } from "node:child_process";
import waitOn from "wait-on";

import { buildNotificationPermissions } from "./build-notification-permissions.mjs";
import { buildComputerHelper } from "./build-computer-helper.mjs";
import { configureMacLauncher, desktopDir, resolveElectronPath } from "./electron-launcher.mjs";
import { spawnSourceDesktop } from "./source-desktop-launch.mjs";

const isDevBuild = Boolean(process.env.VITE_DEV_SERVER_URL);

if (isDevBuild) {
  await waitOn({
    resources: [process.env.VITE_DEV_SERVER_URL.replace(/^(https?):/, "$1-get:")],
    timeout: 120_000,
  });
}

if (process.platform === "darwin") {
  buildComputerHelper({ arch: process.arch });
  if (!isDevBuild) buildNotificationPermissions();
}

const electronPath = resolveElectronPath();
if (process.platform === "darwin") configureMacLauncher(electronPath);
const child = spawnSourceDesktop({
  desktopDirectory: desktopDir,
  electronPath,
  spawnProcess: spawn,
  launchViaMacOS: process.platform === "darwin" && !isDevBuild,
});

if (isDevBuild) {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      child.kill(signal);
    });
  }
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
