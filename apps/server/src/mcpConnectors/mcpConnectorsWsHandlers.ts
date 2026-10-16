import type { McpCatalog } from "@glade/contracts/server/mcpCatalog";
import {
  MCP_CONNECTORS_WS_METHODS,
  type McpConnectorConnectInput,
  type McpConnectorConnectResult,
  type McpConnectorProviders,
  type McpConnectorsState,
} from "@glade/contracts/transport/ws/mcpConnectorsRpc";
import { WsRpcError } from "@glade/contracts/transport/ws/rpcErrors";
import { Effect, type Stream } from "effect";

import type { McpConnectorsError, McpConnectorsShape } from "./Services/McpConnectors";

interface StreamAdmission {
  readonly guard: <A, E, R>(
    clientId: number,
    subscription: { readonly key: string },
    stream: Stream.Stream<A, E, R>,
  ) => Stream.Stream<A, E | WsRpcError, R>;
}

const toWsError = (error: McpConnectorsError) => new WsRpcError({ message: error.message });

export function makeMcpConnectorsWsHandlers(input: {
  readonly connectors: McpConnectorsShape;
  readonly streamAdmission: StreamAdmission;
}) {
  const { connectors, streamAdmission } = input;
  return {
    [MCP_CONNECTORS_WS_METHODS.subscribe]: (
      _payload: unknown,
      options: { readonly clientId: number },
    ): Stream.Stream<McpConnectorsState, WsRpcError> =>
      streamAdmission.guard(
        options.clientId,
        { key: "mcpConnectors.state" },
        connectors.streamState,
      ),
    [MCP_CONNECTORS_WS_METHODS.getCatalog]: (): Effect.Effect<McpCatalog> => connectors.catalog,
    [MCP_CONNECTORS_WS_METHODS.connect]: (
      payload: McpConnectorConnectInput,
    ): Effect.Effect<McpConnectorConnectResult, WsRpcError> =>
      connectors.connect(payload).pipe(Effect.mapError(toWsError)),
    [MCP_CONNECTORS_WS_METHODS.cancelSignIn]: (payload: {
      readonly attemptId: string;
    }): Effect.Effect<void> => connectors.cancelSignIn(payload.attemptId),
    [MCP_CONNECTORS_WS_METHODS.disconnect]: (payload: {
      readonly connectorId: string;
    }): Effect.Effect<void, WsRpcError> =>
      connectors.disconnect(payload.connectorId).pipe(Effect.mapError(toWsError)),
    [MCP_CONNECTORS_WS_METHODS.setProviders]: (payload: {
      readonly connectorId: string;
      readonly providers: McpConnectorProviders;
    }): Effect.Effect<void, WsRpcError> =>
      connectors
        .setProviders(payload.connectorId, payload.providers)
        .pipe(Effect.mapError(toWsError)),
  };
}
