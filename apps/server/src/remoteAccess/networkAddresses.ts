import os from "node:os";

import type { RemoteAccessRoute } from "@glade/contracts/transport/ws/remoteAccessRpc";

function stripMappedIpv4(address: string): string {
  return address.toLowerCase().startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

function ipv4Octets(address: string): readonly number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isTailnetIpv4(octets: readonly number[]): boolean {
  return octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
}

export function isLoopbackAddress(raw: string): boolean {
  const address = stripMappedIpv4(raw);
  return address === "::1" || ipv4Octets(address)?.[0] === 127;
}

function isTailnetAddress(raw: string): boolean {
  const address = stripMappedIpv4(raw).toLowerCase();
  const octets = ipv4Octets(address);
  return octets ? isTailnetIpv4(octets) : address.startsWith("fd7a:115c:a1e0:");
}

// Addresses that only other devices on a private network (LAN, VPN, tailnet) can reach. A
// connection accepted on any other local address came in from the public internet.
export function isPrivateNetworkAddress(raw: string): boolean {
  const address = stripMappedIpv4(raw).toLowerCase();
  if (isLoopbackAddress(address)) return true;
  const octets = ipv4Octets(address);
  if (octets) {
    const [first, second] = octets as [number, number];
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      isTailnetIpv4(octets)
    );
  }
  return /^f[cd][0-9a-f]{2}:/.test(address) || /^fe[89ab][0-9a-f]:/.test(address);
}

// Virtual machine, container and bridge interfaces have private addresses no other device uses.
const VIRTUAL_INTERFACE =
  /^(bridge|vmenet|vmnet|vboxnet|virbr|docker|br-|veth|cni|flannel|anpi|awdl|llw|ap\d)/i;
const TUNNEL_INTERFACE = /^(utun|tun|tap|wg|ppp|ipsec|zt|tailscale)/i;

function formatUrl(address: string, port: number): string {
  return address.includes(":") ? `http://[${address}]:${port}` : `http://${address}:${port}`;
}

// Plain HTTP routes for every private address another device could use, IPv4 first. IPv6 link-local
// addresses need an interface scope that a URL cannot carry, so they are left out.
export function listDirectRoutes(
  port: number,
  interfaces: NodeJS.Dict<ReadonlyArray<os.NetworkInterfaceInfo>> = os.networkInterfaces(),
): ReadonlyArray<RemoteAccessRoute> {
  const routes: Array<RemoteAccessRoute & { readonly family: string }> = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries || VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of entries) {
      const address = entry.address.toLowerCase();
      if (entry.internal || !isPrivateNetworkAddress(address) || /^fe[89ab]/.test(address)) {
        continue;
      }
      const kind = isTailnetAddress(address)
        ? "tailnet"
        : TUNNEL_INTERFACE.test(name)
          ? "vpn"
          : "lan";
      routes.push({ kind, url: formatUrl(address, port), family: entry.family });
    }
  }
  const order = { tailnet: 0, lan: 1, vpn: 2 } as const;
  // An IPv4 address reaches the same machine for every device that has one; the IPv6 twin only
  // makes the pairing code denser.
  const kindsWithIpv4 = new Set(
    routes.filter((route) => route.family === "IPv4").map((r) => r.kind),
  );
  return routes
    .filter((route) => route.family === "IPv4" || !kindsWithIpv4.has(route.kind))
    .toSorted(
      (left, right) =>
        order[left.kind as keyof typeof order] - order[right.kind as keyof typeof order] ||
        (left.family === right.family ? 0 : left.family === "IPv4" ? -1 : 1),
    )
    .map(({ kind, url }) => ({ kind, url }));
}
