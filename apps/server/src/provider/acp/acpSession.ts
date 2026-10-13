import { randomUUID } from "node:crypto";

import type {
  AvailableCommand,
  ContentBlock,
  PermissionOption,
  PermissionOptionKind,
  PromptResponse,
  RequestPermissionOutcome,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { RuntimeRequestId } from "@glade/contracts/core/baseSchemas";
import type { ProviderFailure } from "@glade/contracts/provider/providerFailure";
import type { CanonicalRequestType } from "@glade/contracts/provider/runtimeMetadata";
import type {
  ProviderApprovalDecision,
  RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";

import type { AcpConnection } from "./acpConnection.ts";
import {
  acpToolItemType,
  makeAcpTurnProjection,
  type AcpRuntimeEventDraft,
  type AcpTurnProjection,
} from "./acpTurnProjection.ts";

export interface AcpSessionSink {
  // `turnId` is the Glade turn the draft belongs to, when it belongs to one.
  readonly emit: (draft: AcpRuntimeEventDraft, turnId: string | undefined) => void;
}

interface PendingPermission {
  readonly options: ReadonlyArray<PermissionOption>;
  readonly requestType: CanonicalRequestType;
  readonly turnId: string | undefined;
  readonly resolve: (outcome: RequestPermissionOutcome) => void;
}

interface ActiveTurn {
  readonly turnId: string;
  readonly projection: AcpTurnProjection;
}

export interface AcpSession {
  readonly sessionId: string;
  readonly configOptions: () => ReadonlyArray<SessionConfigOption>;
  readonly availableCommands: () => ReadonlyArray<AvailableCommand>;
  readonly activeTurnId: () => string | undefined;
  readonly setConfigOption: (configId: string, value: string) => Promise<void>;
  // Resolves when the turn ends; the turn's events go to the sink as they arrive.
  readonly prompt: (turnId: string, blocks: ReadonlyArray<ContentBlock>) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly respondToPermission: (requestId: string, decision: ProviderApprovalDecision) => boolean;
  readonly setRuntimeMode: (mode: RuntimeMode) => void;
  readonly detach: () => void;
}

function permissionRequestType(request: RequestPermissionRequest): CanonicalRequestType {
  switch (request.toolCall.kind) {
    case "execute":
      return "command_execution_approval";
    case "read":
    case "search":
      return "file_read_approval";
    case "edit":
    case "delete":
    case "move":
      return "file_change_approval";
    default:
      return "tool_approval";
  }
}

function pickOption(
  options: ReadonlyArray<PermissionOption>,
  kinds: ReadonlyArray<PermissionOptionKind>,
): PermissionOption | undefined {
  for (const kind of kinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) return option;
  }
  return undefined;
}

function outcomeFor(
  options: ReadonlyArray<PermissionOption>,
  decision: ProviderApprovalDecision,
): RequestPermissionOutcome {
  const option =
    decision === "accept"
      ? pickOption(options, ["allow_once", "allow_always"])
      : decision === "acceptForSession"
        ? pickOption(options, ["allow_always", "allow_once"])
        : decision === "decline"
          ? pickOption(options, ["reject_once", "reject_always"])
          : undefined;
  return option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Classifies a failed prompt from the agent's JSON-RPC error so Glade can offer the right recovery.
function acpPromptFailure(cause: unknown): ProviderFailure {
  const error = isRecord(cause) ? cause : {};
  const message =
    typeof error.message === "string" ? error.message : cause instanceof Error ? "" : String(cause);
  const data = isRecord(error.data) ? error.data : undefined;
  const reason = typeof data?.reason === "string" ? data.reason : undefined;
  const kind: ProviderFailure["kind"] =
    reason === "model_usage_exhausted"
      ? "quota_exhausted"
      : typeof error.code === "number"
        ? "internal"
        : "connection_lost";
  return {
    kind,
    retry: { state: "none" },
    action: kind === "quota_exhausted" ? "wait" : null,
    resetsAt: null,
    httpStatus: null,
    message: message.trim() || "The agent turn failed.",
  };
}

interface AcpContextUsage {
  readonly used: number;
  readonly size: number;
}

// `usage_update` reports how full the context window is; a turn's own usage counts what the turn
// consumed, which equals the fill only for a single model call, so it stands in only when the
// agent never reported the window.
function usageDraft(
  context: AcpContextUsage | undefined,
  response?: PromptResponse,
): AcpRuntimeEventDraft | undefined {
  const turn = response?.usage ?? undefined;
  const usedTokens = context?.used ?? turn?.totalTokens;
  if (usedTokens === undefined) return undefined;
  return {
    type: "thread.token-usage.updated",
    payload: {
      usage: {
        usedTokens,
        ...(context && context.size > 0 ? { maxTokens: context.size } : {}),
        ...(turn
          ? {
              lastUsedTokens: turn.totalTokens,
              lastInputTokens: turn.inputTokens,
              lastOutputTokens: turn.outputTokens,
              ...(turn.cachedReadTokens != null
                ? { lastCachedInputTokens: turn.cachedReadTokens }
                : {}),
              ...(turn.thoughtTokens != null
                ? { lastReasoningOutputTokens: turn.thoughtTokens }
                : {}),
            }
          : {}),
      },
    },
  };
}

export function openAcpSession(input: {
  readonly connection: AcpConnection;
  readonly sessionId: string;
  readonly configOptions: ReadonlyArray<SessionConfigOption>;
  readonly runtimeMode: RuntimeMode;
  readonly sink: AcpSessionSink;
}): AcpSession {
  const { connection, sessionId, sink } = input;
  let configOptions = input.configOptions;
  let commands: ReadonlyArray<AvailableCommand> = [];
  let runtimeMode = input.runtimeMode;
  let active: ActiveTurn | undefined;
  let context: AcpContextUsage | undefined;
  const pending = new Map<string, PendingPermission>();

  const onUpdate = (notification: SessionNotification) => {
    const update = notification.update;
    switch (update.sessionUpdate) {
      case "available_commands_update":
        commands = update.availableCommands;
        return;
      case "config_option_update":
        configOptions = update.configOptions;
        return;
      case "usage_update": {
        context = { used: update.used, size: update.size };
        const draft = usageDraft(context);
        if (draft) sink.emit(draft, active?.turnId);
        return;
      }
      case "session_info_update":
        if (update.title)
          sink.emit(
            { type: "thread.metadata.updated", payload: { name: update.title } },
            undefined,
          );
        return;
      default:
        if (!active) return;
        for (const draft of active.projection.project(update)) sink.emit(draft, active.turnId);
    }
  };

  const onPermission = (request: RequestPermissionRequest) =>
    new Promise<RequestPermissionOutcome>((resolve) => {
      if (runtimeMode === "full-access") {
        // Full Access approves each call once; Glade never grants a lasting rule in the agent.
        resolve(outcomeFor(request.options, "accept"));
        return;
      }
      const requestId = randomUUID();
      const requestType = permissionRequestType(request);
      const turnId = active?.turnId;
      pending.set(requestId, { options: request.options, requestType, turnId, resolve });
      sink.emit(
        {
          type: "request.opened",
          requestId: RuntimeRequestId.makeUnsafe(requestId),
          payload: {
            requestType,
            ...(request.toolCall.title ? { detail: request.toolCall.title } : {}),
            args: {
              toolCallId: request.toolCall.toolCallId,
              itemType: acpToolItemType(request.toolCall.kind ?? undefined),
              input: request.toolCall.rawInput ?? {},
              options: request.options.map(({ optionId, name, kind }) => ({
                optionId,
                name,
                kind,
              })),
            },
          },
        },
        turnId,
      );
    });

  const settle = (requestId: string, outcome: RequestPermissionOutcome, decision: string) => {
    const permission = pending.get(requestId);
    if (!permission) return false;
    pending.delete(requestId);
    permission.resolve(outcome);
    sink.emit(
      {
        type: "request.resolved",
        requestId: RuntimeRequestId.makeUnsafe(requestId),
        payload: { requestType: permission.requestType, decision },
      },
      permission.turnId,
    );
    return true;
  };

  const settleAll = () => {
    for (const requestId of [...pending.keys()]) {
      settle(requestId, { outcome: "cancelled" }, "cancel");
    }
  };

  const detachRouting = connection.attachSession(sessionId, { onUpdate, onPermission });

  return {
    sessionId,
    configOptions: () => configOptions,
    availableCommands: () => commands,
    activeTurnId: () => active?.turnId,
    setConfigOption: async (configId, value) => {
      const current = configOptions.find((option) => option.id === configId);
      if (current?.type === "select" && current.currentValue === value) return;
      const response = await connection.agent.setSessionConfigOption({
        sessionId,
        configId,
        value,
      });
      configOptions = response.configOptions;
    },
    prompt: async (turnId, blocks) => {
      const turn: ActiveTurn = { turnId, projection: makeAcpTurnProjection(`acp:${turnId}`) };
      active = turn;
      const finish = (drafts: ReadonlyArray<AcpRuntimeEventDraft>) => {
        if (active === turn) active = undefined;
        settleAll();
        for (const draft of drafts) sink.emit(draft, turnId);
      };
      try {
        const response = await connection.agent.prompt({ sessionId, prompt: [...blocks] });
        const usage = usageDraft(context, response);
        const state =
          response.stopReason === "cancelled"
            ? "interrupted"
            : response.stopReason === "refusal"
              ? "failed"
              : "completed";
        finish([
          ...turn.projection.finish(state === "failed"),
          ...(usage ? [usage] : []),
          {
            type: "turn.completed",
            payload: {
              state,
              stopReason: response.stopReason,
              ...(state === "failed" ? { errorMessage: "The agent refused to continue." } : {}),
            },
          },
        ]);
      } catch (cause) {
        const failure = acpPromptFailure(cause);
        finish([
          ...turn.projection.finish(true),
          { type: "runtime.error", payload: { message: failure.message, failure } },
          { type: "turn.completed", payload: { state: "failed", errorMessage: failure.message } },
        ]);
      }
    },
    cancel: async () => {
      // The protocol requires the client to answer outstanding permission requests as cancelled.
      settleAll();
      await connection.agent.cancel({ sessionId });
    },
    respondToPermission: (requestId, decision) => {
      const permission = pending.get(requestId);
      if (!permission) return false;
      return settle(requestId, outcomeFor(permission.options, decision), decision);
    },
    setRuntimeMode: (mode) => {
      runtimeMode = mode;
    },
    detach: () => {
      settleAll();
      detachRouting();
    },
  };
}
