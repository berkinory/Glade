import { readFileSync } from "node:fs";

import { assert, describe, it } from "@effect/vitest";

import { GLADE_CLIENT_METADATA_URL } from "./connectorOAuth.ts";
import { MCP_CONNECTOR_OAUTH_CALLBACK_PATH } from "./Layers/McpConnectors.ts";

// Vendors that support Client ID Metadata Documents fetch this file and compare it with what the
// server sends; a drift silently breaks every such sign-in.
const document = JSON.parse(
  readFileSync(new URL("../../../landing/public/oauth/client.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("published client metadata document", () => {
  it("names the URL the server presents as its client id", () => {
    assert.strictEqual(document.client_id, GLADE_CLIENT_METADATA_URL);
    assert.strictEqual(document.token_endpoint_auth_method, "none");
  });

  it("allows the loopback callback the server redirects to", () => {
    const redirects = document.redirect_uris as ReadonlyArray<string>;
    assert.isNotEmpty(redirects);
    for (const redirect of redirects) {
      const url = new URL(redirect);
      assert.strictEqual(url.protocol, "http:");
      assert.include(["127.0.0.1", "localhost", "[::1]"], url.hostname);
      assert.strictEqual(url.pathname, MCP_CONNECTOR_OAUTH_CALLBACK_PATH);
    }
  });
});
