import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// An event before the adapter stamps its identity, time, provider, thread, turn and generation.
export type RuntimeEventDraft = DistributiveOmit<
  ProviderRuntimeEvent,
  "eventId" | "createdAt" | "provider" | "threadId" | "turnId" | "lifecycleGeneration"
>;
