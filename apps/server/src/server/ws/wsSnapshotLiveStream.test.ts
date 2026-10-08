import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { WS_STREAM_OVERFLOW_CODE } from "@glade/contracts/transport/ws/rpcErrors";
import { Deferred, Effect, Exit, Fiber, PubSub, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeCursorSafeSnapshotLiveStream,
  type SnapshotLiveStreamItem,
} from "./wsSnapshotLiveStream";

// Only `sequence` and the serialized size matter to the stream; the rest of the event is opaque.
const event = (sequence: number, text = "") =>
  ({ sequence, text }) as unknown as OrchestrationEvent;

const settle = Effect.sleep(20);

const harness = (input: {
  readonly snapshot?: Effect.Effect<number>;
  readonly highWater: number;
  readonly replay?: ReadonlyArray<OrchestrationEvent>;
  readonly resumeFromSequence?: number;
}) =>
  Effect.gen(function* () {
    const live = yield* PubSub.unbounded<OrchestrationEvent>();
    const stream = makeCursorSafeSnapshotLiveStream<number, never>({
      subscribeLive: PubSub.subscribe(live).pipe(Effect.map(Stream.fromSubscription)),
      liveLabel: "test",
      snapshot: input.snapshot ?? Effect.succeed(input.highWater),
      snapshotSequence: (sequence) => sequence,
      getHighWaterSequence: Effect.succeed(input.highWater),
      replay: (from, through) =>
        Stream.fromIterable(
          (input.replay ?? []).filter((row) => row.sequence > from && row.sequence <= through),
        ),
      resumeFromSequence: input.resumeFromSequence,
    });
    const pull = yield* Stream.toPull(stream);
    const publish = (events: ReadonlyArray<OrchestrationEvent>) =>
      PubSub.publishAll(live, events).pipe(Effect.andThen(settle));
    return { pull, publish };
  });

const sequences = (items: ReadonlyArray<SnapshotLiveStreamItem<number>>) =>
  items.map((item) =>
    item.kind === "snapshot" ? `snapshot@${item.snapshot}` : item.event.sequence,
  );

const expectOverflow = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain(WS_STREAM_OVERFLOW_CODE);
};

const burst = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => event(from + index));

describe("makeCursorSafeSnapshotLiveStream", () => {
  it.each([
    { name: "event count", events: burst(11, 1_025) },
    { name: "serialized bytes", events: [event(11, "x".repeat(9 * 1024 * 1024))] },
  ])("fails a burst over the live $name budget before emitting the snapshot", ({ events }) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const snapshotGate = yield* Deferred.make<number>();
          const { pull, publish } = yield* harness({
            snapshot: Deferred.await(snapshotGate),
            highWater: 10,
          });
          const first = yield* Effect.forkChild(Effect.exit(pull));
          yield* settle;
          yield* publish(events);
          expectOverflow(yield* Fiber.join(first));
        }),
      ),
    ),
  );

  it("keeps a delivered chunk charged until the next pull acknowledges it", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { pull, publish } = yield* harness({ highWater: 10 });
          expect(sequences(yield* pull)).toEqual(["snapshot@10"]);
          yield* publish(burst(11, 600));
          expect((yield* pull).length).toBe(600);
          // The 600 delivered events are unacknowledged; 600 more exceed the 1,024 budget.
          yield* publish(burst(611, 600));
          expectOverflow(yield* Effect.exit(pull));
        }),
      ),
    ));

  it("resumes from a cursor without a snapshot and skips live events inside the fence", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { pull, publish } = yield* harness({
            highWater: 12,
            resumeFromSequence: 10,
            replay: [event(11), event(12)],
          });
          expect(sequences(yield* pull)).toEqual([11, 12]);
          yield* publish([event(12), event(13)]);
          expect(sequences(yield* pull)).toEqual([13]);
        }),
      ),
    ));

  it("falls back to a snapshot when the resume replay exceeds its byte budget", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { pull } = yield* harness({
            highWater: 12,
            resumeFromSequence: 10,
            replay: [event(11, "x".repeat(3 * 1024 * 1024)), event(12)],
          });
          expect(sequences(yield* pull)).toEqual(["snapshot@12"]);
        }),
      ),
    ));
});
