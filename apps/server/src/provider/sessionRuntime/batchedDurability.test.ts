import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Scope, ServiceMap, Stream } from "effect";

import { ProviderRuntimeEventRepositoryLive } from "../../persistence/Layers/ProviderRuntimeEvents";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { ProviderRuntimeEventRepository } from "../../persistence/Services/ProviderRuntimeEvents";
import { ProviderSessionRuntimeRepository } from "../../persistence/Services/ProviderSessionRuntime";
import { makeDurableProviderServiceLive } from "../Layers/ProviderService";
import { ProviderSessionDirectoryLive } from "../Layers/ProviderSessionDirectory";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry";
import { ProviderService } from "../Services/ProviderService";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import {
  asEventId,
  asThreadId,
  asTurnId,
  makeFakeCodexAdapter,
} from "./providerServiceTestFixtures";

const streamedEvents = [
  ["batch-shutdown", "assistant_text", "partial"],
  ["batch-shutdown", "assistant_text", " text"],
  ["batch-other", "assistant_text", "other thread"],
  ["batch-shutdown", "assistant_text", " survives"],
  ["batch-shutdown", "reasoning_text", "thinking"],
  ["batch-shutdown", "assistant_text", " once"],
] as const;
const lastEventId = `batch-shutdown-${streamedEvents.length - 1}`;

// Adjacent rows of one stream are joined, so the expectation holds wherever the batch tick falls.
const textByThread = (events: ReadonlyArray<ProviderRuntimeEvent>) => {
  const runs = new Map<string, Array<[string, string]>>();
  for (const event of events) {
    if (event.type !== "content.delta") continue;
    const threadRuns = runs.get(event.threadId) ?? [];
    runs.set(event.threadId, threadRuns);
    const tail = threadRuns.at(-1);
    if (tail?.[0] === event.payload.streamKind) tail[1] += event.payload.delta;
    else threadRuns.push([event.payload.streamKind, event.payload.delta]);
  }
  return Object.fromEntries(runs);
};

for (const flushMode of ["shutdown", "idle"] as const) {
  it.live(
    `coalesces assistant text before the journal on ${flushMode} and keeps each thread's order`,
    () =>
      Effect.gen(function* () {
        const journal = yield* ProviderRuntimeEventRepository;
        const sessions = yield* ProviderSessionRuntimeRepository;
        const readAll = yield* Deferred.make<void>();
        const codex = makeFakeCodexAdapter();
        const providerScope = yield* Scope.make();
        yield* Effect.addFinalizer(() => Scope.close(providerScope, Exit.void));
        const adapter = {
          ...codex.adapter,
          streamEvents: codex.adapter.streamEvents.pipe(
            Stream.tap((event) =>
              event.eventId === lastEventId ? Deferred.succeed(readAll, undefined) : Effect.void,
            ),
          ),
        };
        const layer = makeDurableProviderServiceLive().pipe(
          Layer.provide(Layer.succeed(ProviderRuntimeEventRepository, journal)),
          Layer.provide(
            ProviderSessionDirectoryLive.pipe(
              Layer.provide(Layer.succeed(ProviderSessionRuntimeRepository, sessions)),
            ),
          ),
          Layer.provide(
            Layer.succeed(ProviderAdapterRegistry, {
              getByProvider: () => Effect.succeed(adapter),
              listProviders: () => Effect.succeed(["codex"] as const),
            }),
          ),
          Layer.provide(NodeServices.layer),
        );
        const services = yield* Layer.buildWithScope(layer, providerScope);
        const provider = ServiceMap.get(services, ProviderService);
        const live = yield* provider.streamEvents.pipe(
          Stream.takeUntil((event) => event.eventId === lastEventId),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* codex.waitForRuntimeSubscribers();
        yield* Effect.sleep("10 millis");
        for (const [index, [threadId, streamKind, delta]] of streamedEvents.entries()) {
          codex.emit({
            type: "content.delta",
            eventId: asEventId(`batch-shutdown-${index}`),
            threadId: asThreadId(threadId),
            turnId: asTurnId(`${threadId}-turn`),
            itemId: `${threadId}-${streamKind}`,
            provider: "codex",
            createdAt: "2026-09-30T00:00:00.000Z",
            payload: { streamKind, delta },
          });
        }
        yield* Deferred.await(readAll);
        yield* Effect.yieldNow;
        if (flushMode === "idle") {
          yield* Fiber.join(live).pipe(Effect.timeout("1 second"));
        }
        yield* Scope.close(providerScope, Exit.void);
        const replay = yield* journal.readAfter({
          sequenceExclusive: 0,
          throughSequenceInclusive: yield* journal.getHighWaterSequence,
          limit: 10,
        });
        const received = yield* Fiber.join(live);
        const expected: Record<string, Array<[string, string]>> = {
          "batch-shutdown": [
            ["assistant_text", "partial text survives"],
            ["reasoning_text", "thinking"],
            ["assistant_text", " once"],
          ],
          "batch-other": [["assistant_text", "other thread"]],
        };
        assert.isBelow(replay.length, streamedEvents.length);
        assert.deepEqual(textByThread(replay.map((row) => row.event)), expected);
        assert.deepEqual(
          received.map((event) => event.eventId),
          replay.map((row) => row.event.eventId),
        );
        assert.deepEqual(textByThread(received), expected);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            ProviderRuntimeEventRepositoryLive,
            ProviderSessionRuntimeRepositoryLive,
          ).pipe(Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory))),
        ),
      ),
  );
}
