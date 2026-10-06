import { Schema } from "effect";

import { NonNegativeInt } from "../../core/baseSchemas";

export const WS_PROTOCOL_EPOCH = 1;

export const WS_PROTOCOL_MIN_REVISION = 3;
export const WS_PROTOCOL_MAX_REVISION = 3;
export const WS_BOOTSTRAP_METHOD = "bootstrap.negotiate";
export const WS_BOOTSTRAP_PATH = "/ws/bootstrap";
export const WS_NEGOTIATE_HTTP_PATH = "/ws/negotiate";
export const WS_FEATURE_PATH = "/ws";

export const WS_STREAM_LIMITS = {
  totalPerClient: 20,
  threadPerClient: 8,
} as const;

export const WS_COMPATIBILITY_QUERY = {
  clientBuild: "x-glade-client-build",
  protocolEpoch: "x-glade-protocol-epoch",
  protocolRevision: "x-glade-protocol-revision",
  serverInstanceId: "x-glade-server-instance",
} as const;

export const WS_NEGOTIATE_QUERY = {
  clientBuild: "x-glade-client-build",
  protocolEpoch: "x-glade-protocol-epoch",
  minRevision: "x-glade-protocol-min-revision",
  maxRevision: "x-glade-protocol-max-revision",
  requiredCapability: "x-glade-required-capability",
} as const;

export const WS_GITHUB_PROJECT_PROVISIONING_CAPABILITY = "projects.github-provisioning";
export const WS_TURN_DISPATCH_SETTLEMENT_CAPABILITY = "orchestration.turn-dispatch-settlement";
export const WS_PROJECT_FILE_WATCH_CAPABILITY = "projects.file-watch";
// Older servers ignore `resume` on git.runStackedAction and would run the mutation again.
export const WS_GIT_ACTION_REATTACH_CAPABILITY = "git.action-reattach";
// Older servers ignore `onlyIfIdle` and would deliver automatic terminal input to a busy program.
export const WS_TERMINAL_IDLE_INPUT_CAPABILITY = "terminal.idle-input";

export const WS_CLIENT_REQUIRED_CAPABILITIES = [
  "orchestration.cursor-safe-streams",
  WS_TURN_DISPATCH_SETTLEMENT_CAPABILITY,
  "orchestration.thread-detail-snapshot",
  "rpc.typed-errors",
  WS_TERMINAL_IDLE_INPUT_CAPABILITY,

  "git.worktree-setup-progress",
] as const;

export const WS_SERVER_CAPABILITIES = [
  ...WS_CLIENT_REQUIRED_CAPABILITIES,

  WS_GITHUB_PROJECT_PROVISIONING_CAPABILITY,
  WS_PROJECT_FILE_WATCH_CAPABILITY,
  WS_GIT_ACTION_REATTACH_CAPABILITY,

  "transport.http-negotiate",
] as const;

export const WsCompatibilityAction = Schema.Literals(["reload", "update-client", "update-server"]);
export type WsCompatibilityAction = typeof WsCompatibilityAction.Type;

export const WsBootstrapNegotiateInput = Schema.Struct({
  protocolEpoch: Schema.Int,
  minRevision: NonNegativeInt,
  maxRevision: NonNegativeInt,
  clientBuild: Schema.String,
  requiredCapabilities: Schema.Array(Schema.String),
});
export type WsBootstrapNegotiateInput = typeof WsBootstrapNegotiateInput.Type;

export const WsBootstrapNegotiateResult = Schema.Struct({
  protocolEpoch: Schema.Int,
  negotiatedRevision: NonNegativeInt,
  serverBuild: Schema.String,
  serverInstanceId: Schema.String,
  capabilities: Schema.Array(Schema.String),
});
export type WsBootstrapNegotiateResult = typeof WsBootstrapNegotiateResult.Type;

export class WsCompatibilityError extends Schema.TaggedErrorClass<WsCompatibilityError>()(
  "WsCompatibilityError",
  {
    message: Schema.String,
    code: Schema.Literals([
      "WS_PROTOCOL_INCOMPATIBLE",
      "WS_CAPABILITIES_INCOMPATIBLE",
      "WS_NEGOTIATION_REQUIRED",
      "WS_SERVER_GENERATION_CHANGED",
    ]),
    retryable: Schema.Literal(false),
    action: WsCompatibilityAction,
    serverBuild: Schema.String,
    protocolEpoch: Schema.Int,
    minRevision: NonNegativeInt,
    maxRevision: NonNegativeInt,
  },
) {}
