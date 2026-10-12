import guardianReviewSchema from "./generated/schemas/v2/ItemGuardianApprovalReviewCompletedNotification.json";
import type { ItemGuardianApprovalReviewCompletedNotification } from "./generated/types/v2/ItemGuardianApprovalReviewCompletedNotification";
import guardianOverrideSchema from "./generated/schemas/v2/ThreadApproveGuardianDeniedActionResponse.json";
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

type PinnedSchema = Parameters<typeof z.fromJSONSchema>[0];
type Validator = ReturnType<typeof z.fromJSONSchema>;

const validators = new Map<object, Validator>();

// Compiling the generated documents costs tens of megabytes of heap, so each one is compiled on
// first use and kept for the life of the process.
function validatorFor(document: object): Validator {
  const cached = validators.get(document);
  if (cached) return cached;
  // JSON imports widen literal schema keywords; the pinned generator supplies Draft-07 documents.
  const validator = z.fromJSONSchema(document as PinnedSchema);
  validators.set(document, validator);
  return validator;
}

// A message's `method` selects exactly one `oneOf` variant, so validating against that variant
// alone (with the shared definitions) accepts and rejects the same payloads as the whole union.
function documentsByMethod(union: {
  readonly oneOf: ReadonlyArray<{
    readonly properties: { readonly method: { readonly enum: ReadonlyArray<string> } };
  }>;
}): ReadonlyMap<string, object> {
  return new Map(
    union.oneOf.flatMap((variant) =>
      variant.properties.method.enum.map(
        (method) => [method, { ...union, oneOf: [variant] }] as const,
      ),
    ),
  );
}

const responseDocuments: Readonly<Record<string, object>> = {
  "thread/approveGuardianDeniedAction": guardianOverrideSchema,
  "thread/list": threadListSchema,
  "project/list": projectListSchema,
  "model/list": modelListSchema,
  "skills/list": skillsListSchema,
  "plugin/list": pluginListSchema,
  "plugin/read": pluginReadSchema,
  "account/read": accountReadSchema,
  "account/rateLimits/read": accountRateLimitsReadSchema,
  "review/start": reviewStartSchema,
  "skills/extraRoots/set": skillsExtraRootsSetSchema,
  "thread/compact/start": threadCompactStartSchema,
  "thread/fork": threadForkSchema,
  "thread/read": threadReadSchema,
  "thread/resume": threadResumeSchema,
  "thread/revert": threadRevertSchema,
  "thread/start": threadStartSchema,
  "thread/turns/list": threadTurnsListSchema,
  "turn/interrupt": turnInterruptSchema,
  "turn/start": turnStartSchema,
  "turn/steer": turnSteerSchema,
  "mcpServerStatus/list": mcpStatusListSchema,
  "config/read": configReadSchema,
  "config/value/write": configWriteSchema,
  "config/batchWrite": configWriteSchema,
  "mcpServer/oauth/login": mcpOauthLoginSchema,
  "config/mcpServer/reload": mcpRefreshSchema,
  "plugin/installed": pluginInstalledSchema,
  "plugin/install": pluginInstallSchema,
  "plugin/uninstall": pluginUninstallSchema,
};

const notificationDocuments = documentsByMethod(serverNotificationSchema);
const requestDocuments = documentsByMethod(serverRequestSchema);

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
  document: object,
  value: unknown,
  method: string,
  direction: CodexProtocolError["direction"],
): T {
  const parsed = validatorFor(document).safeParse(value);
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
  const document = Object.hasOwn(responseDocuments, method) ? responseDocuments[method] : undefined;
  return document ? decode(document, value, method, "response") : value;
}

export function decodeCodexNotification(value: {
  method: string;
  params?: unknown;
}): "unknown" | "valid" {
  const document = notificationDocuments.get(value.method);
  if (!document) return "unknown";
  decode(document, value, value.method, "notification");
  return "valid";
}

export function decodeCodexServerRequest(value: {
  method: string;
  params?: unknown;
}): "unknown" | "valid" {
  const document = requestDocuments.get(value.method);
  if (!document) return "unknown";
  decode(document, value, value.method, "request");
  return "valid";
}

export function decodeCodexRpcError(value: unknown): void {
  decode(jsonRpcErrorSchema, value, "JSON-RPC error", "response");
}

export function decodeCodexErrorParams(value: unknown): ErrorNotification {
  return decode(errorNotificationSchema, value, "error", "notification");
}

export function decodeCodexGuardianReview(
  value: unknown,
): ItemGuardianApprovalReviewCompletedNotification {
  return decode(guardianReviewSchema, value, "item/autoApprovalReview/completed", "notification");
}
