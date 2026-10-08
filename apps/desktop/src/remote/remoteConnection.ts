import type {
  DesktopSshConnectionState,
  DesktopSshHost,
  DesktopSshPrompt,
  DesktopSshTransferProgress,
} from "@glade/contracts/ipc/sshHosts";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as Net from "node:net";
import { waitForHttpReady } from "../backend/backendReadiness";
import type { RemoteServerBundleSource } from "./remoteServerBundle";
import { ensureRemoteServer } from "./remoteServerInstall";
import type { SshAskpass } from "./sshAskpass";
import { SshFailure, sshFailure, spawnSsh } from "./sshCommand";

const RETRY_BASE_MS = 1_000;
// Attempts are single ssh connects, so a short ceiling notices a returning network quickly.
const RETRY_MAX_MS = 10_000;
// A connection that drops sooner keeps its backoff, so a flapping host is not hammered.
const STABLE_CONNECTION_MS = 30_000;
const HEALTH_INTERVAL_MS = 15_000;

export interface RemoteConnection {
  readonly hostId: string;
  state(): DesktopSshConnectionState;
  // Resolves once the server is reachable for the first time. Only an interactive start may ask the
  // user for a password or host key.
  start(options: { readonly interactive: boolean }): Promise<void>;
  stop(): void;
  // After sleep or a network change: retry a waiting reconnect now and re-check a live server.
  wake(): void;
}

interface RemoteConnectionOptions {
  readonly host: DesktopSshHost;
  readonly version: string;
  readonly bundles: RemoteServerBundleSource;
  readonly devUrl: string | null;
  readonly askpass: SshAskpass;
  // The machine this host reached before, or null before its first connection.
  readonly knownMachine: () => string | null;
  readonly rememberMachine: (machineId: string) => void;
  readonly onState: (state: DesktopSshConnectionState) => void;
  // A background reconnect needs the user (a password, a host key) and stopped retrying.
  readonly onGaveUp: () => void;
  readonly log: (message: string) => void;
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
          : reject(new Error("Could not reserve a local port.")),
      );
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The host entry now reaches another machine (a reused alias or address). Its projects and chats
// live on the first machine, so connecting would mix two machines' data under one host.
class HostMachineChanged extends Error {}

function declinedMessage(kind: DesktopSshPrompt["kind"], host: DesktopSshHost): string {
  switch (kind) {
    case "host-key":
      return `Trust ${host.label}'s host key to connect.`;
    case "password":
      return `${host.label} needs your password.`;
    case "passphrase":
      return "Your SSH key needs its passphrase.";
    case "secret":
      return `${host.label} needs an answer to sign in.`;
  }
}

export function createRemoteConnection(options: RemoteConnectionOptions): RemoteConnection {
  const { host } = options;
  const session = options.askpass.openSession(host);
  let current: DesktopSshConnectionState = {
    hostId: host.id,
    phase: "connecting",
    detail: null,
    progress: null,
    issue: null,
    wsUrl: null,
  };
  let lastProgressAt = 0;
  let localPort: number | null = null;
  let endpoint: { remotePort: number; authToken: string } | null = null;
  let tunnel: ChildProcessWithoutNullStreams | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let healthTimer: NodeJS.Timeout | null = null;
  let serverLost = false;
  let retryAttempt = 0;
  let stableTimer: NodeJS.Timeout | null = null;
  let checkHealth: (() => void) | null = null;
  let failureIssue: DesktopSshConnectionState["issue"] = null;
  let stopped = false;

  function setState(
    phase: DesktopSshConnectionState["phase"],
    detail: string | null = null,
    progress: DesktopSshTransferProgress | null = null,
  ): void {
    // Transfers report every chunk; windows only need a few updates a second.
    const now = Date.now();
    const finished = progress !== null && progress.doneBytes >= progress.totalBytes;
    if (progress && phase === current.phase && !finished && now - lastProgressAt < 100) return;
    lastProgressAt = now;
    // The local port stays reserved across reconnects, so the address only changes when the
    // host's server is replaced and hands out a new token.
    const reachable = phase === "connected" || phase === "reconnecting";
    const wsUrl =
      reachable && localPort !== null && endpoint !== null
        ? `ws://127.0.0.1:${localPort}/?token=${encodeURIComponent(endpoint.authToken)}`
        : null;
    const issue = phase === "failed" ? failureIssue : null;
    current = { hostId: host.id, phase, detail, progress, issue, wsUrl };
    options.onState(current);
  }

  function openTunnel(port: number, remotePort: number): Promise<void> {
    const child = spawnSsh(session.target, {
      options: [
        "-N",
        "-o",
        "ExitOnForwardFailure=yes",
        "-L",
        `127.0.0.1:${port}:127.0.0.1:${remotePort}`,
      ],
      multiplex: false,
    });
    tunnel = child;
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.stdout.resume();
    child.stdin.end();
    const readiness = new AbortController();
    const exited = new Promise<never>((_, reject) => {
      child.once("error", (error) => reject(error));
      child.once("exit", (code) => {
        if (tunnel === child) tunnel = null;
        stopWatchingHealth();
        const failure = serverLost
          ? new Error("The Glade server on this host stopped. Starting it again.")
          : stderr.trim().length > 0
            ? sshFailure(code, stderr)
            : new Error("The SSH connection closed.");
        const reason = failure.message;
        serverLost = false;
        reject(failure);
        readiness.abort();
        if (!stopped && current.phase === "connected") {
          options.log(`ssh tunnel to ${host.destination} closed code=${code ?? "signal"}`);
          scheduleReconnect(reason);
        }
      });
    });
    const ready = waitForHttpReady(`http://127.0.0.1:${port}`, {
      signal: readiness.signal,
      path: "/health",
      timeoutMs: 60_000,
      intervalMs: 250,
      isReady: async (response) =>
        response.ok &&
        ((await response.json()) as { startupReady?: unknown }).startupReady === true,
    });
    exited.catch(() => undefined);
    return Promise.race([ready, exited]);
  }

  async function connect(): Promise<void> {
    failureIssue = null;
    const launch = await ensureRemoteServer({
      target: session.target,
      version: options.version,
      bundles: options.bundles,
      devUrl: options.devUrl,
      verifyMachine: (machineId) => {
        const known = options.knownMachine();
        if (known === null) options.rememberMachine(machineId);
        else if (known !== machineId) {
          failureIssue = "machine-changed";
          throw new HostMachineChanged(
            `${host.label} is not the machine Glade knew. Reconnect to set it up again.`,
          );
        }
      },
      onPhase: (phase, progress) => {
        if (current.phase !== "reconnecting") setState(phase, null, progress);
      },
    });
    if (stopped) return;
    localPort ??= await reserveLoopbackPort();
    endpoint = { remotePort: launch.port, authToken: launch.authToken };
    try {
      await openTunnel(localPort, launch.port);
    } catch (error) {
      tunnel?.kill();
      throw error;
    }
    if (stopped) {
      tunnel?.kill();
      return;
    }
    stableTimer = setTimeout(() => {
      retryAttempt = 0;
    }, STABLE_CONNECTION_MS);
    setState("connected");
    watchHealth(localPort);
  }

  // ssh keeps a forward open after the server behind it dies, so a refused health check through a
  // live tunnel means the server is gone. Timeouts are ignored: a busy server can stall for a minute.
  function watchHealth(port: number): void {
    stopWatchingHealth();
    let refusals = 0;
    checkHealth = () => {
      void fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(10_000) }).then(
        () => {
          refusals = 0;
        },
        (error: unknown) => {
          if (error instanceof DOMException && error.name === "TimeoutError") return;
          refusals += 1;
          if (refusals < 2 || current.phase !== "connected" || !tunnel) return;
          serverLost = true;
          tunnel.kill();
        },
      );
    };
    healthTimer = setInterval(checkHealth, HEALTH_INTERVAL_MS);
  }

  function stopWatchingHealth(): void {
    if (healthTimer) clearInterval(healthTimer);
    if (stableTimer) clearTimeout(stableTimer);
    healthTimer = null;
    stableTimer = null;
    checkHealth = null;
  }

  // A question nobody answered explains the failure better than ssh's own error. A rejected login
  // forgets remembered passwords, so the next interactive attempt asks again.
  function describeFailure(error: unknown): string {
    if (error instanceof SshFailure && error.authRejected) options.askpass.forgetSecrets(host.id);
    const declined = session.declined();
    if (declined) failureIssue = "needs-sign-in";
    return declined ? declinedMessage(declined, host) : errorMessage(error);
  }

  function scheduleReconnect(reason: string): void {
    if (stopped || retryTimer) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
    retryAttempt += 1;
    setState("reconnecting", reason);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      session.setInteractive(false);
      connect().catch((error: unknown) => {
        const message = describeFailure(error);
        options.log(`ssh reconnect to ${host.destination} failed: ${message}`);
        if (session.declined() === null && !(error instanceof HostMachineChanged)) {
          scheduleReconnect(message);
          return;
        }
        // Retrying cannot help until the user answers; they reconnect from the host's status.
        stopped = true;
        stopWatchingHealth();
        setState("failed", message);
        options.onGaveUp();
      });
    }, delay);
  }

  return {
    hostId: host.id,
    state: () => current,
    async start({ interactive }) {
      setState("connecting");
      session.setInteractive(interactive);
      try {
        await connect();
      } catch (error) {
        const message = describeFailure(error);
        setState("failed", message);
        throw new Error(message, { cause: error });
      } finally {
        session.setInteractive(false);
      }
    },
    wake() {
      if (stopped) return;
      if (!retryTimer) {
        checkHealth?.();
        return;
      }
      clearTimeout(retryTimer);
      retryTimer = null;
      retryAttempt = 0;
      scheduleReconnect(current.detail ?? "Reconnecting…");
    },
    stop() {
      stopped = true;
      session.close();
      stopWatchingHealth();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      tunnel?.kill();
      tunnel = null;
    },
  };
}
