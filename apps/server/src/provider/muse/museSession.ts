import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";

import type { RuntimeEventDraft } from "../core/runtimeEventDraft.ts";
import { mintMspCommandId } from "./mspCommandId.ts";
import { callMsp, type MspConnection } from "./mspConnection.ts";
import {
  decodeMsp,
  MspApprovalRequest,
  MspApprovalResolved,
  MspContextUsage,
  MspItemDelta,
  MspItemEvent,
  MspSkillListResult,
  MspTokenUsageChanged,
  MspTurnCompleted,
  MspTurnRetryScheduled,
  MspTurnStartResult,
  MspUserInputRequest,
  MspUserInputSettled,
  type MspSkill,
  type MspTokenUsage,
} from "./mspProtocol.ts";
import { museRetryFailure, museTurnFailure } from "./museFailures.ts";
import { makeMuseInteractions, type MuseInteractions } from "./museInteractions.ts";
import { makeMuseTurnProjection, type MuseTurnProjection } from "./museTurnProjection.ts";

export interface MuseSessionSink {
  // `turnId` is the turn the draft belongs to, when it belongs to one.
  readonly emit: (draft: RuntimeEventDraft, turnId: string | undefined) => void;
}

export type MuseTurnInputPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "skill"; readonly selector: string; readonly arguments?: string };

interface ActiveTurn {
  turnId: string;
  readonly projection: MuseTurnProjection;
  // Events that raced the admission acknowledgement wait until `turn.started` is out.
  buffered: RuntimeEventDraft[] | undefined;
}

export interface MuseSession {
  readonly sessionId: string;
  readonly interactions: Pick<MuseInteractions, "decideApproval" | "answerUserInput">;
  readonly activeTurnId: () => string | undefined;
  readonly modelId: () => string | undefined;
  readonly setModel: (modelId: string) => Promise<void>;
  readonly skills: () => Promise<ReadonlyArray<MspSkill>>;
  // Resolves once the host admitted the turn; its events reach the sink as they arrive.
  readonly startTurn: (input: {
    readonly parts: ReadonlyArray<MuseTurnInputPart>;
    readonly reasoningEffort: string | undefined;
    readonly model: string | undefined;
  }) => Promise<string>;
  readonly interrupt: () => Promise<void>;
  // Ends the running turn as failed when the host is gone.
  readonly fail: (message: string) => void;
  readonly detach: () => void;
}

function usageDraft(
  context: typeof MspContextUsage.Type,
  last: MspTokenUsage | undefined,
): RuntimeEventDraft {
  const used = Math.max(0, Math.round(context.usedTokens));
  const window = context.windowTokens !== undefined ? Math.round(context.windowTokens) : 0;
  return {
    type: "thread.token-usage.updated",
    payload: {
      usage: {
        usedTokens: used,
        ...(window > 0 ? { maxTokens: window } : {}),
        ...(last
          ? {
              lastInputTokens: last.inputTokens,
              lastCachedInputTokens: last.cachedTokens,
              lastOutputTokens: last.outputTokens,
              lastReasoningOutputTokens: last.reasoningTokens,
            }
          : {}),
      },
    },
  };
}

export function openMuseSession(input: {
  readonly connection: MspConnection;
  readonly sessionId: string;
  readonly modelId: string | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly sink: MuseSessionSink;
}): MuseSession {
  const { connection, sessionId, sink } = input;
  let active: ActiveTurn | undefined;
  let modelId = input.modelId;
  let skills: Promise<ReadonlyArray<MspSkill>> | undefined;
  let lastUsage: MspTokenUsage | undefined;
  const interactions = makeMuseInteractions({
    connection,
    sessionId,
    runtimeMode: input.runtimeMode,
    emit: sink.emit,
  });

  const emitForTurn = (turn: ActiveTurn, drafts: ReadonlyArray<RuntimeEventDraft>) => {
    if (turn.buffered) turn.buffered.push(...drafts);
    else for (const draft of drafts) sink.emit(draft, turn.turnId);
  };

  const finishTurn = (turn: ActiveTurn, completed: typeof MspTurnCompleted.Type) => {
    if (active === turn) active = undefined;
    interactions.settleAll();
    const state =
      completed.terminal === "completed"
        ? "completed"
        : completed.terminal === "cancelled"
          ? "interrupted"
          : "failed";
    const failure = state === "failed" ? museTurnFailure(completed) : undefined;
    emitForTurn(turn, [
      ...turn.projection.finish(state !== "completed"),
      ...(failure
        ? [{ type: "runtime.error", payload: { message: failure.message, failure } } as const]
        : []),
      {
        type: "turn.completed",
        payload: {
          state,
          stopReason: completed.terminal,
          ...(failure ? { errorMessage: failure.message } : {}),
        },
      },
    ]);
  };

  const onMessage = (method: string, params: unknown) => {
    switch (method) {
      case "item/started":
      case "item/updated":
      case "item/completed": {
        const event = decodeMsp(MspItemEvent, params);
        if (!event || !active || event.item.turnId !== active.turnId) return;
        const phase =
          method === "item/started"
            ? "started"
            : method === "item/updated"
              ? "updated"
              : "completed";
        emitForTurn(active, active.projection.item(phase, event.item));
        return;
      }
      case "item/delta": {
        const delta = decodeMsp(MspItemDelta, params);
        if (!delta || !active) return;
        emitForTurn(active, active.projection.delta(delta.itemId, delta.field, delta.delta));
        return;
      }
      case "turn/completed": {
        const completed = decodeMsp(MspTurnCompleted, params);
        if (completed && active?.turnId === completed.turnId) finishTurn(active, completed);
        return;
      }
      case "turn/retryScheduled": {
        const retry = decodeMsp(MspTurnRetryScheduled, params);
        if (!retry || active?.turnId !== retry.turnId) return;
        const failure = museRetryFailure(retry);
        emitForTurn(active, [
          { type: "runtime.warning", payload: { message: failure.message, failure } },
        ]);
        return;
      }
      case "approval/request":
      case "approval/requested": {
        const request = decodeMsp(MspApprovalRequest, params);
        if (request) interactions.presentApproval(request);
        return;
      }
      case "approval/resolved": {
        const resolved = decodeMsp(MspApprovalResolved, params);
        if (resolved) interactions.approvalResolved(resolved.approvalId, resolved.decision);
        return;
      }
      case "userInput/request":
      case "userInput/requested": {
        const request = decodeMsp(MspUserInputRequest, params);
        if (request) interactions.presentUserInput(request);
        return;
      }
      case "userInput/settled": {
        const settled = decodeMsp(MspUserInputSettled, params);
        if (settled) interactions.userInputSettled(settled.userInputId);
        return;
      }
      case "session/tokenUsage":
        lastUsage = decodeMsp(MspTokenUsageChanged, params)?.usage ?? lastUsage;
        return;
      case "session/contextUsage": {
        const context = decodeMsp(MspContextUsage, params);
        if (context) sink.emit(usageDraft(context, lastUsage), active?.turnId);
        return;
      }
      case "skill/changed":
        skills = undefined;
        return;
      default:
        return;
    }
  };

  const detach = connection.attachSession(sessionId, onMessage);

  return {
    sessionId,
    interactions,
    activeTurnId: () => active?.turnId,
    modelId: () => modelId,
    setModel: async (next) => {
      if (next === modelId) return;
      await connection.request("session/setModel", {
        sessionId,
        commandId: mintMspCommandId(),
        model: { modelId: next },
      });
      modelId = next;
    },
    skills: () => {
      skills ??= callMsp(connection, "skill/list", { sessionId }, MspSkillListResult).then(
        (result) => result.skills,
        (cause: unknown) => {
          skills = undefined;
          throw cause;
        },
      );
      return skills;
    },
    startTurn: async ({ parts, reasoningEffort, model }) => {
      // A fresh turn's id is its command id, so events that race the acknowledgement still route.
      const commandId = mintMspCommandId();
      const turn: ActiveTurn = {
        turnId: commandId,
        projection: makeMuseTurnProjection(),
        buffered: [],
      };
      active = turn;
      try {
        const ack = await callMsp(
          connection,
          "turn/start",
          { sessionId, commandId, input: parts, ...(reasoningEffort ? { reasoningEffort } : {}) },
          MspTurnStartResult,
        );
        if (ack.disposition !== "started" || ack.turnId !== commandId) {
          throw new Error(`Muse Code did not start a new turn (${ack.disposition}).`);
        }
      } catch (cause) {
        if (active === turn) active = undefined;
        throw cause;
      }
      const buffered = turn.buffered ?? [];
      turn.buffered = undefined;
      sink.emit(
        {
          type: "turn.started",
          payload: {
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { effort: reasoningEffort } : {}),
          },
        },
        turn.turnId,
      );
      for (const draft of buffered) sink.emit(draft, turn.turnId);
      return turn.turnId;
    },
    interrupt: async () => {
      const turn = active;
      if (!turn) return;
      await connection.request("turn/interrupt", {
        sessionId,
        commandId: mintMspCommandId(),
        turnId: turn.turnId,
      });
    },
    fail: (message) => {
      if (active)
        finishTurn(active, { turnId: active.turnId, terminal: "failed", reason: message });
    },
    detach: () => {
      interactions.settleAll();
      detach();
    },
  };
}
