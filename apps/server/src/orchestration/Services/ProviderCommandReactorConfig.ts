import { Duration, ServiceMap } from "effect";

export interface ProviderCommandReactorLiveOptions {
  readonly commandEventTimeout?: Duration.Duration;
}

interface ProviderCommandReactorConfigShape {
  readonly commandEventTimeout: Duration.Duration;
}

export class ProviderCommandReactorConfig extends ServiceMap.Service<
  ProviderCommandReactorConfig,
  ProviderCommandReactorConfigShape
>()("glade/orchestration/Layers/ProviderCommandReactorConfig") {}
