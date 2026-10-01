import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { describe, expect } from "vitest";
import { GitProcessQueue } from "./gitProcessQueue";

describe("Git process admission", () => {
  it.effect("caps active operations and releases permits after failure", () =>
    Effect.gen(function* () {
      const queue = new GitProcessQueue(6);
      let active = 0;
      let peak = 0;
      yield* Effect.all(
        Array.from({ length: 24 }, (_, index) =>
          queue.run(
            Effect.acquireUseRelease(
              Effect.sync(() => {
                active += 1;
                peak = Math.max(peak, active);
              }),
              () =>
                Effect.yieldNow.pipe(
                  Effect.flatMap(() => (index % 2 ? Effect.void : Effect.fail("failed"))),
                ),
              () =>
                Effect.sync(() => {
                  active -= 1;
                }),
            ).pipe(Effect.exit),
            "background",
          ),
        ),
        { concurrency: "unbounded" },
      );
      expect(peak).toBe(6);
      expect(active).toBe(0);
      yield* queue.run(Effect.void, "foreground");
    }),
  );

  it.effect("serves foreground work first and cancels queued work without leaking a permit", () =>
    Effect.gen(function* () {
      const queue = new GitProcessQueue(1);
      const gate = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const order: string[] = [];
      const first = yield* queue
        .run(
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate))),
          "background",
        )
        .pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      const cancelled = yield* queue
        .run(
          Effect.sync(() => order.push("cancelled")),
          "background",
        )
        .pipe(Effect.forkScoped);
      const background = yield* queue
        .run(
          Effect.sync(() => order.push("background")),
          "background",
        )
        .pipe(Effect.forkScoped);
      const foreground = yield* queue
        .run(
          Effect.sync(() => order.push("foreground")),
          "foreground",
        )
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(cancelled);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(background);
      yield* Fiber.join(foreground);
      yield* queue.run(
        Effect.sync(() => order.push("last")),
        "foreground",
      );
      expect(order).toEqual(["foreground", "background", "last"]);
    }),
  );
});
