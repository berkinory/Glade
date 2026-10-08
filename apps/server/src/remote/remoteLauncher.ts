import {
  REMOTE_SERVER_LAUNCH_MARKER,
  type RemoteServerLaunch,
} from "@glade/contracts/remote/remoteServer";
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

// Runs on the SSH host under the bundled Node runtime. It starts one long-lived server per host,
// detached from the SSH session, and answers every connect with that server's port and token.

interface ServerRecord extends RemoteServerLaunch {
  readonly pid: number;
  readonly shutdownToken: string;
  // The runtime directory the server runs from, which names one build of one version.
  readonly runtime?: string;
  // A development desktop loads its renderer from a dev server, which the host's server must trust
  // as an origin; packaged desktops use the app scheme it always trusts.
  readonly devUrl?: string | null;
}

class LaunchError extends Error {}

const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 25_000;
const LOCK_STALE_MS = 3 * 60_000;

const bundleRoot = Path.resolve(import.meta.dirname, "..");
const runtimeRoot = Path.dirname(bundleRoot);
const runtime = Path.basename(bundleRoot);
const STALE_INSTALL_MS = 60 * 60_000;
const rootDir = Path.join(OS.homedir(), REMOTE_SERVER_ROOT);
const recordPath = Path.join(rootDir, "server.json");
const lockPath = Path.join(rootDir, "launch.lock");
const logPath = Path.join(rootDir, "server.log");

function bundleVersion(): string {
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

function readRecord(): ServerRecord | null {
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

function isAlive(pid: number): boolean {
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

async function startServer(version: string, devUrl: string | null): Promise<ServerRecord> {
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
    detached: true,
    stdio: ["ignore", log, log],
    env,
  });
  FS.closeSync(log);
  if (child.pid === undefined) throw new LaunchError("Could not start the Glade server.");
  child.unref();
  const record = { version, port, authToken, shutdownToken, devUrl, runtime, pid: child.pid };
  writeRecord(record);
  return record;
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

async function ensureServer(devUrl: string | null): Promise<RemoteServerLaunch> {
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
    const started = await startServer(version, devUrl);
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

async function main(): Promise<void> {
  const [command, flag, devUrl] = process.argv.slice(2);
  if (command !== "start" || (flag !== undefined && (flag !== "--dev-url" || !devUrl))) {
    throw new LaunchError("Usage: remoteLauncher start [--dev-url <url>]");
  }
  const launch = await ensureServer(devUrl ?? null);
  process.stdout.write(`${REMOTE_SERVER_LAUNCH_MARKER}${JSON.stringify(launch)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
