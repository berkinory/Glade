import { ServiceMap, type Effect } from "effect";
import type { ProviderAdapterValidationError } from "../core/Errors";

export class CompactionAdmission extends ServiceMap.Service<
  CompactionAdmission,
  {
    readonly check: Effect.Effect<void, ProviderAdapterValidationError>;
    readonly admitted: () => void;
  }
>()("glade/provider/CompactionAdmission") {}
