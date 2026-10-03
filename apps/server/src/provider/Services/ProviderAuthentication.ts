import { Effect, Schema, ServiceMap } from "effect";
import type {
  ProviderAuthenticationRequest,
  ProviderAuthenticationStatus,
} from "@glade/contracts/provider/providerAuthentication";

export class ProviderAuthenticationError extends Schema.TaggedErrorClass<ProviderAuthenticationError>()(
  "ProviderAuthenticationError",
  {
    message: Schema.String,
  },
) {}

export class ProviderAuthentication extends ServiceMap.Service<
  ProviderAuthentication,
  {
    readonly request: (
      input: ProviderAuthenticationRequest,
    ) => Effect.Effect<ProviderAuthenticationStatus | null, ProviderAuthenticationError>;
  }
>()("glade/provider/ProviderAuthentication") {}
