import type { DesktopPairedMachine } from "@glade/contracts/ipc/pairedMachines";
import type { DesktopSshConnectionState } from "@glade/contracts/ipc/sshHosts";
import * as Crypto from "node:crypto";
import { readEnvironmentDescriptor as readDescriptor } from "../environmentDescriptor";
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
  // The paired machine serving this environment, so an SSH host cannot add the same server twice.
  pairedAs(environmentId: string): string | null;
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

type RouteLookup =
  | {
      readonly kind: "found";
      readonly url: string;
      readonly environmentId: string;
      readonly label: string;
    }
  | { readonly kind: "other-machine"; readonly label: string }
  | { readonly kind: "unreachable" };

// The first route, in the link's order, that answers as the expected machine. Routes are probed at
// once so a dead address costs one timeout, not one each. A route that answers as another machine (a
// LAN address reused on another network) is skipped before it ever sees the session token.
async function findRoute(
  routes: ReadonlyArray<string>,
  environmentId: string | null,
): Promise<RouteLookup> {
  const probes = routes.map((url) =>
    readDescriptor(url).then((descriptor) => ({ url, descriptor })),
  );
  let otherLabel: string | null = null;
  for (const probe of probes) {
    const { url, descriptor } = await probe;
    if (!descriptor) continue;
    if (environmentId === null || descriptor.environmentId === environmentId) {
      return { kind: "found", url, ...descriptor };
    }
    otherLabel ??= descriptor.label;
  }
  return otherLabel === null
    ? { kind: "unreachable" }
    : { kind: "other-machine", label: otherLabel };
}

export function createPairedMachines(input: {
  readonly store: PairedMachinesStore;
  readonly allowedOrigins: ReadonlySet<string>;
  // Servers this app already reaches another way: its own, and SSH host tunnels. The same server
  // under two environments would show every project and chat twice.
  readonly localServerUrl: () => string;
  readonly sshServerUrls: () => ReadonlyArray<string>;
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
    const signedOut = (): never => {
      setState(id, {
        phase: "failed",
        detail: `${record.label} no longer accepts this app. Pair it again from its Remote access settings.`,
        issue: "needs-sign-in",
        wsUrl: null,
      });
      throw new Error(`${record.label} no longer accepts this app.`);
    };
    const { sessionToken } = record;
    if (sessionToken === null) return signedOut();
    const route = await findRoute(record.routes, record.environmentId);
    if (route.kind !== "found") {
      setState(id, {
        phase: "failed",
        detail:
          route.kind === "other-machine"
            ? `${record.label}'s addresses now reach ${route.label}. Glade keeps looking for ${record.label}.`
            : `${record.label} is not reachable at any of its addresses.`,
        issue: null,
        wsUrl: null,
      });
      scheduleRetry(id);
      throw new Error(`${record.label} is not reachable.`);
    }
    const session = await fetch(new URL("/api/auth/session", route.url), {
      headers: { authorization: `Bearer ${sessionToken}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
      .then((response) => response.json() as Promise<{ authenticated?: boolean }>)
      .catch(() => null);
    if (session?.authenticated !== true) return signedOut();
    if (route.url !== record.address || route.label !== record.label) {
      input.store.put({ ...record, sessionToken, address: route.url, label: route.label });
    }
    const proxy = await proxyFor(id);
    if (upstreamUrlById.get(id) !== route.url) {
      proxy.setUpstream({ baseUrl: new URL(route.url), sessionToken });
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
    if (route.kind === "other-machine") {
      throw new Error(
        `That link's addresses now reach ${route.label}, not the machine that made it. Create a new link on that machine.`,
      );
    }
    if (route.kind === "unreachable") {
      throw new Error(
        "Glade could not reach that machine. Check that both are on the same network or tailnet, and that its remote access is on.",
      );
    }
    const [local, ...sshHosts] = await Promise.all(
      [input.localServerUrl(), ...input.sshServerUrls()].map(readDescriptor),
    );
    if (local?.environmentId === route.environmentId) {
      throw new Error(
        "That link is from this computer. Open it on another device to pair with it.",
      );
    }
    const sshHost = sshHosts.find((entry) => entry?.environmentId === route.environmentId);
    if (sshHost) {
      throw new Error(
        `${sshHost.label} is already added as an SSH host. Remove it from SSH hosts to pair with it instead.`,
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
    const record = {
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
    if (record?.sessionToken) {
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
    pairedAs: (environmentId) => {
      try {
        return (
          input.store.list().find((machine) => machine.environmentId === environmentId)?.label ??
          null
        );
      } catch {
        return null;
      }
    },
    connectAll: () => {
      let machines: ReadonlyArray<PairedMachineRecord>;
      try {
        machines = input.store.list();
      } catch (error) {
        // An unreadable file is reported when the window lists machines; it is never rewritten here.
        input.log(
          `paired machines not loaded: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      for (const machine of machines) void connect(machine.id).catch(() => undefined);
    },
    stop: async () => {
      for (const timer of retryTimers.values()) clearTimeout(timer);
      retryTimers.clear();
      await Promise.all([...proxies.values()].map((proxy) => proxy.close()));
      proxies.clear();
    },
  };
}
