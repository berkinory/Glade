import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect } from "vitest";
import { GitProcessQueue, type GitProcessClass } from "./gitProcessQueue";

const overloaded = () => "overloaded" as const;
const makeQueue = (limit: number, reserved = {}, maxQueuedPerClass = 64) =>
  new GitProcessQueue({ limit, reserved, maxQueuedPerClass });

describe("Git process admission", () => {
  it.effect("caps active operations and releases permits after failure", () =>
    Effect.gen(function* () {
      const queue = makeQueue(6);
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
                  Effect.flatMap(() => (index % 2 ? Effect.void : Effect.fail("failed" as const))),
                ),
              () =>
                Effect.sync(() => {
                  active -= 1;
                }),
            ).pipe(Effect.exit),
            "background",
            overloaded,
          ),
        ),
        { concurrency: "unbounded" },
      );
      expect(peak).toBe(6);
      expect(active).toBe(0);
      yield* queue.run(Effect.void, "foreground", overloaded);
    }),
  );

  it.effect("serves foreground work first and cancels queued work without leaking a permit", () =>
    Effect.gen(function* () {
      const queue = makeQueue(1);
      const gate = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const order: string[] = [];
      const run = (label: string, processClass: GitProcessClass) =>
        queue
          .run(
            Effect.sync(() => order.push(label)),
            processClass,
            overloaded,
          )
          .pipe(Effect.forkScoped);
      const first = yield* queue
        .run(
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate))),
          "background",
          overloaded,
        )
        .pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      const cancelled = yield* run("cancelled", "background");
      const background = yield* run("background", "background");
      const foreground = yield* run("foreground", "foreground");
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(cancelled);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(background);
      yield* Fiber.join(foreground);
      yield* queue.run(
        Effect.sync(() => order.push("last")),
        "foreground",
        overloaded,
      );
      expect(order).toEqual(["foreground", "background", "last"]);
    }),
  );

  it.effect("keeps reserved slots for checkpoints and interactive reads under refresh load", () =>
    Effect.gen(function* () {
      const queue = makeQueue(4, { checkpoint: 1, foreground: 1 });
      const gate = yield* Deferred.make<void>();
      let backgroundActive = 0;
      const backgrounds = yield* Effect.forEach(Array.from({ length: 6 }), () =>
        queue
          .run(
            Effect.sync(() => (backgroundActive += 1)).pipe(Effect.andThen(Deferred.await(gate))),
            "background",
            overloaded,
          )
          .pipe(Effect.forkScoped),
      );
      yield* Effect.yieldNow;
      expect(backgroundActive).toBe(2);
      yield* queue.run(Effect.void, "checkpoint", overloaded);
      yield* queue.run(Effect.void, "foreground", overloaded);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.joinAll(backgrounds);
      expect(backgroundActive).toBe(6);
    }),
  );

  it.effect("fails fast when a class backlog is full and lets background work progress", () =>
    Effect.gen(function* () {
      const queue = makeQueue(1, {}, 2);
      const gate = yield* Deferred.make<void>();
      const holder = yield* queue
        .run(Deferred.await(gate), "foreground", overloaded)
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      const order: string[] = [];
      const queued = yield* Effect.forEach(["bg-1", "bg-2"], (label) =>
        queue
          .run(
            Effect.sync(() => order.push(label)),
            "background",
            overloaded,
          )
          .pipe(Effect.forkScoped),
      );
      yield* Effect.yieldNow;
      const rejected = yield* queue.run(Effect.void, "background", overloaded).pipe(Effect.exit);
      expect(Exit.isFailure(rejected)).toBe(true);

      // A steady foreground stream must not starve the waiting background reads forever.
      const foregrounds = yield* Effect.forEach(
        Array.from({ length: 2 }, (_, index) => `fg-${index}`),
        (label) =>
          queue
            .run(
              Effect.sync(() => order.push(label)),
              "foreground",
              overloaded,
            )
            .pipe(Effect.forkScoped),
      );
      yield* Effect.yieldNow;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(holder);
      yield* Fiber.joinAll([...queued, ...foregrounds]);
      expect(order.indexOf("bg-1")).toBeLessThan(order.indexOf("fg-1"));
    }),
  );
});
