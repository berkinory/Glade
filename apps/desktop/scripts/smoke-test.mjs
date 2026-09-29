import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureMacLauncher, resolveElectronPath } from "./electron-launcher.mjs";

import { GLADE_DESKTOP_SMOKE_USER_DATA_ENV } from "@glade/shared/desktopIdentity";
import { spawnSourceDesktop } from "./source-desktop-launch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const smokeHome = mkdtempSync(join(tmpdir(), "glade-desktop-smoke-"));
const environment = {
  ...process.env,
  ELECTRON_ENABLE_LOGGING: "1",
  GLADE_HOME: smokeHome,
  [GLADE_DESKTOP_SMOKE_USER_DATA_ENV]: join(smokeHome, "electron-user-data"),
};

delete environment.VITE_DEV_SERVER_URL;
delete environment.GLADE_AUTH_TOKEN;

console.log("\nLaunching Electron smoke test...");

const electronPath = resolveElectronPath();
if (process.platform === "darwin") configureMacLauncher(electronPath, environment);

const child = spawnSourceDesktop({
  desktopDirectory: desktopDir,
  electronPath,
  spawnProcess: spawn,
  stdio: ["pipe", "pipe", "pipe"],
  environment,
});

let output = "";
let forceExit;
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill();
  // This fresh, empty profile never starts a provider turn or desktop input. A modal startup error
  // must not leave the unattended smoke run hanging.
  forceExit = setTimeout(() => child.kill("SIGKILL"), 5_000);
}, 20_000);

function finish(exitCode) {
  rmSync(smokeHome, { recursive: true, force: true });
  process.exit(exitCode);
}

child.on("error", (error) => {
  clearTimeout(timeout);
  clearTimeout(forceExit);
  console.error("Desktop smoke test failed to launch:", error);
  finish(1);
});

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  clearTimeout(forceExit);

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
    "StartupError:",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));
  if (!output.includes("Glade running")) failures.push("Backend did not report readiness");
  if (code !== 0 && signal !== "SIGTERM")
    failures.push(`Unexpected exit: code=${code} signal=${signal}`);

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    finish(1);
  }

  console.log("Desktop smoke test passed.");
  finish(0);
});
