import { assert, describe, it } from "@effect/vitest";

import { makeAgentGatewayConnectorGrants } from "./connectorGrants.ts";

const ORIGIN = "http://127.0.0.1:5860";

describe("agent gateway connector grants", () => {
  it("scopes each session to the connectors published when it started", () => {
    const grants = makeAgentGatewayConnectorGrants();
    grants.publish([{ connectorId: "linear", serverName: "linear_connector", providers: null }]);
    const early = grants.grant("token-early", ORIGIN, "codex");

    grants.publish([
      { connectorId: "linear", serverName: "linear_connector", providers: null },
      { connectorId: "notion", serverName: "notion_connector", providers: null },
    ]);
    const late = grants.grant("token-late", ORIGIN, "codex");

    assert.deepStrictEqual(early, [
      { name: "linear_connector", url: `${ORIGIN}/mcp/connectors/linear` },
    ]);
    assert.strictEqual(late.length, 2);
    assert.isTrue(grants.canUse("token-early", "linear"));
    assert.isFalse(grants.canUse("token-early", "notion"));
    assert.isTrue(grants.canUse("token-late", "notion"));
    assert.isFalse(grants.canUse("token-unknown", "linear"));
  });

  it("serves a connector only to the agents chosen for it", () => {
    const grants = makeAgentGatewayConnectorGrants();
    grants.publish([
      { connectorId: "linear", serverName: "linear_connector", providers: ["claudeAgent"] },
      { connectorId: "notion", serverName: "notion_connector", providers: null },
    ]);

    const codex = grants.grant("token-codex", ORIGIN, "codex");
    const claude = grants.grant("token-claude", ORIGIN, "claudeAgent");

    assert.deepStrictEqual(
      codex.map((endpoint) => endpoint.name),
      ["notion_connector"],
    );
    assert.strictEqual(claude.length, 2);
    assert.isFalse(grants.canUse("token-codex", "linear"));
    assert.isTrue(grants.canUse("token-claude", "linear"));
  });

  it("drops a revoked session's access", () => {
    const grants = makeAgentGatewayConnectorGrants();
    grants.publish([{ connectorId: "linear", serverName: "linear_connector", providers: null }]);
    grants.grant("token", ORIGIN, "codex");
    grants.revoke("token");
    assert.isFalse(grants.canUse("token", "linear"));
  });
});
