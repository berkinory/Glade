import type {
  McpConnectorConnectInput,
  McpConnectorConnectResult,
  McpConnectorProviders,
  McpConnectorsState,
} from "@glade/contracts/transport/ws/mcpConnectorsRpc";
import { Data, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type { UpstreamRequest } from "../connectorTransport.ts";

export class McpConnectorsError extends Data.TaggedError("McpConnectorsError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type McpConnectorCallbackOutcome =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly title: string; readonly message: string };

interface McpConnectorCallbackQuery {
  readonly state: string | undefined;
  readonly code: string | undefined;
  readonly error: string | undefined;
  readonly errorDescription: string | undefined;
}

// What the gateway answers a provider session with. `failure` carries a reason the model should
// read, which the route turns into JSON-RPC errors rather than an HTTP status the provider's MCP
// client would act on (a 401 would make it start its own OAuth against the gateway).
type McpConnectorUpstreamResult =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly contentType: string | null;
      readonly sessionId: string | null;
      readonly body: ReadableStream<Uint8Array>;
    }
  | { readonly kind: "failure"; readonly message: string };

export interface McpConnectorsShape {
  readonly streamState: Stream.Stream<McpConnectorsState>;
  readonly connect: (
    input: McpConnectorConnectInput,
  ) => Effect.Effect<McpConnectorConnectResult, McpConnectorsError>;
  readonly cancelSignIn: (attemptId: string) => Effect.Effect<void>;
  readonly disconnect: (connectorId: string) => Effect.Effect<void, McpConnectorsError>;
  // Takes effect for sessions that start afterwards.
  readonly setProviders: (
    connectorId: string,
    providers: McpConnectorProviders,
  ) => Effect.Effect<void, McpConnectorsError>;
  // The OAuth redirect target. The browser carries no Glade session, so the single-use state
  // minted with the sign-in is the only authority.
  readonly completeSignIn: (
    query: McpConnectorCallbackQuery,
  ) => Effect.Effect<McpConnectorCallbackOutcome>;
  // Callers must already have checked that the session was granted this connector.
  readonly forward: (
    connectorId: string,
    request: UpstreamRequest,
  ) => Effect.Effect<McpConnectorUpstreamResult>;
}

export class McpConnectors extends ServiceMap.Service<McpConnectors, McpConnectorsShape>()(
  "glade/mcpConnectors/Services/McpConnectors",
) {}
