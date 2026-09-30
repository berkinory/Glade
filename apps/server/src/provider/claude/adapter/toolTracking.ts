import { Effect, Random } from "effect";
import { EventId, TurnId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, ClaudeSubagentRun, ToolInFlight, PROVIDER } from "./sessionTypes";
import { ClaudeRequestUsage } from "../claudeRequestUsage.ts";
import {
  classifyToolItemType,
  toolInputFingerprint,
  summarizeToolRequest,
  titleForTool,
  toolLifecycleEventData,
} from "./toolPresentation";
import { asCanonicalTurnId, asRuntimeItemId, nativeProviderRefs } from "./messageContent";
import { makeClaudeRuntimeEvents } from "./runtimeEvents";
import { makeClaudeTaskPresentation } from "./taskPresentation";

export function makeClaudeToolTracking(input: {
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ReturnType<typeof makeClaudeRuntimeEvents>["offerRuntimeEvent"];
  readonly emitTodoTasksUpdated: ReturnType<
    typeof makeClaudeTaskPresentation
  >["emitTodoTasksUpdated"];
  readonly nowIso: Effect.Effect<string>;
}) {
  const { makeEventStamp, offerRuntimeEvent, emitTodoTasksUpdated, nowIso } = input;
  const ensureSubagentRun = (
    context: ClaudeSessionContext,
    toolUseId: string,
  ): ClaudeSubagentRun => {
    const existing = context.subagentRuns.get(toolUseId);
    if (existing) {
      return existing;
    }
    const run: ClaudeSubagentRun = {
      gatewayParentTurnId: context.turnState?.turnId,
      toolUseId,
      taskId: undefined,
      context: {
        session: context.session,
        startInput: context.startInput,
        ...(context.lifecycleGeneration === undefined
          ? {}
          : { lifecycleGeneration: context.lifecycleGeneration }),
        promptQueue: context.promptQueue,
        query: context.query,
        artifactsEnabled: context.artifactsEnabled,
        processOwner: context.processOwner,
        streamFiber: undefined,
        startedAt: context.startedAt,
        basePermissionMode: context.basePermissionMode,
        spawnPermissionMode: context.spawnPermissionMode,

        firstTurnSpawnModeAuthoritative: false,
        lastInteractionMode: undefined,
        currentApiModelId: undefined,
        resumeSessionId: undefined,
        pendingApprovals: new Map(),
        approvalsAlwaysAllowedForSession: false,
        pendingUserInputs: new Map(),
        turns: [],
        inFlightTools: new Map(),
        trackedTasks: new Map(),
        turnState: undefined,
        lastTurnId: undefined,
        interruptRequestedTurnId: undefined,
        lastKnownContextWindow: context.lastKnownContextWindow,
        currentAutoCompactWindow: context.currentAutoCompactWindow,
        currentAlwaysThinkingEnabled: undefined,
        currentEffort: context.currentEffort,
        currentUltracode: context.currentUltracode,
        currentFastMode: context.currentFastMode,
        lastKnownAutoCompactThreshold: context.lastKnownAutoCompactThreshold,
        // Session-level context usage controls answer for the main conversation only; subagent completion
        // must not poll them.
        contextUsageControlEnabled: false,
        lastKnownTokenUsage: undefined,
        tokenUsageState: "current",
        compactionMessageId: undefined,
        processedTokenTotal: 0,
        processedTokenTurnBaseline: 0,
        processedTokenResultBaseline: 0,
        processedTokenBaselineKnown: true,
        requestUsage: new ClaudeRequestUsage(),
        lastResultUuid: undefined,
        lastAssistantUuid: undefined,
        lastThreadStartedId: undefined,
        rerouteOriginalApiModelId: undefined,
        emittedContextUsageWarnings: new Set(),
        stopped: false,
        warnedUnhandledSdkKinds: context.warnedUnhandledSdkKinds,
        subagentRuns: new Map(),
        pendingSubagentSteers: new Map(),
        pendingSubagentStops: new Set(),
        knownBackgroundTaskIds: new Set(),
        terminalTaskIds: new Set(),
        settledSubagentToolUseIds: new Map(),
        liveWorkflowTaskIds: new Set(),
        knownWorkflowTaskIds: new Set(),
        workflowTaskIdByMemberTaskId: new Map(),
        workflowRuntimePollers: new Map(),
        workflowAgentLabels: new Map(),
        workflowRuntimeStates: new Map(),
        subagentRefs: {
          providerThreadId: toolUseId,
          providerParentThreadId: context.session.threadId,
        },
      },
    };
    context.subagentRuns.set(toolUseId, run);
    return run;
  };

  const openInFlightTool = (
    context: ClaudeSessionContext,
    input: {
      readonly blockIndex: number;
      readonly toolName: string;
      readonly itemId: string;
      readonly toolInput: Record<string, unknown>;
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const itemType = classifyToolItemType(input.toolName);
      const serializedInput = toolInputFingerprint(input.toolInput);
      const inputFingerprint =
        Object.keys(input.toolInput).length > 0 ? serializedInput : undefined;
      const detail = summarizeToolRequest(
        input.toolName,
        input.toolInput,
        serializedInput ?? undefined,
      );

      const tool: ToolInFlight = {
        itemId: input.itemId,
        itemType,
        toolName: input.toolName,
        title: titleForTool(itemType),
        detail,
        input: input.toolInput,
        partialInputJson: "",
        ...(inputFingerprint ? { lastEmittedInputFingerprint: inputFingerprint } : {}),
      };
      context.inFlightTools.set(input.blockIndex, tool);

      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "item.started",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        itemId: asRuntimeItemId(tool.itemId),
        payload: {
          itemType: tool.itemType,
          status: "inProgress",
          title: tool.title,
          ...(tool.detail ? { detail: tool.detail } : {}),
          data: toolLifecycleEventData(tool),
        },
        providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
        raw: {
          source: "claude.sdk.message",
          method: input.rawMethod,
          payload: input.rawPayload,
        },
      });
      if (tool.toolName === "TodoWrite") {
        yield* emitTodoTasksUpdated(context, {
          toolInput: input.toolInput,
          toolUseId: tool.itemId,
          rawMethod: input.rawMethod,
          rawPayload: input.rawPayload,
        });
      }
    });

  const ensureSyntheticTurn = (context: ClaudeSessionContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (context.turnState) {
        return;
      }
      const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
      const startedAt = yield* nowIso;
      context.turnState = {
        turnId,
        startedAt,
        interactionMode: "default",
        synthetic: true,
        items: [],
        assistantTextBlocks: new Map(),
        assistantTextBlockOrder: [],
        capturedProposedPlanKeys: new Set(),
        sawFileChange: false,
        nextSyntheticAssistantBlockIndex: -1,
        assistantMessageBlockBase: 0,
      };
      context.processedTokenTurnBaseline = context.processedTokenTotal;
      context.lastTurnId = turnId;
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        updatedAt: startedAt,
      };
      const turnStartedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "turn.started",
        eventId: turnStartedStamp.eventId,
        provider: PROVIDER,
        createdAt: turnStartedStamp.createdAt,
        threadId: context.session.threadId,
        turnId,
        payload: {},
        providerRefs: {
          ...nativeProviderRefs(context),
          providerTurnId: turnId,
        },
        raw: {
          source: "claude.sdk.message",
          method: "claude/synthetic-turn-start",
          payload: {},
        },
      });
    });

  const emitSubagentSteerDelivered = (
    run: ClaudeSubagentRun,
    message: string,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* ensureSyntheticTurn(run.context);
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(run.context, {
        type: "turn.steered",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: run.context.session.threadId,
        ...(run.context.turnState
          ? { turnId: asCanonicalTurnId(run.context.turnState.turnId) }
          : {}),
        payload: {
          message,
          target: "subagent",
        },
        providerRefs: nativeProviderRefs(run.context),
        raw: {
          source: "claude.sdk.hook",
          method: "hooks/PreToolUse",
          payload: {
            taskId: run.taskId,
            toolUseId: run.toolUseId,
          },
        },
      });
    });
  return { openInFlightTool, ensureSyntheticTurn, ensureSubagentRun, emitSubagentSteerDelivered };
}
