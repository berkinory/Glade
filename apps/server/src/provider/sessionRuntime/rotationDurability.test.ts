import { Effect, Option, Stream, Fiber } from "effect";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { assert } from "@effect/vitest";
import { AGENT_GATEWAY_TURN_AUTHORITY_RETIRED } from "../../agentGateway/sessionLease.ts";
import { TestClock } from "effect/testing";
import {
  makeProviderServiceLayer,
  InjectedFailure,
  asThreadId,
  asTurnId,
  asEventId,
  waitUntilEffect,
  asRuntimePayloadRecord,
  sleep,
  waitUntil,
} from "./providerServiceTestFixtures";

const rotationRetryPersistAttempts = new Map<string, number>();

const ROTATION_RETRY_FAILURE_EVENT_ID = "terminal-rotation-settlement-retry";

const rotationRetry = makeProviderServiceLayer({
  persistRuntimeEvent: (event) =>
    Effect.suspend(() => {
      const eventId = String(event.eventId);
      const attempts = (rotationRetryPersistAttempts.get(eventId) ?? 0) + 1;
      rotationRetryPersistAttempts.set(eventId, attempts);
      if (eventId === ROTATION_RETRY_FAILURE_EVENT_ID && attempts === 1) {
        return Effect.fail(new InjectedFailure("injected transient runtime persistence failure"));
      }
      return Effect.succeed({ sequence: attempts, event });
    }),
  runtimeEventRetry: { baseDelayMs: 1, maxDelayMs: 1 },
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
