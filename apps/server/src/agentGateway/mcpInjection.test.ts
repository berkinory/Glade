import { assert, describe, it } from "@effect/vitest";

import {
  appendCodexConfigSection,
  configHasTomlTableHeader,
  extractManagedCodexConfigSection,
  mergeShellEnvPolicyExclude,
  GLADE_MANAGED_CODEX_CONFIG_BEGIN,
  GLADE_MANAGED_CODEX_CONFIG_END,
} from "../codexProcessEnv.ts";
import {
  buildClaudeMcpServers,
  buildCodexMcpConfigToml,
  callAgentGatewayMcpTool,
  listAgentGatewayMcpTools,
  GLADE_AGENT_GATEWAY_TOKEN_ENV,
} from "./mcpInjection.ts";

const connection = {
  url: "http://127.0.0.1:3773/mcp",
  bearerToken: "sagw_abc.def",
};

describe("agent gateway MCP injection", () => {
  it("builds a codex config block that references the token env var, not the token", () => {
    const block = buildCodexMcpConfigToml(connection.url);
    assert.include(block, "[mcp_servers.glade]");
    assert.include(block, `url = "${connection.url}"`);
    assert.include(block, `bearer_token_env_var = "${GLADE_AGENT_GATEWAY_TOKEN_ENV}"`);
    assert.notInclude(block, connection.bearerToken);
  });

  it("appends the codex section once and keeps existing config intact", () => {
    const base = '[model]\nname = "gpt-5.5"\n';
    const section = buildCodexMcpConfigToml(connection.url);
    const appended = appendCodexConfigSection(base, section);
    assert.include(appended, '[model]\nname = "gpt-5.5"');
    assert.include(appended, "[mcp_servers.glade]");

    const reappended = appendCodexConfigSection(appended, section);
    assert.equal(reappended.split("[mcp_servers.glade]").length, 2);
  });

  it("merges the token exclusion into a user-defined shell environment policy", () => {
    const withExclude = [
      "[shell_environment_policy]",
      'exclude = ["AWS_*"]',
      "",
      "[model]",
      'name = "gpt-5.5"',
    ].join("\n");
    const merged = mergeShellEnvPolicyExclude(withExclude, GLADE_AGENT_GATEWAY_TOKEN_ENV);
    assert.include(merged, `exclude = ["${GLADE_AGENT_GATEWAY_TOKEN_ENV}", "AWS_*"]`);

    // Idempotent: the var is not added twice.
    assert.equal(mergeShellEnvPolicyExclude(merged, GLADE_AGENT_GATEWAY_TOKEN_ENV), merged);

    // A policy table without an exclude key gains one.
    const withoutExclude = ["[shell_environment_policy]", 'inherit = "core"'].join("\n");
    const gained = mergeShellEnvPolicyExclude(withoutExclude, GLADE_AGENT_GATEWAY_TOKEN_ENV);
    assert.include(gained, `exclude = ["${GLADE_AGENT_GATEWAY_TOKEN_ENV}"]`);
    assert.include(gained, 'inherit = "core"');

    // No policy table: unchanged (the managed section appends its own).
    assert.equal(
      mergeShellEnvPolicyExclude('[model]\nname = "gpt-5.5"', GLADE_AGENT_GATEWAY_TOKEN_ENV),
      '[model]\nname = "gpt-5.5"',
    );
  });

  it("ignores commented and unrelated token references when merging shell exclusions", () => {
    const commentedExample = [
      "[shell_environment_policy]",
      `# exclude = ["${GLADE_AGENT_GATEWAY_TOKEN_ENV}"]`,
      'exclude = ["AWS_*"]',
    ].join("\n");
    const mergedCommentedExample = mergeShellEnvPolicyExclude(
      commentedExample,
      GLADE_AGENT_GATEWAY_TOKEN_ENV,
    );
    assert.include(
      mergedCommentedExample,
      `exclude = ["${GLADE_AGENT_GATEWAY_TOKEN_ENV}", "AWS_*"]`,
    );

    const unrelatedString = [
      "[shell_environment_policy]",
      `note = "keep ${GLADE_AGENT_GATEWAY_TOKEN_ENV} private"`,
      'exclude = ["AWS_*"]',
    ].join("\n");
    const mergedUnrelatedString = mergeShellEnvPolicyExclude(
      unrelatedString,
      GLADE_AGENT_GATEWAY_TOKEN_ENV,
    );
    assert.include(
      mergedUnrelatedString,
      `exclude = ["${GLADE_AGENT_GATEWAY_TOKEN_ENV}", "AWS_*"]`,
    );
  });

  it("recognizes only active exact entries in multiline shell exclusion arrays", () => {
    const existing = [
      "[shell_environment_policy]",
      "exclude = [",
      '  "AWS_*",',
      `  "${GLADE_AGENT_GATEWAY_TOKEN_ENV}",`,
      "]",
    ].join("\n");
    assert.equal(mergeShellEnvPolicyExclude(existing, GLADE_AGENT_GATEWAY_TOKEN_ENV), existing);

    const tokenOnlyInComment = [
      "[shell_environment_policy]",
      "exclude = [",
      `  # "${GLADE_AGENT_GATEWAY_TOKEN_ENV}",`,
      '  "AWS_*",',
      "]",
    ].join("\n");
    const merged = mergeShellEnvPolicyExclude(tokenOnlyInComment, GLADE_AGENT_GATEWAY_TOKEN_ENV);
    assert.include(merged, `exclude = ["${GLADE_AGENT_GATEWAY_TOKEN_ENV}",`);
  });

  it("detects real TOML table headers, ignoring comments and strings", () => {
    assert.isTrue(
      configHasTomlTableHeader('[mcp_servers.glade]\nurl = "x"', "[mcp_servers.glade]"),
    );
    assert.isTrue(
      configHasTomlTableHeader("  [mcp_servers.glade]  # managed", "[mcp_servers.glade]"),
    );
    assert.isTrue(
      configHasTomlTableHeader("  [ mcp_servers.glade ]  # managed", "[mcp_servers.glade]"),
    );
    assert.isTrue(configHasTomlTableHeader("  [ mcp_servers . glade ]", "[mcp_servers.glade]"));
    assert.isTrue(configHasTomlTableHeader('[mcp_servers."glade"]', "[mcp_servers.glade]"));
    assert.isTrue(configHasTomlTableHeader("['mcp_servers'.'glade']", "[mcp_servers.glade]"));
    assert.isTrue(configHasTomlTableHeader('[mcp_servers."gl\\u0061de"]', "[mcp_servers.glade]"));
    assert.isTrue(
      configHasTomlTableHeader('["shell_environment_policy"]', "[shell_environment_policy]"),
    );
    assert.isFalse(configHasTomlTableHeader('["mcp_servers.glade"]', "[mcp_servers.glade]"));
    assert.isFalse(configHasTomlTableHeader('[mcp_servers."syn\\qara"]', "[mcp_servers.glade]"));
    // A commented-out example block must not count as the table being present.
    assert.isFalse(configHasTomlTableHeader("# [mcp_servers.glade]", "[mcp_servers.glade]"));
    assert.isFalse(
      configHasTomlTableHeader('note = "see [mcp_servers.glade] docs"', "[mcp_servers.glade]"),
    );
  });

  it("round-trips the managed section through the overlay markers", () => {
    const section = buildCodexMcpConfigToml(connection.url);
    const overlayConfig = [
      '[model]\nname = "gpt-5.5"',
      "",
      GLADE_MANAGED_CODEX_CONFIG_BEGIN,
      section,
      GLADE_MANAGED_CODEX_CONFIG_END,
      "",
    ].join("\n");
    // A rewrite without appendConfigToml recovers the block so concurrent env
    // preps (version checks, text generation) don't strip the session's MCP entry.
    assert.equal(extractManagedCodexConfigSection(overlayConfig), section);
    assert.isUndefined(extractManagedCodexConfigSection('[model]\nname = "gpt-5.5"\n'));
  });

  it("builds a claude http server entry with the bearer header", () => {
    const servers = buildClaudeMcpServers(connection);
    assert.deepEqual(servers, {
      glade: {
        type: "http",
        url: connection.url,
        headers: { Authorization: `Bearer ${connection.bearerToken}` },
      },
    });
  });

  it("loads and invokes the canonical gateway catalog for native-tool providers", async () => {
    const requests: Array<{ readonly authorization: string | null; readonly body: unknown }> = [];
    const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const body: unknown = JSON.parse(String(init?.body));
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        body,
      });
      const request = body as { readonly id: string; readonly method: string };
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result:
          request.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "glade_list_threads",
                    description: "List Glade threads.",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              }
            : { content: [{ type: "text", text: "ok" }] },
      });
    };

    assert.deepEqual(await listAgentGatewayMcpTools({ connection, fetch }), [
      {
        name: "glade_list_threads",
        description: "List Glade threads.",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    assert.deepEqual(
      await callAgentGatewayMcpTool({
        connection,
        name: "glade_list_threads",
        arguments: { limit: 2 },
        fetch,
      }),
      { content: [{ type: "text", text: "ok" }] },
    );
    assert.deepEqual(
      requests.map((request) => request.authorization),
      [`Bearer ${connection.bearerToken}`, `Bearer ${connection.bearerToken}`],
    );
    assert.deepEqual((requests[1]?.body as { readonly params: unknown }).params, {
      name: "glade_list_threads",
      arguments: { limit: 2 },
    });
  });
});
