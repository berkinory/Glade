export const AGENT_GATEWAY_CONNECTORS_PATH = "/mcp/connectors";

export interface AgentGatewayConnectorRegistration {
  readonly connectorId: string;
  readonly serverName: string;
}

// One connector as a provider session sees it: an MCP server on the gateway, authenticated with
// the session's own bearer. The vendor's credentials never leave the server.
export interface AgentGatewayConnectorEndpoint {
  readonly name: string;
  readonly url: string;
}

export interface AgentGatewayConnectorGrants {
  // Replaces the connectors new sessions receive. Running sessions keep the set they started with.
  readonly publish: (registrations: ReadonlyArray<AgentGatewayConnectorRegistration>) => void;
  readonly canUse: (token: string, connectorId: string) => boolean;
}

function agentGatewayConnectorUrl(gatewayOrigin: string, connectorId: string): string {
  return `${gatewayOrigin}${AGENT_GATEWAY_CONNECTORS_PATH}/${encodeURIComponent(connectorId)}`;
}

export function makeAgentGatewayConnectorGrants() {
  let published: ReadonlyArray<AgentGatewayConnectorRegistration> = [];
  const grantsByToken = new Map<string, ReadonlySet<string>>();
  return {
    publish: (registrations: ReadonlyArray<AgentGatewayConnectorRegistration>) => {
      published = registrations;
    },
    canUse: (token: string, connectorId: string) =>
      grantsByToken.get(token)?.has(connectorId) === true,
    grant: (token: string, gatewayOrigin: string): ReadonlyArray<AgentGatewayConnectorEndpoint> => {
      grantsByToken.set(token, new Set(published.map((entry) => entry.connectorId)));
      return published.map((entry) => ({
        name: entry.serverName,
        url: agentGatewayConnectorUrl(gatewayOrigin, entry.connectorId),
      }));
    },
    revoke: (token: string) => {
      grantsByToken.delete(token);
    },
  };
}
