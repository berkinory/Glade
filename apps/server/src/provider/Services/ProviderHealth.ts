import type {
  ServerProviderStatus,
  ServerProviderUpdateInput,
  ServerProviderUpdateResult,
  ServerProviderUpdateError,
} from "@glade/contracts/server/server";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export interface ProviderHealthShape {
  readonly getStatuses: Effect.Effect<ReadonlyArray<ServerProviderStatus>>;

  readonly refresh: Effect.Effect<ReadonlyArray<ServerProviderStatus>>;

  readonly updateProvider: (
    input: ServerProviderUpdateInput,
  ) => Effect.Effect<ServerProviderUpdateResult, ServerProviderUpdateError>;

  readonly streamChanges: Stream.Stream<ReadonlyArray<ServerProviderStatus>>;
}

export class ProviderHealth extends ServiceMap.Service<ProviderHealth, ProviderHealthShape>()(
  "glade/provider/Services/ProviderHealth",
) {}
