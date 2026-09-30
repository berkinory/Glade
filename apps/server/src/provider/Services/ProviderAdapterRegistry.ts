import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProviderAdapterError, ProviderUnsupportedError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface ProviderAdapterRegistryShape {
  readonly getByProvider: (
    provider: ProviderKind,
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, ProviderUnsupportedError>;

  readonly listProviders: () => Effect.Effect<ReadonlyArray<ProviderKind>>;
}

export class ProviderAdapterRegistry extends ServiceMap.Service<
  ProviderAdapterRegistry,
  ProviderAdapterRegistryShape
>()("glade/provider/Services/ProviderAdapterRegistry") {}
