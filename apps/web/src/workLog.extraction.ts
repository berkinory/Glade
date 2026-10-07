import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { isToolLifecycleItemType } from "@glade/contracts/provider/runtimeMetadata";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import {
  decodeSubagentAgentStates,
  extractSubagentIdentityHints,
  decodeSubagentReceiverAgents,
  decodeSubagentReceiverThreadIds,
} from "@glade/shared/threads/subagents";
import { approvalRequestKindFromRequestType } from "@glade/shared/threads/threadSummary";
import { stripTrailingToolExitCode } from "./features/chat/timeline/toolOutputSummary";
import { pluralize } from "@glade/shared/text/text";
import { normalizeCompactToolLabel } from "./lib/toolCallLabel.presentations";
import { compactPath } from "./lib/toolCallLabel.shell";
import type { WorkLogEntry, WorkLogSubagent, WorkLogSubagentAction } from "./workLog.types";

export function firstFiniteNumber(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
}

function normalizeCollabIdentifier(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.trim().toLowerCase().replaceAll("_", "").replaceAll("-", "");
}

export function collabPayloadItem(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const data = asObjectRecord(payload?.data);
  return asObjectRecord(data?.item) ?? data;
}

function inferSubagentActionTool(item: Record<string, unknown> | null): string | null {
  const directTool = nonEmptyTrimmed(item?.tool ?? item?.name) ?? null;
  if (directTool) {
    if (directTool === "agentActivity") {
      if (item?.kind === "started") return "spawnAgent";
      if (item?.kind === "interacted") return "sendInput";
    }
    return directTool;
  }

  const normalizedType = normalizeCollabIdentifier(nonEmptyTrimmed(item?.type) ?? null);
  if (!normalizedType) {
    return null;
  }
  if (normalizedType.includes("spawn")) return "spawnAgent";
  if (normalizedType.includes("wait")) return "waitAgent";
  if (normalizedType.includes("close")) return "closeAgent";
  if (normalizedType.includes("resume")) return "resumeAgent";
  if (normalizedType.includes("interaction")) return "sendInput";
  return "spawnAgent";
}

function summarizeSubagentAction(tool: string, count: number, status: string): string {
  const normalizedTool = normalizeCollabIdentifier(tool) ?? "";
  const effectiveCount = Math.max(1, count);
  const noun = pluralize(effectiveCount, "subagent");
  const finished = status === "completed";
  switch (normalizedTool) {
    case "spawnagent":
      return `${finished ? "Started" : "Starting"} ${effectiveCount} ${noun}`;
    case "wait":
    case "waitagent":
      return `${finished ? "Waited for" : "Waiting for"} ${effectiveCount} ${noun}`;
    case "closeagent":
      return `${finished ? "Stopped" : "Stopping"} ${effectiveCount} ${noun}`;
    case "resumeagent":
      return `${finished ? "Resumed" : "Resuming"} ${effectiveCount} ${noun}`;
    case "sendinput":
      return `${finished ? "Sent instructions to" : "Sending instructions to"} ${effectiveCount} ${noun}`;
    default:
      return effectiveCount === 1 ? "Subagent activity" : `Subagent activity (${effectiveCount})`;
  }
}

export function extractCollabAction(
  payload: Record<string, unknown> | null,
  subagents: ReadonlyArray<WorkLogSubagent>,
): WorkLogSubagentAction | undefined {
  const itemType = extractWorkLogItemType(payload);
  if (itemType !== "collab_agent_tool_call") {
    return undefined;
  }

  const item = collabPayloadItem(payload);
  const itemInput = asObjectRecord(item?.input);
  const tool = inferSubagentActionTool(item);
  const status = nonEmptyTrimmed(item?.status ?? payload?.status) ?? "in_progress";
  const model =
    nonEmptyTrimmed(
      item?.model ??
        item?.modelName ??
        item?.model_name ??
        item?.requestedModel ??
        item?.requested_model,
    ) ?? null;
  const prompt =
    nonEmptyTrimmed(
      item?.prompt ?? item?.task ?? item?.message ?? itemInput?.prompt ?? itemInput?.description,
    ) ?? null;
  const agentStates = decodeSubagentAgentStates(item);
  const receiverThreadIds = decodeSubagentReceiverThreadIds(item);
  const count = Math.max(
    subagents.length,
    receiverThreadIds.length,
    Object.keys(agentStates).length,
  );

  if (!tool && !model && !prompt && count === 0) {
    return undefined;
  }

  return {
    tool: tool ?? "spawnAgent",
    status,
    summaryText: summarizeSubagentAction(tool ?? "spawnAgent", count, status),
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

export function extractCollabSubagents(
  payload: Record<string, unknown> | null,
): ReadonlyArray<WorkLogSubagent> {
  const itemType = extractWorkLogItemType(payload);
  if (itemType !== "collab_agent_tool_call") {
    return [];
  }

  const item = collabPayloadItem(payload);
  if (!item) {
    return [];
  }

  const receiverThreadIds = decodeSubagentReceiverThreadIds(item);
  const receiverAgents = decodeSubagentReceiverAgents(item, receiverThreadIds).map((agent) => {
    const receiverAgent: WorkLogSubagent = {
      threadId: agent.providerThreadId,
      providerThreadId: agent.providerThreadId,
    };
    if (agent.agentId) receiverAgent.agentId = agent.agentId;
    if (agent.nickname) receiverAgent.nickname = agent.nickname;
    if (agent.role) receiverAgent.role = agent.role;
    if (agent.model) {
      receiverAgent.model = agent.model;
      receiverAgent.modelIsRequestedHint = agent.modelIsRequestedHint;
    }
    if (agent.effort) receiverAgent.effort = agent.effort;
    if (agent.background) receiverAgent.background = agent.background;
    if (agent.prompt) receiverAgent.prompt = agent.prompt;
    return receiverAgent;
  });

  const agentStates = decodeSubagentAgentStates(item);
  if (receiverAgents.length > 0 || Object.keys(agentStates).length > 0) {
    const mergedByThreadId = new Map<string, WorkLogSubagent>();
    for (const agent of receiverAgents) {
      mergedByThreadId.set(agent.threadId, agent);
    }
    for (const [threadId, state] of Object.entries(agentStates)) {
      const previous = mergedByThreadId.get(threadId);
      const useStateModel =
        state.model &&
        !(state.modelIsRequestedHint && previous?.model && !previous.modelIsRequestedHint);
      mergedByThreadId.set(threadId, {
        threadId,
        providerThreadId: previous?.providerThreadId ?? threadId,
        ...previous,
        ...(state.agentId ? { agentId: state.agentId } : {}),
        ...(state.nickname ? { nickname: state.nickname } : {}),
        ...(state.role ? { role: state.role } : {}),
        ...(useStateModel
          ? { model: state.model, modelIsRequestedHint: state.modelIsRequestedHint }
          : {}),
        ...(state.prompt ? { prompt: state.prompt } : {}),
        ...(state.status ? { rawStatus: state.status } : {}),
        ...(state.message ? { latestUpdate: state.message } : {}),
      });
    }
    return [...mergedByThreadId.values()];
  }

  const singularThreadId =
    receiverThreadIds[0] ??
    nonEmptyTrimmed(
      item.receiverThreadId ?? item.receiver_thread_id ?? item.threadId ?? item.thread_id,
    ) ??
    null;
  if (!singularThreadId) {
    const fallbackIdentity = extractSubagentIdentityHints(item).find(
      (entry) => entry.providerThreadId !== undefined,
    );
    if (!fallbackIdentity?.providerThreadId) {
      return [];
    }
    return [
      {
        threadId: fallbackIdentity.providerThreadId,
        providerThreadId: fallbackIdentity.providerThreadId,
        ...(fallbackIdentity.agentId ? { agentId: fallbackIdentity.agentId } : {}),
        ...(fallbackIdentity.nickname ? { nickname: fallbackIdentity.nickname } : {}),
        ...(fallbackIdentity.role ? { role: fallbackIdentity.role } : {}),
        ...(fallbackIdentity.model
          ? {
              model: fallbackIdentity.model,
              modelIsRequestedHint: fallbackIdentity.modelIsRequestedHint,
            }
          : {}),
        ...(fallbackIdentity.effort ? { effort: fallbackIdentity.effort } : {}),
        ...(fallbackIdentity.background ? { background: fallbackIdentity.background } : {}),
        ...(fallbackIdentity.prompt ? { prompt: fallbackIdentity.prompt } : {}),
        ...(fallbackIdentity.status ? { rawStatus: fallbackIdentity.status } : {}),
        ...(fallbackIdentity.message ? { latestUpdate: fallbackIdentity.message } : {}),
      },
    ];
  }
  return [
    {
      threadId: singularThreadId,
      providerThreadId: singularThreadId,
      agentId:
        nonEmptyTrimmed(item.agentId ?? item.agent_id ?? item.newAgentId ?? item.new_agent_id) ??
        undefined,
      nickname:
        nonEmptyTrimmed(
          item.newAgentNickname ??
            item.new_agent_nickname ??
            item.agentNickname ??
            item.agent_nickname ??
            item.receiverAgentNickname ??
            item.receiver_agent_nickname,
        ) ?? undefined,
      role:
        nonEmptyTrimmed(
          item.receiverAgentRole ??
            item.receiver_agent_role ??
            item.newAgentRole ??
            item.new_agent_role ??
            item.agentRole ??
            item.agent_role ??
            item.agentType ??
            item.agent_type,
        ) ?? undefined,
      model:
        nonEmptyTrimmed(
          item.model ??
            item.modelName ??
            item.model_name ??
            item.requestedModel ??
            item.requested_model,
        ) ?? undefined,
      modelIsRequestedHint: true,
      effort: nonEmptyTrimmed(item.effort) ?? undefined,
      background: item.background === true ? true : undefined,
      prompt: nonEmptyTrimmed(item.prompt ?? item.task ?? item.message) ?? undefined,
    },
  ];
}

function normalizeCommandValue(value: unknown): string | null {
  const direct = nonEmptyTrimmed(value) ?? null;
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => nonEmptyTrimmed(entry) ?? null)
    .filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

function asCommandArgumentRecord(value: unknown): Record<string, unknown> | null {
  const direct = asObjectRecord(value);
  if (direct) {
    return direct;
  }
  const text = nonEmptyTrimmed(value) ?? null;
  if (!text || !text.startsWith("{")) {
    return null;
  }
  try {
    return asObjectRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function isCommandLikeDetail(payload: Record<string, unknown> | null): boolean {
  if (!payload) {
    return false;
  }
  const itemType = extractWorkLogItemType(payload);
  if (itemType === "command_execution") {
    return true;
  }
  const requestKind = extractWorkLogRequestKind(payload);
  if (requestKind === "command") {
    return true;
  }
  const normalizedTitle = normalizeCompactToolLabel(nonEmptyTrimmed(payload.title) ?? "");
  return normalizedTitle === "Ran command" || normalizedTitle === "Command run";
}

interface CommandAction {
  type: string;
  command?: string;
  name?: string;
  path?: string;
  query?: string;
}

interface CommandActionDisplay {
  title: string;
  preview?: string;
}

function makeCommandActionDisplay(
  title: string,
  preview: string | undefined,
): CommandActionDisplay {
  return preview === undefined ? { title } : { title, preview };
}

export function extractToolCommand(
  payload: Record<string, unknown> | null,
  commandAction: CommandAction | null = extractPrimaryCommandAction(payload),
): { command: string | null; rawCommand: string | null } {
  const data = asObjectRecord(payload?.data);
  const item = asObjectRecord(data?.item);
  const itemResult = asObjectRecord(item?.result);
  const itemInput = asObjectRecord(item?.input);
  const itemArguments = asCommandArgumentRecord(item?.arguments ?? item?.args ?? item?.params);
  const itemCall = asObjectRecord(item?.call);
  const itemFunction = asObjectRecord(item?.function);
  const dataInput = asObjectRecord(data?.input);
  const dataArguments = asCommandArgumentRecord(data?.arguments ?? data?.args ?? data?.params);
  const rawInput = asCommandArgumentRecord(data?.rawInput);
  const detailCommand =
    isCommandLikeDetail(payload) && typeof payload?.detail === "string"
      ? stripTrailingExitCode(payload.detail).output
      : null;
  const rawCommandCandidates = [
    item?.command,
    item?.cmd,
    itemInput?.command,
    itemInput?.cmd,
    itemArguments?.command,
    itemArguments?.cmd,
    itemCall?.command,
    itemCall?.cmd,
    itemFunction?.arguments,
    itemResult?.command,
    itemResult?.cmd,
    data?.command,
    data?.cmd,
    dataInput?.command,
    dataInput?.cmd,
    dataArguments?.command,
    dataArguments?.cmd,
    rawInput?.command,
    rawInput?.cmd,
    item?.text,
    item?.summary,
    detailCommand,
  ];
  const rawCommand =
    rawCommandCandidates
      .map((candidate) => normalizeCommandValue(candidate))
      .find((candidate) => candidate !== null) ?? null;
  const command = normalizeCommandValue(commandAction?.command) ?? rawCommand;
  return {
    command,
    rawCommand: rawCommand && rawCommand !== command ? rawCommand : null,
  };
}

export function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return nonEmptyTrimmed(payload?.title) ?? null;
}

export function extractPrimaryCommandAction(
  payload: Record<string, unknown> | null,
): CommandAction | null {
  const data = asObjectRecord(payload?.data);
  const item = asObjectRecord(data?.item);
  const actions = collectCommandActions(payload, data, item);
  for (const action of actions) {
    const actionRecord = asObjectRecord(action);
    if (!actionRecord) {
      continue;
    }
    const type = nonEmptyTrimmed(actionRecord.type) ?? "unknown";
    const command = nonEmptyTrimmed(actionRecord.command) ?? undefined;
    const name = nonEmptyTrimmed(actionRecord.name) ?? undefined;
    const path = nonEmptyTrimmed(actionRecord.path) ?? undefined;
    const query = nonEmptyTrimmed(actionRecord.query) ?? undefined;
    if (command || name || path || query || type !== "unknown") {
      return {
        type,
        ...(command ? { command } : {}),
        ...(name ? { name } : {}),
        ...(path ? { path } : {}),
        ...(query ? { query } : {}),
      };
    }
  }
  return null;
}

function collectCommandActions(
  payload: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
  item: Record<string, unknown> | null,
): ReadonlyArray<unknown> {
  const candidates = [
    item?.commandActions,
    asCommandArgumentRecord(item?.arguments ?? item?.args ?? item?.params)?.commandActions,
    data?.commandActions,
    asCommandArgumentRecord(data?.arguments ?? data?.args ?? data?.params)?.commandActions,
    asCommandArgumentRecord(data?.rawInput)?.commandActions,
    asCommandArgumentRecord(data?.input)?.commandActions,
    payload?.commandActions,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

export function deriveCommandActionDisplay(
  action: CommandAction | null,
  activityKind: OrchestrationThreadActivity["kind"],
): CommandActionDisplay | null {
  if (!action) {
    return null;
  }
  const running = activityKind !== "tool.completed";
  switch (normalizeCommandActionType(action.type)) {
    case "read":
    case "readfile":
      return makeCommandActionDisplay(running ? "Reading" : "Read", commandActionTarget(action));
    case "search":
    case "find":
      return makeCommandActionDisplay(
        running ? "Searching" : "Searched",
        commandActionSearchPreview(action),
      );
    case "listfiles":
      return makeCommandActionDisplay(
        running ? "Listing" : "Listed",
        commandActionListPreview(action),
      );
    default:
      return null;
  }
}

function normalizeCommandActionType(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function commandActionTarget(action: CommandAction): string | undefined {
  return action.name ?? (action.path ? compactPath(action.path) : null) ?? undefined;
}

function commandActionSearchPreview(action: CommandAction): string | undefined {
  const query = action.query ?? action.name;
  const path = action.path ? compactPath(action.path) : null;
  if (query && path) {
    return `for ${query} in ${path}`;
  }
  if (query) {
    return `for ${query}`;
  }
  if (path) {
    return `in ${path}`;
  }
  return commandActionTarget(action);
}

function commandActionListPreview(action: CommandAction): string | undefined {
  return (action.path ? compactPath(action.path) : null) ?? action.name ?? undefined;
}

export function extractMcpService(payload: Record<string, unknown> | null): string | null {
  const data = asObjectRecord(payload?.data);
  const item = asObjectRecord(data?.item);
  const appContext = asObjectRecord(item?.appContext);
  const candidates = [appContext?.appName, payload?.server, data?.server, item?.server];
  for (const candidate of candidates) {
    const name = nonEmptyTrimmed(candidate);
    if (name) return name;
  }
  return null;
}

export function extractToolName(payload: Record<string, unknown> | null): string | null {
  const data = asObjectRecord(payload?.data);
  const item = asObjectRecord(data?.item);
  const itemInput = asObjectRecord(item?.input);
  const dataInvocation = asObjectRecord(data?.invocation);
  const itemInvocation = asObjectRecord(item?.invocation);
  const candidates = [
    payload?.toolName,
    data?.toolName,
    data?.tool,
    dataInvocation?.tool,
    dataInvocation?.toolName,
    item?.toolName,
    item?.tool,
    item?.name,
    itemInvocation?.tool,
    itemInvocation?.toolName,
    itemInput?.toolName,
  ];
  for (const candidate of candidates) {
    const normalized = nonEmptyTrimmed(candidate) ?? null;
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  const data = asObjectRecord(payload?.data);
  const item = asObjectRecord(data?.item);
  return (
    nonEmptyTrimmed(
      data?.toolCallId ?? data?.toolUseId ?? data?.callID ?? data?.callId ?? item?.id,
    ) ?? null
  );
}

export function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  return stripTrailingToolExitCode(value.trim());
}

export function extractDetailCollapseHint(detail: string | undefined): string {
  if (!detail) {
    return "";
  }
  const firstLine = detail.split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length === 0) {
    return "";
  }
  const colonIndex = firstLine.indexOf(":");
  if (colonIndex <= 0) {
    return firstLine;
  }
  return firstLine.slice(0, colonIndex);
}

export function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  const topLevel = payload?.itemType;
  if (typeof topLevel === "string" && isToolLifecycleItemType(topLevel)) {
    return topLevel;
  }

  const data = asObjectRecord(payload?.data);
  const item = asObjectRecord(data?.item);
  const nested = data?.itemType ?? item?.type ?? item?.kind ?? payload?.type ?? payload?.kind;
  if (typeof nested === "string" && isToolLifecycleItemType(nested)) {
    return nested;
  }
  return undefined;
}

export function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change" ||
    payload?.requestKind === "permissions" ||
    payload?.requestKind === "tool"
  ) {
    return payload.requestKind;
  }
  return approvalRequestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = nonEmptyTrimmed(value) ?? null;
  if (!normalized || !isLikelyFilePath(normalized) || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function isLikelyFilePath(value: string): boolean {
  if (/^(?:file|vscode|cursor):\/\//iu.test(value)) {
    return true;
  }
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/u.test(value)) {
    return true;
  }
  if (value.includes("/") || value.includes("\\")) {
    return true;
  }
  return /^[^\s/\\]+\.[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asObjectRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.file);
  pushChangedFile(target, seen, record.file_path);
  pushChangedFile(target, seen, record.filepath);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "rawInput",
    "rawOutput",
    "data",
    "location",
    "locations",
    "changes",
    "files",
    "file",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

export function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asObjectRecord(payload?.data), changedFiles, seen, 0);
  return changedFiles;
}
