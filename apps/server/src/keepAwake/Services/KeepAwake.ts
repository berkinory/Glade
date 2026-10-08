import type { ServerKeepAwakeStatus } from "@glade/contracts/server/keepAwake";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface KeepAwakeShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly getStatus: Effect.Effect<ServerKeepAwakeStatus>;
}

export class KeepAwake extends ServiceMap.Service<KeepAwake, KeepAwakeShape>()(
  "glade/keepAwake/Services/KeepAwake",
) {}
