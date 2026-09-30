import { Effect } from "effect";
import { EventId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";
import { type RuntimeTurnState } from "@glade/contracts/provider/runtimeMetadata";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeTurnResultUsage } from "../claudeResultUsage.ts";
import {
  maxClaudeContextWindowFromModelUsage,
  resolveEffectiveClaudeContextWindow,
  normalizeClaudeTokenUsage,
  snapshotFromClaudeContextUsage,
  mergeClaudeTokenUsageSnapshot,
} from "../claudeTokenUsage.ts";
import { asPositiveFiniteNumber } from "@glade/shared/transport/payloadValues";
import { withoutProcessedTokenTotal } from "./sessionResume";
import { type ThreadTokenUsageSnapshot } from "@glade/contracts/provider/runtimePayloads";
import { cancelAgentGatewayTurn } from "../../../agentGateway/sessionLease.ts";
import { asRuntimeItemId, nativeProviderRefs, asCanonicalTurnId } from "./messageContent";
import { toolLifecycleEventData } from "./toolPresentation";
import { makeClaudeInteractionSettlement } from "./interactionSettlement";
import { makeClaudeContextUsage } from "./contextUsage";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { makeClaudeAssistantText } from "./assistantText";

export function makeClaudeTurnCompletion(input: {
  readonly settlePendingHumanInteractions: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingHumanInteractions"];
  readonly readClaudeContextUsage: ReturnType<
    typeof makeClaudeContextUsage
  >["readClaudeContextUsage"];
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
  readonly completeAssistantTextBlock: ReturnType<
    typeof makeClaudeAssistantText
  >["completeAssistantTextBlock"];
  readonly updateResumeCursor: ClaudeRuntimeEventsShape["updateResumeCursor"];
}) {
  const {
    settlePendingHumanInteractions,
    readClaudeContextUsage,
    makeEventStamp,
    offerRuntimeEvent,
    completeAssistantTextBlock,
    updateResumeCursor,
  } = input;
  const completeTurn = (
    context: ClaudeSessionContext,
    status: RuntimeTurnState,
    errorMessage?: string,
    result?: SDKResultMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      // A terminal foreground turn cannot retain its root callbacks once the UI can no longer answer
      // them. Agent callbacks remain actionable until their own task has provider-terminal evidence or
      // the session stops; background membership messages may race the callback itself.
      if (context.turnState) {
        yield* settlePendingHumanInteractions(context, {
          type: "foregroundTurn",
          turnId: context.turnState.turnId,
        });
      }

      const turnResultUsage = result
        ? claudeTurnResultUsage(result, context.resultUsageBaseline)
        : undefined;
      if (result) context.resultUsageBaseline = result;
      const liveContextUsage = yield* readClaudeContextUsage(context);
      const resultContextWindow = maxClaudeContextWindowFromModelUsage(result?.modelUsage);
      const liveRawContextWindow = asPositiveFiniteNumber(liveContextUsage?.rawMaxTokens);
      const effectiveContextWindow =
        liveRawContextWindow ??
        resolveEffectiveClaudeContextWindow({
          reportedContextWindow: resultContextWindow,
          lastKnownContextWindow: context.lastKnownContextWindow,
        });
      if (effectiveContextWindow !== undefined) {
        context.lastKnownContextWindow = effectiveContextWindow;
      }
      const liveAutoCompactThreshold = asPositiveFiniteNumber(
        liveContextUsage?.autoCompactThreshold,
      );
      if (liveAutoCompactThreshold !== undefined) {
        context.lastKnownAutoCompactThreshold = liveAutoCompactThreshold;
      }

      const accumulatedSnapshot = normalizeClaudeTokenUsage(
        result?.usage,
        context.lastKnownContextWindow,
      );
      const reportedZeroUsage =
        result?.usage?.input_tokens === 0 &&
        result.usage.output_tokens === 0 &&
        (result.usage.cache_creation_input_tokens ?? 0) === 0 &&
        (result.usage.cache_read_input_tokens ?? 0) === 0;
      const resultProcessedTokens =
        accumulatedSnapshot?.totalProcessedTokens ??
        accumulatedSnapshot?.usedTokens ??
        (reportedZeroUsage ? 0 : undefined);
      if (resultProcessedTokens !== undefined) {
        const reconciledTotal = context.processedTokenResultBaseline + resultProcessedTokens;
        context.processedTokenTotal =
          status === "completed"
            ? reconciledTotal
            : Math.max(context.processedTokenTotal, reconciledTotal);
      }
      const totalProcessedTokens =
        context.processedTokenTotal > 0 ? context.processedTokenTotal : resultProcessedTokens;
      const accountedAccumulatedSnapshot = accumulatedSnapshot
        ? context.processedTokenBaselineKnown && totalProcessedTokens !== undefined
          ? { ...accumulatedSnapshot, totalProcessedTokens }
          : withoutProcessedTokenTotal(accumulatedSnapshot)
        : undefined;
      const liveSnapshot = liveContextUsage
        ? snapshotFromClaudeContextUsage(
            liveContextUsage,
            context.processedTokenBaselineKnown ? totalProcessedTokens : undefined,
          )
        : undefined;
      const lastGoodUsage = liveSnapshot ?? context.lastKnownTokenUsage;
      const maxTokens = context.lastKnownContextWindow;
      if (context.tokenUsageState === "skip-compaction-call") {
        context.tokenUsageState = "awaiting-fresh-assistant";
      }
      const mergedUsageSnapshot: ThreadTokenUsageSnapshot | undefined =
        context.tokenUsageState !== "current"
          ? undefined
          : !context.processedTokenBaselineKnown
            ? lastGoodUsage
            : lastGoodUsage
              ? mergeClaudeTokenUsageSnapshot(
                  lastGoodUsage,
                  accountedAccumulatedSnapshot,
                  maxTokens,
                )
              : undefined;
      if (liveSnapshot) context.lastKnownTokenUsage = liveSnapshot;
      // The context merge preserves context size; accounting has its own final value and must not inherit
      // the merge's monotonic provisional maximum.
      const usageSnapshot = mergedUsageSnapshot
        ? {
            ...withoutProcessedTokenTotal(mergedUsageSnapshot),
            tokenAccountingVersion: 1 as const,
            ...(context.processedTokenBaselineKnown && totalProcessedTokens !== undefined
              ? { totalProcessedTokens }
              : {}),
          }
        : undefined;
      const mainLoopTokens = Math.max(
        0,
        context.processedTokenTotal -
          (result ? context.processedTokenResultBaseline : context.processedTokenTurnBaseline),
      );

      context.processedTokenResultBaseline = context.processedTokenTotal;
      context.requestUsage.settleTurn();

      const turnState = context.turnState;
      if (!turnState) {
        if (usageSnapshot) {
          const usageStamp = yield* makeEventStamp();
          yield* offerRuntimeEvent(context, {
            type: "thread.token-usage.updated",
            eventId: usageStamp.eventId,
            provider: PROVIDER,
            createdAt: usageStamp.createdAt,
            threadId: context.session.threadId,
            payload: {
              usage: usageSnapshot,
            },
            providerRefs: {},
          });
        }

        // Runtime ingestion drops a terminal event it cannot attribute to a turn, which strands the
        // projection in "running". The last turn this session owned is the only turn this result can belong
        // to, because a newer one would still have live turn state.
        const settledTurnId = context.lastTurnId;
        if (settledTurnId === undefined) {
          yield* Effect.logWarning("claude turn result arrived with no attributable turn", {
            threadId: context.session.threadId,
            status,
          });
        }
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "turn.completed",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(settledTurnId !== undefined ? { turnId: settledTurnId } : {}),
          payload: {
            state: status,
            ...(context.nativeSessionState ? { sessionState: context.nativeSessionState } : {}),
            ...(result?.stop_reason !== undefined ? { stopReason: result.stop_reason } : {}),
            ...(result?.usage ? { usage: result.usage } : {}),
            ...(turnResultUsage ? { modelUsage: turnResultUsage.modelUsage } : {}),
            tokenAccountingVersion: 1,
            mainLoopTokens,
            ...(typeof result?.total_cost_usd === "number"
              ? { totalCostUsd: turnResultUsage?.totalCostUsd ?? result.total_cost_usd }
              : {}),
            ...(errorMessage ? { errorMessage } : {}),
          },
          providerRefs: {},
        });
        return;
      }

      if (context.interruptRequestedTurnId !== turnState.turnId) {
        yield* cancelAgentGatewayTurn(context.gatewaySessionLease, turnState.turnId);
      }

      for (const [index, tool] of context.inFlightTools.entries()) {
        const toolStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "item.completed",
          eventId: toolStamp.eventId,
          provider: PROVIDER,
          createdAt: toolStamp.createdAt,
          threadId: context.session.threadId,
          turnId: turnState.turnId,
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            itemType: tool.itemType,
            status: status === "completed" ? "completed" : "failed",
            title: tool.title,
            ...(tool.detail ? { detail: tool.detail } : {}),
            data: toolLifecycleEventData(tool),
          },
          providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/result",
            payload: result ?? { status },
          },
        });
        if (tool.itemType === "file_change") {
          context.turnState = {
            ...turnState,
            sawFileChange: true,
          };
        }
        context.inFlightTools.delete(index);
      }

      context.inFlightTools.clear();

      for (const block of turnState.assistantTextBlockOrder) {
        yield* completeAssistantTextBlock(context, block, {
          force: true,
          rawMethod: "claude/result",
          rawPayload: result ?? { status },
        });
      }

      context.turns.push({
        id: turnState.turnId,
        items: [...turnState.items],
      });

      if (usageSnapshot) {
        const usageStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "thread.token-usage.updated",
          eventId: usageStamp.eventId,
          provider: PROVIDER,
          createdAt: usageStamp.createdAt,
          threadId: context.session.threadId,
          turnId: turnState.turnId,
          payload: {
            usage: usageSnapshot,
          },
          providerRefs: nativeProviderRefs(context),
        });
      }

      if (status === "completed" && turnState.sawFileChange) {
        const diffStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "turn.diff.updated",
          eventId: diffStamp.eventId,
          provider: PROVIDER,
          createdAt: diffStamp.createdAt,
          threadId: context.session.threadId,
          turnId: turnState.turnId,
          payload: {
            unifiedDiff: "",
          },
          providerRefs: nativeProviderRefs(context),
          raw: {
            source: "claude.sdk.message",
            method: "claude/result",
            payload: result ?? { status },
          },
        });
      }

      // A compaction that ended without its boundary must not leave a spinner row.
      if (turnState.compactionInProgress) {
        const compactionStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "item.completed",
          eventId: compactionStamp.eventId,
          provider: PROVIDER,
          createdAt: compactionStamp.createdAt,
          threadId: context.session.threadId,
          turnId: asCanonicalTurnId(turnState.turnId),
          itemId: asRuntimeItemId(`claude-compaction-${turnState.turnId}`),
          payload: {
            itemType: "context_compaction",
            status: "failed",
            title: "Context compaction failed",
          },
          providerRefs: nativeProviderRefs(context),
        });
      }

      const stamp = yield* makeEventStamp();

      if (context.interruptRequestedTurnId === turnState.turnId) {
        context.interruptRequestedTurnId = undefined;
      }
      context.lastInteractionMode = turnState.interactionMode;
      context.turnState = undefined;
      context.session = {
        ...context.session,
        status:
          context.nativeSessionState === "running" || context.nativeSessionState === "waiting"
            ? "running"
            : "ready",
        activeTurnId: undefined,
        updatedAt: stamp.createdAt,
        ...(status === "failed" && errorMessage ? { lastError: errorMessage } : {}),
      };
      yield* updateResumeCursor(context, stamp.createdAt);

      yield* offerRuntimeEvent(context, {
        type: "turn.completed",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        payload: {
          state: status,
          ...(context.nativeSessionState ? { sessionState: context.nativeSessionState } : {}),
          ...(turnState.explicitCompaction
            ? {
                contextCompacted:
                  status === "completed" &&
                  turnState.explicitCompaction.boundaryObserved &&
                  result?.session_id === turnState.explicitCompaction.nativeSessionId,
              }
            : {}),
          ...(result?.stop_reason !== undefined ? { stopReason: result.stop_reason } : {}),
          ...(result?.usage ? { usage: result.usage } : {}),
          ...(turnResultUsage ? { modelUsage: turnResultUsage.modelUsage } : {}),
          tokenAccountingVersion: 1,
          mainLoopTokens,
          ...(typeof result?.total_cost_usd === "number"
            ? { totalCostUsd: turnResultUsage?.totalCostUsd ?? result.total_cost_usd }
            : {}),
          ...(errorMessage ? { errorMessage } : {}),
        },
        providerRefs: nativeProviderRefs(context),
      });
    });
  return { completeTurn };
}
