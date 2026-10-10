import type {
  RemoteAccessPairing,
  RemoteAccessStatus,
  RemoteAccessUpdateInput,
} from "@glade/contracts/transport/ws/remoteAccessRpc";
import { isAlive, readRecord } from "../hostServer";

export class NotRunning extends Error {}

// Talks to this machine's running server on loopback with the token from its record, which only
// this user can read.
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const record = readRecord();
  if (!record || !isAlive(record.pid)) throw new NotRunning("Glade is not running.");
  const url = new URL(path, `http://127.0.0.1:${record.port}`);
  url.searchParams.set("token", record.authToken);
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) {
    throw new Error(body?.error ?? `Glade answered ${response.status}.`);
  }
  return body;
}

export const remoteStatus = () => call<RemoteAccessStatus>("/api/remote-access");

export const updateRemote = (input: RemoteAccessUpdateInput) =>
  call<RemoteAccessStatus>("/api/remote-access", { method: "POST", body: JSON.stringify(input) });

export const createPairing = () =>
  call<RemoteAccessPairing>("/api/remote-access/pairing", { method: "POST", body: "{}" });

export const pendingPairings = () =>
  call<{ readonly pendingPairingIds: ReadonlyArray<string> }>("/api/remote-access/devices");
