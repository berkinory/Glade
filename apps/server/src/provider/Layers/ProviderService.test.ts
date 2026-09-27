// FILE: ProviderService.test.ts
// Purpose: Verifies cross-provider routing, persistence, recovery, and runtime lifecycle behavior.
// Layer: Provider service integration tests
// Depends on: ProviderServiceLive with in-memory adapter and SQLite fakes.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ProviderApprovalDecision,
  ProviderForkThreadInput,
  ProviderForkThreadResult,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderStartReviewInput,
  ProviderSteerTurnInput,
  ProviderTurnStartResult,
} from "@glade/contracts";
import {
  ApprovalRequestId,
  EventId,
  type ProviderKind,
  ProviderSessionStartInput,
  ThreadId,
  TurnId,
} from "@glade/contracts";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, PubSub, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderSessionDirectoryPersistenceError,
  ProviderUnsupportedError,
  ProviderValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { makeProviderServiceLive } from "./ProviderService.ts";
import { ProviderSessionDirectoryLive } from "./ProviderSessionDirectory.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime.ts";
import { ProviderSessionRuntimeRepository } from "../../persistence/Services/ProviderSessionRuntime.ts";
import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../../persistence/Layers/Sqlite.ts";
import { AGENT_GATEWAY_TURN_AUTHORITY_RETIRED } from "../../agentGateway/sessionLease.ts";

const asRequestId = (value: string): ApprovalRequestId => ApprovalRequestId.makeUnsafe(value);
const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

type LegacyProviderRuntimeEvent = {
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

// Converts deferred listSessions callbacks into typed release handles for race tests.

function asRuntimePayloadRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function makeFakeCodexAdapter(
  provider: ProviderKind = "codex",
  options?: {
    readonly conversationRollback?: "native" | "restart-session";
    readonly didResumeSession?: NonNullable<
      ProviderAdapterShape<ProviderAdapterError>["didResumeSession"]
    >;
  },
) {
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
      sessionModelSwitch: "in-session",
      supportsTurnSteering: true,
      ...(options?.conversationRollback
        ? { conversationRollback: options.conversationRollback }
        : {}),
    },
    startSession,
    ...(provider === "claudeAgent" ? { prepareSessionReplacement } : {}),
    ...(options?.didResumeSession ? { didResumeSession: options.didResumeSession } : {}),
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
    prepareSessionReplacement,
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
  };
}

const sleep = (ms: number) =>
  Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

const waitUntil = (
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

const waitUntilEffect = <E = never, R = never>(
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

function makeProviderServiceLayer(
  options?: Parameters<typeof makeProviderServiceLive>[0],
  providers?: {
    readonly codexDidResumeSession?: NonNullable<
      ProviderAdapterShape<ProviderAdapterError>["didResumeSession"]
    >;
  },
) {
  const codex = makeFakeCodexAdapter(
    "codex",
    providers?.codexDidResumeSession ? { didResumeSession: providers.codexDidResumeSession } : {},
  );
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
    rawLayer,
  };
}

const routing = makeProviderServiceLayer();

const rotationRetryPersistAttempts = new Map<string, number>();
const ROTATION_RETRY_FAILURE_EVENT_ID = "terminal-rotation-settlement-retry";
const rotationRetry = makeProviderServiceLayer({
  persistRuntimeEvent: (event) =>
    Effect.suspend(() => {
      const eventId = String(event.eventId);
      const attempts = (rotationRetryPersistAttempts.get(eventId) ?? 0) + 1;
      rotationRetryPersistAttempts.set(eventId, attempts);
      if (eventId === ROTATION_RETRY_FAILURE_EVENT_ID && attempts === 1) {
        return Effect.fail(new Error("injected transient runtime persistence failure"));
      }
      return Effect.succeed({ sequence: attempts, event });
    }),
  runtimeEventRetryBaseDelayMs: 1,
  runtimeEventRetryMaxDelayMs: 1,
});
it.effect("ProviderServiceLive keeps persisted resumable sessions on startup", () =>
  Effect.gen(function* () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glade-provider-service-"));
    const dbPath = path.join(tempDir, "orchestration.sqlite");

    const codex = makeFakeCodexAdapter();
    const registry: typeof ProviderAdapterRegistry.Service = {
      getByProvider: (provider) =>
        provider === "codex"
          ? Effect.succeed(codex.adapter)
          : Effect.fail(new ProviderUnsupportedError({ provider })),
      listProviders: () => Effect.succeed(["codex"]),
    };

    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const runtimeRepositoryLayer = ProviderSessionRuntimeRepositoryLive.pipe(
      Layer.provide(persistenceLayer),
    );
    const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer));

    yield* Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory;
      yield* directory.upsert({
        provider: "codex",
        threadId: ThreadId.makeUnsafe("thread-stale"),
      });
    }).pipe(Effect.provide(directoryLayer));

    const providerLayer = makeProviderServiceLive().pipe(
      Layer.provide(Layer.succeed(ProviderAdapterRegistry, registry)),
      Layer.provide(directoryLayer),
    );

    yield* Effect.gen(function* () {
      yield* ProviderService;
    }).pipe(Effect.provide(providerLayer));

    const persistedProvider = yield* Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory;
      return yield* directory.getProvider(asThreadId("thread-stale"));
    }).pipe(Effect.provide(directoryLayer));
    assert.equal(persistedProvider, "codex");

    const runtime = yield* Effect.gen(function* () {
      const repository = yield* ProviderSessionRuntimeRepository;
      return yield* repository.getByThreadId({ threadId: asThreadId("thread-stale") });
    }).pipe(Effect.provide(runtimeRepositoryLayer));
    assert.equal(Option.isSome(runtime), true);

    const legacyTableRows = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'provider_sessions'
      `;
    }).pipe(Effect.provide(persistenceLayer));
    assert.equal(legacyTableRows.length, 0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "ProviderServiceLive persists active sessions as stopped when adapter cleanup fails",
  () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glade-provider-service-stopall-"));
      const dbPath = path.join(tempDir, "orchestration.sqlite");
      const persistenceLayer = makeSqlitePersistenceLive(dbPath);
      const runtimeRepositoryLayer = ProviderSessionRuntimeRepositoryLive.pipe(
        Layer.provide(persistenceLayer),
      );

      const codex = makeFakeCodexAdapter();
      const threadId = asThreadId("thread-stopall");
      const resumeCursor = {
        threadId,
        resume: "resume-session-stopall",
        resumeSessionAt: "assistant-message-stopall",
        turnCount: 1,
      };
      codex.stopAll.mockImplementation(() =>
        Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: "codex",
            threadId,
          }),
        ),
      );

      const registry: typeof ProviderAdapterRegistry.Service = {
        getByProvider: (provider) =>
          provider === "codex"
            ? Effect.succeed(codex.adapter)
            : Effect.fail(new ProviderUnsupportedError({ provider })),
        listProviders: () => Effect.succeed(["codex"]),
      };

      const providerLayer = makeProviderServiceLive().pipe(
        Layer.provide(Layer.succeed(ProviderAdapterRegistry, registry)),
        Layer.provide(ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer))),
      );

      yield* Effect.gen(function* () {
        const provider = yield* ProviderService;
        yield* provider.startSession(threadId, {
          provider: "codex",
          cwd: "/tmp/project",
          runtimeMode: "full-access",
          threadId,
        });
        codex.updateSession(threadId, (existing) => ({
          ...existing,
          status: "running",
          activeTurnId: asTurnId("turn-stopall"),
          resumeCursor,
        }));
      }).pipe(Effect.provide(providerLayer));

      const persisted = yield* Effect.gen(function* () {
        const repository = yield* ProviderSessionRuntimeRepository;
        return yield* repository.getByThreadId({ threadId });
      }).pipe(Effect.provide(runtimeRepositoryLayer));

      assert.equal(Option.isSome(persisted), true);
      if (Option.isSome(persisted)) {
        const runtimePayload = persisted.value.runtimePayload as Record<string, unknown>;
        assert.equal(persisted.value.status, "stopped");
        assert.deepEqual(persisted.value.resumeCursor, resumeCursor);
        assert.equal(runtimePayload.activeTurnId, null);
        assert.equal(runtimePayload.lastRuntimeEvent, "provider.stopAll");
      }

      fs.rmSync(tempDir, { recursive: true, force: true });
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "ProviderServiceLive restores rollback routing after restart using persisted thread mapping",
  () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glade-provider-service-restart-"));
      const dbPath = path.join(tempDir, "orchestration.sqlite");
      const persistenceLayer = makeSqlitePersistenceLive(dbPath);
      const runtimeRepositoryLayer = ProviderSessionRuntimeRepositoryLive.pipe(
        Layer.provide(persistenceLayer),
      );

      const firstCodex = makeFakeCodexAdapter();
      const firstRegistry: typeof ProviderAdapterRegistry.Service = {
        getByProvider: (provider) =>
          provider === "codex"
            ? Effect.succeed(firstCodex.adapter)
            : Effect.fail(new ProviderUnsupportedError({ provider })),
        listProviders: () => Effect.succeed(["codex"]),
      };

      const firstDirectoryLayer = ProviderSessionDirectoryLive.pipe(
        Layer.provide(runtimeRepositoryLayer),
      );
      const firstProviderLayer = makeProviderServiceLive().pipe(
        Layer.provide(Layer.succeed(ProviderAdapterRegistry, firstRegistry)),
        Layer.provide(firstDirectoryLayer),
      );
      const updatedResumeCursor = {
        threadId: asThreadId("thread-1"),
        resume: "resume-session-1",
        resumeSessionAt: "assistant-message-1",
        turnCount: 1,
      };

      const startedSession = yield* Effect.gen(function* () {
        const provider = yield* ProviderService;
        const threadId = asThreadId("thread-1");
        const session = yield* provider.startSession(threadId, {
          provider: "codex",
          cwd: "/tmp/project",
          runtimeMode: "full-access",
          threadId,
        });
        firstCodex.updateSession(threadId, (existing) => ({
          ...existing,
          status: "ready",
          resumeCursor: updatedResumeCursor,
          updatedAt: new Date(Date.now() + 1_000).toISOString(),
        }));
        return session;
      }).pipe(Effect.provide(firstProviderLayer));

      const persistedAfterStopAll = yield* Effect.gen(function* () {
        const repository = yield* ProviderSessionRuntimeRepository;
        return yield* repository.getByThreadId({ threadId: startedSession.threadId });
      }).pipe(Effect.provide(runtimeRepositoryLayer));
      assert.equal(Option.isSome(persistedAfterStopAll), true);
      if (Option.isSome(persistedAfterStopAll)) {
        assert.equal(persistedAfterStopAll.value.status, "stopped");
        assert.deepEqual(persistedAfterStopAll.value.resumeCursor, updatedResumeCursor);
      }

      const secondCodex = makeFakeCodexAdapter();
      const secondRegistry: typeof ProviderAdapterRegistry.Service = {
        getByProvider: (provider) =>
          provider === "codex"
            ? Effect.succeed(secondCodex.adapter)
            : Effect.fail(new ProviderUnsupportedError({ provider })),
        listProviders: () => Effect.succeed(["codex"]),
      };
      const secondDirectoryLayer = ProviderSessionDirectoryLive.pipe(
        Layer.provide(runtimeRepositoryLayer),
      );
      const secondProviderLayer = makeProviderServiceLive().pipe(
        Layer.provide(Layer.succeed(ProviderAdapterRegistry, secondRegistry)),
        Layer.provide(secondDirectoryLayer),
      );

      secondCodex.startSession.mockClear();
      secondCodex.rollbackThread.mockClear();

      yield* Effect.gen(function* () {
        const provider = yield* ProviderService;
        yield* provider.rollbackConversation({
          threadId: startedSession.threadId,
          numTurns: 1,
        });
      }).pipe(Effect.provide(secondProviderLayer));

      assert.equal(secondCodex.startSession.mock.calls.length, 1);
      const resumedStartInput = secondCodex.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "codex");
        assert.equal(startPayload.cwd, "/tmp/project");
        assert.deepEqual(startPayload.resumeCursor, updatedResumeCursor);
        assert.equal(startPayload.threadId, startedSession.threadId);
      }
      assert.equal(secondCodex.rollbackThread.mock.calls.length, 1);
      const rollbackCall = secondCodex.rollbackThread.mock.calls[0];
      assert.equal(typeof rollbackCall?.[0], "string");
      assert.equal(rollbackCall?.[1], 1);

      fs.rmSync(tempDir, { recursive: true, force: true });
    }).pipe(Effect.provide(NodeServices.layer)),
);

routing.layer("ProviderServiceLive routing", (it) => {
  it.effect("fails native imports without transcript fallback and retires failed runtimes", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("external-import-failure");
      const stops = routing.codex.stopSession.mock.calls.length;
      routing.codex.forkThread.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "thread/fork",
            detail: "native copy failed",
          }),
        ),
      );
      const result = yield* Effect.result(
        provider.importExternalThread!({
          threadId,
          provider: "codex",
          externalThreadId: "source",
          sourceCwd: "/missing/project",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
        }),
      );
      assert.equal(result._tag, "Failure");
      assert.equal(routing.codex.stopSession.mock.calls.length - stops, 2);
      assert.equal(Option.isNone(yield* directory.getBinding(threadId)), true);
    }),
  );

  it.effect("retires an interrupted native import before releasing its lifecycle lock", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("external-import-interrupted");
      const started = yield* Deferred.make<void>();
      const stops = routing.codex.stopSession.mock.calls.length;
      routing.codex.forkThread.mockImplementationOnce(() =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      );
      const fiber = yield* provider.importExternalThread!({
        threadId,
        provider: "codex",
        externalThreadId: "source",
        sourceCwd: "/repo/source",
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
      }).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      assert.equal(routing.codex.stopSession.mock.calls.length - stops, 2);
      assert.equal(Option.isNone(yield* directory.getBinding(threadId)), true);
    }),
  );

  it.effect("rejects native imports that accidentally return the original cursor", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("external-import-original-cursor");
      routing.claude.forkThread.mockImplementationOnce(() =>
        Effect.succeed({
          threadId,
          resumeCursor: { resume: "source" },
        }),
      );
      const result = yield* Effect.result(
        provider.importExternalThread!({
          threadId,
          provider: "claudeAgent",
          externalThreadId: "source",
          sourceCwd: "/repo/project",
          modelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
          runtimeMode: "full-access",
        }),
      );
      assert.equal(result._tag, "Failure");
      assert.equal(Option.isNone(yield* directory.getBinding(threadId)), true);
    }),
  );

  it.effect("serializes lifecycle mutations and persists a fresh generation per start", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-lifecycle-generation");
      const startInput: ProviderSessionStartInput = {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      };

      yield* provider.startSession(threadId, startInput);
      const firstBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const firstGeneration = firstBinding?.lifecycleGeneration;
      assert.equal(typeof firstGeneration, "string");

      yield* provider.stopSession({ threadId });
      yield* provider.stopSession({ threadId });
      yield* provider.startSession(threadId, startInput);
      const secondBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const secondGeneration = secondBinding?.lifecycleGeneration;
      assert.equal(typeof secondGeneration, "string");
      assert.notEqual(secondGeneration, firstGeneration);

      const responseCallCount = routing.codex.respondToRequest.mock.calls.length;
      const staleResponse = yield* Effect.result(
        provider.respondToRequest({
          threadId,
          requestId: asRequestId("request-from-old-generation"),
          lifecycleGeneration: String(firstGeneration),
          decision: "accept",
        }),
      );
      assertFailure(
        staleResponse,
        new ProviderValidationError({
          operation: "ProviderService.respondToRequest",
          issue: `Cannot respond to stale request 'request-from-old-generation' from provider generation '${String(firstGeneration)}'.`,
          reason: "stale-interaction",
        }),
      );
      assert.equal(routing.codex.respondToRequest.mock.calls.length, responseCallCount);

      const userInputResponseCallCount = routing.codex.respondToUserInput.mock.calls.length;
      const staleUserInputResponse = yield* Effect.result(
        provider.respondToUserInput({
          threadId,
          requestId: asRequestId("user-input-from-old-generation"),
          lifecycleGeneration: String(firstGeneration),
          answers: { answer: "stale" },
        }),
      );
      assertFailure(
        staleUserInputResponse,
        new ProviderValidationError({
          operation: "ProviderService.respondToUserInput",
          issue: `Cannot respond to stale request 'user-input-from-old-generation' from provider generation '${String(firstGeneration)}'.`,
          reason: "stale-interaction",
        }),
      );
      assert.equal(routing.codex.respondToUserInput.mock.calls.length, userInputResponseCallCount);

      yield* routing.codex.waitForRuntimeSubscribers();
      routing.codex.emit({
        type: "session.exited",
        eventId: asEventId("runtime-old-generation-exited"),
        provider: "codex",
        threadId,
        createdAt: "2026-07-14T14:00:00.000Z",
        lifecycleGeneration: String(firstGeneration),
        payload: { reason: "late old-runtime exit" },
      });
      yield* sleep(25);
      const bindingAfterStaleEvent = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(bindingAfterStaleEvent?.lifecycleGeneration, secondGeneration);
      assert.equal(bindingAfterStaleEvent?.status, "running");

      const defaultStart = routing.codex.startSession.getMockImplementation();
      if (!defaultStart) assert.fail("Expected the fake adapter start implementation");
      let releaseDelayedStart: () => void = () => undefined;
      const delayedStart = new Promise<void>((resolve) => {
        releaseDelayedStart = resolve;
      });
      routing.codex.startSession.mockImplementationOnce((input) =>
        Effect.promise(() => delayedStart).pipe(Effect.andThen(defaultStart(input))),
      );
      const startCallCount = routing.codex.startSession.mock.calls.length;
      const stopCallCount = routing.codex.stopSession.mock.calls.length;
      const startFiber = yield* provider.startSession(threadId, startInput).pipe(Effect.forkChild);
      yield* waitUntil(
        () => routing.codex.startSession.mock.calls.length > startCallCount,
        500,
        10,
        "delayed provider start",
      );
      const stopFiber = yield* provider.stopSession({ threadId }).pipe(Effect.forkChild);
      yield* sleep(25);
      assert.equal(routing.codex.stopSession.mock.calls.length, stopCallCount);

      releaseDelayedStart();
      yield* Fiber.join(startFiber);
      yield* Fiber.join(stopFiber);
      assert.equal(Option.isNone(yield* directory.getBinding(threadId)), true);
    }),
  );

  const staleSettlementPersistedEvents = new Map<string, ProviderRuntimeEvent>();
  const staleSettlementRouting = makeProviderServiceLayer({
    persistRuntimeEvent: (event) =>
      Effect.suspend(() => {
        staleSettlementPersistedEvents.set(String(event.eventId), event);
        return Effect.succeed({ sequence: staleSettlementPersistedEvents.size, event });
      }),
    runtimeEventRetryBaseDelayMs: 1,
    runtimeEventRetryMaxDelayMs: 1,
  });

  staleSettlementRouting.layer("ProviderServiceLive stale-generation settlement", (it) => {
    it.effect("recovers instead of routing into a session whose binding generation is stale", () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const directory = yield* ProviderSessionDirectory;
        const threadId = asThreadId("thread-stale-binding-routing");
        yield* staleSettlementRouting.codex.waitForRuntimeSubscribers();

        yield* provider.startSession(threadId, {
          provider: "codex",
          threadId,
          cwd: "/tmp/project",
          runtimeMode: "full-access",
        });
        // Rotate the runtime generation (as a stop does), keep a live adapter
        // session around (the zombie), and rewind the persisted binding to the
        // old generation — a turn send must not fast-path into that session,
        // whose events the stale-generation gate would reject.
        assert.equal(typeof provider.stopRuntimeSession, "function");
        if (!provider.stopRuntimeSession) assert.fail("Expected stopRuntimeSession");
        yield* provider.stopRuntimeSession({ threadId });
        yield* directory.upsert({
          threadId,
          provider: "codex",
          status: "running",
          lifecycleGeneration: "old-generation",
          resumeCursor: { opaque: `resume-${String(threadId)}` },
          runtimePayload: { activeTurnId: null },
        });
        yield* staleSettlementRouting.codex.startSession({
          threadId,
          provider: "codex",
          cwd: "/tmp/project",
          runtimeMode: "full-access",
        });

        const sendCallsBefore = staleSettlementRouting.codex.sendTurn.mock.calls.length;
        yield* provider.sendTurn({ threadId, input: "after the wedge", attachments: [] });
        assert.equal(staleSettlementRouting.codex.sendTurn.mock.calls.length, sendCallsBefore + 1);

        // Recovery re-adopts the persisted generation, so the still-live
        // session's events become visible again instead of being dropped.
        staleSettlementRouting.codex.emit({
          type: "content.delta",
          eventId: asEventId("stale-binding-delta"),
          provider: "codex",
          threadId,
          createdAt: "2026-07-14T14:00:00.000Z",
          lifecycleGeneration: "old-generation",
          payload: { streamKind: "assistant_text", delta: "visible again" },
        });
        yield* waitUntil(
          () => staleSettlementPersistedEvents.has("stale-binding-delta"),
          500,
          10,
          "delta from the re-adopted generation to be persisted",
        );
      }),
    );
  });

  it.effect("serializes overlapping same-provider and cross-provider starts", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-overlapping-provider-starts");
      const codexInput: ProviderSessionStartInput = {
        provider: "codex",
        threadId,
        cwd: "/tmp/provider-starts",
        runtimeMode: "full-access",
      };

      yield* provider.startSession(threadId, codexInput);
      const defaultCodexStart = routing.codex.startSession.getMockImplementation();
      if (!defaultCodexStart) assert.fail("Expected the fake Codex start implementation");

      let releaseSameProviderStart: () => void = () => undefined;
      const delayedSameProviderStart = new Promise<void>((resolve) => {
        releaseSameProviderStart = resolve;
      });
      routing.codex.startSession.mockImplementationOnce((input) =>
        Effect.promise(() => delayedSameProviderStart).pipe(
          Effect.andThen(defaultCodexStart(input)),
        ),
      );
      const codexStartCount = routing.codex.startSession.mock.calls.length;
      const claudeStartCount = routing.claude.startSession.mock.calls.length;

      const sameProviderFiber = yield* provider
        .startSession(threadId, codexInput)
        .pipe(Effect.forkChild);
      yield* waitUntil(
        () => routing.codex.startSession.mock.calls.length > codexStartCount,
        500,
        10,
        "same-provider start",
      );
      const crossProviderFiber = yield* provider
        .startSession(threadId, {
          provider: "claudeAgent",
          threadId,
          cwd: "/tmp/provider-starts",
          runtimeMode: "full-access",
        })
        .pipe(Effect.forkChild);
      yield* sleep(25);
      assert.equal(routing.claude.startSession.mock.calls.length, claudeStartCount);

      releaseSameProviderStart();
      yield* Fiber.join(sameProviderFiber);
      yield* Fiber.join(crossProviderFiber);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const [codexSessions, claudeSessions] = yield* Effect.all([
        routing.codex.listSessions(),
        routing.claude.listSessions(),
      ]);
      assert.equal(binding?.provider, "claudeAgent");
      assert.equal(
        codexSessions.some((session) => session.threadId === threadId),
        false,
      );
      assert.equal(claudeSessions.filter((session) => session.threadId === threadId).length, 1);

      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("restores the previous runtime and generation when provider replacement fails", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-failed-provider-replacement");
      const initial = yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/failed-provider-replacement",
        runtimeMode: "full-access",
      });
      const originalBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const replacementFailure = new ProviderAdapterSessionNotFoundError({
        provider: "claudeAgent",
        threadId,
      });
      routing.claude.startSession.mockImplementationOnce(() => Effect.fail(replacementFailure));

      const replacement = yield* Effect.result(
        provider.startSession(threadId, {
          provider: "claudeAgent",
          threadId,
          cwd: "/tmp/failed-provider-replacement",
          runtimeMode: "full-access",
        }),
      );
      assertFailure(replacement, replacementFailure);

      const restoredBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const [codexSessions, claudeSessions] = yield* Effect.all([
        routing.codex.listSessions(),
        routing.claude.listSessions(),
      ]);
      const restoreCall = routing.codex.startSession.mock.calls.findLast(
        ([input]) => input.threadId === threadId,
      )?.[0];
      assert.equal(restoredBinding?.provider, "codex");
      assert.equal(restoredBinding?.status, "running");
      assert.equal(restoredBinding?.lifecycleGeneration, originalBinding?.lifecycleGeneration);
      assert.equal(codexSessions.filter((session) => session.threadId === threadId).length, 1);
      assert.equal(
        claudeSessions.some((session) => session.threadId === threadId),
        false,
      );
      assert.deepEqual(restoreCall?.resumeCursor, initial.resumeCursor);
      assert.equal(restoreCall?.lifecycleGeneration, originalBinding?.lifecycleGeneration);

      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("requires the source lifecycle generation for modern Claude interactions", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-claude-interaction-generation");

      yield* provider.startSession(threadId, {
        provider: "claudeAgent",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "approval-required",
      });
      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const lifecycleGeneration = binding?.lifecycleGeneration;
      assert.equal(typeof lifecycleGeneration, "string");

      const approvalCallCount = routing.claude.respondToRequest.mock.calls.length;
      const missingApprovalGeneration = yield* Effect.result(
        provider.respondToRequest({
          threadId,
          requestId: asRequestId("claude-approval-without-generation"),
          decision: "accept",
        }),
      );
      assertFailure(
        missingApprovalGeneration,
        new ProviderValidationError({
          operation: "ProviderService.respondToRequest",
          issue:
            "Cannot respond to request 'claude-approval-without-generation' without its provider lifecycle generation.",
        }),
      );
      assert.equal(routing.claude.respondToRequest.mock.calls.length, approvalCallCount);

      const userInputCallCount = routing.claude.respondToUserInput.mock.calls.length;
      const missingUserInputGeneration = yield* Effect.result(
        provider.respondToUserInput({
          threadId,
          requestId: asRequestId("claude-user-input-without-generation"),
          answers: { answer: "continue" },
        }),
      );
      assertFailure(
        missingUserInputGeneration,
        new ProviderValidationError({
          operation: "ProviderService.respondToUserInput",
          issue:
            "Cannot respond to request 'claude-user-input-without-generation' without its provider lifecycle generation.",
        }),
      );
      assert.equal(routing.claude.respondToUserInput.mock.calls.length, userInputCallCount);

      yield* provider.respondToRequest({
        threadId,
        requestId: asRequestId("claude-approval-current-generation"),
        lifecycleGeneration,
        decision: "accept",
      });
      yield* provider.respondToUserInput({
        threadId,
        requestId: asRequestId("claude-user-input-current-generation"),
        lifecycleGeneration,
        answers: { answer: "continue" },
      });
      assert.equal(routing.claude.respondToRequest.mock.calls.length, approvalCallCount + 1);
      assert.equal(routing.claude.respondToUserInput.mock.calls.length, userInputCallCount + 1);
      yield* provider.stopSession({ threadId });
      routing.claude.startSession.mockClear();
      routing.claude.respondToRequest.mockClear();
      routing.claude.respondToUserInput.mockClear();
      routing.claude.stopSession.mockClear();
    }),
  );

  it.effect("routes provider operations and rollback conversation", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      routing.codex.sendTurn.mockClear();
      routing.codex.interruptTurn.mockClear();
      routing.codex.startSession.mockClear();
      routing.codex.stopSession.mockClear();
      routing.codex.respondToRequest.mockClear();
      routing.codex.respondToUserInput.mockClear();

      const session = yield* provider.startSession(asThreadId("thread-1"), {
        provider: "codex",
        threadId: asThreadId("thread-1"),
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      assert.equal(session.provider, "codex");
      const binding = Option.getOrUndefined(yield* directory.getBinding(session.threadId));
      const lifecycleGeneration = binding?.lifecycleGeneration;
      assert.equal(typeof lifecycleGeneration, "string");

      const sessions = yield* provider.listSessions();
      assert.equal(sessions.length, 1);

      yield* provider.respondToRequest({
        threadId: session.threadId,
        requestId: asRequestId("req-1"),
        lifecycleGeneration,
        decision: "accept",
      });
      assert.deepEqual(routing.codex.respondToRequest.mock.calls, [
        [session.threadId, asRequestId("req-1"), "accept"],
      ]);

      yield* provider.respondToUserInput({
        threadId: session.threadId,
        requestId: asRequestId("req-user-input-1"),
        lifecycleGeneration,
        answers: {
          sandbox_mode: "workspace-write",
        },
      });
      assert.deepEqual(routing.codex.respondToUserInput.mock.calls, [
        [
          session.threadId,
          asRequestId("req-user-input-1"),
          {
            sandbox_mode: "workspace-write",
          },
        ],
      ]);

      yield* provider.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });
      assert.equal(routing.codex.sendTurn.mock.calls.length, 1);

      yield* provider.interruptTurn({ threadId: session.threadId });
      assert.deepEqual(routing.codex.interruptTurn.mock.calls, [
        [session.threadId, asTurnId("turn-thread-1"), undefined],
      ]);
      assert.deepEqual(routing.codex.stopSession.mock.calls, [[session.threadId]]);
      const fencedBinding = Option.getOrUndefined(yield* directory.getBinding(session.threadId));
      assert.equal(fencedBinding?.status, "stopped");
      assert.equal(
        asRuntimePayloadRecord(fencedBinding?.runtimePayload)
          .agentGatewayCredentialRotationRequired,
        true,
      );

      const startsBeforeRecovery = routing.codex.startSession.mock.calls.length;
      yield* provider.sendTurn({
        threadId: session.threadId,
        input: "continue after interrupt",
        attachments: [],
      });
      assert.equal(routing.codex.startSession.mock.calls.length, startsBeforeRecovery + 1);
      const resumedInput = routing.codex.startSession.mock.calls.at(-1)?.[0];
      assert.deepEqual(resumedInput?.resumeCursor, session.resumeCursor);
      const recoveredBinding = Option.getOrUndefined(yield* directory.getBinding(session.threadId));
      assert.equal(
        asRuntimePayloadRecord(recoveredBinding?.runtimePayload)
          .agentGatewayCredentialRotationRequired,
        false,
      );

      yield* provider.rollbackConversation({
        threadId: session.threadId,
        numTurns: 0,
      });

      yield* provider.stopSession({ threadId: session.threadId });
      const sendAfterStop = yield* Effect.result(
        provider.sendTurn({
          threadId: session.threadId,
          input: "after-stop",
          attachments: [],
        }),
      );
      assertFailure(
        sendAfterStop,
        new ProviderValidationError({
          operation: "ProviderService.sendTurn",
          issue: `Cannot route thread '${session.threadId}' because no persisted provider binding exists.`,
          reason: "runtime-unavailable",
        }),
      );
    }),
  );

  it.effect(
    "retires A's runtime before admitting B while allowing background tasks to finish",
    () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const directory = yield* ProviderSessionDirectory;
        const threadId = asThreadId("thread-terminal-gateway-credential-rotation");
        const turnA = asTurnId(`turn-${threadId}`);

        yield* provider.startSession(threadId, {
          provider: "codex",
          threadId,
          cwd: "/tmp/project",
          runtimeMode: "full-access",
        });
        const initialBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        const lifecycleGeneration = initialBinding?.lifecycleGeneration;
        assert.equal(typeof lifecycleGeneration, "string");
        yield* routing.codex.waitForRuntimeSubscribers();
        yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
        routing.codex.emit({
          type: "task.started",
          eventId: asEventId("terminal-rotation-background-started"),
          provider: "codex",
          createdAt: "2026-07-23T12:00:00.000Z",
          threadId,
          lifecycleGeneration,
          payload: { taskId: "background-after-a" },
        });
        if (provider.hasLiveRuntimeTasks) {
          yield* waitUntilEffect(
            () => provider.hasLiveRuntimeTasks!({ threadId }),
            500,
            20,
            "background task ownership before terminal rotation",
          );
        }
        routing.codex.emit({
          type: "turn.completed",
          eventId: asEventId("terminal-rotation-turn-a-completed"),
          provider: "codex",
          createdAt: "2026-07-23T12:00:01.000Z",
          threadId,
          turnId: turnA,
          lifecycleGeneration,
          payload: { state: "completed" },
          raw: {
            source: "codex.app-server.notification",
            method: "turn/completed",
            payload: { [AGENT_GATEWAY_TURN_AUTHORITY_RETIRED]: true },
          },
        });
        yield* waitUntilEffect(
          () =>
            directory.getBinding(threadId).pipe(
              Effect.map(
                Option.match({
                  onNone: () => false,
                  onSome: (binding) =>
                    asRuntimePayloadRecord(binding.runtimePayload)
                      .agentGatewayCredentialRotationRequired === true,
                }),
              ),
            ),
          500,
          20,
          "terminal credential retirement persistence",
        );

        const startsBeforeB = routing.codex.startSession.mock.calls.length;
        const stopsBeforeB = routing.codex.stopSession.mock.calls.length;
        const sendsBeforeB = routing.codex.sendTurn.mock.calls.length;
        const turnB = yield* provider
          .sendTurn({ threadId, input: "turn B", attachments: [] })
          .pipe(Effect.forkChild);
        yield* sleep(25);
        assert.equal(routing.codex.stopSession.mock.calls.length, stopsBeforeB);
        assert.equal(routing.codex.startSession.mock.calls.length, startsBeforeB);
        assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeB);

        routing.codex.emit({
          type: "task.updated",
          eventId: asEventId("terminal-rotation-background-completed"),
          provider: "codex",
          createdAt: "2026-07-23T12:00:02.000Z",
          threadId,
          lifecycleGeneration,
          payload: { taskId: "background-after-a", status: "completed" },
        });
        yield* Fiber.join(turnB);

        assert.equal(routing.codex.stopSession.mock.calls.length, stopsBeforeB + 1);
        assert.equal(routing.codex.startSession.mock.calls.length, startsBeforeB + 1);
        assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeB + 1);
        const recoveredBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        assert.equal(
          asRuntimePayloadRecord(recoveredBinding?.runtimePayload)
            .agentGatewayCredentialRotationRequired,
          false,
        );

        yield* provider.stopSession({ threadId });
      }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect(
    "fences a next turn before a targeted child interrupt acquires lifecycle ownership",
    () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const directory = yield* ProviderSessionDirectory;
        const threadId = asThreadId("thread-child-interrupt-preflight-fence");
        const responseStarted = yield* Deferred.make<void>();
        const releaseResponse = yield* Deferred.make<void>();
        const defaultRespond = routing.codex.respondToRequest.getMockImplementation();
        assert.isDefined(defaultRespond);
        routing.codex.respondToRequest.mockImplementationOnce((...args) =>
          Deferred.succeed(responseStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseResponse)),
            Effect.andThen(defaultRespond!(...args)),
          ),
        );

        yield* provider.startSession(threadId, {
          provider: "codex",
          threadId,
          cwd: "/tmp/project",
          runtimeMode: "full-access",
        });
        yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
        const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        assert.isDefined(binding?.lifecycleGeneration);
        const sendsBeforeB = routing.codex.sendTurn.mock.calls.length;

        const heldLifecycle = yield* provider
          .respondToRequest({
            threadId,
            requestId: asRequestId("request-holding-lifecycle"),
            lifecycleGeneration: binding!.lifecycleGeneration,
            decision: "accept",
          })
          .pipe(Effect.forkChild);
        yield* Deferred.await(responseStarted);
        const targetedInterrupt = yield* provider
          .interruptTurn({
            threadId,
            turnId: asTurnId("turn-child-A"),
            providerThreadId: "provider-child-A",
          })
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const nextTurn = yield* provider
          .sendTurn({ threadId, input: "turn B", attachments: [] })
          .pipe(Effect.forkChild);
        yield* sleep(10);
        assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeB);

        yield* Deferred.succeed(releaseResponse, undefined);
        yield* Fiber.join(heldLifecycle);
        yield* Fiber.join(targetedInterrupt);
        yield* Fiber.join(nextTurn);
        assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeB + 1);

        yield* provider.stopSession({ threadId });
      }),
  );

  it.effect("tombstones a targeted child stop even when its native interrupt fails", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-child-interrupt-uncertain-failure");
      routing.codex.interruptTurn.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: "codex",
            threadId,
          }),
        ),
      );

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
      const firstStop = yield* Effect.exit(
        provider.interruptTurn({
          threadId,
          turnId: asTurnId("turn-child-failed"),
          providerThreadId: "provider-child-failed",
        }),
      );
      assert.equal(Exit.isFailure(firstStop), true);
      const interruptCallsAfterFailure = routing.codex.interruptTurn.mock.calls.length;

      yield* provider.interruptTurn({
        threadId,
        turnId: asTurnId("turn-child-failed"),
        providerThreadId: "provider-child-failed",
      });
      assert.equal(routing.codex.interruptTurn.mock.calls.length, interruptCallsAfterFailure + 1);
      const interruptCallsAfterRetry = routing.codex.interruptTurn.mock.calls.length;

      yield* provider.sendTurn({ threadId, input: "turn B", attachments: [] });
      const startsAfterRotation = routing.codex.startSession.mock.calls.length;
      const stopsAfterRotation = routing.codex.stopSession.mock.calls.length;
      yield* provider.interruptTurn({
        threadId,
        turnId: asTurnId("turn-child-failed"),
        providerThreadId: "provider-child-failed",
      });
      assert.equal(routing.codex.interruptTurn.mock.calls.length, interruptCallsAfterRetry);

      yield* provider.sendTurn({ threadId, input: "turn C", attachments: [] });
      assert.equal(routing.codex.startSession.mock.calls.length, startsAfterRotation);
      assert.equal(routing.codex.stopSession.mock.calls.length, stopsAfterRotation);

      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("holds a concurrent next turn behind interrupted-runtime credential rotation", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-interrupt-credential-fence");
      const stopStarted = yield* Deferred.make<void>();
      const releaseStop = yield* Deferred.make<void>();
      const defaultStop = routing.codex.stopSession.getMockImplementation();
      assert.isDefined(defaultStop);
      routing.codex.stopSession.mockImplementationOnce((stoppedThreadId) =>
        Deferred.succeed(stopStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseStop)),
          Effect.andThen(defaultStop!(stoppedThreadId)),
        ),
      );

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
      const sendCallsBeforeB = routing.codex.sendTurn.mock.calls.length;

      const interrupted = yield* provider.interruptTurn({ threadId }).pipe(Effect.forkChild);
      yield* Deferred.await(stopStarted);
      const nextTurn = yield* provider
        .sendTurn({ threadId, input: "turn B", attachments: [] })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.equal(routing.codex.sendTurn.mock.calls.length, sendCallsBeforeB);

      yield* Deferred.succeed(releaseStop, undefined);
      yield* Fiber.join(interrupted);
      yield* Fiber.join(nextTurn);
      assert.equal(routing.codex.sendTurn.mock.calls.length, sendCallsBeforeB + 1);

      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("settles the interruption fence when its caller is cancelled during teardown", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-interrupt-caller-cancelled");
      const stopStarted = yield* Deferred.make<void>();
      const releaseStop = yield* Deferred.make<void>();
      const defaultStop = routing.codex.stopSession.getMockImplementation();
      assert.isDefined(defaultStop);
      routing.codex.stopSession.mockImplementationOnce((stoppedThreadId) =>
        Deferred.succeed(stopStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseStop)),
          Effect.andThen(defaultStop!(stoppedThreadId)),
        ),
      );

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
      const sendsBeforeRecovery = routing.codex.sendTurn.mock.calls.length;

      const interrupted = yield* provider.interruptTurn({ threadId }).pipe(Effect.forkChild);
      yield* Deferred.await(stopStarted);
      const cancellation = yield* Fiber.interrupt(interrupted).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      yield* Deferred.succeed(releaseStop, undefined);
      yield* Fiber.join(cancellation);
      yield* provider.sendTurn({ threadId, input: "turn B", attachments: [] });
      assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeRecovery + 1);

      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("fails closed when the interrupted runtime cannot be retired", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-interrupt-retirement-failure");
      routing.codex.stopSession.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: "codex",
            threadId,
          }),
        ),
      );

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
      assert.equal(Exit.isFailure(yield* Effect.exit(provider.interruptTurn({ threadId }))), true);

      const staleSecondInterrupt = yield* Effect.exit(
        provider.interruptTurn({ threadId, turnId: asTurnId("turn-stale-after-failure") }),
      );
      assert.equal(Exit.isFailure(staleSecondInterrupt), true);
      if (Exit.isFailure(staleSecondInterrupt)) {
        const failure = Cause.squash(staleSecondInterrupt.cause);
        assert.instanceOf(failure, ProviderValidationError);
        assert.match(failure.issue, /previous runtime could not be retired safely/);
      }

      const blocked = yield* Effect.exit(
        provider.sendTurn({ threadId, input: "turn B", attachments: [] }),
      );
      assert.equal(Exit.isFailure(blocked), true);
      if (Exit.isFailure(blocked)) {
        const failure = Cause.squash(blocked.cause);
        assert.instanceOf(failure, ProviderValidationError);
        assert.equal(failure.operation, "ProviderService.turnDispatch");
        assert.match(failure.issue, /could not be retired safely/);
      }

      // An explicit session replacement is the recovery authority after a
      // failed teardown and clears the fail-closed fence.
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect(
    "routes early approval and user-input responses to live sessions before persistence",
    () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const directory = yield* ProviderSessionDirectory;
        const threadId = asThreadId("thread-live-startup-prompt");

        routing.codex.respondToRequest.mockClear();
        routing.codex.respondToUserInput.mockClear();
        yield* routing.codex.adapter.startSession({
          provider: "codex",
          threadId,
          runtimeMode: "approval-required",
        });

        const bindingBeforeResponse = yield* directory.getBinding(threadId);
        assert.equal(Option.isNone(bindingBeforeResponse), true);

        yield* provider.respondToRequest({
          threadId,
          requestId: asRequestId("req-live-approval"),
          decision: "accept",
        });
        yield* provider.respondToUserInput({
          threadId,
          requestId: asRequestId("req-live-user-input"),
          answers: {
            answer: "continue",
          },
        });

        assert.deepEqual(routing.codex.respondToRequest.mock.calls, [
          [threadId, asRequestId("req-live-approval"), "accept"],
        ]);
        assert.deepEqual(routing.codex.respondToUserInput.mock.calls, [
          [
            threadId,
            asRequestId("req-live-user-input"),
            {
              answer: "continue",
            },
          ],
        ]);
      }),
  );

  it.effect("recovers stale claudeAgent sessions for sendTurn using persisted cwd", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;

      const initial = yield* provider.startSession(asThreadId("thread-claude-send-turn"), {
        provider: "claudeAgent",
        threadId: asThreadId("thread-claude-send-turn"),
        cwd: "/tmp/project-claude-send-turn",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
          options: {
            effort: "max",
          },
        },
        runtimeMode: "full-access",
      });

      yield* routing.claude.stopAll();
      routing.claude.startSession.mockClear();
      routing.claude.sendTurn.mockClear();

      yield* provider.sendTurn({
        threadId: initial.threadId,
        input: "resume with claude",
        attachments: [],
      });

      assert.equal(routing.claude.startSession.mock.calls.length, 1);
      const resumedStartInput = routing.claude.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          modelSelection?: unknown;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "claudeAgent");
        assert.equal(startPayload.cwd, "/tmp/project-claude-send-turn");
        assert.deepEqual(startPayload.modelSelection, {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
          options: {
            effort: "max",
          },
        });
        assert.deepEqual(startPayload.resumeCursor, initial.resumeCursor);
        assert.equal(startPayload.threadId, initial.threadId);
      }
      assert.equal(routing.claude.sendTurn.mock.calls.length, 1);
    }),
  );

  it.effect("keeps a newer binding active when an overlapping older turn completes late", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-overlapping-stale-terminal");
      const olderTurnId = asTurnId("turn-overlapping-older");
      const newerTurnId = asTurnId("turn-overlapping-newer");
      const olderResumeCursor = { cursor: "older-resume" };
      const newerResumeCursor = { cursor: "newer-resume" };
      const olderModelSelection = { provider: "codex" as const, model: "gpt-5.1-codex-mini" };
      const newerModelSelection = {
        provider: "opencode" as const,
        model: "opencode/minimax-m2.5-free",
      };
      let olderDispatchStarted = false;
      let releaseOlderDispatch: ((result: ProviderTurnStartResult) => void) | undefined;

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      routing.codex.sendTurn
        .mockImplementationOnce(() =>
          Effect.promise(
            () =>
              new Promise<ProviderTurnStartResult>((resolve) => {
                olderDispatchStarted = true;
                releaseOlderDispatch = resolve;
              }),
          ),
        )
        .mockImplementationOnce((input) =>
          Effect.succeed({
            threadId: input.threadId,
            turnId: newerTurnId,
            resumeCursor: newerResumeCursor,
          }),
        );

      const olderSendFiber = yield* provider
        .sendTurn({
          threadId,
          input: "older",
          attachments: [],
          modelSelection: olderModelSelection,
        })
        .pipe(Effect.forkChild);
      yield* waitUntil(() => olderDispatchStarted, 500, 20, "older turn dispatch");
      yield* provider.sendTurn({
        threadId,
        input: "newer",
        attachments: [],
        modelSelection: newerModelSelection,
      });

      yield* routing.codex.waitForRuntimeSubscribers();
      routing.codex.emit({
        type: "turn.completed",
        eventId: asEventId("runtime-overlapping-older-completed"),
        provider: "codex",
        createdAt: "2026-02-27T00:04:00.000Z",
        threadId,
        turnId: olderTurnId,
        payload: { state: "completed" },
      });
      yield* sleep(50);

      const release = releaseOlderDispatch;
      if (!release) {
        assert.fail("Expected delayed older dispatch release callback");
      }
      release({ threadId, turnId: olderTurnId, resumeCursor: olderResumeCursor });
      yield* Fiber.join(olderSendFiber);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const runtimePayload = asRuntimePayloadRecord(binding?.runtimePayload);
      assert.equal(binding?.status, "running");
      assert.deepEqual(binding?.resumeCursor, newerResumeCursor);
      assert.equal(runtimePayload.activeTurnId, newerTurnId);
      assert.equal(runtimePayload.lastRuntimeEvent, "provider.sendTurn");
      assert.deepEqual(runtimePayload.modelSelection, newerModelSelection);
    }),
  );

  it.effect("rolls back turn bookkeeping when started-turn persistence fails", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-started-persistence-failure");
      const failedTurnId = asTurnId("turn-persistence-failed");
      const nextTurnId = asTurnId("turn-after-persistence-failure");
      const persistenceFailure = new ProviderSessionDirectoryPersistenceError({
        operation: "test",
        detail: "injected started-turn persistence failure",
      });

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      routing.codex.sendTurn
        .mockImplementationOnce((input) =>
          Effect.succeed({ threadId: input.threadId, turnId: failedTurnId }),
        )
        .mockImplementationOnce((input) =>
          Effect.succeed({ threadId: input.threadId, turnId: nextTurnId }),
        );
      const upsertSpy = vi
        .spyOn(directory, "upsert")
        .mockImplementationOnce(() => Effect.fail(persistenceFailure));

      const failedResult = yield* Effect.result(
        provider.sendTurn({ threadId, input: "fails to persist", attachments: [] }),
      );
      assertFailure(failedResult, persistenceFailure);
      upsertSpy.mockRestore();

      yield* provider.sendTurn({ threadId, input: "next turn", attachments: [] });
      yield* routing.codex.waitForRuntimeSubscribers();
      routing.codex.emit({
        type: "turn.completed",
        eventId: asEventId("runtime-unscoped-after-persistence-failure"),
        provider: "codex",
        createdAt: "2026-02-27T00:04:00.000Z",
        threadId,
        payload: { state: "completed" },
      });
      yield* sleep(50);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const payload = binding?.runtimePayload as Record<string, unknown>;
      assert.equal(binding?.status, "stopped");
      assert.equal(payload.activeTurnId, null);
      assert.equal(payload.lastRuntimeEvent, "turn.completed");
    }),
  );

  it.effect("refreshes persisted resume cursor immediately on model reroutes", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const runtimeRepository = yield* ProviderSessionRuntimeRepository;

      const session = yield* provider.startSession(asThreadId("thread-runtime-resume-refresh"), {
        provider: "claudeAgent",
        threadId: asThreadId("thread-runtime-resume-refresh"),
        runtimeMode: "full-access",
      });
      const updatedResumeCursor = {
        threadId: session.threadId,
        resume: "550e8400-e29b-41d4-a716-446655440000",
        resumeSessionAt: "assistant-message-refresh",
        turnCount: 2,
        rerouteOriginalApiModelId: "claude-fable-5",
        rerouteFallbackApiModelId: "claude-opus-4-8",
      };

      routing.claude.updateSession(session.threadId, (existing) => ({
        ...existing,
        resumeCursor: updatedResumeCursor,
      }));
      routing.claude.emit({
        type: "model.rerouted",
        eventId: asEventId("runtime-model-rerouted-refresh"),
        provider: "claudeAgent",
        createdAt: "2026-02-27T00:04:00.000Z",
        threadId: session.threadId,
        payload: {
          fromModel: "claude-fable-5",
          toModel: "claude-opus-4-8",
          reason: "Model safeguards rerouted this request.",
        },
      });
      yield* sleep(50);

      const runtime = yield* runtimeRepository.getByThreadId({
        threadId: session.threadId,
      });
      assert.equal(Option.isSome(runtime), true);
      if (Option.isSome(runtime)) {
        assert.deepEqual(runtime.value.resumeCursor, updatedResumeCursor);
      }
    }),
  );

  it.effect("reuses persisted resume cursor when startSession is called after a restart", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glade-provider-service-start-"));
      const dbPath = path.join(tempDir, "orchestration.sqlite");
      const persistenceLayer = makeSqlitePersistenceLive(dbPath);
      const runtimeRepositoryLayer = ProviderSessionRuntimeRepositoryLive.pipe(
        Layer.provide(persistenceLayer),
      );

      const firstClaude = makeFakeCodexAdapter("claudeAgent");
      const firstRegistry: typeof ProviderAdapterRegistry.Service = {
        getByProvider: (provider) =>
          provider === "claudeAgent"
            ? Effect.succeed(firstClaude.adapter)
            : Effect.fail(new ProviderUnsupportedError({ provider })),
        listProviders: () => Effect.succeed(["claudeAgent"]),
      };
      const firstDirectoryLayer = ProviderSessionDirectoryLive.pipe(
        Layer.provide(runtimeRepositoryLayer),
      );
      const firstProviderLayer = makeProviderServiceLive().pipe(
        Layer.provide(Layer.succeed(ProviderAdapterRegistry, firstRegistry)),
        Layer.provide(firstDirectoryLayer),
      );

      const initial = yield* Effect.gen(function* () {
        const provider = yield* ProviderService;
        return yield* provider.startSession(asThreadId("thread-claude-start"), {
          provider: "claudeAgent",
          threadId: asThreadId("thread-claude-start"),
          cwd: "/tmp/project-claude-start",
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(firstProviderLayer));

      yield* Effect.gen(function* () {
        const provider = yield* ProviderService;
        yield* provider.listSessions();
      }).pipe(Effect.provide(firstProviderLayer));

      const secondClaude = makeFakeCodexAdapter("claudeAgent");
      const secondRegistry: typeof ProviderAdapterRegistry.Service = {
        getByProvider: (provider) =>
          provider === "claudeAgent"
            ? Effect.succeed(secondClaude.adapter)
            : Effect.fail(new ProviderUnsupportedError({ provider })),
        listProviders: () => Effect.succeed(["claudeAgent"]),
      };
      const secondDirectoryLayer = ProviderSessionDirectoryLive.pipe(
        Layer.provide(runtimeRepositoryLayer),
      );
      const secondProviderLayer = makeProviderServiceLive().pipe(
        Layer.provide(Layer.succeed(ProviderAdapterRegistry, secondRegistry)),
        Layer.provide(secondDirectoryLayer),
      );

      secondClaude.startSession.mockClear();

      yield* Effect.gen(function* () {
        const provider = yield* ProviderService;
        yield* provider.startSession(initial.threadId, {
          provider: "claudeAgent",
          threadId: initial.threadId,
          cwd: "/tmp/project-claude-start",
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(secondProviderLayer));

      assert.equal(secondClaude.startSession.mock.calls.length, 1);
      const resumedStartInput = secondClaude.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "claudeAgent");
        assert.equal(startPayload.cwd, "/tmp/project-claude-start");
        assert.deepEqual(startPayload.resumeCursor, initial.resumeCursor);
        assert.equal(startPayload.threadId, initial.threadId);
      }

      fs.rmSync(tempDir, { recursive: true, force: true });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

rotationRetry.layer("ProviderServiceLive credential rotation event durability", (it) => {
  it.effect("retries task settlement durably before rotating the provider generation", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-terminal-rotation-persistence-retry");
      const turnId = asTurnId(`turn-${threadId}`);
      const settlementEventId = asEventId(ROTATION_RETRY_FAILURE_EVENT_ID);
      rotationRetryPersistAttempts.clear();

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const lifecycleGeneration = binding?.lifecycleGeneration;
      assert.equal(typeof lifecycleGeneration, "string");
      yield* rotationRetry.codex.waitForRuntimeSubscribers();
      yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });

      rotationRetry.codex.emit({
        type: "task.started",
        eventId: asEventId("terminal-rotation-retry-task-started"),
        provider: "codex",
        createdAt: "2026-07-24T10:00:00.000Z",
        threadId,
        lifecycleGeneration,
        payload: { taskId: "background-retry" },
      });
      if (provider.hasLiveRuntimeTasks) {
        yield* waitUntilEffect(
          () => provider.hasLiveRuntimeTasks!({ threadId }),
          500,
          20,
          "background task registration before persistence retry",
        );
      }

      rotationRetry.codex.emit({
        type: "turn.completed",
        eventId: asEventId("terminal-rotation-retry-turn-completed"),
        provider: "codex",
        createdAt: "2026-07-24T10:00:01.000Z",
        threadId,
        turnId,
        lifecycleGeneration,
        payload: { state: "completed" },
        raw: {
          source: "codex.app-server.notification",
          method: "turn/completed",
          payload: { [AGENT_GATEWAY_TURN_AUTHORITY_RETIRED]: true },
        },
      });
      yield* waitUntilEffect(
        () =>
          directory.getBinding(threadId).pipe(
            Effect.map(
              Option.match({
                onNone: () => false,
                onSome: (current) =>
                  asRuntimePayloadRecord(current.runtimePayload)
                    .agentGatewayCredentialRotationRequired === true,
              }),
            ),
          ),
        500,
        20,
        "credential rotation flag before persistence retry",
      );

      const receivedEventIds: string[] = [];
      const settlementConsumer = yield* provider.streamEvents.pipe(
        Stream.filter((event) => event.eventId === settlementEventId),
        Stream.take(1),
        Stream.runForEach((event) =>
          Effect.sync(() => {
            receivedEventIds.push(String(event.eventId));
          }),
        ),
        Effect.forkChild,
      );
      yield* sleep(20);

      const startsBeforeB = rotationRetry.codex.startSession.mock.calls.length;
      const stopsBeforeB = rotationRetry.codex.stopSession.mock.calls.length;
      const turnB = yield* provider
        .sendTurn({ threadId, input: "turn B", attachments: [] })
        .pipe(Effect.forkChild);
      rotationRetry.codex.emit({
        type: "task.updated",
        eventId: settlementEventId,
        provider: "codex",
        createdAt: "2026-07-24T10:00:02.000Z",
        threadId,
        lifecycleGeneration,
        payload: { taskId: "background-retry", status: "completed" },
      });

      yield* waitUntilEffect(
        () =>
          provider.getRuntimeEventPumpHealth
            ? provider
                .getRuntimeEventPumpHealth()
                .pipe(
                  Effect.map(
                    (health) =>
                      health.find((entry) => entry.provider === "codex")?.status === "recovering",
                  ),
                )
            : Effect.succeed(false),
        1_000,
        20,
        "runtime event pump persistence retry scheduling",
      );
      yield* TestClock.adjust("2 millis");
      yield* waitUntil(
        () => rotationRetryPersistAttempts.get(String(settlementEventId)) === 2,
        1_000,
        20,
        "task settlement persistence retry",
      );
      yield* waitUntil(
        () => receivedEventIds.length === 1,
        1_000,
        20,
        "task settlement fanout after persistence retry",
      );
      yield* waitUntil(
        () =>
          rotationRetry.codex.stopSession.mock.calls.length === stopsBeforeB + 1 &&
          rotationRetry.codex.startSession.mock.calls.length === startsBeforeB + 1,
        1_000,
        20,
        "credential rotation after durable task settlement",
      );
      yield* Fiber.join(settlementConsumer);
      yield* Fiber.join(turnB);

      assert.equal(rotationRetryPersistAttempts.get(String(settlementEventId)), 2);
      assert.deepEqual(receivedEventIds, [String(settlementEventId)]);
      assert.equal(rotationRetry.codex.stopSession.mock.calls.length, stopsBeforeB + 1);
      assert.equal(rotationRetry.codex.startSession.mock.calls.length, startsBeforeB + 1);

      yield* provider.stopSession({ threadId });
    }),
  );
});

const idleCleanup = makeProviderServiceLayer({ runtimeIdleStopMs: 100 });
idleCleanup.layer("ProviderServiceLive idle cleanup", (it) => {
  it.effect("retries failed idle teardown after a delayed session exit notification", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-idle-cleanup-retry");
      const originalStop = idleCleanup.codex.stopSession.getMockImplementation()!;
      idleCleanup.codex.stopSession.mockClear();
      idleCleanup.codex.stopSession.mockImplementationOnce((id) =>
        originalStop(id).pipe(
          Effect.andThen(
            Effect.fail(
              new ProviderAdapterProcessError({
                provider: "codex",
                threadId: id,
                detail: "Descendant still alive",
              }),
            ),
          ),
        ),
      );
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      yield* idleCleanup.codex.waitForRuntimeSubscribers();
      idleCleanup.codex.emit({
        type: "turn.completed",
        eventId: asEventId("idle-retry-completed"),
        provider: "codex",
        threadId,
        createdAt: new Date().toISOString(),
        payload: { state: "completed" },
      });
      yield* waitUntil(() => idleCleanup.codex.stopSession.mock.calls.length === 1);
      yield* sleep(30);
      idleCleanup.codex.emit({
        type: "session.exited",
        eventId: asEventId("runtime-idle-delayed-exit"),
        provider: "codex",
        threadId,
        createdAt: new Date().toISOString(),
        payload: { reason: "stopped" },
      });
      yield* waitUntilEffect(() =>
        directory
          .getBinding(threadId)
          .pipe(
            Effect.map(
              (binding) =>
                asRuntimePayloadRecord(Option.getOrUndefined(binding)?.runtimePayload)
                  .lastRuntimeEvent === "session.exited",
            ),
          ),
      );
      assert.isFalse(yield* idleCleanup.codex.adapter.hasSession(threadId));
      yield* waitUntil(() => idleCleanup.codex.stopSession.mock.calls.length === 2, 2_000);
      yield* waitUntilEffect(() =>
        directory
          .getBinding(threadId)
          .pipe(
            Effect.map(
              (binding) =>
                asRuntimePayloadRecord(Option.getOrUndefined(binding)?.runtimePayload)
                  .lastRuntimeEvent === "provider.stopRuntimeSession",
            ),
          ),
      );
      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("cancels a pending idle cleanup retry when new user work starts", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-idle-retry-new-work");
      idleCleanup.codex.stopSession.mockClear();
      idleCleanup.codex.stopSession.mockReturnValueOnce(
        Effect.fail(
          new ProviderAdapterProcessError({
            provider: "codex",
            threadId,
            detail: "Temporary cleanup failure",
          }),
        ),
      );
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      yield* idleCleanup.codex.waitForRuntimeSubscribers();
      idleCleanup.codex.emit({
        type: "turn.completed",
        eventId: asEventId("idle-retry-new-work-completed"),
        provider: "codex",
        threadId,
        createdAt: new Date().toISOString(),
        payload: { state: "completed" },
      });
      yield* waitUntil(() => idleCleanup.codex.stopSession.mock.calls.length === 1);
      yield* sleep(30);
      yield* provider.sendTurn({ threadId, input: "new work" });
      yield* sleep(1_100);
      assert.equal(idleCleanup.codex.stopSession.mock.calls.length, 1);
      assert.isTrue(yield* idleCleanup.codex.adapter.hasSession(threadId));
      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("keeps the runtime alive until background tasks settle", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-idle-background-task");

      idleCleanup.claude.stopSession.mockClear();
      const session = yield* provider.startSession(threadId, {
        provider: "claudeAgent",
        threadId,
        runtimeMode: "full-access",
      });
      yield* idleCleanup.claude.waitForRuntimeSubscribers();
      idleCleanup.claude.emit({
        type: "task.started",
        eventId: asEventId("runtime-background-task-started"),
        provider: "claudeAgent",
        createdAt: "2026-07-16T20:00:00.000Z",
        threadId,
        payload: { taskId: "background-task-1" },
      });
      idleCleanup.claude.emit({
        type: "turn.completed",
        eventId: asEventId("runtime-background-parent-completed"),
        provider: "claudeAgent",
        createdAt: "2026-07-16T20:00:01.000Z",
        threadId,
        payload: { state: "completed" },
      });

      yield* sleep(150);
      assert.equal(idleCleanup.claude.stopSession.mock.calls.length, 0);

      idleCleanup.claude.emit({
        type: "task.updated",
        eventId: asEventId("runtime-background-task-completed"),
        provider: "claudeAgent",
        createdAt: "2026-07-16T20:00:02.000Z",
        threadId,
        payload: { taskId: "background-task-1", status: "completed" },
      });

      yield* waitUntil(
        () => idleCleanup.claude.stopSession.mock.calls.length > 0,
        500,
        20,
        "idle runtime stop after background task settlement",
      );
      assert.deepEqual(idleCleanup.claude.stopSession.mock.calls[0]?.[0], session.threadId);
    }),
  );

  it.effect("keeps lifecycle ownership on the first of two conflicting turn starts", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-conflicting-runtime-starts");
      const firstTurnId = asTurnId("turn-conflicting-start-first");
      const secondTurnId = asTurnId("turn-conflicting-start-second");

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      yield* idleCleanup.codex.waitForRuntimeSubscribers();
      idleCleanup.codex.emit({
        type: "turn.started",
        eventId: asEventId("runtime-conflicting-start-first"),
        provider: "codex",
        createdAt: "2026-02-27T00:04:01.000Z",
        threadId,
        turnId: firstTurnId,
        payload: { state: "running" },
      });
      yield* waitUntilEffect(
        () =>
          directory.getBinding(threadId).pipe(
            Effect.map((current) => {
              const binding = Option.getOrUndefined(current);
              const payload = binding?.runtimePayload as Record<string, unknown> | undefined;
              return payload?.activeTurnId === firstTurnId;
            }),
          ),
        500,
        20,
        "first runtime turn start persistence",
      );

      idleCleanup.codex.emit({
        type: "turn.started",
        eventId: asEventId("runtime-conflicting-start-second"),
        provider: "codex",
        createdAt: "2026-02-27T00:04:02.000Z",
        threadId,
        turnId: secondTurnId,
        payload: { state: "running" },
      });
      yield* sleep(50);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const payload = binding?.runtimePayload as Record<string, unknown>;
      assert.equal(binding?.status, "running");
      assert.equal(payload.activeTurnId, firstTurnId);
      assert.equal(payload.lastRuntimeEvent, "turn.started");
    }),
  );
});

const fanout = makeProviderServiceLayer();
fanout.layer("ProviderServiceLive fanout", (it) => {
  it.effect("keeps subscriber delivery ordered and isolates failing subscribers", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const session = yield* provider.startSession(asThreadId("thread-1"), {
        provider: "codex",
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access",
      });

      const receivedByHealthy: string[] = [];
      const expectedEventIds = new Set<string>(["evt-ordered-1", "evt-ordered-2", "evt-ordered-3"]);
      const healthyFiber = yield* Stream.take(provider.streamEvents, 3).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            receivedByHealthy.push(event.eventId);
          }),
        ),
        Effect.forkChild,
      );
      const failingFiber = yield* Stream.take(provider.streamEvents, 1).pipe(
        Stream.runForEach(() => Effect.fail("listener crash")),
        Effect.forkChild,
      );
      yield* sleep(50);

      const events: ReadonlyArray<LegacyProviderRuntimeEvent> = [
        {
          type: "tool.completed",
          eventId: asEventId("evt-ordered-1"),
          provider: "codex",
          createdAt: new Date().toISOString(),
          threadId: session.threadId,
          turnId: asTurnId("turn-1"),
          toolKind: "command",
          title: "Ran command",
          detail: "echo one",
        },
        {
          type: "message.delta",
          eventId: asEventId("evt-ordered-2"),
          provider: "codex",
          createdAt: new Date().toISOString(),
          threadId: session.threadId,
          turnId: asTurnId("turn-1"),
          delta: "hello",
        },
        {
          type: "turn.completed",
          eventId: asEventId("evt-ordered-3"),
          provider: "codex",
          createdAt: new Date().toISOString(),
          threadId: session.threadId,
          turnId: asTurnId("turn-1"),
          status: "completed",
        },
      ];

      for (const event of events) {
        fanout.codex.emit(event);
      }
      const failingResult = yield* Effect.result(Fiber.join(failingFiber));
      assert.equal(failingResult._tag, "Failure");
      yield* Fiber.join(healthyFiber);

      assert.deepEqual(
        receivedByHealthy.filter((eventId) => expectedEventIds.has(eventId)).slice(0, 3),
        ["evt-ordered-1", "evt-ordered-2", "evt-ordered-3"],
      );
    }),
  );
});

let persistedFanoutSequence = 0;
const persistedFanout = makeProviderServiceLayer({
  persistRuntimeEvent: (event) =>
    Effect.sync(() => ({
      sequence: ++persistedFanoutSequence,
      event,
    })),
});
persistedFanout.layer("ProviderServiceLive durable fanout", (it) => {
  it.effect("reuses the durable journal result without changing the canonical event stream", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-persisted-fanout");
      const session = yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      assert.notEqual(provider.streamPersistedEvents, undefined);

      const canonicalEvents = yield* Ref.make<Array<ProviderRuntimeEvent>>([]);
      const persistedEvents = yield* Ref.make<
        Array<{ readonly sequence: number; readonly event: ProviderRuntimeEvent }>
      >([]);
      const canonicalEventFiber = yield* Stream.runForEach(provider.streamEvents, (event) =>
        Ref.update(canonicalEvents, (current) => [...current, event]),
      ).pipe(Effect.forkChild);
      const persistedEventFiber = yield* Stream.runForEach(
        provider.streamPersistedEvents!,
        (event) => Ref.update(persistedEvents, (current) => [...current, event]),
      ).pipe(Effect.forkChild);
      yield* sleep(50);

      const completedEvent: LegacyProviderRuntimeEvent = {
        type: "turn.completed",
        eventId: asEventId("evt-persisted-fanout"),
        provider: "codex",
        createdAt: new Date().toISOString(),
        threadId: session.threadId,
        turnId: asTurnId("turn-persisted-fanout"),
        status: "completed",
      };
      persistedFanout.codex.emit(completedEvent);
      yield* sleep(100);

      const canonicalEvent = (yield* Ref.get(canonicalEvents))[0];
      const persistedEvent = (yield* Ref.get(persistedEvents))[0];
      yield* Fiber.interrupt(canonicalEventFiber);
      yield* Fiber.interrupt(persistedEventFiber);
      assert.notEqual(canonicalEvent, undefined);
      assert.notEqual(persistedEvent, undefined);
      if (canonicalEvent === undefined || persistedEvent === undefined) {
        assert.fail("Expected both canonical and persisted runtime events");
      }
      assert.equal(canonicalEvent.eventId, completedEvent.eventId);
      assert.equal(persistedEvent.event.eventId, completedEvent.eventId);
      assert.equal(persistedEvent.sequence > 0, true);
    }),
  );
});

const validation = makeProviderServiceLayer();
validation.layer("ProviderServiceLive validation", (it) => {
  it.effect("fails closed when startSession has no provider source", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-no-provider");

      const failure = yield* Effect.result(
        provider.startSession(threadId, {
          threadId,
          runtimeMode: "full-access",
        }),
      );

      assert.equal(failure._tag, "Failure");
      if (failure._tag !== "Failure") return;
      assert.equal(failure.failure._tag, "ProviderValidationError");
      if (failure.failure._tag !== "ProviderValidationError") return;
      assert.equal(failure.failure.operation, "provider.session.start");
    }),
  );
});

const disabledProviderStart = makeProviderServiceLayer({
  providerIsEnabled: (provider) => Effect.succeed(provider !== "codex"),
});
disabledProviderStart.layer("ProviderServiceLive enablement", (it) => {
  it.effect("rejects native imports for disabled providers before touching the source", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const result = yield* Effect.result(
        provider.importExternalThread!({
          threadId: asThreadId("disabled-import"),
          provider: "codex",
          externalThreadId: "source",
          sourceCwd: "/repo/source",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
        }),
      );
      assert.equal(result._tag, "Failure");
      assert.equal(disabledProviderStart.codex.forkThread.mock.calls.length, 0);
    }),
  );
});

let providerEnabledDuringStart = true;
const providerDisabledAfterInitialCheck = makeProviderServiceLayer({
  providerIsEnabled: () =>
    Effect.sync(() => {
      const enabled = providerEnabledDuringStart;
      providerEnabledDuringStart = false;
      return enabled;
    }),
});
providerDisabledAfterInitialCheck.layer("ProviderServiceLive enablement race", (it) => {
  it.effect("rechecks provider enablement immediately before adapter startup", () =>
    Effect.gen(function* () {
      providerEnabledDuringStart = true;
      providerDisabledAfterInitialCheck.codex.startSession.mockClear();
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-disabled-during-start");

      const failure = yield* Effect.result(
        provider.startSession(threadId, {
          provider: "codex",
          threadId,
          runtimeMode: "full-access",
        }),
      );

      assert.equal(failure._tag, "Failure");
      if (failure._tag !== "Failure") return;
      assert.equal(failure.failure._tag, "ProviderValidationError");
      assert.equal(failure.failure.message.includes("disabled"), true);
      assert.equal(providerDisabledAfterInitialCheck.codex.startSession.mock.calls.length, 0);
    }),
  );
});

const liveFallback = makeProviderServiceLayer();
liveFallback.layer("ProviderServiceLive live-fallback settled turns", (it) => {
  it.effect("persists the first binding row as stopped when the turn settles pre-write", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-live-fallback-settled");
      const turnId = asTurnId("turn-live-fallback-settled");

      // The adapter owns a live session but startSession has not persisted a
      // binding row yet (the startup window resolveRoutableSession allows).
      liveFallback.codex.hasSession.mockImplementation((candidate: ThreadId) =>
        Effect.succeed(candidate === threadId),
      );
      liveFallback.codex.sendTurn.mockImplementationOnce((input: ProviderSendTurnInput) =>
        Effect.gen(function* () {
          // The terminal runtime event is fully processed before sendTurn
          // returns, so the post-dispatch write takes the settled-turn branch.
          liveFallback.codex.emit({
            type: "turn.completed",
            eventId: asEventId("evt-live-fallback-settled"),
            provider: "codex",
            createdAt: new Date().toISOString(),
            threadId: input.threadId,
            turnId,
            payload: { state: "cancelled" },
          });
          yield* sleep(100);
          return { threadId: input.threadId, turnId };
        }),
      );
      yield* liveFallback.codex.waitForRuntimeSubscribers();

      yield* provider.sendTurn({ threadId, input: "hello" });

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(binding?.status, "stopped");
    }),
  );
});
