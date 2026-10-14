import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPairedMachines, type PairedMachines } from "./pairedMachines";
import type { PairedMachineRecord } from "./pairedMachinesStore";

const machinesToStop: PairedMachines[] = [];

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const machines of machinesToStop.splice(0)) await machines.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(session: () => Promise<Response>) {
  let record: PairedMachineRecord | null = {
    id: "paired-host",
    environmentId: "environment-1",
    label: "Remote machine",
    address: "http://paired.invalid",
    routes: ["http://paired.invalid"],
    sessionToken: "test-session",
  };
  let resolveConnected!: () => void;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/auth/session") return session();
    if (url.pathname === "/api/auth/logout") return new Response(null, { status: 204 });
    return Response.json({ environmentId: "environment-1", label: "Remote machine" });
  });
  const machines = createPairedMachines({
    store: {
      list: () => (record ? [record] : []),
      get: () => record,
      put: (next) => {
        record = next;
      },
      remove: () => {
        record = null;
      },
    },
    allowedOrigins: new Set(),
    localServerUrl: () => "http://local.invalid",
    sshServerUrls: () => [],
    publish: (states) => {
      if (states.some((state) => state.phase === "connected")) resolveConnected();
    },
    log: () => undefined,
  });
  machinesToStop.push(machines);
  return { machines, connected };
}

it.each([
  ["timeout", () => Promise.reject(new DOMException("Timed out", "TimeoutError"))],
  ["connection reset", () => Promise.reject(new TypeError("fetch failed"))],
  ["server error", () => Promise.resolve(Response.json({ authenticated: false }, { status: 503 }))],
  ["invalid JSON", () => Promise.resolve(new Response("<html>Unavailable</html>"))],
  ["invalid session payload", () => Promise.resolve(Response.json({}))],
] as const)(
  "automatically recovers after a session check %s without requiring pairing",
  async (_name, failure) => {
    const session = vi
      .fn(failure)
      .mockImplementationOnce(failure)
      .mockImplementation(() => Promise.resolve(Response.json({ authenticated: true })));
    const { machines, connected } = setup(session);
    await expect(machines.connect("paired-host")).rejects.toThrow();
    expect(machines.states()[0]).toMatchObject({ phase: "failed", issue: null });
    await vi.advanceTimersByTimeAsync(2_000);
    await connected;
    expect(machines.states()[0]).toMatchObject({ phase: "connected", issue: null });
    expect(session).toHaveBeenCalledTimes(2);
  },
);

it.each([
  ["signed-out response", () => Response.json({ authenticated: false })],
  ["unauthorized response", () => new Response(null, { status: 401 })],
  ["forbidden response", () => new Response(null, { status: 403 })],
] as const)("requires pairing after an explicit %s and does not retry", async (_name, response) => {
  const session = vi.fn(async () => response());
  const { machines } = setup(session);
  await expect(machines.connect("paired-host")).rejects.toThrow("no longer accepts");
  expect(machines.states()[0]).toMatchObject({ phase: "failed", issue: "needs-sign-in" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(session).toHaveBeenCalledTimes(1);
});

it.each(["remove", "stop"] as const)(
  "does not restart a pending connection after %s",
  async (action) => {
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const { machines } = setup(() => {
      resolveStarted();
      return response;
    });
    const connecting = machines.connect("paired-host");
    await started;
    if (action === "remove") await machines.remove("paired-host");
    else await machines.stop();
    const states = machines.states();
    resolveResponse(new Response(null, { status: 503 }));
    await connecting;
    expect(machines.states()).toEqual(states);
    expect(vi.getTimerCount()).toBe(0);
  },
);
