// FILE: dev.mjs
// Purpose: Runs the desktop bundle watcher and Electron watcher together in dev.
// Layer: Desktop dev script
// Depends on: package.json scripts `dev:bundle` and `dev:electron`

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

process.title = "glade-desktop-dev";

const bunExecutable = process.execPath;
const serverDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../server");
const childProcesses = [];
let isShuttingDown = false;

const initialServerBuild = spawn(bunExecutable, ["tsdown"], {
  cwd: serverDirectory,
  stdio: "inherit",
  env: process.env,
});
const initialServerBuildExit = await new Promise((resolveExit, reject) => {
  initialServerBuild.once("error", reject);
  initialServerBuild.once("exit", (code, signal) => resolveExit({ code, signal }));
});
if (initialServerBuildExit.code !== 0) {
  console.error("[desktop-dev] Initial server build failed", initialServerBuildExit);
  process.exit(1);
}

// Start one named Bun script and stream its output into the current terminal.
function startScript(scriptName, cwd) {
  const child = spawn(bunExecutable, ["run", scriptName], {
    ...(cwd ? { cwd } : {}),
    stdio: "inherit",
    env: process.env,
  });

  childProcesses.push(child);
  return child;
}

function stopAll(signal = "SIGTERM") {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  for (const child of childProcesses) {
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }
    child.kill(signal);
  }
}

function wireExit(child, scriptName) {
  child.once("exit", (code, signal) => {
    if (isShuttingDown) {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
      return;
    }

    stopAll(signal ?? "SIGTERM");
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.once("error", (error) => {
    console.error(`[desktop-dev] Failed to start ${scriptName}`, error);
    stopAll();
    process.exit(1);
  });
}

const bundleWatcher = startScript("dev:bundle");
const serverWatcher = startScript("dev:bundle", serverDirectory);
const electronWatcher = startScript("dev:electron");

wireExit(bundleWatcher, "dev:bundle");
wireExit(serverWatcher, "server dev:bundle");
wireExit(electronWatcher, "dev:electron");

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    stopAll(signal);
  });
}
