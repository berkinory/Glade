import { describe, it, expect } from "vitest";
import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Stream, Deferred, Fiber, Exit } from "effect";
import { makeReactorTestHarness } from "./reactorTestFixtures";
import { withCompactionAdmission } from "./compactionAdmission";
import { CompactionAdmission } from "../../provider/Services/CompactionAdmission";

describe("durable compaction admission", () => {
  const { createHarness } = makeReactorTestHarness();
  it("cancels preparation before ordered teardown and fences replay against the recorded stop", async () => {
    const harness = await createHarness({ startReactor: false });
    const engine = harness.engine;
    const threadId = ThreadId.makeUnsafe("thread-1");
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const receipt = yield* engine.dispatch({
            type: "thread.compact",
            commandId: CommandId.makeUnsafe("compact"),
            threadId,
            createdAt: new Date().toISOString(),
          });
          const events = yield* engine
            .readThreadEventsThrough(threadId, 0, receipt.sequence)
            .pipe(Stream.runCollect);
          const event = events.find((event) => event.type === "thread.compact-requested");
          if (!event || event.type !== "thread.compact-requested")
            throw new Error("Missing compaction intent");
          const preparing = yield* Deferred.make<void>();
          const ready = yield* Deferred.make<void>();
          let dispatched = false;
          const work = Effect.gen(function* () {
            const admission = yield* CompactionAdmission;
            yield* Deferred.succeed(preparing, undefined);
            yield* Deferred.await(ready);
            yield* admission.check;
            admission.admitted();
            dispatched = true;
          });
          const pending = yield* withCompactionAdmission(engine, event, work).pipe(
            Effect.forkChild,
          );
          yield* Deferred.await(preparing);
          yield* engine.dispatch({
            type: "thread.session.stop",
            commandId: CommandId.makeUnsafe("stop"),
            threadId,
            createdAt: new Date().toISOString(),
          });
          const cancelled = yield* Fiber.await(pending);
          yield* Deferred.succeed(ready, undefined);
          const replayed = yield* Effect.exit(withCompactionAdmission(engine, event, work));
          return {
            cancelled: Exit.isFailure(cancelled),
            replayed: Exit.isFailure(replayed),
            dispatched,
          };
        }),
      ),
    );
    expect(result).toEqual({ cancelled: true, replayed: true, dispatched: false });
  });
});
