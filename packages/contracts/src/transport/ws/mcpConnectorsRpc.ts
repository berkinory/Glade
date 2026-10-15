import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { WsRpcError } from "./rpcErrors";

export const MCP_CONNECTORS_WS_METHODS = {
  subscribe: "mcpConnectors.subscribe",
  connect: "mcpConnectors.connect",
  cancelSignIn: "mcpConnectors.cancelSignIn",
  disconnect: "mcpConnectors.disconnect",
} as const;

export const McpConnectorAuthKind = Schema.Literals(["none", "oauth", "token"]);
export type McpConnectorAuthKind = typeof McpConnectorAuthKind.Type;

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
