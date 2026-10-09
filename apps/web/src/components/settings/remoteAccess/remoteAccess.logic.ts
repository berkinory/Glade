import type { AuthClientSession } from "@glade/contracts/transport/auth/auth";
import type { RemoteAccessStatus } from "@glade/contracts/transport/ws/remoteAccessRpc";
import { DateTime } from "effect";

import { formatRelativeTime } from "~/lib/relativeTime";

export function deviceName(device: AuthClientSession): string {
  const { client } = device;
  if (client.label) return client.label;
  if (client.deviceType === "bot") return "Command-line client";
  const system =
    client.os ?? (client.deviceType === "unknown" ? null : DEVICE_TYPE_NAMES[client.deviceType]);
  const app = client.browser ?? "Glade";
  return system ? `${app} on ${system}` : app;
}

const DEVICE_TYPE_NAMES = { desktop: "a computer", mobile: "a phone", tablet: "a tablet" } as const;

export function deviceActivity(device: AuthClientSession): string {
  if (device.connected) return "Connected now";
  const lastUsed = device.lastConnectedAt ?? device.issuedAt;
  const ago = formatRelativeTime(DateTime.formatIso(lastUsed));
  const verb = device.lastConnectedAt ? "Last used" : "Paired";
  return ago === "now" ? `${verb} just now` : `${verb} ${ago} ago`;
}

export function routeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// One line under the main switch that says whether a device can reach this machine right now.
export function reachabilityText(status: RemoteAccessStatus): string | null {
  if (!status.enabled) return null;
  if (status.listener === "failed")
    return status.error ?? "Could not open a port for other devices.";
  const [first, ...rest] = status.routes;
  if (!first) return "Not reachable yet. Turn on Tailscale HTTPS or your local network below.";
  const more =
    rest.length > 0
      ? ` and ${rest.length} more ${rest.length === 1 ? "address" : "addresses"}`
      : "";
  return `Reachable at ${routeHost(first.url)}${more}.`;
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
