import { assert, it } from "@effect/vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Deferred, Effect, Fiber, Stream } from "effect";
import { AppPresentation } from "../Services/AppPresentation";
import { AppPresentationLive } from "./AppPresentation";

it.layer(AppPresentationLive)("App presentation lifecycle", (it) => {
  it.effect(
    "requires a connected UI and accepts acknowledgements only from its selected client",
    () =>
      Effect.gen(function* () {
        const presentation = yield* AppPresentation;
        const request = {
          threadId: ThreadId.makeUnsafe("thread"),
          target: { kind: "terminal" as const },
        };
        const unavailable = yield* presentation.open(request).pipe(Effect.flip);
        assert.include(unavailable.message, "No Glade UI");
        const received = yield* Deferred.make<string>();
        const listener = yield* presentation.stream(1).pipe(
          Stream.runForEach((event) => Deferred.succeed(received, event.requestId)),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const opening = yield* presentation.open(request).pipe(Effect.forkChild);
        const requestId = yield* Deferred.await(received);
        assert.isFalse(yield* presentation.acknowledge(2, { requestId }));
        assert.isTrue(yield* presentation.acknowledge(1, { requestId }));
        yield* Fiber.join(opening);
        yield* Fiber.interrupt(listener);
        assert.isFalse(yield* presentation.acknowledge(1, { requestId }));
      }),
  );

  it.effect("fails a pending open when its UI disconnects", () =>
    Effect.gen(function* () {
      const presentation = yield* AppPresentation;
      const received = yield* Deferred.make<void>();
      const listener = yield* presentation.stream(1).pipe(
        Stream.runForEach(() => Deferred.succeed(received, undefined)),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      const opening = yield* presentation
        .open({ threadId: ThreadId.makeUnsafe("thread"), target: { kind: "terminal" } })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(received);
      yield* Fiber.interrupt(listener);
      assert.include((yield* Fiber.join(opening)).message, "disconnected");
    }),
  );
});
