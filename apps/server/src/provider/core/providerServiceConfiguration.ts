import { type EventNdjsonLogger } from "../Layers/EventNdjsonLogger.ts";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Effect, Duration } from "effect";
import { type PersistedProviderRuntimeEvent } from "../../persistence/Services/ProviderRuntimeEvents.ts";
import type { TaggedFailure } from "../../platform/operationError.ts";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { ProviderValidationError } from "./Errors.ts";

export interface ProviderServiceLiveOptions {
  readonly canonicalEventLogPath?: string;
  readonly canonicalEventLogger?: EventNdjsonLogger;
  readonly runtimeIdleStopMs?: number;

  readonly runtimeEventBufferCapacity?: number;

  readonly persistRuntimeEvent?: (
    event: ProviderRuntimeEvent,
  ) => Effect.Effect<PersistedProviderRuntimeEvent, TaggedFailure>;

  readonly quarantineRuntimeEvent?: (
    event: ProviderRuntimeEvent,
    cause: string,
  ) => Effect.Effect<void, TaggedFailure>;

  readonly runtimeEventRetry?: { readonly baseDelayMs?: number; readonly maxDelayMs?: number };

  readonly providerIsEnabled?: (
    provider: ProviderKind,
  ) => Effect.Effect<boolean, ProviderValidationError>;
}

const DEFAULT_PROVIDER_RUNTIME_IDLE_STOP_MS = 10 * 60 * 1000;

export const PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY = 2_048;

export const PROVIDER_RUNTIME_QUARANTINE_CAUSE_MAX_BYTES = 16 * 1024;

const configuredProviderRuntimeIdleStopMs = process.env.GLADE_PROVIDER_RUNTIME_IDLE_STOP_MS;

export const PROVIDER_RUNTIME_IDLE_STOP_MS = Number.isFinite(
  Number(configuredProviderRuntimeIdleStopMs),
)
  ? Math.max(0, Number(configuredProviderRuntimeIdleStopMs))
  : DEFAULT_PROVIDER_RUNTIME_IDLE_STOP_MS;

export const MAX_TARGETED_CHILD_INTERRUPT_TOMBSTONES = 16_384;

export const PROVIDER_START_SESSION_TIMEOUT = Duration.seconds(60);

export const PROVIDER_STOP_SESSION_TIMEOUT = Duration.seconds(10);

export function ensureProviderEnabled(
  providerIsEnabled: ProviderServiceLiveOptions["providerIsEnabled"],
  provider: ProviderKind,
  operation: string,
) {
  return providerIsEnabled
    ? providerIsEnabled(provider).pipe(
        Effect.flatMap((enabled) =>
          enabled
            ? Effect.void
            : Effect.fail(
                new ProviderValidationError({
                  operation,
                  issue: `${provider} is disabled in Settings > Providers.`,
                }),
              ),
        ),
      )
    : Effect.void;
}
