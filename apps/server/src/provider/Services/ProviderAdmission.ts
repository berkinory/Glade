import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { ServiceMap, type Effect } from "effect";
import type { ProviderValidationError } from "../core/Errors";
export class ProviderAdmission extends ServiceMap.Service<
  ProviderAdmission,
  {
    readonly ensureProviderEnabled: (
      provider: ProviderKind,
      operation: string,
    ) => Effect.Effect<void, ProviderValidationError>;
  }
>()("glade/provider/ProviderAdmission") {}
