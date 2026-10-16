import type { ProviderMcpServer } from "@glade/contracts/provider/providerDiscovery";

import { GLADE_MCP_SERVER_NAME } from "../../agentGateway/mcpInjection.ts";
import type { McpServerStatus } from "./protocol/generated/types/v2/McpServerStatus";

// Glade injects its own gateway and connector servers; those are Glade's, not the provider's.
function isGladeServer(name: string): boolean {
  return name === GLADE_MCP_SERVER_NAME || name.endsWith("_connector");
}

const AUTH_FAILURE = /\b(401|403|unauthori[sz]ed|auth|login|token)\b/iu;

function statusOf(server: McpServerStatus): Pick<ProviderMcpServer, "status" | "detail"> {
  switch (server.runtimeStatus) {
    case "connected":
      return { status: "connected", detail: null };
    case "authenticationRequired":
      return { status: "needs-sign-in", detail: null };
    case "failed":
    case "cancelled":
      return { status: "failed", detail: server.toolsError };
    case "disabled":
      return { status: "configured", detail: "Disabled in Codex" };
    default:
      break;
  }
  if (server.toolsError) {
    return {
      status:
        server.authStatus === "notLoggedIn" && AUTH_FAILURE.test(server.toolsError)
          ? "needs-sign-in"
          : "failed",
      detail: server.toolsError,
    };
  }
  return { status: "connected", detail: null };
}

export function codexMcpServers(statuses: ReadonlyArray<McpServerStatus>): ProviderMcpServer[] {
  return statuses
    .filter((server) => !isGladeServer(server.name))
    .map((server) => ({
      name: server.name,
      transport: server.httpOrigin ? ("http" as const) : ("local" as const),
      origin: server.httpOrigin,
      toolCount: server.toolsError ? null : Object.keys(server.tools).length,
      ...statusOf(server),
    }));
}
