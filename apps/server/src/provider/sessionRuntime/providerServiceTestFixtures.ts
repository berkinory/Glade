import {
  ApprovalRequestId,
  EventId,
  ThreadId,
  TurnId,
  type ProviderKind,
} from "@glade/contracts/core/baseSchemas";
import type {
  ProviderSession,
  ProviderSendTurnInput,
  ProviderTurnStartResult,
  ProviderSteerTurnInput,
  ProviderStartReviewInput,
  ProviderForkThreadInput,
  ProviderForkThreadResult,
} from "@glade/contracts/provider/provider";
import { Effect, PubSub, Stream, Layer } from "effect";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { vi, assert, it } from "@effect/vitest";
import { ProviderSessionStartInput } from "@glade/contracts/provider/provider";
import {
  type ProviderAdapterError,
  ProviderAdapterSessionNotFoundError,
  ProviderUnsupportedError,
} from "../core/Errors.ts";
import type { ProviderApprovalDecision } from "@glade/contracts/provider/sessionPolicy";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makeProviderServiceLive } from "../Layers/ProviderService.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProviderSessionDirectoryLive } from "../Layers/ProviderSessionDirectory.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

export class InjectedFailure extends Error {
  readonly _tag = "InjectedFailure";
}

export const asRequestId = (value: string): ApprovalRequestId =>
  ApprovalRequestId.makeUnsafe(value);

export const asEventId = (value: string): EventId => EventId.makeUnsafe(value);

export const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

export type LegacyProviderRuntimeEvent = {
  readonly type: string;
  readonly eventId: EventId;
  readonly provider: ProviderKind;
  readonly createdAt: string;
  readonly threadId: ThreadId;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly payload?: unknown | undefined;
  readonly [key: string]: unknown;
};

export function asRuntimePayloadRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function makeFakeCodexAdapter(provider: ProviderKind = "codex") {
  const sessions = new Map<ThreadId, ProviderSession>();
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());

  const startSession = vi.fn(
    (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, ProviderAdapterError> =>
      Effect.sync(() => {
        const now = new Date().toISOString();
        const session: ProviderSession = {
          provider,
          status: "ready",
          runtimeMode: input.runtimeMode,
          threadId: input.threadId,
          resumeCursor: input.resumeCursor ?? { opaque: `resume-${String(input.threadId)}` },
          cwd: input.cwd ?? process.cwd(),
          createdAt: now,
          updatedAt: now,
        };
        sessions.set(session.threadId, session);
        return session;
      }),
  );

  const sendTurn = vi.fn(
    (
      input: ProviderSendTurnInput,
    ): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> => {
      if (!sessions.has(input.threadId)) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider,
            threadId: input.threadId,
          }),
        );
      }

      return Effect.succeed({
        threadId: input.threadId,
        turnId: TurnId.makeUnsafe(`turn-${String(input.threadId)}`),
      });
    },
  );

  const steerTurn = vi.fn(
    (input: ProviderSteerTurnInput): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> =>
      Effect.succeed({
        threadId: input.threadId,
        turnId: TurnId.makeUnsafe(`steer-${String(input.threadId)}`),
      }),
  );

  const startReview = vi.fn(
    (
      input: ProviderStartReviewInput,
    ): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> =>
      Effect.succeed({
        threadId: input.threadId,
        turnId: TurnId.makeUnsafe(`review-${String(input.threadId)}`),
      }),
  );

  const interruptTurn = vi.fn(
    (
      _threadId: ThreadId,
      _turnId?: TurnId,
      _providerThreadId?: string,
    ): Effect.Effect<void, ProviderAdapterError> => Effect.void,
  );

  const respondToRequest = vi.fn(
    (
      _threadId: ThreadId,
      _requestId: string,
      _decision: ProviderApprovalDecision,
    ): Effect.Effect<void, ProviderAdapterError> => Effect.void,
  );

  const respondToUserInput = vi.fn(
    (
      _threadId: ThreadId,
      _requestId: string,
      _answers: Record<string, unknown>,
    ): Effect.Effect<void, ProviderAdapterError> => Effect.void,
  );

  const stopSession = vi.fn(
    (threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => {
        sessions.delete(threadId);
      }),
  );

  const listSessions = vi.fn(
    (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
      Effect.sync(() => Array.from(sessions.values())),
  );

  const hasSession = vi.fn(
    (threadId: ThreadId): Effect.Effect<boolean> => Effect.succeed(sessions.has(threadId)),
  );

  const readThread = vi.fn(
    (
      threadId: ThreadId,
    ): Effect.Effect<
      {
        threadId: ThreadId;
        turns: ReadonlyArray<{ id: TurnId; items: readonly [] }>;
      },
      ProviderAdapterError
    > =>
      Effect.succeed({
        threadId,
        turns: [{ id: asTurnId("turn-1"), items: [] }],
      }),
  );

  const rollbackThread = vi.fn(
    (
      threadId: ThreadId,
      _numTurns: number,
    ): Effect.Effect<{ threadId: ThreadId; turns: readonly [] }, ProviderAdapterError> =>
      Effect.succeed({ threadId, turns: [] }),
  );

  const compactThread = vi.fn(
    (_threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> => Effect.void,
  );

  const forkThread = vi.fn(
    (
      input: ProviderForkThreadInput,
    ): Effect.Effect<ProviderForkThreadResult, ProviderAdapterError> =>
      Effect.succeed({
        threadId: input.threadId,
        resumeCursor: { opaque: `fork-${String(input.threadId)}` },
      }),
  );

  const updateNativeHistory = vi.fn<
    NonNullable<ProviderAdapterShape<ProviderAdapterError>["updateNativeHistory"]>
  >(() => Effect.void);

  const stopAll = vi.fn(
    (): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => {
        sessions.clear();
      }),
  );

  const prepareSessionReplacement = vi.fn<
    NonNullable<ProviderAdapterShape<ProviderAdapterError>["prepareSessionReplacement"]>
  >(() => Effect.succeed(undefined));
  const adapter: ProviderAdapterShape<ProviderAdapterError> = {
    provider,
    capabilities: {
      supportsTurnSteering: true,
    },
    startSession,
    ...(provider === "claudeAgent" ? { prepareSessionReplacement } : {}),
    sendTurn,
    steerTurn,
    startReview,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    compactThread,
    forkThread,
    stopAll,
    updateNativeHistory,
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
  };

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, event as unknown as ProviderRuntimeEvent));
  };

  const waitForRuntimeSubscribers = (count = 1): Effect.Effect<void> =>
    waitUntil(
      () => runtimeEventPubSub.subscribers.size >= count,
      500,
      20,
      `${provider} runtime event subscriber`,
    );

  const updateSession = (
    threadId: ThreadId,
    update: (session: ProviderSession) => ProviderSession,
  ): void => {
    const existing = sessions.get(threadId);
    if (!existing) {
      return;
    }
    sessions.set(threadId, update(existing));
  };

  return {
    adapter,
    emit,
    waitForRuntimeSubscribers,
    updateSession,
    startSession,
    sendTurn,
    steerTurn,
    startReview,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    compactThread,
    forkThread,
    stopAll,
    updateNativeHistory,
  };
}

export const sleep = (ms: number) =>
  Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

export const waitUntil = (
  predicate: () => boolean,
  timeoutMs = 500,
  intervalMs = 20,
  description = "condition",
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline) {
      yield* sleep(intervalMs);
    }
    if (!predicate()) {
      assert.fail(`Timed out waiting for ${description}`);
    }
  });

export const waitUntilEffect = <E = never, R = never>(
  predicate: () => Effect.Effect<boolean, E, R>,
  timeoutMs = 500,
  intervalMs = 20,
  description = "condition",
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    let matched = yield* predicate();
    while (!matched && Date.now() < deadline) {
      yield* sleep(intervalMs);
      matched = yield* predicate();
    }
    if (!matched) {
      assert.fail(`Timed out waiting for ${description}`);
    }
  });

export const singleProviderRegistry = (
  adapter: ProviderAdapterShape<ProviderAdapterError>,
): typeof ProviderAdapterRegistry.Service => ({
  getByProvider: (provider) =>
    provider === adapter.provider
      ? Effect.succeed(adapter)
      : Effect.fail(new ProviderUnsupportedError({ provider })),
  listProviders: () => Effect.succeed([adapter.provider]),
});

export function makeProviderServiceLayer(options?: Parameters<typeof makeProviderServiceLive>[0]) {
  const codex = makeFakeCodexAdapter("codex");
  const claude = makeFakeCodexAdapter("claudeAgent");
  const registry: typeof ProviderAdapterRegistry.Service = {
    getByProvider: (provider) =>
      provider === "codex"
        ? Effect.succeed(codex.adapter)
        : provider === "claudeAgent"
          ? Effect.succeed(claude.adapter)
          : Effect.fail(new ProviderUnsupportedError({ provider })),
    listProviders: () => Effect.succeed(["codex", "claudeAgent"] as const),
  };

  const providerAdapterLayer = Layer.succeed(ProviderAdapterRegistry, registry);
  const runtimeRepositoryLayer = ProviderSessionRuntimeRepositoryLive.pipe(
    Layer.provide(SqlitePersistenceMemory),
  );
  const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer));

  const rawLayer = Layer.mergeAll(
    makeProviderServiceLive(options).pipe(
      Layer.provide(providerAdapterLayer),
      Layer.provide(directoryLayer),
    ),
    directoryLayer,
    runtimeRepositoryLayer,
    NodeServices.layer,
  );
  const layer = it.layer(rawLayer);

  return {
    codex,
    claude,
    layer,
  };
}

export const routing = makeProviderServiceLayer();
