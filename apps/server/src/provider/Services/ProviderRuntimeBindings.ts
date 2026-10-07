import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { ServiceMap, type Effect } from "effect";
import type { ProviderValidationError } from "../core/Errors";
import type { KeyedLock } from "../core/keyedLock";
import type { StartedTurnPersistenceInput } from "../core/providerRuntimeBinding";
import type { ProviderSessionDirectoryWriteError } from "./ProviderSessionDirectory";

interface SessionBindingMetadata {
  readonly lifecycleGeneration?: string;
  readonly modelSelection?: unknown;
  readonly providerOptions?: unknown;
  readonly lastRuntimeEvent?: string;
  readonly lastRuntimeEventAt?: string;
  readonly runtimePayload?: Record<string, unknown>;
}
interface ProviderRuntimeBindingsShape {
  readonly updateSessionBindingFromRuntimeEvent: (
    event: ProviderRuntimeEvent,
  ) => Effect.Effect<void>;
  readonly withBindingWriteLock: KeyedLock<ThreadId>["withLock"];
  readonly upsertSessionBinding: (
    session: ProviderSession,
    threadId: ThreadId,
    extra?: SessionBindingMetadata,
  ) => Effect.Effect<void, ProviderSessionDirectoryWriteError>;
  readonly runTurnDispatch: <A, E, R>(
    threadId: ThreadId,
    dispatch: (generation: number) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ProviderValidationError, R>;
  readonly persistDispatchedTurn: (
    input: StartedTurnPersistenceInput,
  ) => Effect.Effect<void, ProviderSessionDirectoryWriteError>;
  readonly markThreadStopped: (
    threadId: ThreadId,
    stoppedAt: string,
    session?: ProviderSession,
  ) => Effect.Effect<void, ProviderSessionDirectoryWriteError>;
  readonly withQueuedBindingWrite: KeyedLock<ThreadId>["withLockQueued"];
  readonly beginShutdown: (stoppedAt: string) => Effect.Effect<number>;
  readonly cursorWrittenSince: (threadId: ThreadId, baseline: number) => unknown;
}
export class ProviderRuntimeBindings extends ServiceMap.Service<
  ProviderRuntimeBindings,
  ProviderRuntimeBindingsShape
>()("glade/provider/ProviderRuntimeBindings") {}
