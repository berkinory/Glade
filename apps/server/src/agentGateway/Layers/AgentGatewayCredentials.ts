import { makeNativeToolCallRegistry } from "../nativeToolCalls.ts";

import { Effect, Layer } from "effect";

import { ServerConfig } from "../../server/config.ts";
import { formatHostForUrl, isWildcardHost } from "../../server/http/startupAccess.ts";
import {
  AgentGatewayCredentials,
  type AgentGatewayCredentialsShape,
} from "../Services/AgentGatewayCredentials.ts";
import { AgentGatewaySessionRegistry } from "../Services/AgentGatewaySessionRegistry.ts";
import { makeAgentGatewayInFlightRequestRegistry } from "../inFlightRequestRegistry.ts";
import { AgentGatewaySessionRegistryLive } from "./AgentGatewaySessionRegistry.ts";

export const AGENT_GATEWAY_MCP_PATH = "/mcp";

interface AgentGatewayEndpoint {
  readonly url: string;
  readonly setListeningPort: (listeningPort: number) => void;
}

export function resolveAgentGatewayEndpointHost(configHost: string | undefined): string {
  if (configHost === undefined || isWildcardHost(configHost)) {
    return "127.0.0.1";
  }
  return formatHostForUrl(configHost);
}

export function makeAgentGatewayEndpoint(
  configHost: string | undefined,
  initialPort: number,
): AgentGatewayEndpoint {
  const endpointHost = resolveAgentGatewayEndpointHost(configHost);
  let port = initialPort;
  return {
    get url() {
      return `http://${endpointHost}:${port}${AGENT_GATEWAY_MCP_PATH}`;
    },
    setListeningPort: (listeningPort: number) => {
      port = listeningPort;
    },
  };
}

const makeAgentGatewayCredentials = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const sessionRegistry = yield* AgentGatewaySessionRegistry;
  const inFlightRequests = makeAgentGatewayInFlightRequestRegistry();
  const nativeToolCalls = makeNativeToolCallRegistry();

  const endpoint = makeAgentGatewayEndpoint(config.host, config.port);
  const issueSessionToken: AgentGatewayCredentialsShape["issueSessionToken"] = (
    threadId,
    provider,
    options,
  ) => sessionRegistry.issue(threadId, provider, options).token;

  const verifySessionToken: AgentGatewayCredentialsShape["verifySessionToken"] = (token) =>
    sessionRegistry.verify(token)?.threadId ?? null;

  const revokeSessionToken = (token: string): void => {
    const session = sessionRegistry.verify(token);
    sessionRegistry.revoke(token);
    nativeToolCalls.revoke(token);
    if (session) inFlightRequests.revokeSession(session.sessionKey);
  };

  const cancelSessionTurnRequests: AgentGatewayCredentialsShape["cancelSessionTurnRequests"] = (
    token,
    turnId,
  ) => {
    const session = sessionRegistry.verify(token);
    if (!session) return Promise.resolve();
    nativeToolCalls.retire(token, turnId);
    return inFlightRequests.cancelTurn(session.sessionKey, turnId).settled;
  };

  const retireSessionTurn: AgentGatewayCredentialsShape["retireSessionTurn"] = (token, turnId) => {
    const session = sessionRegistry.verify(token);
    if (!session) return Promise.resolve();
    // Retire synchronously before exposing the asynchronous drain barrier. Requests racing the terminal
    // event can no longer bind this bearer to B.
    sessionRegistry.retireWriteAuthority(token, turnId);
    nativeToolCalls.retire(token, turnId);
    return inFlightRequests.cancelTurn(session.sessionKey, turnId).settled;
  };

  return {
    nativeToolCalls,
    get mcpEndpointUrl() {
      return endpoint.url;
    },
    setListeningPort: endpoint.setListeningPort,
    issueSessionToken,
    verifySessionToken,
    verifySession: sessionRegistry.verify,
    bindWriteAuthority: sessionRegistry.bindWriteAuthority,
    verifyWriteAuthority: sessionRegistry.verifyWriteAuthority,
    registerInFlightRequest: inFlightRequests.register,
    cancelInFlightRequests: inFlightRequests.cancel,
    cancelSessionTurnRequests,
    retireSessionTurn,
    revokeSessionToken,
    connectionForThread: (threadId, provider, options) => ({
      url: endpoint.url,
      bearerToken: issueSessionToken(threadId, provider, options),
    }),
  } satisfies AgentGatewayCredentialsShape;
});

const AgentGatewayCredentialsLive = Layer.effect(
  AgentGatewayCredentials,
  makeAgentGatewayCredentials,
).pipe(Layer.provide(AgentGatewaySessionRegistryLive));

export const AgentGatewayCredentialsWithSecretsLive = AgentGatewayCredentialsLive.pipe(Layer.orDie);
