import {
  ClaudeAdapterLiveOptions,
  ClaudeQueryRuntime,
  ClaudeProcessOwner,
} from "../claude/adapter/adapterConfiguration";
import { Effect, FileSystem, Option, Queue, DateTime, Clock, Random, Stream, Layer } from "effect";
import { ServerConfig } from "../../server/config.ts";
import { AgentGatewayCredentials } from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import { makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import type { SDKUserMessage, Options as ClaudeQueryOptions } from "@anthropic-ai/claude-agent-sdk";
import { loadClaudeAgentSdk } from "../claude/claudeAgentSdk.ts";
import {
  spawnOwnedClaudeCodeProcess,
  readInstalledClaudeCliVersion,
} from "../claude/adapter/sdkProcessRuntime";
import { teardownProviderProcessTree } from "../../platform/supervisedProcessTeardown";
import { ThreadId, EventId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER } from "../claude/adapter/sessionTypes";
import { makeKeyedLock } from "../core/keyedLock.ts";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY } from "../Services/ProviderAdapter.ts";
import { buildClaudeProcessEnv } from "../claude/claudeProcessEnv.ts";
import { makeClaudeProcessOwnership } from "../claude/adapter/processOwnership";
import { makeClaudeRuntimeEvents } from "../claude/adapter/runtimeEvents";
import { makeClaudeAssistantText } from "../claude/adapter/assistantText";
import { makeClaudeContextUsage } from "../claude/adapter/contextUsage";
import { makeClaudeTaskPresentation } from "../claude/adapter/taskPresentation";
import { makeClaudeInteractionSettlement } from "../claude/adapter/interactionSettlement";
import { makeClaudeTurnCompletion } from "../claude/adapter/turnCompletion";
import { makeClaudeWorkflowRuntime } from "../claude/adapter/workflowRuntime";
import { makeClaudeToolTracking } from "../claude/adapter/toolTracking";
import { type ClaudeAdapterShape, ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { settleConcurrentTeardowns } from "../core/settleConcurrentTeardowns.ts";
import { makeClaudeSessionAccess } from "../claude/adapter/sessionAccess";
import { makeClaudeSessionTeardown } from "../claude/adapter/sessionTeardown";
import { makeClaudeContentMessages } from "../claude/adapter/contentMessages";
import { makeClaudeSystemMessages } from "../claude/adapter/systemMessages";
import { makeClaudeSdkStream } from "../claude/adapter/sdkStream";
import { makeClaudeTurnDispatch } from "../claude/adapter/turnDispatch";
import { makeClaudeSessionInteractions } from "../claude/adapter/sessionInteractions";
import { makeClaudeSessionBranching } from "../claude/adapter/sessionBranching";
import { makeClaudeDiscovery } from "../claude/adapter/discovery";
import { makeClaudeSessionStartup } from "../claude/adapter/sessionStartup";

function makeClaudeAdapter(options?: ClaudeAdapterLiveOptions) {
  return Effect.gen(function* () {
    // SDK hooks and stream observers enter from Promise callbacks; retain the Layer services and tracing.
    const sdkServices = yield* Effect.services<never>();
    const runSdkPromise = Effect.runPromiseWith(sdkServices);
    const runSdkFork = Effect.runForkWith(sdkServices);
    const runSdkSync = Effect.runSyncWith(sdkServices);
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;

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
    const spawnClaudeProcess = options?.spawnClaudeCodeProcess ?? spawnOwnedClaudeCodeProcess;
    const teardownProcessTree = options?.teardownProcessTree ?? teardownProviderProcessTree;
    const readClaudeCliVersion = options?.readClaudeCliVersion ?? readInstalledClaudeCliVersion;

    const sessions = new Map<ThreadId, ClaudeSessionContext>();
    const failedStartupProcessOwners = new Map<ThreadId, ClaudeProcessOwner>();
    const failedDiscoveryProcessOwners = new Set<ClaudeProcessOwner>();
    const sessionLifecycleLock = makeKeyedLock<ThreadId>();
    const runtimeEventQueue = yield* Queue.bounded<ProviderRuntimeEvent>(
      PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
    );

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const cacheClock = yield* Clock.Clock;
    const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });
    const withSessionLifecycleLock = sessionLifecycleLock.withLock;
    const resolveClaudeSdkEnv = Effect.sync(() =>
      buildClaudeProcessEnv({ homeDir: serverConfig.homeDir }),
    );

    const stopSession: ClaudeAdapterShape["stopSession"] = (threadId) =>
      withSessionLifecycleLock(
        threadId,
        Effect.gen(function* () {
          const failedOwner = failedStartupProcessOwners.get(threadId);
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
      Effect.sync(() => Array.from(sessions.values(), ({ session }) => ({ ...session })));

    const hasSession: ClaudeAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      });

    const stopAll: ClaudeAdapterShape["stopAll"] = () =>
      settleConcurrentTeardowns(
        [
          settleConcurrentTeardowns([...sessions.values()], (context) =>
            stopSessionInternal(context, { emitExitEvent: true }),
          ),
          settleConcurrentTeardowns([...failedStartupProcessOwners], ([threadId, owner]) =>
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
    } = makeClaudeProcessOwnership({
      spawnClaudeProcess,
      teardownProcessTree,
      failedStartupProcessOwners,
      failedDiscoveryProcessOwners,
    });
    const {
      offerRuntimeEvent,
      emitRuntimeWarning,
      updateResumeCursor,
      emitRuntimeError,
      emitCompactionProgress,
      warnUnhandledSdkKind,
      logNativeSdkMessage,
      ensureThreadId,
      emitClaudeCacheObservation,
      snapshotThread,
    } = makeClaudeRuntimeEvents({
      runtimeEventQueue,
      nativeEventLogger,
      nowIso,
      makeEventStamp,
      sessions,
    });
    const {
      completeAssistantTextBlock,
      ensureAssistantTextBlock,
      backfillAssistantTextBlocksFromSnapshot,
    } = makeClaudeAssistantText({ makeEventStamp, offerRuntimeEvent });
    const { readClaudeContextUsage, maybeEmitContextUsageWarning } = makeClaudeContextUsage({
      emitRuntimeWarning,
    });
    const {
      emitTodoTasksUpdated,
      emitTrackedTasksUpdated,
      emitProposedPlanCompleted,
      emitTaskUsageSnapshot,
    } = makeClaudeTaskPresentation({ makeEventStamp, offerRuntimeEvent });
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
    } = makeClaudeSessionAccess({ sessions, resolveClaudeSdkEnv, readClaudeCliVersion });
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
        nowIso,
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
      emitTaskUsageSnapshot,
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
      observeSessionAgents,
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
    const { startClaudeCompaction, sendTurn, steerTurn } = makeClaudeTurnDispatch({
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
      resolveNativeCommandNames,
    });
    const {
      getClaudeCacheObservation,
      interruptTurn,
      stopTask,
      backgroundTask,
      steerSubagent,
      readThread,
      respondToRequest,
      respondToUserInput,
    } = makeClaudeSessionInteractions({
      requireSession,
      readClaudeContextUsage,
      sessions,
      nowIso,
      emitClaudeCacheObservation,
      serverConfig,
      snapshotThread,
      settlePendingApproval,
      settlePendingUserInput,
    });
    const { startSessionUnlocked, startSession } = makeClaudeSessionStartup({
      resolveClaudeStartPreflight,
      nowIso,
      failedStartupProcessOwners,
      teardownFailedStartupProcess,
      sessions,
      assertSessionReplaceable,
      stopSessionInternal,
      agentGatewayCredentials,
      cacheClock,
      runSdkSync,
      runSdkFork,
      emitClaudeCacheObservation,
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
      observeSessionAgents,
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

    yield* Effect.addFinalizer(() =>
      settleConcurrentTeardowns(
        [
          settleConcurrentTeardowns([...sessions.values()], (context) =>
            stopSessionInternal(context, { emitExitEvent: false }),
          ),
          settleConcurrentTeardowns([...failedStartupProcessOwners], ([threadId, owner]) =>
            teardownFailedStartupProcess(threadId, owner),
          ),
          teardownFailedDiscoveryProcesses(),
        ],
        (teardown) => teardown,
      ).pipe(Effect.ignore, Effect.andThen(Queue.shutdown(runtimeEventQueue))),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        supportsSkillMentions: false,
        supportsSkillDiscovery: false,
        supportsNativeSlashCommandDiscovery: true,
        supportsPluginMentions: false,
        supportsPluginDiscovery: false,
        supportsRuntimeModelList: true,
        supportsTurnSteering: true,
        supportsLiveTurnDiffPatch: false,
      },
      startSession,
      prepareSessionReplacement,
      getClaudeCacheObservation,
      startClaudeCompaction,
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
      listSessions,
      hasSession,
      stopAll,
      getComposerCapabilities,
      listCommands,
      listSkills,
      listModels,
      listAgents,
      streamEvents: Stream.fromQueue(runtimeEventQueue),
    } satisfies ClaudeAdapterShape;
  });
}

export function makeClaudeAdapterLive(options?: ClaudeAdapterLiveOptions) {
  return Layer.effect(ClaudeAdapter, makeClaudeAdapter(options));
}
