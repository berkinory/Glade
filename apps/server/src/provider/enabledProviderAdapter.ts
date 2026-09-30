import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { Effect } from "effect";

import type { ServerSettingsShape } from "../serverSettings";
import type { ProviderAdapterRegistryShape } from "./Services/ProviderAdapterRegistry";

class ProviderDisabledError extends Error {
  readonly status = 409;
}

export function providerDisabledSettingsMessage(provider: ProviderKind): string {
  return `${PROVIDER_DISPLAY_NAMES[provider]} is disabled in Settings > Providers.`;
}

export function ensureProviderEnabled(provider: ProviderKind, serverSettings: ServerSettingsShape) {
  return serverSettings.getSettings.pipe(
    Effect.flatMap((settings) =>
      settings.providers[provider].enabled
        ? Effect.void
        : Effect.fail(new ProviderDisabledError(providerDisabledSettingsMessage(provider))),
    ),
  );
}

export function getEnabledProviderAdapter(
  provider: ProviderKind,
  serverSettings: ServerSettingsShape,
  providerAdapterRegistry: ProviderAdapterRegistryShape,
) {
  return ensureProviderEnabled(provider, serverSettings).pipe(
    Effect.andThen(providerAdapterRegistry.getByProvider(provider)),
  );
}
