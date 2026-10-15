import backgroundTerminalsCleanSchema from "./generated/schemas/v2/ThreadBackgroundTerminalsCleanResponse.json";
import backgroundTerminalsListSchema from "./generated/schemas/v2/ThreadBackgroundTerminalsListResponse.json";
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
import configReadSchema from "./generated/schemas/v2/ConfigReadResponse.json";
import errorNotificationSchema from "./generated/schemas/v2/ErrorNotification.json";
import type { ModelListResponse } from "./generated/types/v2/ModelListResponse";
import type { SkillsListResponse } from "./generated/types/v2/SkillsListResponse";
import type { PluginListResponse } from "./generated/types/v2/PluginListResponse";
import type { GetAccountResponse } from "./generated/types/v2/GetAccountResponse";
import type { GetAccountRateLimitsResponse } from "./generated/types/v2/GetAccountRateLimitsResponse";
import type { ErrorNotification } from "./generated/types/v2/ErrorNotification";

type PinnedSchema = Parameters<typeof z.fromJSONSchema>[0];
type Validator = ReturnType<typeof z.fromJSONSchema>;

interface ProtocolDocument {
  readonly definitions?: Readonly<Record<string, unknown>>;
}

// A message's `method` selects exactly one `oneOf` variant, so validating against that variant
// alone (with the shared definitions) accepts and rejects the same payloads as the whole union.
function variantsByMethod(union: {
  readonly oneOf: ReadonlyArray<{
    readonly properties: { readonly method: { readonly enum: ReadonlyArray<string> } };
  }>;
}): ReadonlyMap<string, object> {
  return new Map(
    union.oneOf.flatMap((variant) =>
      variant.properties.method.enum.map((method) => [method, variant] as const),
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
  "account/read": accountReadSchema,
  "account/rateLimits/read": accountRateLimitsReadSchema,
  "review/start": reviewStartSchema,
  "skills/extraRoots/set": skillsExtraRootsSetSchema,
  "thread/compact/start": threadCompactStartSchema,
  "thread/backgroundTerminals/clean": backgroundTerminalsCleanSchema,
  "thread/backgroundTerminals/list": backgroundTerminalsListSchema,
  "thread/fork": threadForkSchema,
  "thread/read": threadReadSchema,
  "thread/resume": threadResumeSchema,
  "thread/revert": threadRevertSchema,
  "thread/start": threadStartSchema,
  "thread/turns/list": threadTurnsListSchema,
  "turn/interrupt": turnInterruptSchema,
  "turn/start": turnStartSchema,
  "turn/steer": turnSteerSchema,
  "config/read": configReadSchema,
};

const notificationVariants = variantsByMethod(serverNotificationSchema);
const requestVariants = variantsByMethod(serverRequestSchema);

const standaloneDocuments: ReadonlyArray<object> = [
  ...Object.values(responseDocuments),
  jsonRpcErrorSchema,
  errorNotificationSchema,
  guardianReviewSchema,
];

let validators: ReadonlyMap<object, Validator> | null = null;

// Every generated document repeats the shared protocol definitions, and zod only reuses a compiled
// definition within one conversion. Compiling all roots as one document shares a single type graph;
// compiling each root on its own retained over 100MB of duplicate validators.
function compileValidators(): ReadonlyMap<object, Validator> {
  const definitions: Record<string, unknown> = {};
  const mergeDefinitions = (document: ProtocolDocument) => {
    for (const [name, definition] of Object.entries(document.definitions ?? {})) {
      const existing = definitions[name];
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(definition)) {
        throw new Error(`Codex protocol documents disagree on definition ${name}.`);
      }
      definitions[name] = definition;
    }
  };
  const roots: object[] = [...serverNotificationSchema.oneOf, ...serverRequestSchema.oneOf];
  mergeDefinitions(serverNotificationSchema);
  mergeDefinitions(serverRequestSchema);
  const rootSchemas: unknown[] = [...roots];
  for (const document of standaloneDocuments) {
    mergeDefinitions(document);
    const {
      definitions: _definitions,
      $schema: _schema,
      ...root
    } = document as ProtocolDocument & {
      readonly $schema?: string;
    };
    roots.push(document);
    rootSchemas.push(root);
  }
  const rootNames = rootSchemas.map((_, index) => `__glade_root_${index}`);
  rootSchemas.forEach((root, index) => {
    definitions[rootNames[index]!] = root;
  });
  // JSON imports widen literal schema keywords; the pinned generator supplies Draft-07 documents.
  const union = z.fromJSONSchema({
    $schema: "http://json-schema.org/draft-07/schema#",
    definitions,
    anyOf: rootNames.map((name) => ({ $ref: `#/definitions/${name}` })),
  } as PinnedSchema);
  if (!(union instanceof z.ZodUnion) || union.options.length !== roots.length) {
    throw new Error("Codex protocol roots did not compile to one validator each.");
  }
  return new Map(roots.map((root, index) => [root, union.options[index] as Validator]));
}

function validatorFor(root: object): Validator {
  validators ??= compileValidators();
  const validator = validators.get(root);
  if (!validator) throw new Error("Codex protocol root was not compiled.");
  return validator;
}

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
  root: object,
  value: unknown,
  method: string,
  direction: CodexProtocolError["direction"],
): T {
  const parsed = validatorFor(root).safeParse(value);
  if (!parsed.success) throw new CodexProtocolError(method, direction);
  return parsed.data as T;
}

export function decodeCodexResponse(method: "thread/list", value: unknown): ThreadListResponse;
export function decodeCodexResponse(method: "project/list", value: unknown): ProjectListResponse;
export function decodeCodexResponse(method: "model/list", value: unknown): ModelListResponse;
export function decodeCodexResponse(method: "skills/list", value: unknown): SkillsListResponse;
export function decodeCodexResponse(method: "plugin/list", value: unknown): PluginListResponse;
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
  const variant = notificationVariants.get(value.method);
  if (!variant) return "unknown";
  decode(variant, value, value.method, "notification");
  return "valid";
}

export function decodeCodexServerRequest(value: {
  method: string;
  params?: unknown;
}): "unknown" | "valid" {
  const variant = requestVariants.get(value.method);
  if (!variant) return "unknown";
  decode(variant, value, value.method, "request");
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
