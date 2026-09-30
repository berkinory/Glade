import { updateClaudeNativeHistory } from "../claude/adapter/nativeHistory.ts";
import {
  ClaudeAdapterLiveOptions,
  ClaudeQueryRuntime,
} from "../claude/adapter/adapterConfiguration";
import { Effect, FileSystem, Option, Layer } from "effect";
import { ServerConfig } from "../../server/config.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { AgentGatewayCredentials } from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import type { SDKUserMessage, Options as ClaudeQueryOptions } from "@anthropic-ai/claude-agent-sdk";
import { loadClaudeAgentSdk } from "../claude/claudeAgentSdk.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER } from "../claude/adapter/sessionTypes";
import { ClaudeSessionRegistry } from "../Services/ClaudeSessionRegistry.ts";
import { ClaudeSessionRegistryLive } from "./ClaudeSessionRegistry.ts";
import { ClaudeSessionAccess } from "../Services/ClaudeSessionAccess.ts";
import { makeClaudeSessionAccessLive } from "./ClaudeSessionAccess.ts";
import { ClaudeRuntimeEvents } from "../Services/ClaudeRuntimeEvents.ts";
import { makeClaudeRuntimeEventsLive } from "./ClaudeRuntimeEvents.ts";
import { makeKeyedLock } from "../core/keyedLock.ts";
import { buildClaudeProcessEnv } from "../claude/claudeProcessEnv.ts";
import { ClaudeProcessOwnership } from "../Services/ClaudeProcessOwnership.ts";
import { makeClaudeProcessOwnershipLive } from "./ClaudeProcessOwnership.ts";
import { makeClaudeAssistantText } from "../claude/adapter/assistantText";
import { makeClaudeContextUsage } from "../claude/adapter/contextUsage";
import { makeClaudeTaskPresentation } from "../claude/adapter/taskPresentation";
import { makeClaudeInteractionSettlement } from "../claude/adapter/interactionSettlement";
import { makeClaudeTurnCompletion } from "../claude/adapter/turnCompletion";
import { makeClaudeWorkflowRuntime } from "../claude/adapter/workflowRuntime";
import { makeClaudeToolTracking } from "../claude/adapter/toolTracking";
import { type ClaudeAdapterShape, ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { settleConcurrentTeardowns } from "../core/settleConcurrentTeardowns.ts";
import { makeClaudeSessionTeardown } from "../claude/adapter/sessionTeardown";
import { makeClaudeContentMessages } from "../claude/adapter/contentMessages";
import { makeClaudeSystemMessages } from "../claude/adapter/systemMessages";
import { makeClaudeSdkStream } from "../claude/adapter/sdkStream";
import { makeClaudeTurnDispatch } from "../claude/adapter/turnDispatch";
import { makeClaudeSessionInteractions } from "../claude/adapter/sessionInteractions";
import { makeClaudeSessionBranching } from "../claude/adapter/sessionBranching";
import { makeClaudeDiscovery } from "../claude/adapter/discovery";
import { makeClaudeSessionStartup } from "../claude/adapter/sessionStartup";
import { makeClaudeManagement } from "../claude/adapter/management.ts";

function makeClaudeAdapter(options?: ClaudeAdapterLiveOptions) {
  return Effect.gen(function* () {
    // SDK hooks and stream observers enter from Promise callbacks; retain the Layer services and tracing.
    const sdkServices = yield* Effect.services<never>();
    const runSdkPromise = Effect.runPromiseWith(sdkServices);
    const runSdkFork = Effect.runForkWith(sdkServices);
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;
    const serverSettings = yield* ServerSettingsService;
    const getDisabledSkillNames = serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.skills.disabled),
    );

    const agentGatewayCredentials = Option.getOrUndefined(
      yield* Effect.serviceOption(AgentGatewayCredentials),
    );
    const createQuery = async (input: {
      readonly prompt: AsyncIterable<SDKUserMessage>;
      readonly options: ClaudeQueryOptions;
    }): Promise<ClaudeQueryRuntime> => {
      const override = options?.createQuery;
      if (override) {
        return override(input);
      }
      const { query } = await loadClaudeAgentSdk();
      return query({ prompt: input.prompt, options: input.options }) as ClaudeQueryRuntime;
    };
    const forkNativeSession = async (
      sessionId: string,
      forkOptions?: { readonly dir?: string; readonly upToMessageId?: string },
    ): Promise<{ sessionId: string }> => {
      const override = options?.forkNativeSession;
      if (override) {
        return override(sessionId, forkOptions);
      }
      const { forkSession } = await loadClaudeAgentSdk();
      return forkSession(sessionId, forkOptions);
    };
    const sessions = yield* ClaudeSessionRegistry;
    const processOwnership = yield* ClaudeProcessOwnership;
    const sessionAccess = yield* ClaudeSessionAccess;
    const runtimeEvents = yield* ClaudeRuntimeEvents;
    const sessionLifecycleLock = makeKeyedLock<ThreadId>();

    const { nowIso, makeEventStamp, streamEvents } = runtimeEvents;
    const withSessionLifecycleLock = sessionLifecycleLock.withLock;
    const resolveClaudeSdkEnv = Effect.sync(() =>
      buildClaudeProcessEnv({ homeDir: serverConfig.homeDir }),
    );

    const stopSession: ClaudeAdapterShape["stopSession"] = (threadId) =>
      withSessionLifecycleLock(
        threadId,
        Effect.gen(function* () {
          const failedOwner = processOwnership.failedStartupOwner(threadId);
          if (failedOwner) yield* teardownFailedStartupProcess(threadId, failedOwner);
          const context = sessions.get(threadId);
          if (!context) {
            return;
          }
          yield* stopSessionInternal(context, {
            emitExitEvent: true,
          });
        }),
      );

    const listSessions: ClaudeAdapterShape["listSessions"] = () =>
      Effect.sync(() => sessions.list().map(({ session }) => ({ ...session })));

    const hasSession: ClaudeAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      });

    const stopAll: ClaudeAdapterShape["stopAll"] = () =>
      settleConcurrentTeardowns(
        [
          settleConcurrentTeardowns(sessions.list(), (context) =>
            stopSessionInternal(context, { emitExitEvent: true }),
          ),
          settleConcurrentTeardowns(processOwnership.failedStartupOwners(), ([threadId, owner]) =>
            teardownFailedStartupProcess(threadId, owner),
          ),
          teardownFailedDiscoveryProcesses(),
        ],
        (teardown) => teardown,
      );

    const {
      teardownClaudeProcess,
      teardownFailedStartupProcess,
      bindClaudeProcessOwner,
      teardownFailedDiscoveryProcesses,
      teardownDiscoveryProcess,
    } = processOwnership;
    const {
      offerRuntimeEvent,
      emitRuntimeWarning,
      updateResumeCursor,
      emitRuntimeError,
      emitCompactionProgress,
      warnUnhandledSdkKind,
      logNativeSdkMessage,
      ensureThreadId,
      snapshotThread,
    } = runtimeEvents;
    const {
      completeAssistantTextBlock,
      ensureAssistantTextBlock,
      backfillAssistantTextBlocksFromSnapshot,
    } = makeClaudeAssistantText({ makeEventStamp, offerRuntimeEvent });
    const { readClaudeContextUsage, maybeEmitContextUsageWarning } = makeClaudeContextUsage({
      emitRuntimeWarning,
    });
    const { emitTodoTasksUpdated, emitTrackedTasksUpdated, emitProposedPlanCompleted } =
      makeClaudeTaskPresentation({ makeEventStamp, offerRuntimeEvent });
    const {
      settlePendingHumanInteractions,
      settlePendingHumanInteractionsForAgent,
      settlePendingUserInput,
      settlePendingApproval,
    } = makeClaudeInteractionSettlement({ makeEventStamp, offerRuntimeEvent });
    const { completeTurn } = makeClaudeTurnCompletion({
      settlePendingHumanInteractions,
      readClaudeContextUsage,
      makeEventStamp,
      offerRuntimeEvent,
      completeAssistantTextBlock,
      updateResumeCursor,
    });
    const { startWorkflowRuntimePoller, stopWorkflowRuntimePoller, resolveWorkflowScriptText } =
      makeClaudeWorkflowRuntime({
        fileSystem,
        options,
        makeEventStamp,
        offerRuntimeEvent,
        runSdkFork,
      });
    const { openInFlightTool, ensureSyntheticTurn, ensureSubagentRun, emitSubagentSteerDelivered } =
      makeClaudeToolTracking({ makeEventStamp, offerRuntimeEvent, emitTodoTasksUpdated, nowIso });
    const {
      resolveClaudeStartPreflight,
      assertSessionReplaceable,
      requireSession,
      resolveNativeCommandNames,
    } = sessionAccess;
    const { stopSessionInternal } = makeClaudeSessionTeardown({
      settlePendingHumanInteractions,
      completeTurn,
      stopWorkflowRuntimePoller,
      emitRuntimeError,
      teardownClaudeProcess,
      nowIso,
      makeEventStamp,
      offerRuntimeEvent,
      sessions,
    });
    const { handleStreamEvent, handleUserMessage, handleAssistantMessage } =
      makeClaudeContentMessages({
        ensureAssistantTextBlock,
        makeEventStamp,
        offerRuntimeEvent,
        emitTodoTasksUpdated,
        openInFlightTool,
        completeAssistantTextBlock,
        updateResumeCursor,
        emitTrackedTasksUpdated,
        startWorkflowRuntimePoller,
        ensureSyntheticTurn,
        emitProposedPlanCompleted,
        backfillAssistantTextBlocksFromSnapshot,
        maybeEmitContextUsageWarning,
      });
    const { handleSdkTelemetryMessage, handleSystemMessage } = makeClaudeSystemMessages({
      settlePendingHumanInteractionsForAgent,
      stopWorkflowRuntimePoller,
      makeEventStamp,
      offerRuntimeEvent,
      completeTurn,
      updateResumeCursor,
      emitRuntimeWarning,
      emitCompactionProgress,
      ensureSubagentRun,
      emitRuntimeError,
      resolveWorkflowScriptText,
      fileSystem,
      warnUnhandledSdkKind,
    });
    const { runSdkStream, handleStreamExit } = makeClaudeSdkStream({
      emitRuntimeError,
      completeTurn,
      stopSessionInternal,
      logNativeSdkMessage,
      ensureSubagentRun,
      ensureSyntheticTurn,
      handleStreamEvent,
      handleUserMessage,
      handleAssistantMessage,
      handleSdkTelemetryMessage,
      ensureThreadId,
      updateResumeCursor,
      handleSystemMessage,
      warnUnhandledSdkKind,
      emitTrackedTasksUpdated,
    });
    const {
      verifyClaudeAutoModelSupport,
      observeSessionModels,
      getComposerCapabilities,
      listCommands,
      listSkills,
      listModels,
      listAgents,
    } = makeClaudeDiscovery({
      runSdkPromise,
      teardownFailedDiscoveryProcesses,
      createQuery,
      bindClaudeProcessOwner,
      teardownDiscoveryProcess,
      sessions,
      resolveClaudeSdkEnv,
      serverConfig,
    });
    const { sendTurn, steerTurn } = makeClaudeTurnDispatch({
      requireSession,
      sessions,
      completeTurn,
      updateResumeCursor,
      verifyClaudeAutoModelSupport,
      makeEventStamp,
      offerRuntimeEvent,
      nowIso,
      emitCompactionProgress,
      emitTrackedTasksUpdated,
      fileSystem,
      serverConfig,
      getDisabledSkillNames,
      resolveNativeCommandNames,
    });
    const {
      interruptTurn,
      stopTask,
      backgroundTask,
      steerSubagent,
      readThread,
      respondToRequest,
      respondToUserInput,
    } = makeClaudeSessionInteractions({
      requireSession,
      serverConfig,
      snapshotThread,
      settlePendingApproval,
      settlePendingUserInput,
    });
    const { startSessionUnlocked, startSession } = makeClaudeSessionStartup({
      resolveClaudeStartPreflight,
      nowIso,
      processOwnership,
      sessions,
      assertSessionReplaceable,
      stopSessionInternal,
      agentGatewayCredentials,
      serverConfig,
      getDisabledSkillNames,
      runSdkFork,
      makeEventStamp,
      offerRuntimeEvent,
      settlePendingUserInput,
      runSdkPromise,
      emitSubagentSteerDelivered,
      emitProposedPlanCompleted,
      settlePendingApproval,
      bindClaudeProcessOwner,
      createQuery,
      verifyClaudeAutoModelSupport,
      observeSessionModels,
      runSdkStream,
      handleStreamExit,
      withSessionLifecycleLock,
    });
    const { prepareSessionReplacement, rollbackThread, forkThread } = makeClaudeSessionBranching({
      withSessionLifecycleLock,
      sessions,
      resolveClaudeStartPreflight,
      assertSessionReplaceable,
      stopSessionInternal,
      startSessionUnlocked,
      requireSession,
      options,
      forkNativeSession,
      snapshotThread,
    });
    const management = makeClaudeManagement({ sessions, serverConfig });

    yield* Effect.addFinalizer(() =>
      settleConcurrentTeardowns(
        [
          settleConcurrentTeardowns(sessions.list(), (context) =>
            stopSessionInternal(context, { emitExitEvent: false }),
          ),
          settleConcurrentTeardowns(processOwnership.failedStartupOwners(), ([threadId, owner]) =>
            teardownFailedStartupProcess(threadId, owner),
          ),
          teardownFailedDiscoveryProcesses(),
        ],
        (teardown) => teardown,
      ).pipe(Effect.ignore),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        supportsSkillMentions: true,
        supportsSkillDiscovery: true,
        supportsNativeSlashCommandDiscovery: true,
        supportsPluginMentions: false,
        supportsPluginDiscovery: false,
        supportsRuntimeModelList: true,
        supportsTurnSteering: true,
        supportsLiveTurnDiffPatch: false,
      },
      startSession,
      prepareSessionReplacement,
      sendTurn,
      steerTurn,
      interruptTurn,
      stopTask,
      backgroundTask,
      steerSubagent,
      readThread,
      rollbackThread,
      forkThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      updateNativeHistory: updateClaudeNativeHistory,
      listSessions,
      hasSession,
      stopAll,
      getComposerCapabilities,
      listCommands,
      listSkills,
      listModels,
      listAgents,
      ...management,
      streamEvents,
    } satisfies ClaudeAdapterShape;
  });
}

export function makeClaudeAdapterLive(options?: ClaudeAdapterLiveOptions) {
  const registry = ClaudeSessionRegistryLive;
  const dependencies = Layer.mergeAll(
    registry,
    makeClaudeProcessOwnershipLive(options),
    makeClaudeSessionAccessLive(options).pipe(Layer.provide(registry)),
    makeClaudeRuntimeEventsLive(options).pipe(Layer.provide(registry)),
  );
  return Layer.effect(ClaudeAdapter, makeClaudeAdapter(options)).pipe(
    Layer.provide(Layer.fresh(dependencies)),
  );
}
