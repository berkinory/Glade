import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ServiceMap, type Effect } from "effect";
interface ProviderLifecycleLease {
  readonly generation: string;
  readonly isCurrent: () => boolean;
  // Takes lasting ownership of {@link ProviderLifecycleLease.generation}. A run publishes its
  // generation eagerly (runtime events emitted *while* a provider starts must not look stale), but
  // that publication is provisional: it survives the run only if the run says it took ownership.
  readonly commit: () => void;

  readonly adopt: (generation: string) => void;

  readonly retire: () => void;
}

export interface ProviderLifecycleShape {
  readonly run: <A, E, R>(
    threadId: ThreadId,
    operation: (lease: ProviderLifecycleLease) => Effect.Effect<A, E, R>,
    prepare?: Effect.Effect<unknown, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly runCurrent: <A, E, R>(
    threadId: ThreadId,
    operation: (generation: string | undefined) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  // Control-plane variant of {@link ProviderLifecycleShape.runCurrent}: waits a bounded time
  // for the per-thread lock and then proceeds without it. A wedged lifecycle mutation (a provider
  // start that never returns) must not be able to hold an interrupt hostage forever; the operation
  // still validates the current generation, so a racing replacement is rejected downstream.
  readonly runCurrentUrgent: <A, E, R>(
    threadId: ThreadId,
    operation: (generation: string | undefined) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly currentGeneration: (threadId: ThreadId) => string | undefined;
}

export class ProviderLifecycle extends ServiceMap.Service<
  ProviderLifecycle,
  ProviderLifecycleShape
>()("glade/provider/ProviderLifecycle") {}
