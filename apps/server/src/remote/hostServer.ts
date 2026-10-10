import type { RemoteServerLaunch } from "@glade/contracts/remote/remoteServer";
import {
  compareRemoteServerVersions,
  REMOTE_SERVER_ROOT,
} from "@glade/shared/remote/remoteServerBundle";
import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

// The one Glade server of this machine's `~/.glade/remote`: started detached for an SSH connection
// or `glade start`, or in the foreground under a service manager. Both paths share one record, so
// the desktop and the `glade` command always find the same server.

export interface ServerRecord extends RemoteServerLaunch {
  readonly pid: number;
  readonly shutdownToken: string;
  // The runtime directory the server runs from, which names one build of one version.
  readonly runtime?: string;
  // A development desktop loads its renderer from a dev server, which the host's server must trust
  // as an origin; packaged desktops use the app scheme it always trusts.
  readonly devUrl?: string | null;
}

export class LaunchError extends Error {}

const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 25_000;
const LOCK_STALE_MS = 3 * 60_000;

const bundleRoot = Path.resolve(import.meta.dirname, "..");
const runtimeRoot = Path.dirname(bundleRoot);
const runtime = Path.basename(bundleRoot);
const STALE_INSTALL_MS = 60 * 60_000;
export const rootDir = Path.join(OS.homedir(), REMOTE_SERVER_ROOT);
const recordPath = Path.join(rootDir, "server.json");
const lockPath = Path.join(rootDir, "launch.lock");
export const logPath = Path.join(rootDir, "server.log");

export function bundleVersion(): string {
  const manifest: unknown = JSON.parse(
    FS.readFileSync(Path.join(bundleRoot, "package.json"), "utf8"),
  );
  const version =
    typeof manifest === "object" && manifest !== null && "version" in manifest
      ? manifest.version
      : null;
  if (typeof version !== "string") throw new LaunchError("The server bundle has no version.");
  return version;
}

export function readRecord(): ServerRecord | null {
  try {
    const value: unknown = JSON.parse(FS.readFileSync(recordPath, "utf8"));
    if (typeof value !== "object" || value === null) return null;
    const record = value as Partial<ServerRecord>;
    return typeof record.pid === "number" &&
      typeof record.port === "number" &&
      typeof record.version === "string" &&
      typeof record.authToken === "string" &&
      typeof record.shutdownToken === "string"
      ? (record as ServerRecord)
      : null;
  } catch {
    return null;
  }
}

function writeRecord(record: ServerRecord): void {
  const temporary = `${recordPath}.${process.pid}.tmp`;
  FS.writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  FS.renameSync(temporary, recordPath);
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function isReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "startupReady" in body
      ? body.startupReady === true
      : false;
  } catch {
    return false;
  }
}

async function waitForReady(record: ServerRecord): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isAlive(record.pid)) {
      throw new LaunchError(`The Glade server exited during startup.\n${logTail()}`);
    }
    if (await isReady(record.port)) return;
    await sleep(250);
  }
  throw new LaunchError(`The Glade server did not become ready in time.\n${logTail()}`);
}

function logTail(): string {
  try {
    return FS.readFileSync(logPath, "utf8").split("\n").slice(-40).join("\n");
  } catch {
    return "";
  }
}

async function stopServer(record: ServerRecord): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${record.port}/api/desktop/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${record.shutdownToken}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // A server that cannot answer is signalled below.
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (isAlive(record.pid) && Date.now() < deadline) await sleep(250);
  if (isAlive(record.pid)) {
    process.kill(record.pid, "SIGTERM");
    await sleep(5_000);
  }
  if (isAlive(record.pid)) {
    throw new LaunchError(`The previous Glade server (process ${record.pid}) did not stop.`);
  }
}

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = Net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new LaunchError("Could not reserve a loopback port.")),
      );
    });
  });
}

// Detached for an SSH connection or `glade start`, so the server outlives the session; attached when a
// service manager supervises it through `glade run`.
async function startServer(
  version: string,
  devUrl: string | null,
  detached: boolean,
): Promise<{ readonly record: ServerRecord; readonly child: ChildProcess.ChildProcess }> {
  const port = await reserveLoopbackPort();
  const authToken = Crypto.randomBytes(32).toString("hex");
  const shutdownToken = Crypto.randomBytes(32).toString("hex");
  const log = FS.openSync(logPath, "a", 0o600);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GLADE_MODE: "desktop",
    GLADE_NO_BROWSER: "1",
    GLADE_HOST: "127.0.0.1",
    GLADE_PORT: String(port),
    GLADE_HOME: Path.join(rootDir, "home"),
    GLADE_AUTH_TOKEN: authToken,
    GLADE_DESKTOP_SHUTDOWN_TOKEN: shutdownToken,
    ...(devUrl ? { VITE_DEV_SERVER_URL: devUrl } : {}),
  };
  // The server outlives this SSH session, so it must not inherit a parent-lifetime pipe or a PATH
  // marker; it probes the user's login shell itself.
  delete env.GLADE_DESKTOP_PARENT_STDIN;
  delete env.GLADE_PATH_HYDRATED;
  const child = ChildProcess.spawn(process.execPath, [Path.join(bundleRoot, "dist/index.mjs")], {
    cwd: OS.homedir(),
    detached,
    stdio: ["ignore", log, log],
    env,
  });
  FS.closeSync(log);
  if (child.pid === undefined) throw new LaunchError("Could not start the Glade server.");
  if (detached) child.unref();
  const record = { version, port, authToken, shutdownToken, devUrl, runtime, pid: child.pid };
  writeRecord(record);
  return { record, child };
}

async function withLaunchLock<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + READY_TIMEOUT_MS + STOP_TIMEOUT_MS;
  for (;;) {
    try {
      FS.mkdirSync(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lock = FS.statSync(lockPath, { throwIfNoEntry: false });
      if (!lock) continue;
      if (Date.now() - lock.mtimeMs > LOCK_STALE_MS) {
        FS.rmSync(lockPath, { recursive: true, force: true });
      } else if (Date.now() > deadline)
        throw new LaunchError("Another connection is starting Glade.");
      else await sleep(500);
    }
  }
  try {
    return await operation();
  } finally {
    FS.rmSync(lockPath, { recursive: true, force: true });
  }
}

// Keeps the running build and this launcher's own; every other build is unused once the host's
// server moved on. Abandoned install staging directories go after an hour.
function removeStaleRuntimes(keep: ReadonlySet<string | undefined>): void {
  for (const entry of FS.readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;
    const path = Path.join(runtimeRoot, entry.name);
    const stale =
      entry.name.startsWith("glade-remote-server-") ||
      (entry.name.startsWith(".install.") &&
        Date.now() - FS.statSync(path).mtimeMs > STALE_INSTALL_MS);
    if (stale) FS.rmSync(path, { recursive: true, force: true });
  }
}

export async function ensureServer(devUrl: string | null): Promise<RemoteServerLaunch> {
  FS.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  const version = bundleVersion();
  const record = await withLaunchLock(async () => {
    const existing = readRecord();
    if (existing && isAlive(existing.pid)) {
      const sameBuild = existing.runtime === runtime && (existing.devUrl ?? null) === devUrl;
      // Another desktop may have upgraded the host meanwhile. An older server cannot open the
      // database a newer one migrated, so the newer server keeps running.
      if (sameBuild || compareRemoteServerVersions(existing.version, version) > 0) {
        await waitForReady(existing);
        return existing;
      }
      await stopServer(existing);
    }
    const { record: started } = await startServer(version, devUrl, true);
    await waitForReady(started);
    return started;
  });
  try {
    removeStaleRuntimes(new Set([runtime, record.runtime]));
  } catch (error) {
    // Cleanup only reclaims disk space; the server is already up.
    process.stderr.write(`Could not remove old Glade builds: ${String(error)}\n`);
  }
  return { version: record.version, port: record.port, authToken: record.authToken };
}

// Stops the recorded server, if one runs. Returns whether there was one.
export async function stopRunningServer(): Promise<boolean> {
  return withLaunchLock(async () => {
    const existing = readRecord();
    if (!existing || !isAlive(existing.pid)) return false;
    await stopServer(existing);
    return true;
  });
}

// Runs the server under a service manager until it exits. A newer server another desktop started
// keeps running instead, since an older one cannot open the database it migrated; the service then
// ends cleanly rather than restarting into the same refusal.
export async function runServerAttached(): Promise<number> {
  FS.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  const version = bundleVersion();
  const started = await withLaunchLock(async () => {
    const existing = readRecord();
    if (existing && isAlive(existing.pid)) {
      if (compareRemoteServerVersions(existing.version, version) > 0) return null;
      await stopServer(existing);
    }
    const next = await startServer(version, null, false);
    await waitForReady(next.record);
    return next;
  });
  if (!started) {
    process.stderr.write("A newer Glade server is already running; leaving it in charge.\n");
    return 0;
  }
  try {
    removeStaleRuntimes(new Set([runtime]));
  } catch (error) {
    process.stderr.write(`Could not remove old Glade builds: ${String(error)}\n`);
  }
  const forward = (signal: NodeJS.Signals) => started.child.kill(signal);
  process.on("SIGTERM", forward);
  process.on("SIGINT", forward);
  return new Promise((resolve) => started.child.once("exit", (code) => resolve(code ?? 1)));
}

// Waits for the recorded server to answer, for a service the caller just started.
export async function waitForRunningServer(timeoutMs = READY_TIMEOUT_MS): Promise<ServerRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = readRecord();
    if (record && isAlive(record.pid) && (await isReady(record.port))) return record;
    await sleep(250);
  }
  throw new LaunchError(`Glade did not start in time.\n${logTail()}`);
}
