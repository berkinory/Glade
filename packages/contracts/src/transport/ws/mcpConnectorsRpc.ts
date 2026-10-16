import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { ProviderKind } from "../../core/baseSchemas";
import { McpCatalog, McpConnectorAuthKind } from "../../server/mcpCatalog";
import { WsRpcError } from "./rpcErrors";

export const MCP_CONNECTORS_WS_METHODS = {
  subscribe: "mcpConnectors.subscribe",
  getCatalog: "mcpConnectors.getCatalog",
  connect: "mcpConnectors.connect",
  cancelSignIn: "mcpConnectors.cancelSignIn",
  disconnect: "mcpConnectors.disconnect",
  setProviders: "mcpConnectors.setProviders",
} as const;

// The agents a connector serves. Null means every agent, including ones added later.
export const McpConnectorProviders = Schema.NullOr(Schema.Array(ProviderKind));
export type McpConnectorProviders = typeof McpConnectorProviders.Type;

export const McpConnector = Schema.Struct({
  connectorId: Schema.String,
  presetId: Schema.NullOr(Schema.String),
  name: Schema.String,
  url: Schema.String,
  authKind: McpConnectorAuthKind,
  // "needs-sign-in": the vendor rejected the saved sign-in for good; agents get an explanation
  // instead of tools until the user reconnects.
  status: Schema.Literals(["connected", "needs-sign-in"]),
  connectedAt: Schema.String,
  providers: McpConnectorProviders,
});
export type McpConnector = typeof McpConnector.Type;

// A browser sign-in started from Settings. It ends as a connector or a failure the UI can show.
export const McpConnectorSignIn = Schema.Struct({
  attemptId: Schema.String,
  name: Schema.String,
  state: Schema.Literals(["waiting", "failed"]),
  message: Schema.NullOr(Schema.String),
});
export type McpConnectorSignIn = typeof McpConnectorSignIn.Type;

export const McpConnectorsState = Schema.Struct({
  connectors: Schema.Array(McpConnector),
  signIns: Schema.Array(McpConnectorSignIn),
});
export type McpConnectorsState = typeof McpConnectorsState.Type;

// Exactly one of `presetId` or `url`. `token` is required by token presets and optional for custom
// servers; it is never sent back to clients.
export const McpConnectorConnectInput = Schema.Struct({
  presetId: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  token: Schema.optionalKey(Schema.String),
  // Left out on a reconnect to keep the agents chosen before.
  providers: Schema.optionalKey(McpConnectorProviders),
  // Where the browser reaches this server when it is not on the same machine, such as an SSH
  // tunnel's local end. Only loopback origins are accepted.
  callbackOrigin: Schema.optionalKey(Schema.String),
});
export type McpConnectorConnectInput = typeof McpConnectorConnectInput.Type;

export const McpConnectorConnectResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("connected"), connector: McpConnector }),
  Schema.Struct({
    kind: Schema.Literal("authorize"),
    attemptId: Schema.String,
    authorizationUrl: Schema.String,
  }),
]);
export type McpConnectorConnectResult = typeof McpConnectorConnectResult.Type;

export const WsMcpConnectorsSubscribeRpc = Rpc.make(MCP_CONNECTORS_WS_METHODS.subscribe, {
  payload: Schema.Struct({}),
  success: McpConnectorsState,
  error: WsRpcError,
  stream: true,
});

export const WsMcpConnectorsGetCatalogRpc = Rpc.make(MCP_CONNECTORS_WS_METHODS.getCatalog, {
  payload: Schema.Struct({}),
  success: McpCatalog,
  error: WsRpcError,
});

export const WsMcpConnectorsConnectRpc = Rpc.make(MCP_CONNECTORS_WS_METHODS.connect, {
  payload: McpConnectorConnectInput,
  success: McpConnectorConnectResult,
  error: WsRpcError,
});

export const WsMcpConnectorsCancelSignInRpc = Rpc.make(MCP_CONNECTORS_WS_METHODS.cancelSignIn, {
  payload: Schema.Struct({ attemptId: Schema.String }),
  success: Schema.Void,
  error: WsRpcError,
});

export const WsMcpConnectorsDisconnectRpc = Rpc.make(MCP_CONNECTORS_WS_METHODS.disconnect, {
  payload: Schema.Struct({ connectorId: Schema.String }),
  success: Schema.Void,
  error: WsRpcError,
});

export const WsMcpConnectorsSetProvidersRpc = Rpc.make(MCP_CONNECTORS_WS_METHODS.setProviders, {
  payload: Schema.Struct({ connectorId: Schema.String, providers: McpConnectorProviders }),
  success: Schema.Void,
  error: WsRpcError,
});
