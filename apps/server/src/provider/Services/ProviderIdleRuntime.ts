import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { ServiceMap, type Effect } from "effect";
import type { ProviderValidationError } from "../core/Errors";
import type {
  StopRuntimeSessionInput,
  StopRuntimeSessionEffect,
} from "../core/providerRuntimeBinding";

export type StopIdleRuntime = (
  input: StopRuntimeSessionInput,
  expectedIdleGeneration?: symbol,
  options?: { readonly requireAgentGatewayCredentialRotation?: boolean },
) => StopRuntimeSessionEffect;

interface ProviderIdleRuntimeShape {
  readonly clearRuntimeIdleTimer: (threadId: ThreadId) => void;
  readonly runIdleSensitiveProviderWork: <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
    options?: { readonly scheduleIdleStopOnSuccess?: boolean },
  ) => Effect.Effect<A, E | ProviderValidationError, R>;
  readonly reconcileRuntimeIdleTimer: (event: ProviderRuntimeEvent) => void;
  readonly waitForLiveRuntimeTasksToSettle: (threadId: ThreadId) => Effect.Effect<void>;
  readonly waitForRuntimeIdleStop: (threadId: ThreadId) => Effect.Effect<void>;
  readonly clearLiveRuntimeTasks: (threadId: ThreadId) => void;
  readonly retireRuntimeIdleGeneration: (threadId: ThreadId, generation?: symbol) => void;
  readonly isRuntimeIdleGenerationCurrent: (threadId: ThreadId, generation: symbol) => boolean;
  readonly hasLiveTasks: (threadId: ThreadId) => boolean;
  readonly installStopHandler: (handler: StopIdleRuntime) => Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
}
export class ProviderIdleRuntime extends ServiceMap.Service<
  ProviderIdleRuntime,
  ProviderIdleRuntimeShape
>()("glade/provider/ProviderIdleRuntime") {}
