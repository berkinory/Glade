import { ServiceMap } from "effect";
import type { ProviderServiceShape } from "./ProviderService";
import type { StopIdleRuntime } from "./ProviderIdleRuntime";
export class ProviderSessionTeardown extends ServiceMap.Service<
  ProviderSessionTeardown,
  Required<
    Pick<
      ProviderServiceShape,
      | "stopSession"
      | "stopRuntimeSession"
      | "parkSession"
      | "takeParkedSession"
      | "hasLiveRuntimeTasks"
      | "clearSessionResumeCursor"
    >
  > & { readonly stopRuntimeSessionInternal: StopIdleRuntime }
>()("glade/provider/ProviderSessionTeardown") {}
