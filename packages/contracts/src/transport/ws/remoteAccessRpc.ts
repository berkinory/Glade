import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { AuthSessionId } from "../../core/baseSchemas";
import { AuthClientSession } from "../auth/auth";
import { WsRpcError } from "./rpcErrors";

export const REMOTE_ACCESS_WS_METHODS = {
  subscribe: "remoteAccess.subscribe",
  update: "remoteAccess.update",
  createPairing: "remoteAccess.createPairing",
  subscribeDevices: "remoteAccess.subscribeDevices",
  revokeDevice: "remoteAccess.revokeDevice",
} as const;

// How a device can reach this machine, most preferred first. HTTPS routes come before plain ones.
export const RemoteAccessRouteKind = Schema.Literals([
  "tailnet-https",
  "public-url",
  "tailnet",
  "lan",
  "vpn",
]);
export type RemoteAccessRouteKind = typeof RemoteAccessRouteKind.Type;

export const RemoteAccessRoute = Schema.Struct({
  kind: RemoteAccessRouteKind,
  url: Schema.String,
});
export type RemoteAccessRoute = typeof RemoteAccessRoute.Type;

export const RemoteAccessTailscale = Schema.Struct({
  state: Schema.Literals(["not-installed", "stopped", "running"]),
  // The user's choice; `httpsUrl` is set only while the mapping is actually live.
  httpsRequested: Schema.Boolean,
  httpsUrl: Schema.NullOr(Schema.String),
  // Tailscale's page for turning on HTTPS for the tailnet, when that blocks the mapping.
  setupUrl: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type RemoteAccessTailscale = typeof RemoteAccessTailscale.Type;

export const RemoteAccessStatus = Schema.Struct({
  enabled: Schema.Boolean,
  allowPlainHttp: Schema.Boolean,
  port: Schema.Number,
  listener: Schema.Literals(["off", "on", "failed"]),
  error: Schema.NullOr(Schema.String),
  tailscale: RemoteAccessTailscale,
  routes: Schema.Array(RemoteAccessRoute),
});
export type RemoteAccessStatus = typeof RemoteAccessStatus.Type;

export const RemoteAccessUpdateInput = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  allowPlainHttp: Schema.optionalKey(Schema.Boolean),
  tailscaleHttps: Schema.optionalKey(Schema.Boolean),
});
export type RemoteAccessUpdateInput = typeof RemoteAccessUpdateInput.Type;

// A one-time link for a new device. The secret and the route list ride in the URL fragment, so
// they never reach a server log.
export const RemoteAccessPairing = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  expiresAt: Schema.DateTimeUtc,
});
export type RemoteAccessPairing = typeof RemoteAccessPairing.Type;

export const RemoteAccessDevices = Schema.Struct({
  devices: Schema.Array(AuthClientSession),
  pendingPairingIds: Schema.Array(Schema.String),
});
export type RemoteAccessDevices = typeof RemoteAccessDevices.Type;

export const WsRemoteAccessSubscribeRpc = Rpc.make(REMOTE_ACCESS_WS_METHODS.subscribe, {
  payload: Schema.Struct({}),
  success: RemoteAccessStatus,
  error: WsRpcError,
  stream: true,
});

export const WsRemoteAccessUpdateRpc = Rpc.make(REMOTE_ACCESS_WS_METHODS.update, {
  payload: RemoteAccessUpdateInput,
  success: RemoteAccessStatus,
  error: WsRpcError,
});

export const WsRemoteAccessCreatePairingRpc = Rpc.make(REMOTE_ACCESS_WS_METHODS.createPairing, {
  payload: Schema.Struct({}),
  success: RemoteAccessPairing,
  error: WsRpcError,
});

export const WsRemoteAccessSubscribeDevicesRpc = Rpc.make(
  REMOTE_ACCESS_WS_METHODS.subscribeDevices,
  {
    payload: Schema.Struct({}),
    success: RemoteAccessDevices,
    error: WsRpcError,
    stream: true,
  },
);

export const WsRemoteAccessRevokeDeviceRpc = Rpc.make(REMOTE_ACCESS_WS_METHODS.revokeDevice, {
  payload: Schema.Struct({ sessionId: AuthSessionId }),
  success: Schema.Void,
  error: WsRpcError,
});
