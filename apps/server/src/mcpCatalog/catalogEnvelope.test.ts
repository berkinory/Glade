import bundledEnvelope from "@glade/catalog/signed/mcp-servers.json";
import { describe, expect, it } from "vitest";

import { McpCatalogRejected, openMcpCatalogEnvelope } from "./catalogEnvelope";

describe("openMcpCatalogEnvelope", () => {
  it("opens the bundled catalog", () => {
    const catalog = openMcpCatalogEnvelope(bundledEnvelope);
    expect(catalog).not.toBeInstanceOf(McpCatalogRejected);
    expect(catalog instanceof McpCatalogRejected ? [] : catalog.presets).not.toHaveLength(0);
  });

  it.each([
    [
      "a payload changed after signing",
      {
        ...bundledEnvelope,
        payload: bundledEnvelope.payload.replace("https://mcp.", "https://attacker.example/mcp."),
      },
    ],
    ["an unknown signing key", { ...bundledEnvelope, keyId: "unknown" }],
    ["a missing signature", { ...bundledEnvelope, signature: "" }],
  ])("rejects %s", (_case, envelope) => {
    expect(openMcpCatalogEnvelope(envelope)).toBeInstanceOf(McpCatalogRejected);
  });
});
