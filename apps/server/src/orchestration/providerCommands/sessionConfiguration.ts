import type { ServiceMap } from "effect";
import {
  type ProviderStartOptions,
  type ModelSelection,
  type RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";
import { ProviderContextLifecycleActivityRecord } from "./contextLifecycle";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { makeProviderProjectionAccess } from "./projectionAccess";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { makeProviderThreadProjection } from "./threadProjection";
import { Option, Effect, Schema } from "effect";
import { AgentGatewaySessionRegistry } from "../../agentGateway/Services/AgentGatewaySessionRegistry";
import { ComputerService } from "../../computer/Services/ComputerService";
import { ThreadId, ProviderKind } from "@glade/contracts/core/baseSchemas";
import {
  ProviderServiceError,
  ProviderAdapterValidationError,
} from "../../provider/core/Errors.ts";
import { providerDisabledSettingsMessage } from "../../provider/core/enabledProviderAdapter.ts";
import { providerStartOptionsFromServerSettings } from "../../settings/settingsPatches";
import { resolveThreadWorkspaceState } from "@glade/shared/threads/threadEnvironment";
import { type ProviderSession } from "@glade/contracts/provider/provider";
import { providerWorkspaceChanged } from "../projectRelocationPaths.ts";
import { claudeSelectionRequiresRestart } from "@glade/shared/provider/model";
import { BlockedGoalContinuation, PendingInterruptEscalation } from "./runtimeState";
import { makeProviderContextBootstrap } from "./contextBootstrap";

export function makeProviderSessionConfiguration(input: {
  readonly editResendTurnStartKeys: Set<string>;
  readonly threadProviderOptions: Map<string, ProviderStartOptions>;
  readonly threadSessionModelSelections: Map<string, ModelSelection>;
  readonly threadSessionComputerControl: Map<string, boolean>;
  readonly quarantinedThreads: Set<string>;
  readonly blockedGoalContinuations: Map<string, BlockedGoalContinuation>;
  readonly queuedGoalContinuationRetries: Set<string>;
  readonly suppressContextBootstrapOnNextStartThreadIds: Set<string>;
  readonly clearPendingContextBootstraps: ReturnType<
    typeof makeProviderContextBootstrap
  >["clearPendingContextBootstraps"];
  readonly pendingInterruptEscalations: Map<string, PendingInterruptEscalation>;
  readonly pendingProviderContextLifecycleActivities: Map<
    string,
    ProviderContextLifecycleActivityRecord
  >;
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
  readonly resolveThread: ReturnType<typeof makeProviderProjectionAccess>["resolveThread"];
  readonly serverSettings: ServiceMap.Service.Shape<typeof ServerSettingsService>;
  readonly resolveProjectedThreadWorkspaceCwd: ReturnType<
    typeof makeProviderProjectionAccess
  >["resolveProjectedThreadWorkspaceCwd"];
  readonly setThreadSession: ReturnType<typeof makeProviderThreadProjection>["setThreadSession"];
  readonly gatewaySessions: Option.Option<
    ServiceMap.Service.Shape<typeof AgentGatewaySessionRegistry>
  >;
  readonly hasLiveProviderTurn: ReturnType<
    typeof makeProviderProjectionAccess
  >["hasLiveProviderTurn"];
  readonly computerService: Option.Option<ServiceMap.Service.Shape<typeof ComputerService>>;
  readonly freshSessionContextBootstrapThreadIds: Set<string>;
}) {
  const {
    editResendTurnStartKeys,
    threadProviderOptions,
    threadSessionModelSelections,
    threadSessionComputerControl,
    quarantinedThreads,
    blockedGoalContinuations,
    queuedGoalContinuationRetries,
    suppressContextBootstrapOnNextStartThreadIds,
    clearPendingContextBootstraps,
    pendingInterruptEscalations,
    pendingProviderContextLifecycleActivities,
    providerService,
    resolveThread,
    serverSettings,
    resolveProjectedThreadWorkspaceCwd,
    setThreadSession,
    gatewaySessions,
    hasLiveProviderTurn,
    computerService,
    freshSessionContextBootstrapThreadIds,
  } = input;
  const editResendTurnStartKey = (threadId: ThreadId, messageId: string) =>
    `${threadId}:${messageId}`;

  const clearEditResendTurnStartKeysForThread = (threadId: ThreadId) =>
    Effect.sync(() => {
      const prefix = `${threadId}:`;
      for (const key of editResendTurnStartKeys) {
        if (key.startsWith(prefix)) {
          editResendTurnStartKeys.delete(key);
        }
      }
    });

  const clearThreadRuntimeCaches = (threadId: ThreadId) =>
    Effect.sync(() => {
      threadProviderOptions.delete(threadId);
      threadSessionModelSelections.delete(threadId);
      threadSessionComputerControl.delete(threadId);
      const editResendPrefix = `${threadId}:`;
      for (const key of editResendTurnStartKeys) {
        if (key.startsWith(editResendPrefix)) {
          editResendTurnStartKeys.delete(key);
        }
      }
      quarantinedThreads.delete(threadId);
      blockedGoalContinuations.delete(threadId);
      queuedGoalContinuationRetries.delete(threadId);

      suppressContextBootstrapOnNextStartThreadIds.delete(threadId);
      clearPendingContextBootstraps(threadId);
      pendingInterruptEscalations.delete(threadId);
      const lifecyclePrefix = `${threadId}:`;
      for (const activityKey of pendingProviderContextLifecycleActivities.keys()) {
        if (activityKey.startsWith(lifecyclePrefix)) {
          pendingProviderContextLifecycleActivities.delete(activityKey);
        }
      }
    });

  const clearStaleProviderResumeState = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly cause: ProviderServiceError;
    readonly preserveActiveRuntime?: boolean;
  }) {
    if (providerService.clearSessionResumeCursor) {
      yield* providerService.clearSessionResumeCursor({
        threadId: input.threadId,
        ...(input.preserveActiveRuntime === true ? { preserveActiveRuntime: true } : {}),
      });
    } else if (input.preserveActiveRuntime !== true) {
      yield* providerService.stopSession({ threadId: input.threadId });
    }
    yield* Effect.logWarning("provider command reactor cleared stale provider resume state", {
      threadId: input.threadId,
      cause: input.cause.message,
    });
  });

  const ensureSessionForThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection;
      readonly providerOptions?: ProviderStartOptions;
      readonly enableComputerControl?: boolean;
      readonly runtimeMode?: RuntimeMode;
      readonly registerPriorTranscriptBootstrapOnFreshStart?: boolean;
    },
  ) {
    const thread = yield* resolveThread(threadId);
    if (!thread) {
      return yield* Effect.die(
        new Error(`Thread '${threadId}' was not found in projection state.`),
      );
    }
    const shouldRegisterContextBootstrap =
      !suppressContextBootstrapOnNextStartThreadIds.has(threadId);

    const desiredRuntimeMode = options?.runtimeMode ?? thread.runtimeMode;
    const currentProvider: ProviderKind | undefined = Schema.is(ProviderKind)(
      thread.session?.providerName,
    )
      ? thread.session.providerName
      : undefined;
    const requestedModelSelection = options?.modelSelection;
    const resolveActiveSession = (threadId: ThreadId) =>
      providerService
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));

    const activeSession =
      currentProvider !== undefined &&
      thread.latestTurn === null &&
      requestedModelSelection !== undefined &&
      requestedModelSelection.provider !== currentProvider
        ? yield* resolveActiveSession(threadId)
        : undefined;

    const establishedProvider =
      currentProvider !== undefined && (activeSession !== undefined || thread.latestTurn !== null)
        ? currentProvider
        : undefined;
    if (
      establishedProvider !== undefined &&
      requestedModelSelection !== undefined &&
      requestedModelSelection.provider !== establishedProvider
    ) {
      return yield* new ProviderAdapterValidationError({
        provider: establishedProvider,
        operation: "thread.turn.start",
        issue: `Thread '${threadId}' is bound to provider '${establishedProvider}' and cannot switch to '${requestedModelSelection.provider}'.`,
      });
    }
    const preferredProvider: ProviderKind =
      establishedProvider ??
      requestedModelSelection?.provider ??
      currentProvider ??
      thread.modelSelection.provider;
    const desiredModelSelection = requestedModelSelection ?? thread.modelSelection;
    const settings = yield* serverSettings.getSettings;
    if (!settings.providers[preferredProvider].enabled) {
      return yield* new ProviderAdapterValidationError({
        provider: preferredProvider,
        operation: "thread.turn.start",
        issue: `${providerDisabledSettingsMessage(preferredProvider)} Re-enable it to continue this thread.`,
      });
    }
    const resolvedProviderOptions = providerStartOptionsFromServerSettings(settings);
    const effectiveCwd = yield* resolveProjectedThreadWorkspaceCwd(thread);
    const workspaceState = resolveThreadWorkspaceState({
      envMode: thread.envMode,
      worktreePath: thread.worktreePath,
    });
    if (workspaceState === "worktree-pending") {
      return yield* new ProviderAdapterValidationError({
        provider: preferredProvider,
        operation: "thread.turn.start",
        issue: `Thread '${threadId}' targets a worktree that has not been created yet.`,
      });
    }
    const providerSessionOptions = {
      threadId,
      ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
      modelSelection: desiredModelSelection,
      providerOptions: resolvedProviderOptions,
      ...(options?.enableComputerControl !== undefined
        ? { enableComputerControl: options.enableComputerControl }
        : {}),
      runtimeMode: desiredRuntimeMode,
    };

    const providerSessionStartInput = (resumeCursor?: unknown) => ({
      ...providerSessionOptions,
      ...(preferredProvider ? { provider: preferredProvider } : {}),
      ...(resumeCursor !== undefined ? { resumeCursor } : {}),
    });

    const startProviderSessionWithOutcome = (
      resumeCursor?: unknown,
      registerPriorTranscriptBootstrapOnFreshStart = false,
    ) => {
      const startInput = providerSessionStartInput(resumeCursor);
      return providerService.startSessionWithOutcome
        ? providerService.startSessionWithOutcome(threadId, startInput, {
            registerPriorTranscriptBootstrapOnFreshStart,
          })
        : providerService.startSession(threadId, startInput).pipe(
            Effect.map((session) => ({
              session,
              nativeResumeAttempted: resumeCursor !== undefined && resumeCursor !== null,
              nativeResumeSucceeded: resumeCursor !== undefined && resumeCursor !== null,
              priorTranscriptBootstrapPending: registerPriorTranscriptBootstrapOnFreshStart,
            })),
          );
    };

    const bindSessionToThread = (session: ProviderSession) =>
      setThreadSession({
        threadId,
        session: {
          threadId,
          status:
            session.status === "connecting"
              ? "starting"
              : session.status === "closed"
                ? "stopped"
                : session.status,
          providerName: session.provider,
          runtimeMode: desiredRuntimeMode,

          activeTurnId: null,
          lastError: session.lastError ?? null,
          updatedAt: session.updatedAt,
        },
        createdAt,
      });

    const activeSessionBeforeEnsure = yield* resolveActiveSession(threadId);
    const workspaceChanged =
      activeSessionBeforeEnsure !== undefined &&
      providerWorkspaceChanged(activeSessionBeforeEnsure.cwd, effectiveCwd);

    if (
      workspaceChanged &&
      providerService.hasLiveRuntimeTasks &&
      (yield* providerService.hasLiveRuntimeTasks({ threadId }))
    ) {
      return yield* new ProviderAdapterValidationError({
        provider: preferredProvider,
        operation: "thread.turn.start",
        issue:
          "Finish or stop this thread's background tasks before resuming in the new project path.",
      });
    }
    const reusableSession =
      thread.session && thread.session.status !== "stopped" ? activeSessionBeforeEnsure : undefined;
    if (reusableSession) {
      const existingSessionThreadId = thread.id;
      const runtimeModeChanged = desiredRuntimeMode !== thread.session?.runtimeMode;
      const providerChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.provider !== currentProvider;
      const modelChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.model !== activeSessionBeforeEnsure?.model;
      const previousModelSelection = threadSessionModelSelections.get(threadId);
      // When the dispatch cache has no entry (the session was started by a turn without a selection),
      // compare against the projected thread selection the session was actually spawned from so
      // spawn-fixed changes still restart.
      const shouldRestartForModelSelectionChange =
        currentProvider === "claudeAgent"
          ? claudeSelectionRequiresRestart(
              previousModelSelection ?? thread.modelSelection,
              desiredModelSelection,
            )
          : false;
      const requestedComputerControl = options?.enableComputerControl;

      const previousComputerControl =
        Option.isSome(gatewaySessions) && gatewaySessions.value.computerControlProvisioned
          ? gatewaySessions.value.computerControlProvisioned(threadId, reusableSession.provider)
          : (threadSessionComputerControl.get(threadId) ?? false);
      const computerControlChanged =
        requestedComputerControl !== undefined &&
        requestedComputerControl !== previousComputerControl;

      if (
        !runtimeModeChanged &&
        !providerChanged &&
        !workspaceChanged &&
        !shouldRestartForModelSelectionChange &&
        !computerControlChanged
      ) {
        return {
          activeSessionBeforeEnsure,
          activeSession: reusableSession,
          nativeResumeSucceeded: false,
          nativeResumeFailed: false,
          nativeSessionRestarted: false,
          computerControlRestartDeferred: false,
          forkComputerControl: undefined,
        };
      }

      // P1 activation stickiness: a computer-control-only change never restarts under a live turn. The
      // caller keeps the previously provisioned flag cached so the next turn still observes the change
      // and restarts between turns. Liveness comes from the runtime, never the projection:
      // terminal-driven drains dispatch the queued turn before the projector clears the session row, so a
      // projected running turn here is stale, not live.
      if (
        computerControlChanged &&
        !runtimeModeChanged &&
        !providerChanged &&
        !workspaceChanged &&
        !shouldRestartForModelSelectionChange &&
        (yield* hasLiveProviderTurn(threadId))
      ) {
        return {
          activeSessionBeforeEnsure,
          activeSession: reusableSession,
          nativeResumeSucceeded: false,
          nativeResumeFailed: false,
          nativeSessionRestarted: false,
          computerControlRestartDeferred: true,
          forkComputerControl: undefined,
        };
      }

      if (currentProvider === "claudeAgent" && reusableSession.activeTurnId != null) {
        return yield* new ProviderAdapterValidationError({
          provider: currentProvider,
          operation: "session/reconfigure",
          issue: "Wait for Claude's active turn to finish before changing session settings.",
        });
      }

      const resumeCursor =
        providerChanged || runtimeModeChanged
          ? undefined
          : (activeSessionBeforeEnsure?.resumeCursor ?? undefined);
      yield* Effect.logInfo("provider command reactor restarting provider session", {
        threadId,
        existingSessionThreadId,
        currentProvider,
        desiredProvider: desiredModelSelection.provider,
        currentRuntimeMode: thread.session?.runtimeMode,
        desiredRuntimeMode,
        runtimeModeChanged,
        providerChanged,
        workspaceChanged,
        modelChanged,
        shouldRestartForModelSelectionChange,
        computerControlChanged,
        hasResumeCursor: resumeCursor !== undefined,
      });

      const restartedOutcome = yield* startProviderSessionWithOutcome(
        resumeCursor,
        workspaceChanged && shouldRegisterContextBootstrap,
      );
      const restartedSession = restartedOutcome.session;
      threadSessionModelSelections.set(threadId, desiredModelSelection);
      if (options?.enableComputerControl !== undefined) {
        threadSessionComputerControl.set(threadId, options.enableComputerControl);
      }
      yield* Effect.logInfo("provider command reactor restarted provider session", {
        threadId,
        previousSessionId: existingSessionThreadId,
        restartedSessionThreadId: restartedSession.threadId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
      });
      yield* bindSessionToThread(restartedSession);
      suppressContextBootstrapOnNextStartThreadIds.delete(threadId);
      return {
        activeSessionBeforeEnsure,
        activeSession: restartedSession,
        nativeResumeSucceeded: restartedOutcome.nativeResumeSucceeded,
        nativeResumeFailed:
          restartedOutcome.nativeResumeAttempted && !restartedOutcome.nativeResumeSucceeded,
        nativeSessionRestarted: true,
        computerControlRestartDeferred: false,
        forkComputerControl: undefined,
      };
    }

    let bootstrapTranscriptIfResumeFails = false;
    if (providerService.forkThread && thread.forkSourceThreadId) {
      const parentCanContinueChatControl =
        Option.isSome(computerService) &&
        computerService.value.manager.canContinueChatControl(thread.forkSourceThreadId);
      const forkComputerControl = Option.isSome(computerService)
        ? yield* Effect.promise(() =>
            computerService.value.manager.admitControl(
              threadId,
              parentCanContinueChatControl ? "chat" : "off",
              0,
            ),
          )
        : (options?.enableComputerControl ?? false);
      const forked = yield* providerService.forkThread({
        ...providerSessionOptions,
        sourceThreadId: thread.forkSourceThreadId,
        enableComputerControl: forkComputerControl,
      });
      if (forked) {
        threadSessionModelSelections.set(threadId, desiredModelSelection);
        threadSessionComputerControl.set(threadId, forkComputerControl);
        const forkedSession =
          (yield* resolveActiveSession(threadId)) ??
          ({
            provider: preferredProvider,
            status: "ready",
            runtimeMode: desiredRuntimeMode,
            ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
            model: desiredModelSelection.model,
            threadId,
            ...(forked.resumeCursor !== undefined ? { resumeCursor: forked.resumeCursor } : {}),
            createdAt,
            updatedAt: createdAt,
          } satisfies ProviderSession);
        yield* bindSessionToThread(forkedSession);
        suppressContextBootstrapOnNextStartThreadIds.delete(threadId);
        return {
          activeSessionBeforeEnsure,
          activeSession: forkedSession,
          nativeResumeSucceeded: false,
          nativeResumeFailed: false,
          nativeSessionRestarted: false,
          computerControlRestartDeferred: false,
          forkComputerControl,
        };
      }

      bootstrapTranscriptIfResumeFails = shouldRegisterContextBootstrap;
    }

    const registerPriorTranscriptBootstrapOnFreshStart =
      shouldRegisterContextBootstrap &&
      options?.registerPriorTranscriptBootstrapOnFreshStart === true;
    const startOutcome = yield* startProviderSessionWithOutcome(
      undefined,
      registerPriorTranscriptBootstrapOnFreshStart,
    ).pipe(
      Effect.map((outcome) => ({
        ...outcome,
        nativeResumeFailed: outcome.nativeResumeAttempted && !outcome.nativeResumeSucceeded,
      })),
    );
    if (bootstrapTranscriptIfResumeFails && !startOutcome.nativeResumeSucceeded) {
      freshSessionContextBootstrapThreadIds.add(threadId);
    }
    if (startOutcome.priorTranscriptBootstrapPending) {
      if (shouldRegisterContextBootstrap) {
        freshSessionContextBootstrapThreadIds.add(threadId);
      }
    }
    const startedSession = startOutcome.session;

    threadSessionModelSelections.set(threadId, desiredModelSelection);
    if (options?.enableComputerControl !== undefined) {
      threadSessionComputerControl.set(threadId, options.enableComputerControl);
    }
    yield* bindSessionToThread(startedSession);
    suppressContextBootstrapOnNextStartThreadIds.delete(threadId);
    return {
      activeSessionBeforeEnsure,
      activeSession: startedSession,
      nativeResumeSucceeded: startOutcome.nativeResumeSucceeded,
      nativeResumeFailed: startOutcome.nativeResumeFailed,
      nativeSessionRestarted: true,
      computerControlRestartDeferred: false,
      forkComputerControl: undefined,
    };
  });
  return {
    ensureSessionForThread,
    clearStaleProviderResumeState,
    editResendTurnStartKey,
    clearEditResendTurnStartKeysForThread,
    clearThreadRuntimeCaches,
  };
}
