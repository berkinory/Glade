import type { DesktopPairedMachine } from "@glade/contracts/ipc/pairedMachines";
import type { DesktopSshConnectionState } from "@glade/contracts/ipc/sshHosts";
import { ENVIRONMENT_DESCRIPTOR_PATH } from "@glade/contracts/workspace/environment";
import * as Crypto from "node:crypto";
import { createMachineProxy, type MachineProxy } from "./machineProxy";
import type { PairedMachineRecord, PairedMachinesStore } from "./pairedMachinesStore";
import { parsePairingLink } from "./pairingLink";

const PROBE_TIMEOUT_MS = 5_000;
const RETRY_MS = 15_000;
const CLIENT_LABEL = "Glade desktop";

export interface PairedMachines {
  list(): ReadonlyArray<DesktopPairedMachine>;
  states(): ReadonlyArray<DesktopSshConnectionState>;
  add(link: string): Promise<DesktopPairedMachine>;
  remove(id: string): Promise<void>;
  connect(id: string): Promise<void>;
  connectAll(): void;
  stop(): Promise<void>;
}

function publicView(record: PairedMachineRecord): DesktopPairedMachine {
  return {
    id: record.id,
    label: record.label,
    environmentId: record.environmentId,
    address: record.address,
  };
}

async function readDescriptor(
  baseUrl: string,
): Promise<{ environmentId: string; label: string } | null> {
  try {
    const response = await fetch(new URL(ENVIRONMENT_DESCRIPTOR_PATH, baseUrl), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { environmentId?: unknown; label?: unknown };
    return typeof body.environmentId === "string" && typeof body.label === "string"
      ? { environmentId: body.environmentId, label: body.label }
      : null;
  } catch {
    return null;
  }
}

// The first route that answers as the expected machine. A route that answers as another machine (a
// LAN address reused on another network) is skipped before it ever sees the session token.
async function findRoute(
  routes: ReadonlyArray<string>,
  environmentId: string | null,
): Promise<{ url: string; environmentId: string; label: string } | null> {
  for (const url of routes) {
    const descriptor = await readDescriptor(url);
    if (descriptor && (environmentId === null || descriptor.environmentId === environmentId)) {
      return { url, ...descriptor };
    }
  }
  return null;
}

export function createPairedMachines(input: {
  readonly store: PairedMachinesStore;
  readonly allowedOrigins: ReadonlySet<string>;
  // Servers this app already reaches another way (SSH host tunnels). The same server under two
  // environments would show every project and chat twice.
  readonly otherServerUrls: () => ReadonlyArray<string>;
  readonly publish: (states: ReadonlyArray<DesktopSshConnectionState>) => void;
  readonly log: (message: string) => void;
}): PairedMachines {
  const proxies = new Map<string, MachineProxy>();
  const stateById = new Map<string, DesktopSshConnectionState>();
  const retryTimers = new Map<string, NodeJS.Timeout>();
  const inFlight = new Map<string, Promise<void>>();
  const upstreamUrlById = new Map<string, string>();

  const setState = (
    id: string,
    patch: Pick<DesktopSshConnectionState, "phase" | "detail" | "issue" | "wsUrl">,
  ) => {
    stateById.set(id, { hostId: id, progress: null, ...patch });
    input.publish([...stateById.values()]);
  };

  const scheduleRetry = (id: string) => {
    if (retryTimers.has(id)) return;
    retryTimers.set(
      id,
      setTimeout(() => {
        retryTimers.delete(id);
        void connect(id).catch(() => undefined);
      }, RETRY_MS),
    );
  };

  const proxyFor = async (id: string): Promise<MachineProxy> => {
    const existing = proxies.get(id);
    if (existing) return existing;
    const proxy = await createMachineProxy({
      allowedOrigins: input.allowedOrigins,
      onUpstreamLost: () => {
        const state = stateById.get(id);
        if (state?.phase !== "connected") return;
        upstreamUrlById.delete(id);
        setState(id, { phase: "reconnecting", detail: null, issue: null, wsUrl: state.wsUrl });
        void connect(id).catch(() => undefined);
      },
    });
    proxies.set(id, proxy);
    return proxy;
  };

  const establish = async (id: string): Promise<void> => {
    const record = input.store.get(id);
    if (!record) throw new Error("This machine is no longer paired.");
    const previous = stateById.get(id);
    setState(id, {
      phase: previous?.phase === "connected" ? "reconnecting" : "connecting",
      detail: null,
      issue: null,
      wsUrl: previous?.wsUrl ?? null,
    });
    const route = await findRoute(record.routes, record.environmentId);
    if (!route) {
      setState(id, {
        phase: "failed",
        detail: `${record.label} is not reachable at any of its addresses.`,
        issue: null,
        wsUrl: null,
      });
      scheduleRetry(id);
      throw new Error(`${record.label} is not reachable.`);
    }
    const session = await fetch(new URL("/api/auth/session", route.url), {
      headers: { authorization: `Bearer ${record.sessionToken}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
      .then((response) => response.json() as Promise<{ authenticated?: boolean }>)
      .catch(() => null);
    if (session?.authenticated !== true) {
      setState(id, {
        phase: "failed",
        detail: `${record.label} no longer accepts this app. Pair it again from its Remote access settings.`,
        issue: "needs-sign-in",
        wsUrl: null,
      });
      throw new Error(`${record.label} no longer accepts this app.`);
    }
    if (route.url !== record.address || route.label !== record.label) {
      input.store.put({ ...record, address: route.url, label: route.label });
    }
    const proxy = await proxyFor(id);
    if (upstreamUrlById.get(id) !== route.url) {
      proxy.setUpstream({ baseUrl: new URL(route.url), sessionToken: record.sessionToken });
      upstreamUrlById.set(id, route.url);
    }
    setState(id, { phase: "connected", detail: null, issue: null, wsUrl: proxy.wsUrl });
  };

  const connect = (id: string): Promise<void> => {
    const pending = inFlight.get(id);
    if (pending) return pending;
    const attempt = establish(id).finally(() => inFlight.delete(id));
    inFlight.set(id, attempt);
    return attempt;
  };

  const add: PairedMachines["add"] = async (link) => {
    const parsed = parsePairingLink(link);
    const route = await findRoute(
      parsed.routes.map((route) => route.url),
      parsed.environmentId,
    );
    if (!route) {
      throw new Error(
        "Glade could not reach that machine. Check that both are on the same network or tailnet, and that its remote access is on.",
      );
    }
    const descriptors = await Promise.all(input.otherServerUrls().map(readDescriptor));
    const known = descriptors.find((entry) => entry?.environmentId === route.environmentId);
    if (known) {
      throw new Error(
        `${known.label} is already added as an SSH host. Remove it from SSH hosts to pair with it instead.`,
      );
    }
    const response = await fetch(new URL("/api/auth/bootstrap/bearer", route.url), {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": CLIENT_LABEL },
      body: JSON.stringify({ credential: parsed.credential }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as {
      sessionToken?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok || typeof body?.sessionToken !== "string") {
      throw new Error(
        "That pairing link did not work. It may have expired or been used; create a new one on the other machine.",
      );
    }
    // Pairing a machine again replaces its saved sign-in instead of adding a second entry.
    const existing = input.store
      .list()
      .find((machine) => machine.environmentId === route.environmentId);
    const record: PairedMachineRecord = {
      id: existing?.id ?? Crypto.randomUUID(),
      label: route.label,
      environmentId: route.environmentId,
      address: route.url,
      routes: [...new Set([route.url, ...parsed.routes.map((entry) => entry.url)])],
      sessionToken: body.sessionToken,
    };
    input.store.put(record);
    upstreamUrlById.delete(record.id);
    input.log(`paired with ${record.label} at ${record.address}`);
    await connect(record.id).catch(() => undefined);
    return publicView(record);
  };

  const remove: PairedMachines["remove"] = async (id) => {
    const record = input.store.get(id);
    clearTimeout(retryTimers.get(id));
    retryTimers.delete(id);
    await proxies.get(id)?.close();
    proxies.delete(id);
    upstreamUrlById.delete(id);
    stateById.delete(id);
    input.store.remove(id);
    input.publish([...stateById.values()]);
    // Signing out on the other machine is a courtesy; an offline machine keeps a session nobody holds.
    if (record) {
      await fetch(new URL("/api/auth/logout", record.address), {
        method: "POST",
        headers: { authorization: `Bearer ${record.sessionToken}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }).catch(() => undefined);
    }
  };

  return {
    list: () => input.store.list().map(publicView),
    states: () => [...stateById.values()],
    add,
    remove,
    connect,
    connectAll: () => {
      for (const machine of input.store.list()) void connect(machine.id).catch(() => undefined);
    },
    stop: async () => {
      for (const timer of retryTimers.values()) clearTimeout(timer);
      retryTimers.clear();
      await Promise.all([...proxies.values()].map((proxy) => proxy.close()));
      proxies.clear();
    },
  };
}
