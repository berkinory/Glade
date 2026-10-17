import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

// Stops a live turn whose provider has gone silent with nothing legitimately in flight.
export interface ProviderTurnWatchdogShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class ProviderTurnWatchdog extends ServiceMap.Service<
  ProviderTurnWatchdog,
  ProviderTurnWatchdogShape
>()("glade/provider/Services/ProviderTurnWatchdog") {}
