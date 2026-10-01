import { Schema } from "effect";
import { ProviderKind, ThreadId, TrimmedNonEmptyString } from "../core/baseSchemas";

export const ProviderManagementScope = Schema.Literals(["user", "project", "local"]);
export type ProviderManagementScope = typeof ProviderManagementScope.Type;

export const ProviderManagementContext = Schema.Struct({
  provider: ProviderKind,
  cwd: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(ThreadId),
});
export type ProviderManagementContext = typeof ProviderManagementContext.Type;

export const ProviderMcpAction = Schema.Literals([
  "authenticate",
  "reconnect",
  "enable",
  "disable",
  "remove",
]);
export type ProviderMcpAction = typeof ProviderMcpAction.Type;

export const ProviderMcpServer = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  provider: ProviderKind,
  scope: Schema.optional(TrimmedNonEmptyString),
  transport: Schema.Literals(["stdio", "http", "unknown"]),
  status: Schema.Literals([
    "pending",
    "starting",
    "ready",
    "failed",
    "needs-auth",
    "disabled",
    "cancelled",
    "unknown",
  ]),
  toolCount: Schema.optional(Schema.Number),
  error: Schema.optional(TrimmedNonEmptyString),
  managed: Schema.Boolean,
  actions: Schema.Array(ProviderMcpAction),
  configVersion: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderMcpServer = typeof ProviderMcpServer.Type;

export const ProviderListMcpServersResult = Schema.Struct({
  servers: Schema.Array(ProviderMcpServer),
  source: TrimmedNonEmptyString,
  error: Schema.optional(TrimmedNonEmptyString),
  canAdd: Schema.Boolean,
  configVersion: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderListMcpServersResult = typeof ProviderListMcpServersResult.Type;

const ProviderMcpConfiguration = Schema.Union([
  Schema.Struct({
    transport: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString,
    args: Schema.Array(Schema.String),
    env: Schema.optional(Schema.Record(TrimmedNonEmptyString, Schema.String)),
  }),
  Schema.Struct({
    transport: Schema.Literal("http"),
    url: TrimmedNonEmptyString,
    headers: Schema.optional(Schema.Record(TrimmedNonEmptyString, Schema.String)),
  }),
]);
export type ProviderMcpConfiguration = typeof ProviderMcpConfiguration.Type;

export const ProviderManageMcpServerInput = Schema.Struct({
  ...ProviderManagementContext.fields,
  name: TrimmedNonEmptyString,
  action: Schema.Literals(["add", "authenticate", "reconnect", "enable", "disable", "remove"]),
  scope: Schema.optional(ProviderManagementScope),
  configuration: Schema.optional(ProviderMcpConfiguration),
  expectedVersion: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderManageMcpServerInput = typeof ProviderManageMcpServerInput.Type;

export const ProviderManagementResult = Schema.Struct({
  applied: Schema.Boolean,
  affects: Schema.Literals(["session", "provider", "next-session"]),
  message: Schema.optional(TrimmedNonEmptyString),
  authorizationUrl: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderManagementResult = typeof ProviderManagementResult.Type;

export const ProviderPluginAction = Schema.Literals([
  "install",
  "remove",
  "enable",
  "disable",
  "reload",
]);
export type ProviderPluginAction = typeof ProviderPluginAction.Type;

export const ProviderInstalledPlugin = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  provider: ProviderKind,
  version: Schema.optional(TrimmedNonEmptyString),
  scope: Schema.optional(TrimmedNonEmptyString),
  installed: Schema.Boolean,
  loaded: Schema.optional(Schema.Boolean),
  enabled: Schema.optional(Schema.Boolean),
  error: Schema.optional(TrimmedNonEmptyString),
  actions: Schema.Array(ProviderPluginAction),
});
export type ProviderInstalledPlugin = typeof ProviderInstalledPlugin.Type;

export const ProviderPluginInventoryResult = Schema.Struct({
  plugins: Schema.Array(ProviderInstalledPlugin),
  source: TrimmedNonEmptyString,
  error: Schema.optional(TrimmedNonEmptyString),
  canInstall: Schema.Boolean,
});
export type ProviderPluginInventoryResult = typeof ProviderPluginInventoryResult.Type;

export const ProviderManagePluginInput = Schema.Struct({
  ...ProviderManagementContext.fields,
  id: TrimmedNonEmptyString,
  action: ProviderPluginAction,
  scope: Schema.optional(ProviderManagementScope),
  marketplacePath: Schema.optional(TrimmedNonEmptyString),
  remoteMarketplaceName: Schema.optional(TrimmedNonEmptyString),
  expectedVersion: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderManagePluginInput = typeof ProviderManagePluginInput.Type;
