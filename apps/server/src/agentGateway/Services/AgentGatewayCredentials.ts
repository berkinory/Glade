import type { NativeToolCallRegistry } from "../nativeToolCalls.ts";
import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
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
  readonly url: string;

  readonly bearerToken: string;
}

export interface AgentGatewayCredentialsShape {
  readonly nativeToolCalls?: NativeToolCallRegistry;

  readonly mcpEndpointUrl: string;

  readonly setListeningPort: (port: number) => void;

  readonly issueSessionToken: (
    threadId: ThreadId,
    provider: ProviderKind,
    options?: { readonly additionalCapabilities?: readonly AgentGatewayCapability[] },
  ) => string;

  readonly verifySessionToken: (token: string) => string | null;

  readonly verifySession: (token: string) => AgentGatewaySessionIdentity | null;

  readonly bindWriteAuthority: (token: string, turnId: string) => AgentGatewayWriteAuthority | null;

  readonly verifyWriteAuthority: (authority: AgentGatewayWriteAuthority) => boolean;

  readonly registerInFlightRequest: (
    registration: AgentGatewayInFlightRequestRegistration,
  ) => () => void;

  readonly cancelInFlightRequests: (
    selector: AgentGatewayInFlightRequestSelector,
  ) => AgentGatewayCancellation;

  readonly cancelSessionTurnRequests: (token: string, turnId: string) => Promise<void>;
  // Tombstone one terminal turn and permanently prevent this bearer from acquiring write authority
  // for any later turn. Authority retirement must happen synchronously; the promise represents only
  // in-flight drainage.
  readonly retireSessionTurn: (token: string, turnId: string) => Promise<void>;

  readonly revokeSessionToken: (token: string) => void;

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
