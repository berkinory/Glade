/**
 * AgentGatewayCredentials - Per-session credentials for the Glade agent
 * gateway.
 *
 * Small service split out from the gateway itself so provider adapters can
 * mint MCP connection details (endpoint URL + bearer token) at session start
 * without depending on the full tool surface.
 *
 * @module agentGateway/Services/AgentGatewayCredentials
 */
import type { NativeToolCallRegistry } from "../nativeToolCalls.ts";
import type { ProviderKind, ThreadId } from "@glade/contracts";
import { ServiceMap } from "effect";
import type {
  AgentGatewaySessionIdentity,
  AgentGatewayWriteAuthority,
  AgentGatewayCapability,
} from "./AgentGatewaySessionRegistry.ts";
import type {
  AgentGatewayCancellation,
  AgentGatewayInFlightRequestRegistration,
  AgentGatewayInFlightRequestSelector,
} from "../inFlightRequestRegistry.ts";

export interface AgentGatewayMcpConnection {
  /** Loopback streamable-HTTP MCP endpoint, e.g. `http://127.0.0.1:3773/mcp`. */
  readonly url: string;
  /** Bearer token bound to the calling thread. */
  readonly bearerToken: string;
}

export interface AgentGatewayCredentialsShape {
  /** Available when the host can correlate native events with MCP call metadata. */
  readonly nativeToolCalls?: NativeToolCallRegistry;
  /** Streamable-HTTP MCP endpoint served by this Glade instance. */
  readonly mcpEndpointUrl: string;
  /** Update the endpoint after the HTTP server resolves a dynamic listen port. */
  readonly setListeningPort: (port: number) => void;
  /** Mint a new opaque bearer token for one provider session. */
  readonly issueSessionToken: (
    threadId: ThreadId,
    provider: ProviderKind,
    options?: { readonly additionalCapabilities?: readonly AgentGatewayCapability[] },
  ) => string;
  /** Resolve a live bearer token back to its thread id, or null when invalid. */
  readonly verifySessionToken: (token: string) => string | null;
  /** Resolve the complete non-secret invocation scope. */
  readonly verifySession: (token: string) => AgentGatewaySessionIdentity | null;
  /** Pin one request/batch to the exact running turn observed at ingress. */
  readonly bindWriteAuthority: (token: string, turnId: string) => AgentGatewayWriteAuthority | null;
  /** Recheck that a previously bound authority still belongs to a live session. */
  readonly verifyWriteAuthority: (authority: AgentGatewayWriteAuthority) => boolean;
  /** Register one MCP request under its exact provider session and turn. */
  readonly registerInFlightRequest: (
    registration: AgentGatewayInFlightRequestRegistration,
  ) => () => void;
  /** Cancel matching requests, used by MCP `notifications/cancelled`. */
  readonly cancelInFlightRequests: (
    selector: AgentGatewayInFlightRequestSelector,
  ) => AgentGatewayCancellation;
  /** Cancel an entire provider turn even when the MCP client emits no notification. */
  readonly cancelSessionTurnRequests: (token: string, turnId: string) => Promise<void>;
  /**
   * Tombstone one terminal turn and permanently prevent this bearer from
   * acquiring write authority for any later turn. Authority retirement must
   * happen synchronously; the promise represents only in-flight drainage.
   */
  readonly retireSessionTurn: (token: string, turnId: string) => Promise<void>;
  /** Revoke exactly one provider session credential. */
  readonly revokeSessionToken: (token: string) => void;
  /** Convenience bundle used when injecting MCP config into provider sessions. */
  readonly connectionForThread: (
    threadId: ThreadId,
    provider: ProviderKind,
    options?: { readonly additionalCapabilities?: readonly AgentGatewayCapability[] },
  ) => AgentGatewayMcpConnection;
}

export class AgentGatewayCredentials extends ServiceMap.Service<
  AgentGatewayCredentials,
  AgentGatewayCredentialsShape
>()("glade/agentGateway/Services/AgentGatewayCredentials") {}
