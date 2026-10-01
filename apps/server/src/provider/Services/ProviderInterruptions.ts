import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { ServiceMap, type Effect } from "effect";
import type { ProviderValidationError } from "../core/Errors";
import type { TargetedChildInterruptTombstone } from "../core/providerRuntimeBinding";

export interface InterruptionLease {
  readonly failure: string | null;
  readonly settle: (failure?: string) => void;
}

interface ProviderInterruptionsShape {
  readonly wait: (threadId: ThreadId) => Effect.Effect<InterruptionLease | undefined>;
  readonly acquire: (
    threadId: ThreadId,
  ) => Effect.Effect<InterruptionLease, ProviderValidationError>;
  readonly key: (threadId: ThreadId, turnId: TurnId, providerThreadId: string) => string;
  readonly remember: (key: string, tombstone: TargetedChildInterruptTombstone) => void;
  readonly previous: (key: string) => TargetedChildInterruptTombstone | undefined;
  readonly clear: (threadId: ThreadId, expected?: InterruptionLease) => void;
}

export class ProviderInterruptions extends ServiceMap.Service<
  ProviderInterruptions,
  ProviderInterruptionsShape
>()("glade/provider/ProviderInterruptions") {}
