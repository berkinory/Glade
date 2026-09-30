import { Effect, Option, Deferred, Fiber, Layer } from "effect";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  ProviderAdapterRequestError,
  ProviderValidationError,
  ProviderAdapterSessionNotFoundError,
  ProviderUnsupportedError,
} from "../core/Errors.ts";
import { assert } from "@effect/vitest";
import { ProviderSessionStartInput } from "@glade/contracts/provider/provider";
import { assertFailure } from "@effect/vitest/utils";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderSessionDirectoryLive } from "../Layers/ProviderSessionDirectory.ts";
import { makeProviderServiceLive } from "../Layers/ProviderService.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  routing,
  asThreadId,
  asRequestId,
  asEventId,
  sleep,
  waitUntil,
  makeProviderServiceLayer,
  makeFakeCodexAdapter,
} from "./providerServiceTestFixtures";

routing.layer("Provider service sessionLifecycle", (it) => {
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
        // Rotate the runtime generation (as a stop does), keep a live adapter session around (the zombie),
        // and rewind the persisted binding to the old generation — a turn send must not fast-path into that
        // session, whose events the stale-generation gate would reject.
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
