import { decodeCodexGuardianReview } from "../codex/protocol/decode.ts";
import { asArray, asFiniteNumber } from "@glade/shared/transport/payloadValues";
import { asString, nonEmptyTrimmed } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { AsyncUserInputQuestions } from "@glade/contracts/orchestration/asyncUserInput";
import { type ChatAttachment } from "@glade/contracts/orchestration/threadEntities";
import {
  type ModelSelection,
  type ProviderUserInputAnswers,
  ProviderApprovalDecision,
} from "@glade/contracts/provider/sessionPolicy";
import {
  type CanonicalItemType,
  type CanonicalRequestType,
} from "@glade/contracts/provider/runtimeMetadata";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { type ThreadTokenUsageSnapshot } from "@glade/contracts/provider/runtimePayloads";
import {
  type ProviderComposerCapabilities,
  type ProviderListModelsResult,
  type ProviderListPluginsResult,
  type ProviderReadPluginResult,
  type ProviderListSkillsResult,
} from "@glade/contracts/provider/providerDiscovery";
import { type ProviderEvent, type ProviderSendTurnInput } from "@glade/contracts/provider/provider";
import { type ServerVoiceTranscriptionResult } from "@glade/contracts/server/server";
import {
  EventId,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  ProviderItemId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import { Cause, Effect, Layer, Option, Queue, Schema, ServiceMap, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../core/Errors.ts";
import { CodexAdapter, type CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY } from "../Services/ProviderAdapter.ts";
import {
  CodexAppServerManager,
  parseCodexUserInputQuestions,
  type CodexAppServerSendTurnInput,
  type CodexAppServerStartSessionInput,
} from "../codex/codexAppServerManager.ts";
import { evaluateTurnIdleTick, resolveTurnIdleTimeoutMs } from "../core/turnIdleTimeout.ts";
import { AgentGatewayCredentials } from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import {
  acquireAgentGatewaySessionLease,
  AGENT_GATEWAY_NO_CAPABILITIES,
  captureAgentGatewayCapabilityInput,
} from "../../agentGateway/sessionLease.ts";
import { filterProviderPromptImageAttachments } from "../core/promptAttachments.ts";
import { resolveProviderAttachmentPath } from "../core/providerAttachmentPaths.ts";
import {
  codexGeneratedImageArtifact,
  extractCodexGeneratedImageReference,
  firstStringValue,
  isCodexGeneratedImageItemType,
  sanitizeNestedCodexGeneratedImagePayloads,
} from "../codex/codexGeneratedImages.ts";
import { CodexSessionStartError } from "../codex/codexErrorClassification.ts";
import { decodeCodexErrorParams } from "../codex/protocol/decode.ts";
import {
  codexUpdatedModelSelection,
  decodeCodexFilePatch,
  decodeCodexApprovalReview,
} from "../codex/codexStateNotifications.ts";
import { normalizeCodexFailure } from "../codex/codexFailures.ts";
import { ServerConfig } from "../../server/config.ts";
import { resolveCodexServiceTier } from "../codex/codexServiceTier.ts";
import { makeRuntimeTaskListItem } from "../core/runtimeTaskList.ts";

import { appendFileAttachmentsPromptBlock } from "../core/attachmentProjection.ts";
import { gladeSkillsDir } from "../core/skillsCatalog.ts";
import { makeBoundedCallbackIngress } from "../core/boundedCallbackIngress.ts";
import { assignDerivedProviderRuntimeEventIds } from "../core/providerRuntimeEventIdentity.ts";
import {
  compactProviderRuntimeEventForIngress,
  isTerminalProviderRuntimeEvent,
  PROVIDER_RUNTIME_CALLBACK_BUFFER_MAX_BYTES,
  PROVIDER_RUNTIME_CALLBACK_TERMINAL_RESERVE,
  PROVIDER_RUNTIME_INGRESS_EVENT_MAX_BYTES,
} from "../core/providerRuntimeEventIngress.ts";
import {
  makeUnmappedProviderEventGate,
  sanitizeUnmappedProviderData,
  sanitizeUnmappedProviderDetail,
  sanitizeUnmappedProviderEvent,
  sanitizeUnmappedProviderNativeType,
} from "../core/unmappedProviderEvents.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = "codex" as const;

const CODEX_TURN_IDLE_TIMEOUT_MS = resolveTurnIdleTimeoutMs({
  envVar: "GLADE_CODEX_TURN_IDLE_TIMEOUT_MS",
  defaultMs: 900_000,
});
const CODEX_TURN_WATCHDOG_INTERVAL_MS = 15_000;

interface CodexTurnWatchdogEntry {
  readonly turnId: TurnId;
  lastActivityAt: number;
}

type CodexRuntimeIngressItem = {
  readonly nativeEvent: ProviderEvent;
  readonly runtimeEvents: ReadonlyArray<ProviderRuntimeEvent>;
  readonly bytes: number;
};

function compactCodexNativeEventForIngress(event: ProviderEvent): {
  readonly event: ProviderEvent;
  readonly bytes: number;
} {
  let originalBytes: number;
  try {
    originalBytes = Buffer.byteLength(JSON.stringify(event), "utf8");
  } catch {
    originalBytes = PROVIDER_RUNTIME_INGRESS_EVENT_MAX_BYTES + 1;
  }
  if (originalBytes <= PROVIDER_RUNTIME_INGRESS_EVENT_MAX_BYTES) {
    return { event, bytes: originalBytes };
  }
  const compactedEvent: ProviderEvent = {
    ...event,
    payload: {
      gladeTruncated: true,
      reason: "Codex native event exceeded the callback ingress size limit",
      originalBytes,
    },
  };
  let compactedBytes: number;
  try {
    compactedBytes = Buffer.byteLength(JSON.stringify(compactedEvent), "utf8");
  } catch {
    compactedBytes = PROVIDER_RUNTIME_INGRESS_EVENT_MAX_BYTES;
  }
  return { event: compactedEvent, bytes: compactedBytes };
}

export interface CodexAdapterLiveOptions {
  readonly manager?: CodexAppServerManager;
  readonly makeManager?: (services?: ServiceMap.ServiceMap<never>) => CodexAppServerManager;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return sanitizeUserFacingErrorMessage(cause.message, fallback);
  }
  return fallback;
}

function sanitizeUserFacingErrorMessage(message: string, fallback: string): string {
  const normalized = message.trim();
  if (normalized.length === 0) {
    return fallback;
  }

  const firstLine = normalized.split("\n")[0]?.trim() ?? "";
  const withoutInlineStack = firstLine.replace(/\s+at file:\/\/.*$/s, "").trim();
  return withoutInlineStack.length > 0 ? withoutInlineStack : fallback;
}

function composeCodexInputWithFileAttachments(input: {
  readonly input: string | undefined;
  readonly attachments: ReadonlyArray<ChatAttachment> | undefined;
  readonly attachmentsDir: string;
}): string | undefined {
  return appendFileAttachmentsPromptBlock({
    text: input.input,
    attachments: input.attachments,
    attachmentsDir: input.attachmentsDir,
    include: "all-files",
  });
}

function codexModelSelectionOverrides(
  modelSelection: ModelSelection | undefined,
): Pick<CodexAppServerSendTurnInput, "model" | "effort"> &
  Pick<CodexAppServerStartSessionInput, "serviceTier"> {
  if (modelSelection?.provider !== PROVIDER) {
    return {};
  }

  const serviceTier = resolveCodexServiceTier(modelSelection);
  return {
    model: modelSelection.model,
    ...(modelSelection.options?.reasoningEffort !== undefined
      ? { effort: modelSelection.options.reasoningEffort }
      : {}),
    ...(serviceTier !== undefined ? { serviceTier } : {}),
  };
}

function toSessionError(
  threadId: ThreadId,
  cause: unknown,
): ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined {
  const normalized = toMessage(cause, "").toLowerCase();
  if (normalized.includes("unknown session") || normalized.includes("unknown provider session")) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }

  if (normalized.includes("session is closed") || normalized.includes("stdin closed")) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  return undefined;
}

function toRequestError(threadId: ThreadId, method: string, cause: unknown): ProviderAdapterError {
  const sessionError = toSessionError(threadId, cause);
  if (sessionError) {
    return sessionError;
  }
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: toMessage(cause, `${method} failed`),
    cause,
  });
}

function providerErrorMapsToWarning(event: ProviderEvent): boolean {
  return (
    event.kind === "error" &&
    (event.method === "mcpServer/elicitation/request/unrenderable" ||
      (event.method === "error" &&
        (asObjectRecord(event.payload) ?? undefined)?.willRetry === true))
  );
}

function normalizeCodexTokenUsage(value: unknown): ThreadTokenUsageSnapshot | undefined {
  const usage = asObjectRecord(value) ?? undefined;
  const totalUsage = asObjectRecord(usage?.total_token_usage ?? usage?.total) ?? undefined;
  const lastUsage = asObjectRecord(usage?.last_token_usage ?? usage?.last) ?? undefined;

  const totalProcessedTokens =
    asFiniteNumber(totalUsage?.total_tokens) ?? asFiniteNumber(totalUsage?.totalTokens);
  const usedTokens =
    asFiniteNumber(lastUsage?.total_tokens) ??
    asFiniteNumber(lastUsage?.totalTokens) ??
    totalProcessedTokens;
  if (usedTokens === undefined || usedTokens <= 0) {
    return undefined;
  }

  const maxTokens =
    asFiniteNumber(usage?.model_context_window) ?? asFiniteNumber(usage?.modelContextWindow);
  const inputTokens =
    asFiniteNumber(lastUsage?.input_tokens) ?? asFiniteNumber(lastUsage?.inputTokens);
  const cachedInputTokens =
    asFiniteNumber(lastUsage?.cached_input_tokens) ?? asFiniteNumber(lastUsage?.cachedInputTokens);
  const outputTokens =
    asFiniteNumber(lastUsage?.output_tokens) ?? asFiniteNumber(lastUsage?.outputTokens);
  const reasoningOutputTokens =
    asFiniteNumber(lastUsage?.reasoning_output_tokens) ??
    asFiniteNumber(lastUsage?.reasoningOutputTokens);

  const totalInput =
    asFiniteNumber(totalUsage?.input_tokens) ?? asFiniteNumber(totalUsage?.inputTokens);
  const totalOutput =
    asFiniteNumber(totalUsage?.output_tokens) ?? asFiniteNumber(totalUsage?.outputTokens);
  const totalCached =
    asFiniteNumber(totalUsage?.cached_input_tokens) ??
    asFiniteNumber(totalUsage?.cachedInputTokens);
  const totalWrites =
    asFiniteNumber(totalUsage?.cacheWriteInputTokens) ??
    asFiniteNumber(totalUsage?.cache_write_input_tokens);
  return {
    usedTokens,
    ...(totalInput !== undefined && totalOutput !== undefined
      ? {
          cumulativeUsage: {
            inputTokens: totalInput,
            outputTokens: totalOutput,
            ...(totalCached !== undefined ? { cachedInputTokens: totalCached } : {}),
            ...(totalWrites !== undefined ? { cacheCreationInputTokens: totalWrites } : {}),
          },
        }
      : {}),
    ...(totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens
      ? { totalProcessedTokens }
      : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    ...(usedTokens !== undefined ? { lastUsedTokens: usedTokens } : {}),
    ...(inputTokens !== undefined ? { lastInputTokens: inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { lastCachedInputTokens: cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined
      ? { lastReasoningOutputTokens: reasoningOutputTokens }
      : {}),
    compactsAutomatically: true,
  };
}

function toTurnId(value: string | undefined): TurnId | undefined {
  return value?.trim() ? TurnId.makeUnsafe(value) : undefined;
}

function toProviderItemId(value: string | undefined): ProviderItemId | undefined {
  return value?.trim() ? ProviderItemId.makeUnsafe(value) : undefined;
}

function toTurnStatus(value: unknown): "completed" | "failed" | "cancelled" | "interrupted" {
  switch (value) {
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return value;
    default:
      return "completed";
  }
}

function normalizeItemType(raw: unknown): string {
  const type = asString(raw);
  if (!type) return "item";
  return type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toCanonicalItemType(raw: unknown): CanonicalItemType {
  const type = normalizeItemType(raw);
  if (isCodexGeneratedImageItemType(raw)) return "image_generation";
  if (type.includes("user")) return "user_message";
  if (type.includes("agent message") || type.includes("assistant")) return "assistant_message";
  if (type.includes("reasoning") || type.includes("thought")) return "reasoning";
  if (type.includes("plan") || type.includes("todo")) return "plan";
  if (type.includes("command")) return "command_execution";
  if (type.includes("file change") || type.includes("patch") || type.includes("edit"))
    return "file_change";
  if (type.includes("mcp")) return "mcp_tool_call";
  if (type.includes("dynamic tool")) return "dynamic_tool_call";
  if (type.includes("collab")) return "collab_agent_tool_call";
  if (type.includes("web search")) return "web_search";
  if (type.includes("image")) return "image_view";
  if (type.includes("review entered") || type.includes("entered review")) return "review_entered";
  if (type.includes("review exited") || type.includes("exited review")) return "review_exited";
  if (type.includes("compact")) return "context_compaction";
  if (type.includes("error")) return "error";
  return "unknown";
}

function toolItemTitle(item: Record<string, unknown> | undefined): string | undefined {
  if (!item) return undefined;
  const appContext = asObjectRecord(item.appContext) ?? undefined;
  const action =
    nonEmptyTrimmed(appContext?.actionName) ??
    nonEmptyTrimmed(item.title) ??
    nonEmptyTrimmed(item.tool) ??
    nonEmptyTrimmed(item.name);
  if (!action) return undefined;

  const appName = nonEmptyTrimmed(appContext?.appName);
  if (!appName || action.toLowerCase().includes(appName.toLowerCase())) {
    return action;
  }
  return `${action} in ${appName}`;
}

function itemTitle(
  itemType: CanonicalItemType,
  item?: Record<string, unknown>,
): string | undefined {
  switch (itemType) {
    case "assistant_message":
      return "Assistant message";
    case "user_message":
      return "User message";
    case "reasoning":
      return "Reasoning";
    case "plan":
      return "Plan";
    case "command_execution":
      return "Ran command";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return toolItemTitle(item) ?? "MCP tool call";
    case "dynamic_tool_call":
      return toolItemTitle(item) ?? "Tool call";
    case "web_search":
      return "Web search";
    case "image_generation":
      return "Generated image";
    case "image_view":
      return "Image view";
    case "error":
      return "Error";
    default:
      return undefined;
  }
}

function joinedTextParts(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const object = asObjectRecord(entry) ?? undefined;
      return asString(object?.text) ?? asString(object?.summary);
    })
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function reasoningSummaryDetail(item: Record<string, unknown>): string | undefined {
  return asString(item.summary)?.trim() || joinedTextParts(item.summary);
}

function itemDetail(
  item: Record<string, unknown>,
  payload: Record<string, unknown>,
): string | undefined {
  const nestedResult = asObjectRecord(item.result) ?? undefined;
  const candidates = [
    asString(item.command),
    asString(item.title),
    asString(item.summary),
    joinedTextParts(item.summary),
    joinedTextParts(item.content),
    asString(item.review),
    asString(item.text),
    asString(item.saved_path),
    asString(item.savedPath),
    asString(item.path),
    asString(item.file_path),
    asString(item.prompt),
    asString(nestedResult?.command),
    asString(payload.command),
    asString(payload.message),
    asString(payload.prompt),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue;
    return trimmed;
  }
  return undefined;
}

function itemStatus(
  lifecycle: "item.started" | "item.updated" | "item.completed",
  rawStatus: unknown,
): "inProgress" | "completed" | "failed" | "declined" | undefined {
  if (lifecycle === "item.started") {
    return "inProgress";
  }
  if (lifecycle === "item.updated") {
    return undefined;
  }
  return rawStatus === "failed" || rawStatus === "declined" ? rawStatus : "completed";
}

function toRequestTypeFromMethod(method: string): CanonicalRequestType {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return "command_execution_approval";
    case "item/fileRead/requestApproval":
      return "file_read_approval";
    case "item/fileChange/requestApproval":
      return "file_change_approval";
    case "item/permissions/requestApproval":
      return "permissions_approval";
    case "mcpServer/elicitation/request":
      return "tool_approval";
    case "applyPatchApproval":
      return "apply_patch_approval";
    case "execCommandApproval":
      return "exec_command_approval";
    case "item/tool/requestUserInput":
      return "tool_user_input";
    case "item/tool/call":
      return "dynamic_tool_call";
    case "account/chatgptAuthTokens/refresh":
      return "auth_tokens_refresh";
    default:
      return "unknown";
  }
}

function toRequestTypeFromKind(kind: unknown): CanonicalRequestType {
  switch (kind) {
    case "command":
      return "command_execution_approval";
    case "file-read":
      return "file_read_approval";
    case "file-change":
      return "file_change_approval";
    case "permissions":
      return "permissions_approval";
    case "tool":
      return "tool_approval";
    default:
      return "unknown";
  }
}

function toRequestTypeFromResolvedPayload(
  payload: Record<string, unknown> | undefined,
): CanonicalRequestType {
  const request = asObjectRecord(payload?.request) ?? undefined;
  const method = asString(request?.method) ?? asString(payload?.method);
  if (method) {
    return toRequestTypeFromMethod(method);
  }
  const requestKind = asString(request?.kind) ?? asString(payload?.requestKind);
  if (requestKind) {
    return toRequestTypeFromKind(requestKind);
  }
  return "unknown";
}

function toCanonicalUserInputAnswers(
  answers: ProviderUserInputAnswers | undefined,
): ProviderUserInputAnswers {
  if (!answers) {
    return {};
  }

  const result: Record<string, string | ReadonlyArray<string> | null> = {};
  for (const [questionId, value] of Object.entries(answers)) {
    if (typeof value === "string") {
      result[questionId] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const normalized = value.filter((entry): entry is string => typeof entry === "string");
      result[questionId] = normalized.length === 1 ? normalized[0]! : normalized;
      continue;
    }

    const nestedAnswers = asArray((asObjectRecord(value) ?? undefined)?.answers);
    if (nestedAnswers) {
      const normalized = nestedAnswers.filter(
        (entry): entry is string => typeof entry === "string",
      );
      result[questionId] = normalized.length === 1 ? normalized[0]! : normalized;
      continue;
    }
  }
  return result;
}

function toThreadState(
  value: unknown,
): "active" | "idle" | "archived" | "closed" | "compacted" | "error" {
  switch (value) {
    case "idle":
      return "idle";
    case "archived":
      return "archived";
    case "closed":
      return "closed";
    case "compacted":
      return "compacted";
    case "error":
    case "failed":
      return "error";
    default:
      return "active";
  }
}

function contentStreamKindFromMethod(
  method: string,
):
  | "assistant_text"
  | "reasoning_text"
  | "reasoning_summary_text"
  | "plan_text"
  | "command_output"
  | "file_change_output" {
  switch (method) {
    case "item/agentMessage/delta":
      return "assistant_text";
    case "item/reasoning/textDelta":
      return "reasoning_text";
    case "item/reasoning/summaryTextDelta":
      return "reasoning_summary_text";
    case "item/commandExecution/outputDelta":
      return "command_output";
    case "item/fileChange/outputDelta":
      return "file_change_output";
    default:
      return "assistant_text";
  }
}

function asRuntimeItemId(itemId: ProviderItemId): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(itemId);
}

function asRuntimeRequestId(requestId: string): RuntimeRequestId {
  return RuntimeRequestId.makeUnsafe(requestId);
}

function asRuntimeTaskId(taskId: string): RuntimeTaskId {
  return RuntimeTaskId.makeUnsafe(taskId);
}

function codexEventMessage(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return asObjectRecord(payload?.msg) ?? undefined;
}

function codexEventBase(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  const payload = asObjectRecord(event.payload) ?? undefined;
  const msg = codexEventMessage(payload);
  const turnId = event.turnId ?? toTurnId(asString(msg?.turn_id) ?? asString(msg?.turnId));
  const itemId = event.itemId ?? toProviderItemId(asString(msg?.item_id) ?? asString(msg?.itemId));
  const requestId = asString(msg?.request_id) ?? asString(msg?.requestId);
  const base = runtimeEventBase(event, canonicalThreadId);
  const providerRefs = base.providerRefs
    ? {
        ...base.providerRefs,
        ...(turnId ? { providerTurnId: turnId } : {}),
        ...(itemId ? { providerItemId: itemId } : {}),
        ...(requestId ? { providerRequestId: requestId } : {}),
      }
    : {
        ...(turnId ? { providerTurnId: turnId } : {}),
        ...(itemId ? { providerItemId: itemId } : {}),
        ...(requestId ? { providerRequestId: requestId } : {}),
      };

  return {
    ...base,
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId: asRuntimeItemId(itemId) } : {}),
    ...(requestId ? { requestId: asRuntimeRequestId(requestId) } : {}),
    ...(Object.keys(providerRefs).length > 0 ? { providerRefs } : {}),
  };
}

function withSanitizedGeneratedImageRaw(
  base: Omit<ProviderRuntimeEvent, "type" | "payload">,
  event: ProviderEvent,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  return {
    ...base,
    raw: {
      source: eventRawSource(event),
      method: event.method,
      payload: sanitizeNestedCodexGeneratedImagePayloads(event.payload ?? {}),
    },
  };
}

function generatedImageEventCandidate(event: ProviderEvent): Record<string, unknown> | undefined {
  const payload = asObjectRecord(event.payload) ?? undefined;
  const msg = codexEventMessage(payload);
  const item = asObjectRecord(payload?.item) ?? undefined;
  const nestedEvent = asObjectRecord(payload?.event) ?? undefined;
  if (item) {
    return item;
  }
  if (msg) {
    return {
      ...msg,
      type: asString(msg.type) ?? "image_generation_end",
    };
  }
  if (nestedEvent) {
    return {
      ...nestedEvent,
      type: asString(nestedEvent.type) ?? "image_generation_end",
    };
  }
  if (payload) {
    return {
      ...payload,
      type: asString(payload.type) ?? "image_generation_end",
    };
  }
  return undefined;
}

function mapGeneratedImageEndEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ProviderRuntimeEvent | undefined {
  if (
    event.method !== "codex/event/image_generation_end" &&
    event.method !== "image_generation_end"
  ) {
    return undefined;
  }
  const payload = asObjectRecord(event.payload) ?? undefined;
  const candidate = generatedImageEventCandidate(event);
  const reference = extractCodexGeneratedImageReference(candidate);
  if (!reference) {
    return undefined;
  }

  const turnId =
    event.turnId ??
    toTurnId(
      firstStringValue(candidate, ["turn_id", "turnId"]) ??
        firstStringValue(payload, ["turn_id", "turnId"]),
    );
  const itemId =
    event.itemId ??
    toProviderItemId(
      firstStringValue(candidate, ["item_id", "itemId", "call_id", "callId", "id"]) ??
        firstStringValue(payload, ["item_id", "itemId", "call_id", "callId", "id"]),
    );
  const base = withSanitizedGeneratedImageRaw(
    {
      ...runtimeEventBase(
        {
          ...event,
          ...(turnId ? { turnId } : {}),
          ...(itemId ? { itemId } : {}),
        },
        canonicalThreadId,
      ),
      ...(turnId ? { turnId } : {}),
      ...(itemId ? { itemId: asRuntimeItemId(itemId) } : {}),
    },
    event,
  );

  return {
    ...base,
    type: "item.completed",
    payload: {
      itemType: "image_generation",
      status: "completed",
      title: "Generated image",
      detail: reference.path,
      data: codexGeneratedImageArtifact(reference),
    },
  };
}

function eventRawSource(event: ProviderEvent): NonNullable<ProviderRuntimeEvent["raw"]>["source"] {
  return event.kind === "request" ? "codex.app-server.request" : "codex.app-server.notification";
}

function providerRefsFromEvent(
  event: ProviderEvent,
): ProviderRuntimeEvent["providerRefs"] | undefined {
  const refs: Record<string, string> = {};
  if (event.providerThreadId) refs.providerThreadId = event.providerThreadId;
  if (event.providerParentThreadId) refs.providerParentThreadId = event.providerParentThreadId;
  if (event.turnId) refs.providerTurnId = event.turnId;
  if (event.parentTurnId) refs.parentProviderTurnId = event.parentTurnId;
  if (event.itemId) refs.providerItemId = event.itemId;
  if (event.requestId) refs.providerRequestId = event.requestId;

  return Object.keys(refs).length > 0 ? (refs as ProviderRuntimeEvent["providerRefs"]) : undefined;
}

function runtimeEventBase(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  const refs = providerRefsFromEvent(event);
  return {
    eventId: event.id,
    provider: event.provider,
    threadId: canonicalThreadId,
    createdAt: event.createdAt,
    ...(event.lifecycleGeneration !== undefined
      ? { lifecycleGeneration: event.lifecycleGeneration }
      : {}),
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.parentTurnId ? { parentTurnId: event.parentTurnId } : {}),
    ...(event.itemId ? { itemId: asRuntimeItemId(event.itemId) } : {}),
    ...(event.requestId ? { requestId: asRuntimeRequestId(event.requestId) } : {}),
    ...(refs ? { providerRefs: refs } : {}),
    raw: {
      source: eventRawSource(event),
      method: event.method,
      payload: event.payload ?? {},
    },
  };
}

function runtimeDeltaEventBase(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  return withMinimalRawPayload(runtimeEventBase(event, canonicalThreadId), event);
}

function codexDeltaEventBase(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  return withMinimalRawPayload(codexEventBase(event, canonicalThreadId), event);
}

function withMinimalRawPayload(
  base: Omit<ProviderRuntimeEvent, "type" | "payload">,
  event: ProviderEvent,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  return {
    ...base,
    raw: {
      source: base.raw?.source ?? eventRawSource(event),
      ...(base.raw?.method !== undefined ? { method: base.raw.method } : {}),
      ...(base.raw?.messageType !== undefined ? { messageType: base.raw.messageType } : {}),
      payload: {},
    },
  };
}

function mapItemLifecycle(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  lifecycle: "item.started" | "item.updated" | "item.completed",
): ProviderRuntimeEvent | undefined {
  const payload = asObjectRecord(event.payload) ?? undefined;
  const item = asObjectRecord(payload?.item) ?? undefined;
  const source = item ?? payload;
  if (!source) {
    return undefined;
  }

  const itemType = toCanonicalItemType(source.type ?? source.kind);
  if (itemType === "unknown" && lifecycle !== "item.updated") {
    return undefined;
  }
  const generatedImageReference =
    itemType === "image_generation" ? extractCodexGeneratedImageReference(source) : undefined;
  if (
    lifecycle === "item.completed" &&
    itemType === "image_generation" &&
    !generatedImageReference
  ) {
    return undefined;
  }

  const canonicalItemType =
    lifecycle === "item.completed" && itemType === "review_exited" ? "assistant_message" : itemType;

  // Only the provider-authored summary is user-visible reasoning. Raw content may contain model trace
  // data and must not leak into transcript activities.
  const detail =
    itemType === "reasoning" ? reasoningSummaryDetail(source) : itemDetail(source, payload ?? {});
  const status = itemStatus(lifecycle, source.status);
  const title = itemTitle(canonicalItemType, source);
  const asyncQuestions =
    itemType === "assistant_message" && Array.isArray(source.questions)
      ? Schema.decodeUnknownOption(AsyncUserInputQuestions)(
          source.questions.map((value: unknown) => {
            const question = asObjectRecord(value) ?? undefined;
            return question
              ? question.options == null
                ? { title: question.title }
                : { title: question.title, options: question.options }
              : value;
          }),
        )
      : Option.none();

  return {
    ...(generatedImageReference
      ? withSanitizedGeneratedImageRaw(runtimeEventBase(event, canonicalThreadId), event)
      : runtimeEventBase(event, canonicalThreadId)),
    type: lifecycle,
    payload: {
      itemType: canonicalItemType,
      ...(Option.isSome(asyncQuestions) ? { asyncQuestions: asyncQuestions.value } : {}),
      ...(status ? { status } : {}),
      ...(title ? { title } : {}),
      ...(generatedImageReference
        ? { detail: generatedImageReference.path }
        : detail
          ? { detail }
          : {}),
      ...(generatedImageReference
        ? { data: codexGeneratedImageArtifact(generatedImageReference) }
        : event.payload !== undefined
          ? { data: event.payload }
          : {}),
    },
  };
}

type CodexHookRunStatus = "completed" | "failed" | "blocked" | "stopped";

function toCodexHookRunStatus(value: unknown): CodexHookRunStatus | undefined {
  return value === "completed" || value === "failed" || value === "blocked" || value === "stopped"
    ? value
    : undefined;
}

function toHookOutcome(status: CodexHookRunStatus | undefined): "success" | "error" | "cancelled" {
  if (status === "completed") return "success";
  if (status === "blocked" || status === "stopped") return "cancelled";
  return "error";
}

function hookRunOutput(run: Record<string, unknown>): string | undefined {
  if (!Array.isArray(run.entries)) {
    return undefined;
  }
  const output = run.entries
    .flatMap((entry) => {
      const record = asObjectRecord(entry) ?? undefined;
      const text = nonEmptyTrimmed(record?.text);
      if (!text) return [];
      const kind = nonEmptyTrimmed(record?.kind);
      return [kind ? `${kind}: ${text}` : text];
    })
    .join("\n");
  return output ? sanitizeUnmappedProviderDetail(output) : undefined;
}

function withSanitizedHookRaw(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  return {
    ...runtimeEventBase(event, canonicalThreadId),
    raw: {
      source: eventRawSource(event),
      method: event.method,
      payload: { gladeSanitized: true },
    },
  };
}

function mapCodexHookEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ProviderRuntimeEvent | undefined {
  if (event.method !== "hook/started" && event.method !== "hook/completed") {
    return undefined;
  }
  const run = asObjectRecord((asObjectRecord(event.payload) ?? undefined)?.run) ?? undefined;
  const hookId = nonEmptyTrimmed(run?.id);
  const hookEvent = nonEmptyTrimmed(run?.eventName);
  if (!run || !hookId || !hookEvent) {
    return undefined;
  }
  const hookName = nonEmptyTrimmed(run.sourcePath) ?? nonEmptyTrimmed(run.handlerType) ?? hookEvent;
  const statusMessage = sanitizeUnmappedProviderDetail(nonEmptyTrimmed(run.statusMessage));
  const data = sanitizeUnmappedProviderData(run);
  const base = withSanitizedHookRaw(event, canonicalThreadId);

  if (event.method === "hook/started") {
    return {
      ...base,
      type: "hook.started",
      payload: {
        hookId,
        hookName,
        hookEvent,
        ...(statusMessage ? { statusMessage } : {}),
        data,
      },
    };
  }

  const status = toCodexHookRunStatus(run.status);
  const durationCandidate = asFiniteNumber(run.durationMs);
  const durationMs =
    durationCandidate !== undefined && Number.isInteger(durationCandidate) && durationCandidate >= 0
      ? durationCandidate
      : undefined;
  const output = hookRunOutput(run);
  return {
    ...base,
    type: "hook.completed",
    payload: {
      hookId,
      hookName,
      hookEvent,
      outcome: toHookOutcome(status),
      ...(status ? { status } : {}),
      ...(statusMessage ? { statusMessage } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(output ? { output } : {}),
      data,
    },
  };
}

const DIAGNOSTIC_ONLY_CODEX_METHODS = new Set([
  "remoteControl/status/changed",
  "skills/changed",
  "session/threadOpenRequested",
  "session/threadOpenResolved",
  "thread/reverted",
]);

function mapUnmappedCodexEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ProviderRuntimeEvent {
  const payload = asObjectRecord(event.payload) ?? undefined;
  const msg = codexEventMessage(payload);
  const nativeType = sanitizeUnmappedProviderNativeType(event.method);
  const detail = sanitizeUnmappedProviderDetail(
    nonEmptyTrimmed(payload?.message) ??
      nonEmptyTrimmed(msg?.summary) ??
      nonEmptyTrimmed(payload?.reason) ??
      nonEmptyTrimmed(payload?.summary) ??
      nonEmptyTrimmed(msg?.status) ??
      nonEmptyTrimmed(payload?.detail) ??
      nonEmptyTrimmed(payload?.status),
  );
  return {
    ...runtimeEventBase(event, canonicalThreadId),
    raw: {
      source: eventRawSource(event),
      method: nativeType,
      payload: { gladeSanitized: true },
    },
    type: "event.unmapped",
    payload: {
      nativeType,
      ...(detail ? { detail } : {}),
      ...(event.payload !== undefined ? { data: sanitizeUnmappedProviderData(event.payload) } : {}),
    },
  };
}

function mapToRuntimeEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ReadonlyArray<ProviderRuntimeEvent> {
  const payload = asObjectRecord(event.payload) ?? undefined;
  const turn = asObjectRecord(payload?.turn) ?? undefined;
  const generatedImageEndEvent = mapGeneratedImageEndEvent(event, canonicalThreadId);
  if (generatedImageEndEvent) {
    return [generatedImageEndEvent];
  }
  const hookEvent = mapCodexHookEvent(event, canonicalThreadId);
  if (hookEvent) {
    return [hookEvent];
  }

  if (event.kind === "error") {
    if (!event.message) {
      return [];
    }
    const treatAsWarning = providerErrorMapsToWarning(event);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: treatAsWarning ? "runtime.warning" : "runtime.error",
        payload: {
          message: event.message,
          ...(!treatAsWarning ? { class: "provider_error" as const } : {}),
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.kind === "request") {
    if (event.method === "item/tool/requestUserInput") {
      const questions = parseCodexUserInputQuestions(payload);
      if (!questions) {
        return [];
      }
      return [
        {
          ...runtimeEventBase(event, canonicalThreadId),
          type: "user-input.requested",
          payload: {
            questions,
          },
        },
      ];
    }

    const detail =
      asString(payload?.command) ??
      asString(payload?.reason) ??
      asString(payload?.prompt) ??
      asString(payload?.message);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.opened",
        payload: {
          requestType: toRequestTypeFromMethod(event.method),
          ...(detail ? { detail } : {}),
          ...(event.payload !== undefined ? { args: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "item/requestApproval/decision" && event.requestId) {
    const decision = Schema.decodeUnknownSync(ProviderApprovalDecision)(payload?.decision);
    const requestType =
      event.requestKind !== undefined
        ? toRequestTypeFromKind(event.requestKind)
        : toRequestTypeFromMethod(event.method);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.resolved",
        payload: {
          requestType,
          ...(decision ? { decision } : {}),
          ...(event.payload !== undefined ? { resolution: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/settings/updated") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "thread.metadata.updated",
        payload: { modelSelection: codexUpdatedModelSelection(event.payload) },
      },
    ];
  }

  if (event.method === "item/fileChange/patchUpdated") {
    const patch = decodeCodexFilePatch(event.payload);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        itemId: RuntimeItemId.makeUnsafe(patch.itemId),
        type: "item.updated",
        payload: {
          itemType: "file_change",
          status: "inProgress",
          title: "File change",
          data: { item: { type: "fileChange", id: patch.itemId, changes: patch.changes } },
        },
      },
    ];
  }

  if (event.method === "item/autoApprovalReview/started") {
    const review = decodeCodexApprovalReview(event.payload);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        itemId: RuntimeItemId.makeUnsafe(review.reviewId),
        type: "item.started",
        payload: {
          itemType: "dynamic_tool_call",
          status: "inProgress",
          title: "Automatic approval review",
        },
      },
    ];
  }

  if (event.method === "item/autoApprovalReview/completed") {
    const nativeReview = decodeCodexGuardianReview(event.payload);
    const review = nativeReview.review;
    const status = review.status;
    const completedReview: ProviderRuntimeEvent = {
      ...runtimeEventBase(event, canonicalThreadId),
      itemId: RuntimeItemId.makeUnsafe(decodeCodexApprovalReview(event.payload).reviewId),
      type: "item.completed",
      payload: {
        itemType: "dynamic_tool_call",
        status: status === "denied" ? "declined" : status === "aborted" ? "failed" : "completed",
        title: "Automatic approval review",
      },
    };
    if (status !== "denied" && status !== "aborted") return [completedReview];
    const rationale = review.rationale ?? `Automatic approval review ${status} this action.`;
    return [
      completedReview,
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "runtime.warning",
        payload: {
          message: rationale,
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "session/connecting") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.state.changed",
        payload: {
          state: "starting",
          ...(event.message ? { reason: event.message } : {}),
        },
      },
    ];
  }

  if (event.method === "session/ready") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.state.changed",
        payload: {
          state: "ready",
          ...(event.message ? { reason: event.message } : {}),
        },
      },
    ];
  }

  if (event.method === "session/started") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.started",
        payload: {
          ...(event.message ? { message: event.message } : {}),
          ...(event.payload !== undefined ? { resume: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "session/exited" || event.method === "session/closed") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.exited",
        payload: {
          ...(event.message ? { reason: event.message } : {}),
          ...(event.method === "session/closed" ? { exitKind: "graceful" } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/started") {
    const payloadThreadId = asString((asObjectRecord(payload?.thread) ?? undefined)?.id);
    const providerThreadId = payloadThreadId ?? asString(payload?.threadId);
    if (!providerThreadId) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "thread.started",
        payload: {
          providerThreadId,
        },
      },
    ];
  }

  if (event.method === "thread/compacting") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "item.updated",
        payload: {
          itemType: "context_compaction",
          status: "inProgress",
          title: "Context compaction",
          detail: event.message ?? "Compacting context",
          ...(event.payload !== undefined ? { data: event.payload } : {}),
        },
      },
    ];
  }

  if (
    event.method === "thread/status/changed" ||
    event.method === "thread/archived" ||
    event.method === "thread/unarchived" ||
    event.method === "thread/closed" ||
    event.method === "thread/compacted"
  ) {
    return [
      {
        type: "thread.state.changed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          state:
            event.method === "thread/archived"
              ? "archived"
              : event.method === "thread/closed"
                ? "closed"
                : event.method === "thread/compacted"
                  ? "compacted"
                  : toThreadState(
                      (asObjectRecord(payload?.thread) ?? undefined)?.state ?? payload?.state,
                    ),
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/name/updated") {
    return [
      {
        type: "thread.metadata.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          ...(asString(payload?.threadName) ? { name: asString(payload?.threadName) } : {}),
          ...(event.payload !== undefined
            ? { metadata: asObjectRecord(event.payload) ?? undefined }
            : {}),
        },
      },
    ];
  }

  if (event.method === "thread/tokenUsage/updated") {
    const tokenUsage = asObjectRecord(payload?.tokenUsage) ?? undefined;
    const normalizedUsage = normalizeCodexTokenUsage(tokenUsage ?? event.payload);
    if (!normalizedUsage) {
      return [];
    }
    return [
      {
        type: "thread.token-usage.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          usage: normalizedUsage,
        },
      },
    ];
  }

  if (event.method === "turn/started") {
    const turnId = event.turnId;
    if (!turnId) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        turnId,
        type: "turn.started",
        payload: {
          ...(asString(turn?.model) ? { model: asString(turn?.model) } : {}),
          ...(asString(turn?.effort) ? { effort: asString(turn?.effort) } : {}),
        },
      },
    ];
  }

  if (event.method === "turn/completed") {
    const errorMessage = asString((asObjectRecord(turn?.error) ?? undefined)?.message);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.completed",
        payload: {
          state: toTurnStatus(turn?.status),
          ...(asString(turn?.stopReason) ? { stopReason: asString(turn?.stopReason) } : {}),
          ...(turn?.usage !== undefined ? { usage: turn.usage } : {}),
          ...((asObjectRecord(turn?.modelUsage) ?? undefined)
            ? { modelUsage: asObjectRecord(turn?.modelUsage) ?? undefined }
            : {}),
          ...(asFiniteNumber(turn?.totalCostUsd) !== undefined
            ? { totalCostUsd: asFiniteNumber(turn?.totalCostUsd) }
            : {}),
          ...(errorMessage ? { errorMessage } : {}),
        },
      },
    ];
  }

  if (event.method === "turn/aborted") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.aborted",
        payload: {
          reason: event.message ?? "Turn aborted",
        },
      },
    ];
  }

  if (event.method === "turn/plan/updated") {
    const steps = Array.isArray(payload?.plan) ? payload.plan : [];
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.tasks.updated",
        payload: {
          ...(asString(payload?.explanation)
            ? { explanation: asString(payload?.explanation) }
            : {}),
          tasks: steps.flatMap((entry) => {
            const taskEntry = asObjectRecord(entry) ?? undefined;
            if (!taskEntry) {
              return [];
            }
            const item = makeRuntimeTaskListItem(
              asString(taskEntry.step) ?? "task",
              taskEntry.status,
            );
            return item ? [item] : [];
          }),
        },
      },
    ];
  }

  if (event.method === "turn/diff/updated") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.diff.updated",
        payload: {
          unifiedDiff:
            asString(payload?.unifiedDiff) ??
            asString(payload?.diff) ??
            asString(payload?.patch) ??
            "",
        },
      },
    ];
  }

  if (event.method === "item/started") {
    const started = mapItemLifecycle(event, canonicalThreadId, "item.started");
    return started ? [started] : [];
  }

  if (event.method === "item/completed") {
    const payload = asObjectRecord(event.payload) ?? undefined;
    const item = asObjectRecord(payload?.item) ?? undefined;
    const source = item ?? payload;
    if (!source) {
      return [];
    }
    const itemType = source ? toCanonicalItemType(source.type ?? source.kind) : "unknown";
    if (itemType === "plan") return [];
    const completed = mapItemLifecycle(event, canonicalThreadId, "item.completed");
    return completed ? [completed] : [];
  }

  if (
    event.method === "item/reasoning/summaryPartAdded" ||
    event.method === "item/commandExecution/terminalInteraction"
  ) {
    const updated = mapItemLifecycle(event, canonicalThreadId, "item.updated");
    return updated ? [updated] : [];
  }

  if (event.method === "item/plan/delta") return [];

  if (
    event.method === "item/agentMessage/delta" ||
    event.method === "item/commandExecution/outputDelta" ||
    event.method === "item/fileChange/outputDelta" ||
    event.method === "item/reasoning/summaryTextDelta" ||
    event.method === "item/reasoning/textDelta"
  ) {
    const delta =
      event.textDelta ??
      asString(payload?.delta) ??
      asString(payload?.text) ??
      asString((asObjectRecord(payload?.content) ?? undefined)?.text);
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeDeltaEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: contentStreamKindFromMethod(event.method),
          delta,
          ...(typeof payload?.contentIndex === "number"
            ? { contentIndex: payload.contentIndex }
            : {}),
          ...(typeof payload?.summaryIndex === "number"
            ? { summaryIndex: payload.summaryIndex }
            : {}),
        },
      },
    ];
  }

  if (event.method === "item/mcpToolCall/progress") {
    const toolUseId = asString(payload?.toolUseId) ?? asString(payload?.itemId);
    const summary = asString(payload?.summary) ?? asString(payload?.message);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "tool.progress",
        payload: {
          ...(toolUseId ? { toolUseId } : {}),
          ...(asString(payload?.toolName) ? { toolName: asString(payload?.toolName) } : {}),
          ...(summary ? { summary } : {}),
          ...(asFiniteNumber(payload?.elapsedSeconds) !== undefined
            ? { elapsedSeconds: asFiniteNumber(payload?.elapsedSeconds) }
            : {}),
        },
      },
    ];
  }

  if (event.method === "serverRequest/resolved") {
    const requestType =
      toRequestTypeFromResolvedPayload(payload) !== "unknown"
        ? toRequestTypeFromResolvedPayload(payload)
        : event.requestId && event.requestKind !== undefined
          ? toRequestTypeFromKind(event.requestKind)
          : "unknown";
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.resolved",
        payload: {
          requestType,
          ...(event.payload !== undefined ? { resolution: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "item/tool/requestUserInput/answered") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "user-input.resolved",
        payload: {
          answers: toCanonicalUserInputAnswers(
            (asObjectRecord(event.payload) ?? undefined)?.answers as
              | ProviderUserInputAnswers
              | undefined,
          ),
        },
      },
    ];
  }

  if (event.method === "codex/event/task_started") {
    const msg = codexEventMessage(payload);
    const taskId = asString(payload?.id) ?? asString(msg?.turn_id);
    if (!taskId) {
      return [];
    }
    return [
      {
        ...codexEventBase(event, canonicalThreadId),
        type: "task.started",
        payload: {
          taskId: asRuntimeTaskId(taskId),
          ...(asString(msg?.collaboration_mode_kind)
            ? { taskType: asString(msg?.collaboration_mode_kind) }
            : {}),
        },
      },
    ];
  }

  if (event.method === "codex/event/task_complete") {
    const msg = codexEventMessage(payload);
    const taskId = asString(payload?.id) ?? asString(msg?.turn_id);

    if (!taskId) return [];
    const events: ProviderRuntimeEvent[] = [
      {
        ...codexEventBase(event, canonicalThreadId),
        type: "task.completed",
        payload: {
          taskId: asRuntimeTaskId(taskId),
          status: "completed",
          ...(asString(msg?.last_agent_message)
            ? { summary: asString(msg?.last_agent_message) }
            : {}),
        },
      },
    ];

    return events;
  }

  if (event.method === "codex/event/agent_reasoning") {
    const msg = codexEventMessage(payload);
    const taskId = asString(payload?.id);
    const description = asString(msg?.text);
    if (!taskId || !description) {
      return [];
    }
    return [
      {
        ...codexEventBase(event, canonicalThreadId),
        type: "task.progress",
        payload: {
          taskId: asRuntimeTaskId(taskId),
          description,
        },
      },
    ];
  }

  if (event.method === "codex/event/reasoning_content_delta") {
    const msg = codexEventMessage(payload);
    const delta = asString(msg?.delta);
    if (!delta) {
      return [];
    }
    return [
      {
        ...codexDeltaEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind:
            asFiniteNumber(msg?.summary_index) !== undefined
              ? "reasoning_summary_text"
              : "reasoning_text",
          delta,
          ...(asFiniteNumber(msg?.summary_index) !== undefined
            ? { summaryIndex: asFiniteNumber(msg?.summary_index) }
            : {}),
        },
      },
    ];
  }

  if (event.method === "model/rerouted") {
    return [
      {
        type: "model.rerouted",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          fromModel: asString(payload?.fromModel) ?? "unknown",
          toModel: asString(payload?.toModel) ?? "unknown",
          reason: asString(payload?.reason) ?? "unknown",
        },
      },
    ];
  }

  if (event.method === "deprecationNotice") {
    const details = nonEmptyTrimmed(payload?.details);
    return [
      {
        type: "deprecation.notice",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          summary: nonEmptyTrimmed(payload?.summary) ?? "Deprecation notice",
          ...(details ? { details } : {}),
        },
      },
    ];
  }

  if (event.method === "configWarning") {
    const details = nonEmptyTrimmed(payload?.details);
    const path = nonEmptyTrimmed(payload?.path);
    return [
      {
        type: "config.warning",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          summary: nonEmptyTrimmed(payload?.summary) ?? "Configuration warning",
          ...(details ? { details } : {}),
          ...(path ? { path } : {}),
          ...(payload?.range !== undefined ? { range: payload.range } : {}),
        },
      },
    ];
  }

  if (event.method === "account/updated") {
    return [
      {
        type: "account.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          account: event.payload ?? {},
        },
      },
    ];
  }

  if (event.method === "account/rateLimits/updated") {
    return [
      {
        type: "account.rate-limits.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          rateLimits: event.payload ?? {},
        },
      },
    ];
  }

  if (event.method === "mcpServer/oauthLogin/completed") {
    return [
      {
        type: "mcp.oauth.completed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          success: payload?.success === true,
          ...(asString(payload?.name) ? { name: asString(payload?.name) } : {}),
          ...(asString(payload?.error) ? { error: asString(payload?.error) } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/realtime/started") {
    const realtimeSessionId = asString(payload?.realtimeSessionId);
    return [
      {
        type: "thread.realtime.started",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          realtimeSessionId,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/itemAdded") {
    return [
      {
        type: "thread.realtime.item-added",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          item: event.payload ?? {},
        },
      },
    ];
  }

  if (event.method === "thread/realtime/outputAudio/delta") {
    return [
      {
        type: "thread.realtime.audio.delta",
        ...runtimeDeltaEventBase(event, canonicalThreadId),
        payload: {
          audio: event.payload ?? {},
        },
      },
    ];
  }

  if (event.method === "thread/realtime/error") {
    const message = asString(payload?.message) ?? event.message ?? "Realtime error";
    return [
      {
        type: "thread.realtime.error",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/closed") {
    return [
      {
        type: "thread.realtime.closed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          reason: event.message,
        },
      },
    ];
  }

  if (event.method === "error") {
    const nativeError = decodeCodexErrorParams(event.payload);
    const message = event.message ?? nativeError.error.message;
    const failure = normalizeCodexFailure(nativeError, message);
    const treatAsWarning = nativeError.willRetry;
    return [
      {
        type: treatAsWarning ? "runtime.warning" : "runtime.error",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message,
          failure,
          ...(!treatAsWarning ? { class: "provider_error" as const } : {}),
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "windows/worldWritableWarning") {
    return [
      {
        type: "runtime.warning",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message: event.message ?? "Windows world-writable warning",
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "windowsSandbox/setupCompleted") {
    const payloadRecord = asObjectRecord(event.payload) ?? undefined;
    const success = payloadRecord?.success;
    const successMessage = event.message ?? "Windows sandbox setup completed";
    const failureMessage = event.message ?? "Windows sandbox setup failed";

    return [
      {
        type: "session.state.changed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          state: success === false ? "error" : "ready",
          reason: success === false ? failureMessage : successMessage,
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
      ...(success === false
        ? [
            {
              type: "runtime.warning" as const,
              ...runtimeEventBase(event, canonicalThreadId),
              payload: {
                message: failureMessage,
                ...(event.payload !== undefined ? { detail: event.payload } : {}),
              },
            },
          ]
        : []),
    ];
  }

  return [mapUnmappedCodexEvent(event, canonicalThreadId)];
}

const makeCodexAdapter = (options?: CodexAdapterLiveOptions) =>
  Effect.gen(function* () {
    const serverConfig = yield* Effect.service(ServerConfig);

    const agentGatewayCredentials = Option.getOrUndefined(
      yield* Effect.serviceOption(AgentGatewayCredentials),
    );
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
            stream: "native",
          })
        : undefined);

    const manager = yield* Effect.acquireRelease(
      Effect.gen(function* () {
        if (options?.manager) {
          return options.manager;
        }
        const services = yield* Effect.services<never>();
        return (
          options?.makeManager?.(services) ??
          new CodexAppServerManager(services, {
            gladeSkillsDir: gladeSkillsDir(serverConfig.baseDir),
            ...(agentGatewayCredentials
              ? {
                  agentGatewayMcp: {
                    endpointUrl: () => agentGatewayCredentials.mcpEndpointUrl,

                    acquireSessionLease: (threadId, capabilityInput) =>
                      acquireAgentGatewaySessionLease(
                        agentGatewayCredentials,
                        threadId,
                        PROVIDER,
                        capabilityInput ?? AGENT_GATEWAY_NO_CAPABILITIES,
                      )!,
                  },
                }
              : {}),
          })
        );
      }),
      (manager) => Effect.promise(() => manager.stopAll()),
    );

    const runtimeEventQueue = yield* Queue.bounded<ProviderRuntimeEvent>(
      PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
    );
    const shouldSurfaceUnmappedEvent = makeUnmappedProviderEventGate();

    // Same semantics as turn idle watchdog (any inbound activity resets it, a pending human decision
    // pauses it), driven by one shared ticker because codex activity arrives on a single manager event
    // stream instead of per-session fibers.
    const turnWatchdogs = new Map<ThreadId, CodexTurnWatchdogEntry>();

    const armTurnWatchdog = (threadId: ThreadId, turnId: TurnId): void => {
      turnWatchdogs.set(threadId, { turnId, lastActivityAt: Date.now() });
    };

    const trackTurnWatchdogActivity = (
      threadId: ThreadId,
      runtimeEvents: ReadonlyArray<ProviderRuntimeEvent>,
    ): void => {
      const entry = turnWatchdogs.get(threadId);
      if (entry) {
        entry.lastActivityAt = Date.now();
      }
      for (const runtimeEvent of runtimeEvents) {
        if (runtimeEvent.type === "turn.started" && runtimeEvent.turnId) {
          armTurnWatchdog(threadId, runtimeEvent.turnId);
        }
      }
    };

    const abandonStalledTurn = (threadId: ThreadId, turnId: TurnId, idleMs: number): void => {
      const idleSeconds = Math.round(idleMs / 1000);
      void manager
        .abandonTurn(
          threadId,
          turnId,
          `Codex stopped responding (no activity for ${idleSeconds}s); the turn was aborted.`,
        )
        .catch((cause: unknown) => {
          void Effect.runPromise(
            Effect.logError("Codex idle turn abandon failed", {
              threadId,
              turnId,
              idleMs,
              cause,
            }),
          );
        });
    };

    const evaluateTurnWatchdogs = (): void => {
      const now = Date.now();
      for (const [threadId, entry] of turnWatchdogs) {
        const idleMs = now - entry.lastActivityAt;
        const decision = evaluateTurnIdleTick({
          isTurnActive: manager.isTurnActive(threadId, entry.turnId),
          isAwaitingHuman: manager.isAwaitingHumanResponse(threadId),
          idleMs,
          idleTimeoutMs: CODEX_TURN_IDLE_TIMEOUT_MS,
        });
        if (decision === "continue") {
          continue;
        }
        if (decision === "touch") {
          entry.lastActivityAt = now;
          continue;
        }
        // Both "stop" (the turn already settled) and "timeout" disarm; a timeout disarms first so a slow
        // interrupt cannot let the next tick re-fire.
        turnWatchdogs.delete(threadId);
        if (decision === "timeout") {
          abandonStalledTurn(threadId, entry.turnId, idleMs);
        }
      }
    };

    const prepareCodexManagerTurnInput = (
      input: ProviderSendTurnInput,
      method: "turn/start" | "turn/steer",
    ): Effect.Effect<CodexAppServerSendTurnInput, ProviderAdapterRequestError> =>
      Effect.gen(function* () {
        const nativeCodexAttachments = yield* Effect.forEach(
          filterProviderPromptImageAttachments(input.attachments),
          (attachment) => {
            const attachmentPath = resolveProviderAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!attachmentPath) {
              const cause = new Error(`Invalid attachment id '${attachment.id}'.`);
              return Effect.fail(
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method,
                  detail: cause.message,
                  cause,
                }),
              );
            }
            return Effect.succeed({ type: "localImage" as const, path: attachmentPath });
          },
          { concurrency: 1 },
        );
        const composedInput = composeCodexInputWithFileAttachments({
          input: input.input,
          attachments: input.attachments,
          attachmentsDir: serverConfig.attachmentsDir,
        });

        return {
          threadId: input.threadId,
          ...(composedInput !== undefined ? { input: composedInput } : {}),
          ...(input.skills !== undefined ? { skills: input.skills } : {}),
          ...(input.mentions !== undefined ? { mentions: input.mentions } : {}),
          ...codexModelSelectionOverrides(input.modelSelection),

          ...(nativeCodexAttachments.length > 0 ? { attachments: nativeCodexAttachments } : {}),
        } satisfies CodexAppServerSendTurnInput;
      });

    const startSession: CodexAdapterShape["startSession"] = (input) => {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          }),
        );
      }

      const managerInput: CodexAppServerStartSessionInput = {
        threadId: input.threadId,
        provider: "codex",
        ...(input.lifecycleGeneration !== undefined
          ? { lifecycleGeneration: input.lifecycleGeneration }
          : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        ...(input.forkSourceResumeCursor !== undefined
          ? { forkSourceResumeCursor: input.forkSourceResumeCursor }
          : {}),
        ...(input.providerOptions !== undefined ? { providerOptions: input.providerOptions } : {}),
        agentGatewayCapabilityInput: captureAgentGatewayCapabilityInput(input),
        runtimeMode: input.runtimeMode,
        ...codexModelSelectionOverrides(input.modelSelection),
      };

      return Effect.tryPromise({
        try: (signal) => manager.startSession(managerInput, signal),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: toMessage(cause, "Failed to start Codex adapter session."),
            ...(cause instanceof CodexSessionStartError
              ? { reason: "startup-failed" as const }
              : {}),
            cause,
          }),
      }).pipe(Effect.map((session) => session));
    };

    const sendTurn: CodexAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const managerInput = yield* prepareCodexManagerTurnInput(input, "turn/start");

        return yield* Effect.tryPromise({
          try: () => manager.sendTurn(managerInput),
          catch: (cause) => toRequestError(input.threadId, "turn/start", cause),
        }).pipe(
          Effect.tap((result) => Effect.sync(() => armTurnWatchdog(input.threadId, result.turnId))),
          Effect.map((result) => ({
            ...result,
            threadId: input.threadId,
          })),
        );
      });

    const steerTurn: CodexAdapterShape["steerTurn"] = (input) =>
      Effect.gen(function* () {
        const managerInput = yield* prepareCodexManagerTurnInput(input, "turn/steer");

        return yield* Effect.tryPromise({
          try: () => manager.steerTurn(managerInput),
          catch: (cause) => toRequestError(input.threadId, "turn/steer", cause),
        }).pipe(
          Effect.tap((result) => Effect.sync(() => armTurnWatchdog(input.threadId, result.turnId))),

          Effect.tap((result) => {
            const message = input.input?.trim();
            if (!message) {
              return Effect.void;
            }
            return Queue.offer(runtimeEventQueue, {
              type: "turn.steered",
              eventId: EventId.makeUnsafe(crypto.randomUUID()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId: result.turnId,
              createdAt: new Date().toISOString(),
              payload: { message, target: "turn" },
            });
          }),
          Effect.map((result) => ({
            ...result,
            threadId: input.threadId,
          })),
        );
      });

    const startReview: CodexAdapterShape["startReview"] = (input) =>
      Effect.tryPromise({
        try: () => manager.startReview(input),
        catch: (cause) => toRequestError(input.threadId, "review/start", cause),
      }).pipe(
        Effect.tap((result) => Effect.sync(() => armTurnWatchdog(input.threadId, result.turnId))),
        Effect.map((result) => ({
          ...result,
          threadId: input.threadId,
        })),
      );

    const interruptTurn: CodexAdapterShape["interruptTurn"] = (
      threadId,
      turnId,
      providerThreadId,
    ) =>
      Effect.tryPromise({
        try: () => manager.interruptTurn(threadId, turnId, providerThreadId),
        catch: (cause) => toRequestError(threadId, "turn/interrupt", cause),
      });

    const readThread: CodexAdapterShape["readThread"] = (threadId) =>
      Effect.tryPromise({
        try: () => manager.readThread(threadId),
        catch: (cause) => toRequestError(threadId, "thread/read", cause),
      }).pipe(
        Effect.map((snapshot) => ({
          threadId,
          turns: snapshot.turns,
          cwd: snapshot.cwd ?? null,
        })),
      );

    const readExternalThreadPage: NonNullable<CodexAdapterShape["readExternalThreadPage"]> = (
      input,
    ) =>
      Effect.tryPromise({
        try: () => manager.readExternalThreadPage(input),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "thread/turns/list",
            detail: toMessage(cause, "Failed to page external Codex history."),
            cause,
          }),
      });

    const readExternalThread: NonNullable<CodexAdapterShape["readExternalThread"]> = (input) =>
      Effect.tryPromise({
        try: () => manager.readExternalThread(input),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "thread/read",
            detail: toMessage(cause, "Failed to read external Codex thread."),
            cause,
          }),
      }).pipe(
        Effect.map((snapshot) => ({
          threadId: ThreadId.makeUnsafe(snapshot.threadId),
          turns: snapshot.turns,
          cwd: snapshot.cwd ?? null,
        })),
      );

    const rollbackThread: CodexAdapterShape["rollbackThread"] = (threadId, numTurns) => {
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          }),
        );
      }

      return Effect.tryPromise({
        try: () => manager.rollbackThread(threadId, numTurns),
        catch: (cause) => toRequestError(threadId, "thread/rollback", cause),
      }).pipe(
        Effect.map((snapshot) => ({
          threadId,
          turns: snapshot.turns,
        })),
      );
    };

    const compactThread: NonNullable<CodexAdapterShape["compactThread"]> = (threadId) =>
      Effect.tryPromise({
        try: () => manager.compactThread(threadId),
        catch: (cause) => toRequestError(threadId, "thread/compact/start", cause),
      });

    const forkThread: CodexAdapterShape["forkThread"] = (input) =>
      Effect.tryPromise({
        try: (signal) => manager.forkThread(input, signal),
        catch: (cause) => toRequestError(input.sourceThreadId, "thread/fork", cause),
      });

    const respondToRequest: CodexAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.tryPromise({
        try: () => manager.respondToRequest(threadId, requestId, decision),
        catch: (cause) => toRequestError(threadId, "item/requestApproval/decision", cause),
      });

    const respondToUserInput: CodexAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.tryPromise({
        try: () => manager.respondToUserInput(threadId, requestId, answers),
        catch: (cause) => toRequestError(threadId, "item/tool/requestUserInput", cause),
      });

    const stopSession: CodexAdapterShape["stopSession"] = (threadId) =>
      Effect.tryPromise({
        try: () => manager.stopSession(threadId),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId,
            detail: toMessage(cause, "Failed to stop Codex adapter session."),
            cause,
          }),
      });

    const listSessions: CodexAdapterShape["listSessions"] = () =>
      Effect.sync(() => manager.listSessions());

    const hasSession: CodexAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => manager.hasSession(threadId));

    const stopAll: CodexAdapterShape["stopAll"] = () =>
      Effect.tryPromise({
        try: () => manager.stopAll(),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: ThreadId.makeUnsafe("codex:all"),
            detail: toMessage(cause, "Failed to stop all Codex app-server processes."),
            cause,
          }),
      });

    const getComposerCapabilities: NonNullable<CodexAdapterShape["getComposerCapabilities"]> = () =>
      Effect.succeed(manager.getComposerCapabilities() satisfies ProviderComposerCapabilities);

    const listSkills: NonNullable<CodexAdapterShape["listSkills"]> = (input) =>
      Effect.tryPromise({
        try: () =>
          manager.listSkills({
            cwd: input.cwd,
            ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
            ...(input.forceReload !== undefined ? { forceReload: input.forceReload } : {}),
          }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "skills/list",
            detail: toMessage(cause, "skills/list failed"),
            cause,
          }),
      }).pipe(Effect.map((result) => result satisfies ProviderListSkillsResult));

    const listPlugins: NonNullable<CodexAdapterShape["listPlugins"]> = (input) =>
      Effect.tryPromise({
        try: () =>
          manager.listPlugins({
            ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
            ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
            ...(input.forceRemoteSync !== undefined
              ? { forceRemoteSync: input.forceRemoteSync }
              : {}),
            ...(input.forceReload !== undefined ? { forceReload: input.forceReload } : {}),
          }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "plugin/list",
            detail: toMessage(cause, "plugin/list failed"),
            cause,
          }),
      }).pipe(Effect.map((result) => result satisfies ProviderListPluginsResult));

    const readPlugin: NonNullable<CodexAdapterShape["readPlugin"]> = (input) =>
      Effect.tryPromise({
        try: () =>
          manager.readPlugin({
            ...(input.marketplacePath ? { marketplacePath: input.marketplacePath } : {}),
            ...(input.remoteMarketplaceName
              ? { remoteMarketplaceName: input.remoteMarketplaceName }
              : {}),
            pluginName: input.pluginName,
          }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "plugin/read",
            detail: toMessage(cause, "plugin/read failed"),
            cause,
          }),
      }).pipe(Effect.map((result) => result satisfies ProviderReadPluginResult));

    const listModels: NonNullable<CodexAdapterShape["listModels"]> = (input) =>
      Effect.tryPromise({
        try: () => manager.listModels(undefined, input.cwd),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "model/list",
            detail: toMessage(cause, "model/list failed"),
            cause,
          }),
      }).pipe(Effect.map((result) => result satisfies ProviderListModelsResult));

    const listMcpServers: NonNullable<CodexAdapterShape["listMcpServers"]> = (input) =>
      Effect.tryPromise({
        try: () => manager.listMcpServers(input),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "mcpServerStatus/list",
            detail: toMessage(cause, "MCP listing failed"),
            cause,
          }),
      });

    const manageMcpServer: NonNullable<CodexAdapterShape["manageMcpServer"]> = (input) =>
      Effect.tryPromise({
        try: () => manager.manageMcpServer(input),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "mcpServer/manage",
            detail: toMessage(cause, "MCP action failed"),
            cause,
          }),
      });

    const pluginInventory: NonNullable<CodexAdapterShape["pluginInventory"]> = (input) =>
      Effect.tryPromise({
        try: () => manager.pluginInventory(input),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "plugin/installed",
            detail: toMessage(cause, "Plugin inventory failed"),
            cause,
          }),
      });

    const managePlugin: NonNullable<CodexAdapterShape["managePlugin"]> = (input) =>
      Effect.tryPromise({
        try: () => manager.managePlugin(input),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "plugin/manage",
            detail: toMessage(cause, "Plugin action failed"),
            cause,
          }),
      });

    const transcribeVoice: NonNullable<CodexAdapterShape["transcribeVoice"]> = (input) =>
      Effect.tryPromise({
        try: () => manager.transcribeVoice(input),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "voice/transcribe",
            detail: toMessage(cause, "voice/transcribe failed"),
            cause,
          }),
      }).pipe(Effect.map((result) => result satisfies ServerVoiceTranscriptionResult));

    const prewarmVoice: NonNullable<CodexAdapterShape["prewarmVoice"]> = (input) =>
      Effect.tryPromise({
        try: () =>
          manager.prewarmVoice({
            cwd: input.cwd,
            ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
          }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "voice/prewarm",
            detail: toMessage(cause, "voice/prewarm failed"),
            cause,
          }),
      });

    yield* Effect.acquireRelease(
      Effect.gen(function* () {
        const writeNativeEvent = (event: ProviderEvent) =>
          Effect.gen(function* () {
            if (!nativeEventLogger) {
              return;
            }
            yield* nativeEventLogger.write(event, event.threadId);
          });

        const ingress = yield* makeBoundedCallbackIngress<CodexRuntimeIngressItem, never, never>(
          (item) =>
            Effect.gen(function* () {
              yield* writeNativeEvent(item.nativeEvent).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("Codex native event logging failed", {
                    threadId: item.nativeEvent.threadId,
                    method: item.nativeEvent.method,
                    cause: Cause.pretty(cause),
                  }),
                ),
              );
              const runtimeEvents = item.runtimeEvents;
              if (runtimeEvents.length === 0) {
                yield* Effect.logDebug("ignoring unhandled Codex provider event", {
                  method: item.nativeEvent.method,
                  threadId: item.nativeEvent.threadId,
                  turnId: item.nativeEvent.turnId,
                  itemId: item.nativeEvent.itemId,
                });
                return;
              }
              yield* Queue.offerAll(runtimeEventQueue, runtimeEvents);
            }),
          {
            capacity: PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
            maxBufferedBytes: PROVIDER_RUNTIME_CALLBACK_BUFFER_MAX_BYTES,
            terminalReserve: PROVIDER_RUNTIME_CALLBACK_TERMINAL_RESERVE,
            isTerminal: (item) => item.runtimeEvents.some(isTerminalProviderRuntimeEvent),
            sizeOf: (item) => item.bytes,
          },
        );
        const listener = (event: ProviderEvent) => {
          const mappedRuntimeEvents = assignDerivedProviderRuntimeEventIds(
            mapToRuntimeEvents(event, event.threadId),
          );
          const hasUnmappedEvent = mappedRuntimeEvents.some(
            (runtimeEvent) => runtimeEvent.type === "event.unmapped",
          );
          const sizedRuntimeEvents = mappedRuntimeEvents
            .filter(
              (runtimeEvent) =>
                runtimeEvent.type !== "event.unmapped" ||
                (!DIAGNOSTIC_ONLY_CODEX_METHODS.has(event.method) &&
                  shouldSurfaceUnmappedEvent(event)),
            )
            .map(compactProviderRuntimeEventForIngress);
          const runtimeEvents = sizedRuntimeEvents.map((item) => item.event);
          trackTurnWatchdogActivity(event.threadId, runtimeEvents);
          const nativeEvent = compactCodexNativeEventForIngress(
            hasUnmappedEvent ? sanitizeUnmappedProviderEvent(event) : event,
          );
          const result = ingress.offer({
            nativeEvent: nativeEvent.event,
            runtimeEvents,
            bytes:
              nativeEvent.bytes + sizedRuntimeEvents.reduce((total, item) => total + item.bytes, 0),
          });
          if (result === "terminal-overflow") {
            void Effect.runPromise(
              Effect.logError("Codex callback ingress exhausted terminal reserve", {
                threadId: event.threadId,
                method: event.method,
                status: ingress.status(),
              }),
            );
          }
        };
        manager.on("event", listener);
        const watchdogTicker = setInterval(evaluateTurnWatchdogs, CODEX_TURN_WATCHDOG_INTERVAL_MS);
        watchdogTicker.unref();
        return { ingress, listener, watchdogTicker };
      }),
      ({ ingress, listener, watchdogTicker }) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            clearInterval(watchdogTicker);
            turnWatchdogs.clear();
            manager.off("event", listener);
          });
          yield* ingress.abort;
          yield* Queue.shutdown(runtimeEventQueue);
        }),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        supportsSkillMentions: true,
        supportsSkillDiscovery: true,
        supportsNativeSlashCommandDiscovery: false,
        supportsPluginMentions: true,
        supportsPluginDiscovery: true,
        supportsRuntimeModelList: true,
        supportsTurnSteering: true,
        supportsLiveTurnDiffPatch: true,
      },
      generateThreadTitle: (input) =>
        Effect.tryPromise({
          try: (signal) => manager.generateThreadTitle(input, signal),
          catch: (cause) => toRequestError(input.threadId, "turn/start", cause),
        }),
      startSession,
      sendTurn,
      steerTurn,
      startReview,
      interruptTurn,
      readThread,
      readExternalThread,
      readExternalThreadPage,
      updateNativeHistory: (input) =>
        Effect.tryPromise({
          try: () => manager.updateNativeHistory(input),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: "codex",
              method: `thread/${input.action.type}`,
              detail: "Failed to update native Codex history.",
              cause,
            }),
        }),
      discoverProjects: (providerOptions) =>
        Effect.tryPromise({
          try: () => manager.discoverProjects(providerOptions),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: "codex",
              method: "thread/list",
              detail: "Failed to discover Codex sessions.",
              cause,
            }),
        }),
      rollbackThread,
      compactThread,
      forkThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      getComposerCapabilities,
      listSkills,
      listPlugins,
      readPlugin,
      listModels,
      listMcpServers,
      manageMcpServer,
      pluginInventory,
      managePlugin,
      prewarmVoice,
      transcribeVoice,
      streamEvents: Stream.fromQueue(runtimeEventQueue),
    } satisfies CodexAdapterShape;
  });

export function makeCodexAdapterLive(options?: CodexAdapterLiveOptions) {
  return Layer.effect(CodexAdapter, makeCodexAdapter(options));
}
