import { Queue, Effect } from "effect";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { type EventNdjsonLogger } from "../../Layers/EventNdjsonLogger.ts";
import { EventId, ThreadId, ProviderItemId, TurnId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";
import { stripDiagnosticImages } from "../../core/stripDiagnosticImages.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { sdkNativeItemId, sdkNativeMethod } from "./sdkMetadata";
import { asCanonicalTurnId, nativeProviderRefs, asRuntimeItemId } from "./messageContent";
import { ProviderAdapterValidationError } from "../../core/Errors.ts";
import { hasDurableClaudeSessionId, invalidateClaudeCache } from "./sessionResume";

export function makeClaudeRuntimeEvents(input: {
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>;
  readonly nativeEventLogger: EventNdjsonLogger | undefined;
  readonly nowIso: Effect.Effect<string>;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly sessions: Map<ThreadId, ClaudeSessionContext>;
}) {
  const { runtimeEventQueue, nativeEventLogger, nowIso, makeEventStamp, sessions } = input;
  const offerRuntimeEvent = (
    context: ClaudeSessionContext,
    event: ProviderRuntimeEvent,
  ): Effect.Effect<void> =>
    Queue.offer(runtimeEventQueue, {
      ...(stripDiagnosticImages(event) as ProviderRuntimeEvent),
      ...(context.lifecycleGeneration !== undefined
        ? { lifecycleGeneration: context.lifecycleGeneration }
        : {}),
    }).pipe(Effect.asVoid);

  const logNativeSdkMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (!nativeEventLogger) {
        return;
      }

      const observedAt = new Date().toISOString();
      const itemId = sdkNativeItemId(message);

      yield* nativeEventLogger.write(
        {
          observedAt,
          event: {
            id:
              "uuid" in message && typeof message.uuid === "string"
                ? message.uuid
                : crypto.randomUUID(),
            kind: "notification",
            provider: PROVIDER,
            createdAt: observedAt,
            method: sdkNativeMethod(message),
            ...(typeof message.session_id === "string"
              ? { providerThreadId: message.session_id }
              : {}),
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            ...(itemId ? { itemId: ProviderItemId.makeUnsafe(itemId) } : {}),
            payload: message,
          },
        },
        context.session.threadId,
      );
    });

  const snapshotThread = (
    context: ClaudeSessionContext,
  ): Effect.Effect<
    {
      threadId: ThreadId;
      turns: ReadonlyArray<{
        id: TurnId;
        items: ReadonlyArray<unknown>;
      }>;
    },
    ProviderAdapterValidationError
  > =>
    Effect.gen(function* () {
      const threadId = context.session.threadId;
      if (!threadId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "readThread",
          issue: "Session thread id is not initialized yet.",
        });
      }
      return {
        threadId,
        turns: context.turns.map((turn) => ({
          id: turn.id,
          items: [...turn.items],
        })),
      };
    });

  const updateResumeCursor = (
    context: ClaudeSessionContext,
    updatedAt?: string,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const timestamp = updatedAt ?? (yield* nowIso);
      const threadId = context.session.threadId;
      if (!threadId) return;

      const resumeCursor = {
        ...(context.cacheObservation ? { claudeCache: context.cacheObservation } : {}),
        threadId,
        ...(context.resumeSessionId ? { resume: context.resumeSessionId } : {}),
        ...(context.lastAssistantUuid ? { resumeSessionAt: context.lastAssistantUuid } : {}),
        turnCount: context.turns.length,
        ...(context.trackedTasks.size > 0
          ? { trackedTasks: Array.from(context.trackedTasks.values()) }
          : {}),
        ...(context.processedTokenBaselineKnown
          ? { processedTokenTotal: context.processedTokenTotal, tokenAccountingVersion: 1 }
          : {}),
      };

      context.session = {
        ...context.session,
        resumeCursor,
        updatedAt: timestamp,
      };
    });

  const ensureThreadId = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (typeof message.session_id !== "string" || message.session_id.length === 0) {
        return;
      }
      if (!hasDurableClaudeSessionId(message)) {
        return;
      }
      const nextThreadId = message.session_id;
      if (
        context.cacheObservation?.nativeSessionId !== undefined &&
        context.cacheObservation.nativeSessionId !== nextThreadId
      )
        invalidateClaudeCache(context);
      context.resumeSessionId = message.session_id;
      yield* updateResumeCursor(context);

      if (context.lastThreadStartedId !== nextThreadId) {
        delete context.resultUsageBaseline;
        context.lastThreadStartedId = nextThreadId;
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "thread.started",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          payload: {
            providerThreadId: nextThreadId,
          },
          providerRefs: {},
          raw: {
            source: "claude.sdk.message",
            method: "claude/thread/started",
            payload: {
              session_id: message.session_id,
            },
          },
        });
      }
    });

  const emitRuntimeError = (
    context: ClaudeSessionContext,
    message: string,
    cause?: unknown,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (cause !== undefined) {
        void cause;
      }
      const turnState = context.turnState;
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "runtime.error",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
        payload: {
          message,
          class: "provider_error",
          ...(cause !== undefined ? { detail: cause } : {}),
        },
        providerRefs: nativeProviderRefs(context),
      });
    });

  const emitRuntimeWarning = (
    context: ClaudeSessionContext,
    message: string,
    detail?: unknown,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "runtime.warning",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
        payload: {
          message,
          ...(detail !== undefined ? { detail } : {}),
        },
        providerRefs: nativeProviderRefs(context),
      });
    });

  const emitCompactionProgress = (context: ClaudeSessionContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      if (!turnState || turnState.compactionInProgress) return;
      turnState.compactionInProgress = true;
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "item.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId: asCanonicalTurnId(turnState.turnId),
        itemId: asRuntimeItemId(`claude-compaction-${turnState.turnId}`),
        payload: {
          itemType: "context_compaction",
          status: "inProgress",
          title: "Compacting context",
        },
        providerRefs: nativeProviderRefs(context),
      });
    });

  const emitClaudeCacheObservation = (context: ClaudeSessionContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      const claudeCache = context.cacheObservation;
      if (!claudeCache || context.stopped || sessions.get(context.session.threadId) !== context)
        return;
      const usedTokens = context.lastKnownTokenUsage?.usedTokens ?? claudeCache.contextTokens;
      if (usedTokens === undefined) return;
      const usage = { ...context.lastKnownTokenUsage, usedTokens, claudeCache };
      context.lastKnownTokenUsage = usage;
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "thread.token-usage.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        payload: { usage },
        providerRefs: nativeProviderRefs(context),
      });
    });

  const warnUnhandledSdkKind = (
    context: ClaudeSessionContext,
    kind: string,
    message: string,
    detail: unknown,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (context.warnedUnhandledSdkKinds.has(kind)) {
        return;
      }
      context.warnedUnhandledSdkKinds.add(kind);
      yield* Effect.logWarning("claude.unhandled_sdk_message", { kind, message, detail });
    });
  return {
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
  };
}
