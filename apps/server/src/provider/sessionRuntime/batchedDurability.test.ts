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
import {
  asEventId,
  asThreadId,
  asTurnId,
  makeFakeCodexAdapter,
} from "./providerServiceTestFixtures";

for (const flushMode of ["shutdown", "idle"] as const) {
  it.live(
    `flushes buffered deltas on ${flushMode} and preserves durable replay and live order`,
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
              event.eventId === "batch-shutdown-2"
                ? Deferred.succeed(readAll, undefined)
                : Effect.void,
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
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* codex.waitForRuntimeSubscribers();
        yield* Effect.sleep("10 millis");
        for (let index = 0; index < 3; index++) {
          codex.emit({
            type: "content.delta",
            eventId: asEventId(`batch-shutdown-${index}`),
            threadId: asThreadId("batch-shutdown"),
            turnId: asTurnId("batch-shutdown-turn"),
            provider: "codex",
            createdAt: "2026-09-30T00:00:00.000Z",
            payload: {
              streamKind: "assistant_text",
              delta: ["partial", " text", " survives"][index],
            },
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
        assert.deepEqual(
          received.map((event) => event.eventId),
          ["batch-shutdown-0", "batch-shutdown-1", "batch-shutdown-2"],
        );
        assert.deepEqual(
          replay.map((row) => row.event.eventId),
          ["batch-shutdown-0", "batch-shutdown-1", "batch-shutdown-2"],
        );
        assert.deepEqual(
          replay.map((row) => (row.event.type === "content.delta" ? row.event.payload.delta : "")),
          ["partial", " text", " survives"],
        );
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
