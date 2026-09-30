import type { ClaudeSessionRegistryShape } from "../../Services/ClaudeSessionRegistry.ts";
import { ThreadId, EventId, TurnId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER, ClaudeTurnState } from "./sessionTypes";
import { makeClaudeTurnCompletion } from "./turnCompletion";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { ClaudeQueryRuntime } from "./adapterConfiguration";
import { Effect, FileSystem, Option, Random, Queue } from "effect";
import { ProviderAdapterValidationError, type ProviderAdapterError } from "../../core/Errors.ts";
import { makeClaudeTaskPresentation } from "./taskPresentation";
import { type ServerConfigShape } from "../../../server/config.ts";
import { type ProviderSendTurnInput } from "@glade/contracts/provider/provider";
import { type ProviderInteractionMode } from "@glade/contracts/provider/sessionPolicy";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { toRequestError, toMessage } from "./streamErrors";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { isClaudeCompactionCommand } from "./commandPresentation";
import { CLAUDE_CONTEXT_USAGE_TIMEOUT_MS } from "./contextUsage";
import { hasActiveClaudeCompactionWork } from "./sessionResume";
import {
  normalizeClaudeModelOptions,
  resolveApiModelId,
  getEffectiveClaudeCodeEffort,
} from "@glade/shared/provider/model";
import { hasOnlyCompletedClaudeTasks, hasUnfinishedClaudeTasks } from "../claudeTaskTracker.ts";
import { nativeProviderRefs, buildUserMessageEffect } from "./messageContent";
import { resolveSelectedClaudeThinkingToggle, selectedClaudeModelInfo } from "./modelCapabilities";
import { type ClaudeApiEffort } from "@glade/contracts/provider/model";
import type { ClaudeSessionAccessShape } from "../../Services/ClaudeSessionAccess.ts";
import { isClaudeSkillAllowed } from "../claudeSkillBridge.ts";
import type { ServerSettingsError } from "@glade/contracts/settings/settings";

export function makeClaudeTurnDispatch(input: {
  readonly requireSession: ClaudeSessionAccessShape["requireSession"];
  readonly sessions: ClaudeSessionRegistryShape;
  readonly completeTurn: ReturnType<typeof makeClaudeTurnCompletion>["completeTurn"];
  readonly updateResumeCursor: ClaudeRuntimeEventsShape["updateResumeCursor"];
  readonly verifyClaudeAutoModelSupport: (input: {
    readonly queryRuntime: ClaudeQueryRuntime;
    readonly selectedModel: string | undefined;
    readonly apiModelId: string | undefined;
    readonly operation: "startSession" | "sendTurn";
  }) => Effect.Effect<void, ProviderAdapterValidationError>;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
  readonly nowIso: Effect.Effect<string>;
  readonly emitCompactionProgress: ClaudeRuntimeEventsShape["emitCompactionProgress"];
  readonly emitTrackedTasksUpdated: ReturnType<
    typeof makeClaudeTaskPresentation
  >["emitTrackedTasksUpdated"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly serverConfig: ServerConfigShape;
  readonly getDisabledSkillNames: Effect.Effect<ReadonlyArray<string>, ServerSettingsError, never>;
  readonly resolveNativeCommandNames: ClaudeSessionAccessShape["resolveNativeCommandNames"];
}) {
  const {
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
  } = input;
  // Apply interaction mode on every turn so sticky SDK permission state cannot leak plan mode across
  // service/recovery paths that omit it. In every other case we send unconditionally, because once
  // any prompt has run the CLI's mode is opaque (`canUseTool` is shadowed under bypassPermissions, so
  // a future mode-changing tool could diverge from anything we tracked); only the pre-first-prompt
  // state is provable.
  const applyInteractionModePermission = (
    context: ClaudeSessionContext,
    threadId: ThreadId,
    interactionMode: ProviderSendTurnInput["interactionMode"],
  ): Effect.Effect<ProviderInteractionMode, ProviderAdapterError> =>
    Effect.gen(function* () {
      const effectiveInteractionMode = interactionMode ?? "default";
      const desiredPermissionMode: PermissionMode | undefined =
        effectiveInteractionMode === "plan"
          ? "plan"
          : context.basePermissionMode !== undefined || context.lastInteractionMode === "plan"
            ? (context.basePermissionMode ?? "default")
            : undefined;
      const canSkipRedundantSpawnModeRequest =
        context.firstTurnSpawnModeAuthoritative &&
        desiredPermissionMode === context.spawnPermissionMode;
      if (desiredPermissionMode !== undefined && !canSkipRedundantSpawnModeRequest) {
        yield* Effect.tryPromise({
          try: () => context.query.setPermissionMode(desiredPermissionMode),
          catch: (cause) => toRequestError(threadId, "turn/setPermissionMode", cause),
        });
      }
      return effectiveInteractionMode;
    });

  const sendTurnCore = (input: ProviderSendTurnInput): ReturnType<ClaudeAdapterShape["sendTurn"]> =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      const disabledSkillNames = yield* getDisabledSkillNames.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Skill settings are unavailable.",
              cause,
            }),
        ),
      );
      for (const skill of input.skills ?? []) {
        if (
          !context.allowedSkillNames.has(skill.name) ||
          !isClaudeSkillAllowed(skill.name, disabledSkillNames)
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Skill ${skill.name} is unavailable for this Claude session.`,
          });
        }
      }
      const slashName = /^\/([^\s]+)(?:\s|$)/u.exec(input.input?.trim() ?? "")?.[1];
      if (
        slashName &&
        context.initSkillNames?.has(slashName) &&
        (!context.allowedSkillNames.has(slashName) ||
          !isClaudeSkillAllowed(slashName, disabledSkillNames))
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Skill ${slashName} is unavailable for this Claude session.`,
        });
      }
      const isCompaction = isClaudeCompactionCommand(input.input);
      if (isCompaction && (input.attachments?.length ?? 0) > 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startClaudeCompaction",
          issue:
            "Native Claude compaction does not accept attachments. Remove them before compacting.",
        });
      }
      if (isCompaction) {
        const commands = yield* Effect.tryPromise({
          try: () => context.query.supportedCommands(),

          catch: (cause) =>
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startClaudeCompaction",
              issue: `Could not discover native compaction support: ${toMessage(cause, "Command discovery failed.")}`,
            }),
        }).pipe(Effect.timeoutOption(CLAUDE_CONTEXT_USAGE_TIMEOUT_MS));
        if (
          Option.isNone(commands) ||
          !commands.value.some((command) => command.name === "compact")
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startClaudeCompaction",
            issue: "Native context compaction is unavailable in this Claude runtime.",
          });
        }
        if (context.stopped || !sessions.isCurrent(input.threadId, context)) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startClaudeCompaction",
            issue: "Claude's session changed while preparing compaction. Try again.",
          });
        }
      }
      if (isCompaction && hasActiveClaudeCompactionWork(context)) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startClaudeCompaction",
          issue: "Wait for Claude's active turn and shared tasks to finish before compacting.",
        });
      }
      if (isCompaction && !context.resumeSessionId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startClaudeCompaction",
          issue: "Claude's native session identity is unavailable for compaction.",
        });
      }
      const modelSelection =
        input.modelSelection?.provider === "claudeAgent" ? input.modelSelection : undefined;
      const selectedOptions = normalizeClaudeModelOptions(
        modelSelection?.model,
        modelSelection?.options,
      );

      if (context.turnState) {
        yield* completeTurn(context, "completed");
      }

      if (hasOnlyCompletedClaudeTasks(context.trackedTasks)) {
        context.trackedTasks.clear();
        yield* updateResumeCursor(context);
      }

      let apiModelChanged = false;
      if (modelSelection?.model) {
        const apiModelId = resolveApiModelId(modelSelection);
        if (apiModelId !== context.currentApiModelId) {
          apiModelChanged = true;
          if (context.session.runtimeMode === "auto") {
            yield* verifyClaudeAutoModelSupport({
              queryRuntime: context.query,
              selectedModel: modelSelection.model,
              apiModelId,
              operation: "sendTurn",
            });
          }
          yield* Effect.tryPromise({
            try: () => context.query.setModel(apiModelId),
            catch: (cause) => toRequestError(input.threadId, "turn/setModel", cause),
          });
        }
        context.currentApiModelId = apiModelId;
        if (apiModelChanged) {
          context.lastKnownContextWindow = undefined;
          context.lastKnownAutoCompactThreshold = undefined;
        }
        yield* updateResumeCursor(context);
      }

      if (modelSelection && apiModelChanged) {
        context.emittedContextUsageWarnings.delete("near-window");
        context.emittedContextUsageWarnings.delete("large-prompt");

        const configuredWindow = {
          model: modelSelection.model,
          apiModelId: context.currentApiModelId,
        };
        const configuredStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "session.configured",
          eventId: configuredStamp.eventId,
          provider: PROVIDER,
          createdAt: configuredStamp.createdAt,
          threadId: input.threadId,
          payload: { config: configuredWindow },
          providerRefs: nativeProviderRefs(context),
        });
      }

      const requestedThinking = resolveSelectedClaudeThinkingToggle(
        selectedClaudeModelInfo(context.availableModels, modelSelection?.model),
        selectedOptions?.thinking,
      );
      if (modelSelection && requestedThinking !== context.currentAlwaysThinkingEnabled) {
        yield* Effect.tryPromise({
          try: () =>
            context.query.applyFlagSettings({
              alwaysThinkingEnabled: requestedThinking ?? null,
            }),
          catch: (cause) => toRequestError(input.threadId, "turn/applyFlagSettings", cause),
        });
        context.currentAlwaysThinkingEnabled = requestedThinking;
      }

      if (modelSelection) {
        const modelInfo = selectedClaudeModelInfo(context.availableModels, modelSelection.model);
        const requestedEffort = getEffectiveClaudeCodeEffort(selectedOptions?.effort);
        if (
          requestedEffort &&
          modelInfo &&
          !modelInfo.supportedEffortLevels?.includes(requestedEffort)
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Claude model "${modelInfo.displayName}" does not support ${requestedEffort} effort.`,
          });
        }
        const requestedUltracode = selectedOptions?.ultracode;
        if (
          requestedUltracode &&
          modelInfo &&
          !modelInfo.supportedEffortLevels?.includes("xhigh")
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Claude model "${modelInfo.displayName}" does not support Ultracode.`,
          });
        }
        const requestedFastMode = selectedOptions?.fastMode;
        if (requestedFastMode && modelInfo && modelInfo.supportsFastMode !== true) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Claude model "${modelInfo.displayName}" does not support fast mode.`,
          });
        }
        const effortChanged = requestedEffort !== context.currentEffort;
        const ultracodeChanged = requestedUltracode !== context.currentUltracode;
        const fastModeChanged = requestedFastMode !== context.currentFastMode;
        if (effortChanged || ultracodeChanged || fastModeChanged) {
          yield* Effect.tryPromise({
            try: () =>
              context.query.applyFlagSettings({
                ...(effortChanged
                  ? { effortLevel: requestedEffort as ClaudeApiEffort | null }
                  : {}),
                ...(ultracodeChanged ? { ultracode: requestedUltracode ?? null } : {}),
                ...(fastModeChanged ? { fastMode: requestedFastMode ?? null } : {}),
              }),
            catch: (cause) => toRequestError(input.threadId, "turn/applyFlagSettings", cause),
          });
          if (effortChanged) {
            context.currentEffort = requestedEffort;
          }
          context.currentUltracode = requestedUltracode;
          context.currentFastMode = requestedFastMode;
        }
      }

      const effectiveInteractionMode = isCompaction
        ? (context.lastInteractionMode ?? "default")
        : yield* applyInteractionModePermission(context, input.threadId, input.interactionMode);

      const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
      context.processedTokenTurnBaseline = context.processedTokenTotal;
      const turnState: ClaudeTurnState = {
        turnId,
        startedAt: yield* nowIso,
        interactionMode: effectiveInteractionMode,
        ...(slashName ? { commandText: input.input!.trim() } : {}),
        ...(isCompaction
          ? {
              explicitCompaction: {
                nativeSessionId: context.resumeSessionId!,
                boundaryObserved: false,
              },
            }
          : {}),
        items: [],
        assistantTextBlocks: new Map(),
        assistantTextBlockOrder: [],
        capturedProposedPlanKeys: new Set(),
        sawFileChange: false,
        nextSyntheticAssistantBlockIndex: -1,
        assistantMessageBlockBase: 0,
      };

      const updatedAt = yield* nowIso;

      if (
        isCompaction &&
        (context.stopped ||
          !sessions.isCurrent(input.threadId, context) ||
          hasActiveClaudeCompactionWork(context))
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startClaudeCompaction",
          issue: "Claude's session became active while preparing compaction. Try again when idle.",
        });
      }
      context.turnState = turnState;
      context.lastTurnId = turnId;
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        updatedAt,
      };

      const turnStartedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "turn.started",
        eventId: turnStartedStamp.eventId,
        provider: PROVIDER,
        createdAt: turnStartedStamp.createdAt,
        threadId: context.session.threadId,
        turnId,
        payload: context.currentApiModelId
          ? { model: context.currentApiModelId }
          : modelSelection?.model
            ? { model: modelSelection.model }
            : {},
        providerRefs: {},
      });

      if (isCompaction) yield* emitCompactionProgress(context);

      if (hasUnfinishedClaudeTasks(context.trackedTasks)) {
        yield* emitTrackedTasksUpdated(context, {
          rawPayload: {
            source: "claude.resume-cursor",
            trackedTaskCount: context.trackedTasks.size,
          },
        });
      }

      const message = yield* buildUserMessageEffect(input, {
        fileSystem,
        attachmentsDir: serverConfig.attachmentsDir,
        nativeCommandNames: yield* resolveNativeCommandNames(context, input.input),
      });

      yield* Queue.offer(context.promptQueue, {
        type: "message",
        message,
      }).pipe(Effect.mapError((cause) => toRequestError(input.threadId, "turn/start", cause)));

      context.firstTurnSpawnModeAuthoritative = false;

      return {
        threadId: context.session.threadId,
        turnId,
        ...(context.session.resumeCursor !== undefined
          ? { resumeCursor: context.session.resumeCursor }
          : {}),
      };
    });

  const withPendingDispatch = (
    input: ProviderSendTurnInput,
    dispatch: ReturnType<ClaudeAdapterShape["sendTurn"]>,
  ): ReturnType<ClaudeAdapterShape["sendTurn"]> =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      context.pendingDispatches = (context.pendingDispatches ?? 0) + 1;
      return yield* dispatch.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            context.pendingDispatches = (context.pendingDispatches ?? 1) - 1;
          }),
        ),
      );
    });

  const sendTurn: ClaudeAdapterShape["sendTurn"] = (input) =>
    withPendingDispatch(input, sendTurnCore(input));

  const steerTurn: ClaudeAdapterShape["steerTurn"] = (input) =>
    withPendingDispatch(
      input,
      Effect.gen(function* () {
        if (isClaudeCompactionCommand(input.input)) return yield* sendTurn(input);
        const context = yield* requireSession(input.threadId);
        const liveTurnState = context.turnState;
        if (liveTurnState === undefined || liveTurnState.synthetic === true) {
          return yield* sendTurn(input);
        }

        const effectiveInteractionMode = yield* applyInteractionModePermission(
          context,
          input.threadId,
          input.interactionMode,
        );
        if (effectiveInteractionMode !== liveTurnState.interactionMode) {
          context.turnState = {
            ...liveTurnState,
            interactionMode: effectiveInteractionMode,
          };
        }

        const message = yield* buildUserMessageEffect(input, {
          fileSystem,
          attachmentsDir: serverConfig.attachmentsDir,
          nativeCommandNames: yield* resolveNativeCommandNames(context, input.input),
        });
        yield* Queue.offer(context.promptQueue, {
          type: "message",
          message,
        }).pipe(Effect.mapError((cause) => toRequestError(input.threadId, "turn/steer", cause)));

        const steerText = input.input?.trim();
        if (steerText) {
          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent(context, {
            type: "turn.steered",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.session.threadId,
            turnId: liveTurnState.turnId,
            payload: { message: steerText, target: "turn" },
            providerRefs: nativeProviderRefs(context),
          });
        }

        return {
          threadId: context.session.threadId,
          turnId: liveTurnState.turnId,
          ...(context.session.resumeCursor !== undefined
            ? { resumeCursor: context.session.resumeCursor }
            : {}),
        };
      }),
    );
  return { sendTurn, steerTurn };
}
