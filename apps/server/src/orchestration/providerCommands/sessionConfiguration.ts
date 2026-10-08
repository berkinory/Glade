import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import { Stream } from "effect";
import type { ServiceMap } from "effect";
import {
  type ModelSelection,
  type ProviderStartOptions,
  type RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";
import { ProviderContextLifecycleActivityRecord } from "./contextLifecycle";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { makeProviderThreadProjection } from "./threadProjection";
import { Option, Effect, Schema } from "effect";
import { ThreadId, ProviderKind } from "@glade/contracts/core/baseSchemas";
import { ProviderAdapterValidationError } from "../../provider/core/Errors.ts";
import { providerDisabledSettingsMessage } from "../../provider/core/enabledProviderAdapter.ts";
import { providerStartOptionsFromServerSettings } from "../../settings/settingsPatches";
import { resolveThreadWorkspaceState } from "@glade/shared/threads/threadEnvironment";
import { type ProviderSession } from "@glade/contracts/provider/provider";
import { providerWorkspaceChanged } from "../projectRelocationPaths.ts";
import { isAwaitingRequestedTurn } from "../turnStartSession.ts";
import { PendingInterruptEscalation } from "./runtimeState";
import { makeProviderContextBootstrap } from "./contextBootstrap";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";
import { ThreadComputerUse } from "../Services/ThreadComputerUse.ts";
import { ProviderDeliveryGate } from "../Services/ProviderDeliveryGate.ts";

export function makeProviderSessionConfiguration(input: {
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly orchestrationEngine: Pick<OrchestrationEngineShape, "readThreadEvents">;
  readonly threadSessionSettings: ServiceMap.Service.Shape<typeof ThreadSessionSettings>;
  readonly threadComputerUse: ServiceMap.Service.Shape<typeof ThreadComputerUse>;
  readonly deliveryGate: ServiceMap.Service.Shape<typeof ProviderDeliveryGate>;

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
  readonly serverSettings: ServiceMap.Service.Shape<typeof ServerSettingsService>;
  readonly setThreadSession: ReturnType<typeof makeProviderThreadProjection>["setThreadSession"];
  readonly freshSessionContextBootstrapThreadIds: Set<string>;
}) {
  const {
    threadSessionSettings,
    threadComputerUse,
    deliveryGate,

    suppressContextBootstrapOnNextStartThreadIds,
    clearPendingContextBootstraps,
    pendingInterruptEscalations,
    pendingProviderContextLifecycleActivities,
    providerService,
    serverSettings,
    setThreadSession,
    freshSessionContextBootstrapThreadIds,
    projectionAccess,
    orchestrationEngine,
  } = input;

  const { resolveThread, resolveProjectedThreadWorkspaceCwd, hasLiveProviderTurn } =
    projectionAccess;
  const clearThreadRuntimeCaches = (threadId: ThreadId) =>
    Effect.sync(() => {
      threadSessionSettings.clearThread(threadId);
      threadComputerUse.clear(threadId);
      deliveryGate.releaseQuarantine(threadId);

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
    readonly cause: { readonly message: string };
    readonly preserveActiveRuntime?: boolean;
    readonly expectedGeneration?: string;
    readonly expectedTurnId?: string;
  }) {
    if (providerService.clearSessionResumeCursor) {
      yield* providerService.clearSessionResumeCursor({
        threadId: input.threadId,
        ...(input.expectedGeneration ? { expectedGeneration: input.expectedGeneration } : {}),
        ...(input.expectedTurnId ? { expectedTurnId: input.expectedTurnId } : {}),
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
    let currentProvider: ProviderKind | undefined = Schema.is(ProviderKind)(
      thread.session?.providerName,
    )
      ? thread.session.providerName
      : undefined;
    const requestedModelSelection = options?.modelSelection;
    const resolveActiveSession = (threadId: ThreadId) =>
      providerService
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));

    const retiredHandoffSource =
      thread.handoff?.sourceRetired === true &&
      ["activating", "activated"].includes(thread.handoff.stage ?? "") &&
      thread.handoff.destinationModelSelection?.provider === requestedModelSelection?.provider &&
      currentProvider === thread.handoff.sourceProvider;
    const activeSession =
      currentProvider !== undefined &&
      (thread.latestTurn === null || retiredHandoffSource) &&
      requestedModelSelection !== undefined &&
      requestedModelSelection.provider !== currentProvider
        ? yield* resolveActiveSession(threadId)
        : undefined;
    if (retiredHandoffSource && activeSession?.provider !== currentProvider) {
      currentProvider = undefined;
    }

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

    const bindSessionToThread = Effect.fnUntraced(function* (session: ProviderSession) {
      const currentSession = (yield* resolveThread(threadId))?.session;
      // Keep the pending start's updatedAt so turn-start failure handling can still compare-and-set it.
      const pendingStart =
        session.status === "ready" && isAwaitingRequestedTurn(currentSession)
          ? currentSession
          : undefined;
      yield* setThreadSession({
        threadId,
        session: {
          threadId,
          status: pendingStart
            ? "starting"
            : session.status === "connecting"
              ? "starting"
              : session.status === "closed"
                ? "stopped"
                : session.status,
          providerName: session.provider,
          runtimeMode: desiredRuntimeMode,

          activeTurnId: null,
          lastError: session.lastError ?? null,
          updatedAt: pendingStart?.updatedAt ?? session.updatedAt,
        },
        createdAt,
      });
    });

    // Providers read the gateway's tool list once per session, so turning Computer Use on or off
    // takes effect when the session next (re)starts.
    const computerToolsListed = threadComputerUse.mode(threadId) !== "off";
    const activeSessionBeforeEnsure = yield* resolveActiveSession(threadId);
    const workspaceChanged =
      activeSessionBeforeEnsure !== undefined &&
      providerWorkspaceChanged(activeSessionBeforeEnsure.cwd, effectiveCwd);

    if (workspaceChanged && (yield* providerService.hasLiveRuntimeTasks({ threadId }))) {
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

      const computerToolsChanged = computerToolsListed !== threadComputerUse.provisioned(threadId);
      const reuse = {
        activeSessionBeforeEnsure,
        activeSession: reusableSession,
        nativeResumeSucceeded: false,
        nativeResumeFailed: false,
        nativeSessionRestarted: false,
      };
      if (!runtimeModeChanged && !providerChanged && !workspaceChanged && !computerToolsChanged) {
        return { ...reuse };
      }
      // A Computer Use change alone never restarts under a live turn; the next turn applies it.
      if (
        !runtimeModeChanged &&
        !providerChanged &&
        !workspaceChanged &&
        (yield* hasLiveProviderTurn(threadId))
      ) {
        return { ...reuse };
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
        computerToolsChanged,
        hasResumeCursor: resumeCursor !== undefined,
      });

      const restartedOutcome = yield* startProviderSessionWithOutcome(
        resumeCursor,
        workspaceChanged && shouldRegisterContextBootstrap,
      );
      const restartedSession = restartedOutcome.session;
      if (restartedOutcome.priorTranscriptBootstrapPending && shouldRegisterContextBootstrap) {
        freshSessionContextBootstrapThreadIds.add(threadId);
      }
      threadSessionSettings.setModelSelection(threadId, desiredModelSelection);
      threadComputerUse.markProvisioned(threadId, computerToolsListed);
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
      };
    }

    if (thread.forkSourceThreadId) {
      if (!providerService.forkThread)
        return yield* new ProviderAdapterValidationError({
          provider: preferredProvider ?? thread.modelSelection.provider,
          operation: "forkThread",
          issue: "Native conversation forking is unavailable.",
        });
      const creation = yield* Stream.runHead(
        orchestrationEngine.readThreadEvents(threadId, 0, ["thread.created"]),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterValidationError({
              provider: preferredProvider ?? thread.modelSelection.provider,
              operation: "forkThread",
              issue: "Could not read the durable native fork point.",
              cause,
            }),
        ),
      );
      const forkPoint =
        Option.isSome(creation) && creation.value.type === "thread.created"
          ? creation.value.payload.forkPoint
          : undefined;
      if (!forkPoint)
        return yield* new ProviderAdapterValidationError({
          provider: preferredProvider ?? thread.modelSelection.provider,
          operation: "forkThread",
          issue: "The conversation has no recorded native fork point.",
        });
      const forked = yield* providerService.forkThread({
        ...providerSessionOptions,
        sourceThreadId: thread.forkSourceThreadId,
        forkPoint,
      });
      if (forked) {
        threadSessionSettings.setModelSelection(threadId, desiredModelSelection);
        threadComputerUse.markProvisioned(threadId, computerToolsListed);
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
        };
      }
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
    if (startOutcome.priorTranscriptBootstrapPending) {
      if (shouldRegisterContextBootstrap) {
        freshSessionContextBootstrapThreadIds.add(threadId);
      }
    }
    const startedSession = startOutcome.session;

    threadSessionSettings.setModelSelection(threadId, desiredModelSelection);
    threadComputerUse.markProvisioned(threadId, computerToolsListed);
    yield* bindSessionToThread(startedSession);
    suppressContextBootstrapOnNextStartThreadIds.delete(threadId);
    return {
      activeSessionBeforeEnsure,
      activeSession: startedSession,
      lifecycleGeneration:
        "lifecycleGeneration" in startOutcome ? startOutcome.lifecycleGeneration : undefined,
      nativeResumeSucceeded: startOutcome.nativeResumeSucceeded,
      nativeResumeFailed: startOutcome.nativeResumeFailed,
      nativeSessionRestarted: true,
    };
  });
  return {
    ensureSessionForThread,
    clearStaleProviderResumeState,
    clearThreadRuntimeCaches,
  };
}
