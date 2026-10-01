#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  devProcessRoots,
  selectGladeDevProcessIds,
  type DevProcess,
} from "./lib/gladeDevProcesses";

const dryRun = process.argv.slice(2).includes("--dry-run");
if (process.argv.slice(2).some((arg) => arg !== "--dry-run")) {
  console.error("Usage: bun run dev:stop [--dry-run]");
  process.exit(2);
}

function command(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout;
}

const gladeDirectoryCache = new Map<string, boolean>();
function isGladeDirectory(directory: string): boolean {
  let current = resolve(directory);
  const visited: string[] = [];
  while (true) {
    const cached = gladeDirectoryCache.get(current);
    if (cached !== undefined) {
      for (const path of visited) gladeDirectoryCache.set(path, cached);
      return cached;
    }
    visited.push(current);
    try {
      const manifest = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as {
        name?: string;
      };
      if (manifest.name === "@glade/monorepo") {
        for (const path of visited) gladeDirectoryCache.set(path, true);
        return true;
      }
    } catch {}
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const path of visited) gladeDirectoryCache.set(path, false);
  return false;
}

function posixProcesses(): DevProcess[] {
  const ownUid = process.getuid?.();
  const processes = command("ps", ["-axo", "pid=,ppid=,uid=,args="])
    .split("\n")
    .flatMap((line): DevProcess[] => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (!match || (ownUid !== undefined && Number(match[3]) !== ownUid)) return [];
      return [{ pid: Number(match[1]), parentPid: Number(match[2]), command: match[4]! }];
    });

  if (process.platform === "linux") {
    for (const entry of processes) {
      try {
        entry.cwd = readlinkSync(`/proc/${entry.pid}/cwd`);
      } catch {}
    }
    return processes;
  }

  const candidates = processes.filter((entry) =>
    /\bbun\b|\bnode\b|\bturbo\b|\bvite\b|\btsdown\b|Electron|glade-dev-/.test(entry.command),
  );
  for (let index = 0; index < candidates.length; index += 100) {
    const pids = candidates
      .slice(index, index + 100)
      .map((entry) => entry.pid)
      .join(",");
    const result = spawnSync("lsof", ["-a", "-p", pids, "-d", "cwd", "-Fn"], {
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    let pid = 0;
    const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      if (line.startsWith("n")) {
        const entry = byPid.get(pid);
        if (entry) entry.cwd = line.slice(1);
      }
    }
  }
  return processes;
}

function windowsProcesses(): DevProcess[] {
  const output = command("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
  ]);
  const decoded = JSON.parse(output) as
    | { ProcessId: number; ParentProcessId: number; CommandLine: string | null }
    | Array<{ ProcessId: number; ParentProcessId: number; CommandLine: string | null }>;
  return (Array.isArray(decoded) ? decoded : [decoded]).map((entry) => ({
    pid: entry.ProcessId,
    parentPid: entry.ParentProcessId,
    command: entry.CommandLine ?? "",
  }));
}

function snapshot(): DevProcess[] {
  return process.platform === "win32" ? windowsProcesses() : posixProcesses();
}

function terminate(pid: number, force: boolean): void {
  try {
    if (process.platform === "win32") {
      const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
      if (result.status !== 0) throw new Error(`taskkill exited ${result.status}`);
    } else {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
    console.error(`[dev:stop] Could not stop process ${pid}: ${String(error)}`);
    process.exitCode = 1;
  }
}

const initial = snapshot();
const selected = selectGladeDevProcessIds(initial, isGladeDirectory);
const roots = devProcessRoots(initial, selected);
if (roots.length === 0) {
  console.log("[dev:stop] No Glade development processes found.");
  process.exit(0);
}

console.log(
  `[dev:stop] ${dryRun ? "Would stop" : "Stopping"} ${roots.length} development process tree${roots.length === 1 ? "" : "s"} (${selected.size} processes): ${roots.map((entry) => entry.pid).join(", ")}`,
);
if (dryRun) process.exit(0);

const initialTargets = new Map(
  initial.filter((entry) => selected.has(entry.pid)).map((entry) => [entry.pid, entry]),
);
function remainingTargets(processes: DevProcess[]): DevProcess[] {
  const detected = selectGladeDevProcessIds(processes, isGladeDirectory);
  return processes.filter((entry) => {
    const original = initialTargets.get(entry.pid);
    return (
      detected.has(entry.pid) ||
      (original !== undefined && original.command === entry.command && original.cwd === entry.cwd)
    );
  });
}

for (const root of roots) terminate(root.pid, false);
await Bun.sleep(1_500);

const afterGrace = snapshot();
for (const entry of remainingTargets(afterGrace)) {
  terminate(entry.pid, false);
}
await Bun.sleep(750);

for (const entry of remainingTargets(snapshot())) {
  terminate(entry.pid, true);
}

await Bun.sleep(200);
const stillRunning = remainingTargets(snapshot());
if (stillRunning.length > 0) {
  console.error(`[dev:stop] ${stillRunning.length} development processes are still running.`);
  process.exitCode = 1;
} else {
  console.log("[dev:stop] Glade development processes stopped.");
}
