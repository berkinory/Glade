import type os from "node:os";

import { describe, expect, it } from "vitest";

import { isLoopbackAddress, isPrivateNetworkAddress, listDirectRoutes } from "./networkAddresses";

describe("remote access addresses", () => {
  it.each([
    ["127.0.0.1", true],
    ["::1", true],
    ["::ffff:192.168.1.20", true],
    ["10.0.0.5", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.0.6", true],
    ["169.254.10.10", true],
    ["100.64.0.1", true],
    ["100.127.255.254", true],
    ["fd7a:115c:a1e0::1", true],
    ["fe80::1", true],
    ["172.32.0.1", false],
    ["100.128.0.1", false],
    ["8.8.8.8", false],
    ["::ffff:8.8.8.8", false],
    ["2001:4860:4860::8888", false],
    ["not-an-address", false],
  ])("accepts connections on %s only from a private network: %s", (address, isPrivate) => {
    expect(isPrivateNetworkAddress(address)).toBe(isPrivate);
  });

  it("treats only loopback as reachable without plain HTTP", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.0.6")).toBe(false);
  });

  it("offers addresses other devices can use, tailnet first, without virtual interfaces", () => {
    const entry = (address: string, family: "IPv4" | "IPv6", internal = false) =>
      ({ address, family, internal }) as os.NetworkInterfaceInfo;
    const routes = listDirectRoutes(3773, {
      lo0: [entry("127.0.0.1", "IPv4", true)],
      en0: [entry("192.168.0.6", "IPv4"), entry("fe80::1", "IPv6")],
      utun5: [entry("100.107.236.121", "IPv4"), entry("fd7a:115c:a1e0::4c32:ec79", "IPv6")],
      wg0: [entry("10.8.0.2", "IPv4")],
      bridge100: [entry("192.168.139.3", "IPv4")],
      en5: [entry("203.0.113.9", "IPv4")],
    });
    expect(routes).toEqual([
      { kind: "tailnet", url: "http://100.107.236.121:3773" },
      { kind: "lan", url: "http://192.168.0.6:3773" },
      { kind: "vpn", url: "http://10.8.0.2:3773" },
    ]);
  });
});
