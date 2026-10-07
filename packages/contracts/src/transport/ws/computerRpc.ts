import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { COMPUTER_UNAVAILABLE_REASONS } from "../../computer/computerHost";
import { ComputerAccessScope, ComputerUseMode } from "../../computer/computerUse";
import { ThreadId } from "../../core/baseSchemas";
import { RuntimeMode } from "../../provider/sessionPolicy";
import { WsRpcError } from "./rpcErrors";

export const COMPUTER_WS_METHODS = {
  subscribe: "computer.subscribe",
  revokeGrant: "computer.revokeGrant",
} as const;

export const ComputerDriverStatus = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("ready"),
    driverVersion: Schema.String,
    permissions: Schema.Struct({ accessibility: Schema.Boolean, screenRecording: Schema.Boolean }),
    // Failing or warning checks from Cua's health report.
    healthProblems: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals([...COMPUTER_UNAVAILABLE_REASONS, "proxy_failed"]),
    message: Schema.String,
  }),
]);
export type ComputerDriverStatus = typeof ComputerDriverStatus.Type;

export const ComputerGrantTarget = Schema.Struct({
  threadId: ThreadId,
  app: Schema.String,
  // null: the grant covers every window of the app.
  windowId: Schema.NullOr(Schema.Int),
});
export type ComputerGrantTarget = typeof ComputerGrantTarget.Type;

export const ComputerGrantView = Schema.Struct({
  app: Schema.String,
  windowId: Schema.NullOr(Schema.Int),
  windowTitle: Schema.NullOr(Schema.String),
  scope: ComputerAccessScope,
  grantedAt: Schema.String,
  // The chat's permission mode when it granted this without asking; null when the user answered.
  autoGrantedIn: Schema.NullOr(RuntimeMode),
});
export type ComputerGrantView = typeof ComputerGrantView.Type;

// Threads with Computer Use not off or with grants; every other thread is off with no grants.
export const ComputerThreadState = Schema.Struct({
  threadId: ThreadId,
  mode: ComputerUseMode,
  grants: Schema.Array(ComputerGrantView),
});
export type ComputerThreadState = typeof ComputerThreadState.Type;

export const ComputerState = Schema.Struct({
  status: ComputerDriverStatus,
  threads: Schema.Array(ComputerThreadState),
});
export type ComputerState = typeof ComputerState.Type;

export const WsComputerSubscribeRpc = Rpc.make(COMPUTER_WS_METHODS.subscribe, {
  payload: Schema.Struct({}),
  success: ComputerState,
  error: WsRpcError,
  stream: true,
});

export const WsComputerRevokeGrantRpc = Rpc.make(COMPUTER_WS_METHODS.revokeGrant, {
  payload: ComputerGrantTarget,
  success: Schema.Void,
  error: WsRpcError,
});
