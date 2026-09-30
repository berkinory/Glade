import { ThreadId, EventId, TurnId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER, ClaudeTurnState } from "./sessionTypes";
import { makeClaudeTurnCompletion } from "./turnCompletion";
import { makeClaudeRuntimeEvents } from "./runtimeEvents";
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
  resolveSelectedClaudeAutoCompactWindow,
  resolveClaudeApiModelIdContextWindowMaxTokens,
} from "../claudeTokenUsage.ts";
import {
  normalizeClaudeModelOptions,
  resolveApiModelId,
  getModelCapabilities,
  trimOrNull,
  hasEffortLevel,
  getEffectiveClaudeCodeEffort,
  stripClaudeContextWindowSuffix,
} from "@glade/shared/provider/model";
import { hasOnlyCompletedClaudeTasks, hasUnfinishedClaudeTasks } from "../claudeTaskTracker.ts";
import { claudeCacheForModel } from "../claudeCacheObservation.ts";
import { nativeProviderRefs, buildUserMessageEffect } from "./messageContent";
import { resolveSelectedClaudeThinkingToggle } from "./modelCapabilities";
import { type ClaudeApiEffort } from "@glade/contracts/provider/model";
import { makeClaudeSessionAccess } from "./sessionAccess";

export function makeClaudeTurnDispatch(input: {
  readonly requireSession: ReturnType<typeof makeClaudeSessionAccess>["requireSession"];
  readonly sessions: Map<ThreadId, ClaudeSessionContext>;
  readonly completeTurn: ReturnType<typeof makeClaudeTurnCompletion>["completeTurn"];
  readonly updateResumeCursor: ReturnType<typeof makeClaudeRuntimeEvents>["updateResumeCursor"];
  readonly verifyClaudeAutoModelSupport: (input: {
    readonly queryRuntime: ClaudeQueryRuntime;
    readonly selectedModel: string | undefined;
    readonly apiModelId: string | undefined;
    readonly operation: "startSession" | "sendTurn";
  }) => Effect.Effect<void, ProviderAdapterValidationError>;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ReturnType<typeof makeClaudeRuntimeEvents>["offerRuntimeEvent"];
  readonly nowIso: Effect.Effect<string>;
  readonly emitCompactionProgress: ReturnType<
    typeof makeClaudeRuntimeEvents
  >["emitCompactionProgress"];
  readonly emitTrackedTasksUpdated: ReturnType<
    typeof makeClaudeTaskPresentation
  >["emitTrackedTasksUpdated"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly serverConfig: ServerConfigShape;
  readonly resolveNativeCommandNames: ReturnType<
    typeof makeClaudeSessionAccess
  >["resolveNativeCommandNames"];
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

  const sendTurnCore = (
    input: ProviderSendTurnInput,
    compactionTurnId?: TurnId,
  ): ReturnType<ClaudeAdapterShape["sendTurn"]> =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      const isCompaction = compactionTurnId !== undefined || isClaudeCompactionCommand(input.input);
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
        if (context.stopped || sessions.get(input.threadId) !== context) {
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
      const requestedAutoCompactWindow = resolveSelectedClaudeAutoCompactWindow(
        modelSelection?.model,
        normalizeClaudeModelOptions(modelSelection?.model, modelSelection?.options)
          ?.autoCompactWindow,
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
        context.rerouteOriginalApiModelId = undefined;
        if (apiModelChanged) {
          context.cacheObservation = claudeCacheForModel(context.cacheObservation, apiModelId);
          context.lastKnownContextWindow =
            resolveClaudeApiModelIdContextWindowMaxTokens(apiModelId);
          context.lastKnownAutoCompactThreshold = requestedAutoCompactWindow;
        }
        yield* updateResumeCursor(context);
      }

      if (modelSelection && apiModelChanged) {
        context.emittedContextUsageWarnings.delete("near-window");
        context.emittedContextUsageWarnings.delete("large-prompt");

        const configuredWindow = {
          autoCompactWindow: requestedAutoCompactWindow ?? null,
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
        modelSelection?.model,
        modelSelection?.options?.thinking,
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
        const turnCaps = getModelCapabilities("claudeAgent", modelSelection.model);
        const requestedEffortOption = trimOrNull(modelSelection.options?.effort ?? null);
        const validEffort =
          requestedEffortOption && hasEffortLevel(turnCaps, requestedEffortOption)
            ? requestedEffortOption
            : null;
        const requestedEffort = getEffectiveClaudeCodeEffort(validEffort);
        const requestedUltracode = validEffort === "ultracode" && hasEffortLevel(turnCaps, "xhigh");
        const requestedFastMode =
          modelSelection.options?.fastMode === true && turnCaps.supportsFastMode;
        const effortChanged =
          requestedEffort !== context.currentEffort &&
          requestedEffort !== "max" &&
          context.currentEffort !== "max";
        const ultracodeChanged = requestedUltracode !== context.currentUltracode;
        const fastModeChanged = requestedFastMode !== context.currentFastMode;
        if (effortChanged || ultracodeChanged || fastModeChanged) {
          yield* Effect.tryPromise({
            try: () =>
              context.query.applyFlagSettings({
                ...(effortChanged
                  ? { effortLevel: requestedEffort as Exclude<ClaudeApiEffort, "max"> | null }
                  : {}),
                ...(ultracodeChanged ? { ultracode: requestedUltracode ? true : null } : {}),
                ...(fastModeChanged ? { fastMode: requestedFastMode ? true : null } : {}),
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

      const turnId = compactionTurnId ?? TurnId.makeUnsafe(yield* Random.nextUUIDv4);
      context.processedTokenTurnBaseline = context.processedTokenTotal;
      const turnState: ClaudeTurnState = {
        turnId,
        startedAt: yield* nowIso,
        interactionMode: effectiveInteractionMode,
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
          sessions.get(input.threadId) !== context ||
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
          ? { model: stripClaudeContextWindowSuffix(context.currentApiModelId) }
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
      const selection = input.modelSelection;
      if (
        selection?.provider === "claudeAgent" &&
        resolveSelectedClaudeAutoCompactWindow(
          selection.model,
          normalizeClaudeModelOptions(selection.model, selection.options)?.autoCompactWindow,
        ) !== context.currentAutoCompactWindow
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "session/reconfigure",
          issue:
            "Claude's auto-compact setting requires an idle session restart with resume before sending.",
        });
      }
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

  const startClaudeCompaction: NonNullable<ClaudeAdapterShape["startClaudeCompaction"]> = (input) =>
    withPendingDispatch(
      { threadId: input.threadId, input: "/compact", attachments: [] },
      sendTurnCore({ threadId: input.threadId, input: "/compact", attachments: [] }, input.turnId),
    );

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
  return { startClaudeCompaction, sendTurn, steerTurn };
}
