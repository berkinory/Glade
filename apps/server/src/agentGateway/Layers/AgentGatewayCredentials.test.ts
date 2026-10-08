import { describe, expect, it } from "vitest";

import {
  makeAgentGatewayEndpoint,
  resolveAgentGatewayEndpointHost,
} from "./AgentGatewayCredentials.ts";

describe("resolveAgentGatewayEndpointHost", () => {
  it.each([
    [undefined, "127.0.0.1"],
    ["0.0.0.0", "127.0.0.1"],
    ["::", "127.0.0.1"],
    ["[::]", "127.0.0.1"],
    ["localhost", "localhost"],
    ["192.168.1.20", "192.168.1.20"],
    ["::1", "[::1]"],
    ["[::1]", "[::1]"],
  ])("resolves bind host %s to endpoint host %s", (bindHost, expected) => {
    expect(resolveAgentGatewayEndpointHost(bindHost)).toBe(expected);
  });

  it("updates connections after a dynamic listen port is resolved", () => {
    const endpoint = makeAgentGatewayEndpoint(undefined, 0);
    expect(endpoint.url).toBe("http://127.0.0.1:0/mcp");
    endpoint.setListeningPort(48123);
    expect(endpoint.url).toBe("http://127.0.0.1:48123/mcp");
  });
});
