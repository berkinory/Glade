import { isRecord } from "@glade/shared/transport/recordValues";
import type { AgentGatewayMcpConnection } from "./Services/AgentGatewayCredentials.ts";

export const GLADE_MCP_SERVER_NAME = "glade";
export const GLADE_AGENT_GATEWAY_TOKEN_ENV = "GLADE_AGENT_GATEWAY_TOKEN";

function authorizationHeader(connection: AgentGatewayMcpConnection): string {
  return `Bearer ${connection.bearerToken}`;
}

// Codex reads MCP servers from `config.toml`; the config file is shared by all sessions of one
// Codex home, so the token is never written into it. The shell_environment_policy table keeps that
// env var out of exec tool subprocesses: codex defaults to `ignore_default_excludes = true`, so the
// built-in *TOKEN* filter is inactive and workspace commands would otherwise inherit the gateway
// bearer token. Appended per-table, so a user-defined policy table is never duplicated (their
// policy then governs).
export function buildCodexMcpConfigToml(endpointUrl: string): string {
  return [
    `[mcp_servers.${GLADE_MCP_SERVER_NAME}]`,
    `url = ${JSON.stringify(endpointUrl)}`,
    `bearer_token_env_var = ${JSON.stringify(GLADE_AGENT_GATEWAY_TOKEN_ENV)}`,
    "",
    "[shell_environment_policy]",
    `exclude = [${JSON.stringify(GLADE_AGENT_GATEWAY_TOKEN_ENV)}]`,
  ].join("\n");
}

export interface ClaudeMcpHttpServerConfig {
  readonly type: "http";
  readonly url: string;
  readonly headers: Record<string, string>;
}

export interface AgentGatewayMcpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export type AgentGatewayMcpFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

async function postAgentGatewayJsonRpc(input: {
  readonly connection: AgentGatewayMcpConnection;
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly signal?: AbortSignal;
  readonly fetch?: AgentGatewayMcpFetch;
}): Promise<unknown> {
  const id = globalThis.crypto.randomUUID();
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const response = await fetchImpl(input.connection.url, {
    method: "POST",
    headers: {
      Authorization: authorizationHeader(input.connection),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: input.method,
      ...(input.params === undefined ? {} : { params: input.params }),
    }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (!response.ok) {
    throw new Error(`Glade MCP request failed with HTTP ${String(response.status)}.`);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.jsonrpc !== "2.0") {
    throw new Error("Glade MCP returned an invalid JSON-RPC response.");
  }
  if ("error" in payload) {
    const failure = isRecord(payload.error) ? payload.error : null;
    throw new Error(failure?.message ? String(failure.message) : "Glade MCP request failed.");
  }
  if (payload.id !== id || !("result" in payload)) {
    throw new Error("Glade MCP returned a mismatched JSON-RPC response.");
  }
  return payload.result;
}

export async function listAgentGatewayMcpTools(input: {
  readonly connection: AgentGatewayMcpConnection;
  readonly fetch?: AgentGatewayMcpFetch;
  readonly signal?: AbortSignal;
}): Promise<ReadonlyArray<AgentGatewayMcpToolDescriptor>> {
  const result = await postAgentGatewayJsonRpc({
    ...input,
    method: "tools/list",
  });
  if (!isRecord(result) || !Array.isArray(result.tools)) {
    throw new Error("Glade MCP tools/list returned an invalid tool catalog.");
  }
  return result.tools.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.name !== "string" ||
      typeof value.description !== "string" ||
      !isRecord(value.inputSchema)
    ) {
      throw new Error("Glade MCP tools/list returned an invalid tool descriptor.");
    }
    return {
      name: value.name,
      description: value.description,
      inputSchema: value.inputSchema,
    };
  });
}

export function callAgentGatewayMcpTool(input: {
  readonly connection: AgentGatewayMcpConnection;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly fetch?: AgentGatewayMcpFetch;
  readonly signal?: AbortSignal;
}): Promise<unknown> {
  return postAgentGatewayJsonRpc({
    connection: input.connection,
    method: "tools/call",
    params: { name: input.name, arguments: input.arguments },
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

export function buildClaudeMcpServers(
  connection: AgentGatewayMcpConnection,
): Record<string, ClaudeMcpHttpServerConfig> {
  return {
    [GLADE_MCP_SERVER_NAME]: {
      type: "http",
      url: connection.url,
      headers: { Authorization: authorizationHeader(connection) },
    },
  };
}
