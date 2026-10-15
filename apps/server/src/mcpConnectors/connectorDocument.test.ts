import { assert, describe, it } from "@effect/vitest";

import { decodeConnectorsDocument, encodeConnectorsDocument } from "./connectorDocument.ts";

const connected = {
  connectorId: "c1",
  presetId: "linear",
  name: "Linear",
  url: "https://mcp.linear.app/mcp",
  serverName: "linear_connector",
  status: "connected",
  connectedAt: "2026-10-16T00:00:00.000Z",
  auth: {
    kind: "oauth",
    authorizationServerUrl: "https://mcp.linear.app",
    authorizationServerMetadata: null,
    clientInformation: { client_id: "client", token_endpoint_auth_method: "none" },
    tokens: { access_token: "access", refresh_token: "refresh", token_type: "Bearer" },
    expiresAt: null,
    resource: "https://mcp.linear.app/mcp",
  },
};

describe("connectors document", () => {
  it("keeps entries it cannot read and writes them back untouched", () => {
    const fromNewerBuild = { ...connected, connectorId: "c2", auth: { kind: "passkey" } };
    const missingToken = {
      ...connected,
      connectorId: "c3",
      auth: { ...connected.auth, tokens: {} },
    };
    const raw = JSON.stringify({
      version: 1,
      connectors: [connected, fromNewerBuild, missingToken],
    });

    const document = decodeConnectorsDocument(raw);

    assert.deepStrictEqual(
      document.connectors.map((connector) => connector.connectorId),
      ["c1"],
    );
    assert.deepStrictEqual(JSON.parse(encodeConnectorsDocument(document)), JSON.parse(raw));
  });

  it("keeps vendor fields the SDK reads back on refresh", () => {
    const [connector] = decodeConnectorsDocument(
      JSON.stringify({ version: 1, connectors: [connected] }),
    ).connectors;
    const auth = connector?.auth;
    const clientInformation = auth?.kind === "oauth" ? auth.clientInformation : undefined;
    assert.strictEqual(clientInformation?.token_endpoint_auth_method, "none");
  });

  it("refuses a document it does not recognize", () => {
    assert.throws(() => decodeConnectorsDocument(JSON.stringify({ version: 2, connectors: [] })));
  });
});
