import { ServiceMap, type Effect } from "effect";
import type { ProviderServiceShape } from "./ProviderService";
export class ProviderRuntimeEvents extends ServiceMap.Service<
  ProviderRuntimeEvents,
  Required<Pick<ProviderServiceShape, "getRuntimeEventPumpHealth" | "streamEvents">> &
    Pick<ProviderServiceShape, "streamPersistedEvents"> & {
      readonly startPumps: Effect.Effect<void>;
      readonly shutdown: Effect.Effect<void>;
    }
>()("glade/provider/ProviderRuntimeEvents") {}
