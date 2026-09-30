import threadListSchema from "./generated/schemas/v2/ThreadListResponse.json";
import projectListSchema from "./generated/schemas/v2/ProjectListResponse.json";
import type { ThreadListResponse } from "./generated/types/v2/ThreadListResponse";
import type { ProjectListResponse } from "./generated/types/v2/ProjectListResponse";
import { z } from "zod";
import modelListSchema from "./generated/schemas/v2/ModelListResponse.json";
import skillsListSchema from "./generated/schemas/v2/SkillsListResponse.json";
import pluginListSchema from "./generated/schemas/v2/PluginListResponse.json";
import pluginReadSchema from "./generated/schemas/v2/PluginReadResponse.json";
import serverNotificationSchema from "./generated/schemas/ServerNotification.json";
import serverRequestSchema from "./generated/schemas/ServerRequest.json";
import jsonRpcErrorSchema from "./generated/schemas/JSONRPCErrorError.json";
import accountReadSchema from "./generated/schemas/v2/GetAccountResponse.json";
import accountRateLimitsReadSchema from "./generated/schemas/v2/GetAccountRateLimitsResponse.json";
import reviewStartSchema from "./generated/schemas/v2/ReviewStartResponse.json";
import skillsExtraRootsSetSchema from "./generated/schemas/v2/SkillsExtraRootsSetResponse.json";
import threadCompactStartSchema from "./generated/schemas/v2/ThreadCompactStartResponse.json";
import threadForkSchema from "./generated/schemas/v2/ThreadForkResponse.json";
import threadReadSchema from "./generated/schemas/v2/ThreadReadResponse.json";
import threadResumeSchema from "./generated/schemas/v2/ThreadResumeResponse.json";
import threadRevertSchema from "./generated/schemas/v2/ThreadRevertResponse.json";
import threadStartSchema from "./generated/schemas/v2/ThreadStartResponse.json";
import threadTurnsListSchema from "./generated/schemas/v2/ThreadTurnsListResponse.json";
import turnInterruptSchema from "./generated/schemas/v2/TurnInterruptResponse.json";
import turnStartSchema from "./generated/schemas/v2/TurnStartResponse.json";
import turnSteerSchema from "./generated/schemas/v2/TurnSteerResponse.json";
import mcpStatusListSchema from "./generated/schemas/v2/ListMcpServerStatusResponse.json";
import configReadSchema from "./generated/schemas/v2/ConfigReadResponse.json";
import configWriteSchema from "./generated/schemas/v2/ConfigWriteResponse.json";
import mcpOauthLoginSchema from "./generated/schemas/v2/McpServerOauthLoginResponse.json";
import pluginInstalledSchema from "./generated/schemas/v2/PluginInstalledResponse.json";
import pluginInstallSchema from "./generated/schemas/v2/PluginInstallResponse.json";
import pluginUninstallSchema from "./generated/schemas/v2/PluginUninstallResponse.json";
import mcpRefreshSchema from "./generated/schemas/v2/McpServerRefreshResponse.json";
import errorNotificationSchema from "./generated/schemas/v2/ErrorNotification.json";
import type { ModelListResponse } from "./generated/types/v2/ModelListResponse";
import type { SkillsListResponse } from "./generated/types/v2/SkillsListResponse";
import type { PluginListResponse } from "./generated/types/v2/PluginListResponse";
import type { PluginReadResponse } from "./generated/types/v2/PluginReadResponse";
import type { GetAccountResponse } from "./generated/types/v2/GetAccountResponse";
import type { GetAccountRateLimitsResponse } from "./generated/types/v2/GetAccountRateLimitsResponse";
import type { ErrorNotification } from "./generated/types/v2/ErrorNotification";

function fromPinnedSchema(value: unknown) {
  // JSON imports widen literal schema keywords; the pinned generator supplies Draft-07 documents.
  return z.fromJSONSchema(value as Parameters<typeof z.fromJSONSchema>[0]);
}

const responseSchemas = {
  "thread/list": fromPinnedSchema(threadListSchema),
  "project/list": fromPinnedSchema(projectListSchema),
  "model/list": fromPinnedSchema(modelListSchema),
  "skills/list": fromPinnedSchema(skillsListSchema),
  "plugin/list": fromPinnedSchema(pluginListSchema),
  "plugin/read": fromPinnedSchema(pluginReadSchema),
  "account/read": fromPinnedSchema(accountReadSchema),
  "account/rateLimits/read": fromPinnedSchema(accountRateLimitsReadSchema),
  "review/start": fromPinnedSchema(reviewStartSchema),
  "skills/extraRoots/set": fromPinnedSchema(skillsExtraRootsSetSchema),
  "thread/compact/start": fromPinnedSchema(threadCompactStartSchema),
  "thread/fork": fromPinnedSchema(threadForkSchema),
  "thread/read": fromPinnedSchema(threadReadSchema),
  "thread/resume": fromPinnedSchema(threadResumeSchema),
  "thread/revert": fromPinnedSchema(threadRevertSchema),
  "thread/start": fromPinnedSchema(threadStartSchema),
  "thread/turns/list": fromPinnedSchema(threadTurnsListSchema),
  "turn/interrupt": fromPinnedSchema(turnInterruptSchema),
  "turn/start": fromPinnedSchema(turnStartSchema),
  "turn/steer": fromPinnedSchema(turnSteerSchema),
  "mcpServerStatus/list": fromPinnedSchema(mcpStatusListSchema),
  "config/read": fromPinnedSchema(configReadSchema),
  "config/value/write": fromPinnedSchema(configWriteSchema),
  "config/batchWrite": fromPinnedSchema(configWriteSchema),
  "mcpServer/oauth/login": fromPinnedSchema(mcpOauthLoginSchema),
  "config/mcpServer/reload": fromPinnedSchema(mcpRefreshSchema),
  "plugin/installed": fromPinnedSchema(pluginInstalledSchema),
  "plugin/install": fromPinnedSchema(pluginInstallSchema),
  "plugin/uninstall": fromPinnedSchema(pluginUninstallSchema),
};

const notificationSchema = fromPinnedSchema(serverNotificationSchema);
const requestSchema = fromPinnedSchema(serverRequestSchema);
const errorSchema = fromPinnedSchema(jsonRpcErrorSchema);
const errorParamsSchema = fromPinnedSchema(errorNotificationSchema);
const knownNotificationMethods = new Set(
  serverNotificationSchema.oneOf.flatMap((entry) => entry.properties.method.enum),
);
const knownRequestMethods = new Set(
  serverRequestSchema.oneOf.flatMap((entry) => entry.properties.method.enum),
);

class CodexProtocolError extends Error {
  constructor(
    readonly method: string,
    readonly direction: "request" | "response" | "notification",
  ) {
    super(`Invalid Codex ${direction} payload for ${method}.`);
    this.name = "CodexProtocolError";
  }
}

function decode<T>(
  schema: ReturnType<typeof z.fromJSONSchema>,
  value: unknown,
  method: string,
  direction: CodexProtocolError["direction"],
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CodexProtocolError(method, direction);
  return parsed.data as T;
}

export function decodeCodexResponse(method: "thread/list", value: unknown): ThreadListResponse;
export function decodeCodexResponse(method: "project/list", value: unknown): ProjectListResponse;
export function decodeCodexResponse(method: "model/list", value: unknown): ModelListResponse;
export function decodeCodexResponse(method: "skills/list", value: unknown): SkillsListResponse;
export function decodeCodexResponse(method: "plugin/list", value: unknown): PluginListResponse;
export function decodeCodexResponse(method: "plugin/read", value: unknown): PluginReadResponse;
export function decodeCodexResponse(method: "account/read", value: unknown): GetAccountResponse;
export function decodeCodexResponse(
  method: "account/rateLimits/read",
  value: unknown,
): GetAccountRateLimitsResponse;
export function decodeCodexResponse(method: string, value: unknown): unknown;
export function decodeCodexResponse(method: string, value: unknown): unknown {
  const schema = responseSchemas[method as keyof typeof responseSchemas];
  return schema ? decode(schema, value, method, "response") : value;
}

export function decodeCodexNotification(value: {
  method: string;
  params?: unknown;
}): "unknown" | "valid" {
  if (!knownNotificationMethods.has(value.method)) return "unknown";
  decode(notificationSchema, value, value.method, "notification");
  return "valid";
}

export function decodeCodexServerRequest(value: {
  method: string;
  params?: unknown;
}): "unknown" | "valid" {
  if (!knownRequestMethods.has(value.method)) return "unknown";
  decode(requestSchema, value, value.method, "request");
  return "valid";
}

export function decodeCodexRpcError(value: unknown): void {
  decode(errorSchema, value, "JSON-RPC error", "response");
}

export function decodeCodexErrorParams(value: unknown): ErrorNotification {
  return decode(errorParamsSchema, value, "error", "notification");
}
