import type { TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationLatestTurn } from "@glade/contracts/orchestration/threadEntities";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Clock, Duration, Effect, PubSub, Stream } from "effect";
import { TestClock } from "effect/testing";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";

export const unused = (): never => Effect.die("unused") as never;

export function failedTurn(turnId: TurnId): OrchestrationLatestTurn {
  return {
    turnId,
    state: "error",
    requestedAt: new Date(0).toISOString(),
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    assistantMessageId: null,
  };
}

// An engine that records dispatched commands and serves a read model; resume reactors use no more.
export function makeRecordingEngine(readModel: () => OrchestrationReadModel) {
  return Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const domainEvents = yield* PubSub.unbounded<OrchestrationEvent>();
    const engine: OrchestrationEngineShape = {
      quiesce: Effect.void,
      drain: Effect.void,
      stop: Effect.void,
      getProjectionCatchUpStatus: unused(),
      readEvents: unused,
      readEventsThrough: unused,
      readThreadEvents: unused,
      readThreadEventsThrough: unused,
      getEventHighWaterSequence: unused(),
      getThreadTitleHighWaterSequence: unused,
      subscribeDomainEvents: Effect.succeed(Stream.fromPubSub(domainEvents)),
      getReadModel: () => Effect.sync(readModel),
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          return { sequence: dispatched.length };
        }),
      repairState: unused,
      refreshCommandReadModel: unused,
      streamDomainEvents: Stream.empty,
    };
    const providerService = {
      streamEvents: Stream.fromPubSub(runtimeEvents),
    } as unknown as ProviderServiceShape; // Only the event stream is read.
    // Wall time the host spent asleep. Timers never see it, as on a host whose monotonic clock
    // stops in sleep.
    let sleptMs = 0;
    const testClock = yield* Clock.Clock;
    const hostMillis = () => testClock.currentTimeMillisUnsafe() + sleptMs;
    const hostClock: Clock.Clock = {
      currentTimeMillisUnsafe: hostMillis,
      currentTimeMillis: Effect.sync(hostMillis),
      currentTimeNanosUnsafe: () => BigInt(hostMillis()) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => BigInt(hostMillis()) * 1_000_000n),
      sleep: (duration) => testClock.sleep(duration),
    };
    return {
      engine,
      providerService,
      dispatched,
      turnStarts: () => dispatched.filter((command) => command.type === "thread.turn.start"),
      publishRuntimeEvent: (event: ProviderRuntimeEvent) => PubSub.publish(runtimeEvents, event),
      publishDomainEvent: (event: OrchestrationEvent) => PubSub.publish(domainEvents, event),
      advance: (duration: Duration.Input) =>
        Effect.yieldNow.pipe(Effect.andThen(TestClock.adjust(duration))),
      // Runs a service on the host clock, so its fibers see the host sleep.
      onHost: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.provideService(effect, Clock.Clock, hostClock),
      sleepHost: (duration: Duration.Input) =>
        Effect.sync(() => {
          sleptMs += Duration.toMillis(Duration.fromInputUnsafe(duration));
        }),
    };
  });
}
