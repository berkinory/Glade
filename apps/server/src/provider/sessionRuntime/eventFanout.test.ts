import { Effect, Stream, Fiber, Ref } from "effect";
import { ProviderService } from "../Services/ProviderService.ts";
import { assert } from "@effect/vitest";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import {
  makeProviderServiceLayer,
  asThreadId,
  sleep,
  LegacyProviderRuntimeEvent,
  asEventId,
  asTurnId,
} from "./providerServiceTestFixtures";

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
