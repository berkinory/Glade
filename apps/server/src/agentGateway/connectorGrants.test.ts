import { assert, describe, it } from "@effect/vitest";

import { makeAgentGatewayConnectorGrants } from "./connectorGrants.ts";

const ORIGIN = "http://127.0.0.1:5860";

describe("agent gateway connector grants", () => {
  it("scopes each session to the connectors published when it started", () => {
    const grants = makeAgentGatewayConnectorGrants();
    grants.publish([{ connectorId: "linear", serverName: "linear_connector" }]);
    const early = grants.grant("token-early", ORIGIN);

    grants.publish([
      { connectorId: "linear", serverName: "linear_connector" },
      { connectorId: "notion", serverName: "notion_connector" },
    ]);
    const late = grants.grant("token-late", ORIGIN);

    assert.deepStrictEqual(early, [
      { name: "linear_connector", url: `${ORIGIN}/mcp/connectors/linear` },
    ]);
    assert.strictEqual(late.length, 2);
    assert.isTrue(grants.canUse("token-early", "linear"));
    assert.isFalse(grants.canUse("token-early", "notion"));
    assert.isTrue(grants.canUse("token-late", "notion"));
    assert.isFalse(grants.canUse("token-unknown", "linear"));
  });

  it("drops a revoked session's access", () => {
    const grants = makeAgentGatewayConnectorGrants();
    grants.publish([{ connectorId: "linear", serverName: "linear_connector" }]);
    grants.grant("token", ORIGIN);
    grants.revoke("token");
    assert.isFalse(grants.canUse("token", "linear"));
  });
});
