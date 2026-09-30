import type {
  ProviderListModelsInput,
  ProviderListModelsResult,
} from "@glade/contracts/provider/providerDiscovery";
import { Deferred, Effect, Exit, Option } from "effect";

import { ProviderAdapterRequestError } from "./Errors.ts";

const PROVIDER_MODEL_DISCOVERY_FRESH_TTL_MS = 30 * 60_000;

const PROVIDER_MODEL_DISCOVERY_STALE_TTL_MS = 24 * 60 * 60_000;

const PROVIDER_MODEL_DISCOVERY_FAILURE_TTL_MS = 30_000;

const PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS = 45_000;
const PROVIDER_MODEL_DISCOVERY_CACHE_MAX_ENTRIES = 64;

export interface ProviderModelDiscoveryCacheKey {
  readonly provider: ProviderListModelsInput["provider"];
  readonly binaryPath: string | null;
  readonly apiEndpoint: string | null;
  readonly cwd: string | null;
}

export interface ProviderModelDiscoveryCache<E> {
  // Resolve a model catalog for `key`, running `discover` only when the cache cannot answer.
  // `discover` always runs detached from the caller so a disconnecting client never aborts a
  // discovery other callers wait on.
  readonly lookup: (
    key: ProviderModelDiscoveryCacheKey,
    discover: Effect.Effect<ProviderListModelsResult, E>,
  ) => Effect.Effect<ProviderListModelsResult, E | ProviderAdapterRequestError>;

  readonly clear: () => void;

  readonly size: () => number;
}

interface CatalogEntry {
  readonly result: ProviderListModelsResult;
  readonly storedAt: number;
}

interface FailureEntry<E> {
  readonly exit: DiscoveryExit<E>;
  readonly storedAt: number;
}

type DiscoveryExit<E> = Exit.Exit<ProviderListModelsResult, E | ProviderAdapterRequestError>;

export function providerModelDiscoveryCacheKey(
  input: ProviderListModelsInput,
): ProviderModelDiscoveryCacheKey {
  return {
    provider: input.provider,
    binaryPath: input.binaryPath ?? null,
    apiEndpoint: input.apiEndpoint ?? null,
    cwd: input.cwd ?? null,
  };
}

const serializeProviderModelDiscoveryCacheKey = (key: ProviderModelDiscoveryCacheKey): string =>
  JSON.stringify([key.provider, key.binaryPath, key.apiEndpoint, key.cwd]);

const isUsableCatalog = (result: ProviderListModelsResult): boolean =>
  result.models.length > 0 && result.error === undefined;

export interface PersistedModelCatalogEntryInput {
  readonly key: string;
  readonly result: ProviderListModelsResult;
  readonly storedAt: number;
}

export function makeProviderModelDiscoveryCache<E>(options?: {
  readonly now?: () => number;
  readonly freshTtlMs?: number;
  readonly staleTtlMs?: number;
  readonly failureTtlMs?: number;
  readonly timeoutMs?: number;
  readonly maxEntries?: number;

  readonly persistedCatalogs?: ReadonlyArray<PersistedModelCatalogEntryInput>;

  readonly onCatalogsChanged?: (entries: ReadonlyArray<PersistedModelCatalogEntryInput>) => void;
}): ProviderModelDiscoveryCache<E> {
  const now = options?.now ?? (() => Date.now());
  const freshTtlMs = options?.freshTtlMs ?? PROVIDER_MODEL_DISCOVERY_FRESH_TTL_MS;
  const staleTtlMs = options?.staleTtlMs ?? PROVIDER_MODEL_DISCOVERY_STALE_TTL_MS;
  const failureTtlMs = options?.failureTtlMs ?? PROVIDER_MODEL_DISCOVERY_FAILURE_TTL_MS;
  const timeoutMs = options?.timeoutMs ?? PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS;
  const maxEntries = options?.maxEntries ?? PROVIDER_MODEL_DISCOVERY_CACHE_MAX_ENTRIES;

  const catalogs = new Map<string, CatalogEntry>();
  const failures = new Map<string, FailureEntry<E>>();
  const inflight = new Map<
    string,
    Deferred.Deferred<ProviderListModelsResult, E | ProviderAdapterRequestError>
  >();

  const emitCatalogsChanged = () => {
    try {
      options?.onCatalogsChanged?.(
        [...catalogs.entries()].map(([key, entry]) => ({
          key,
          result: entry.result,
          storedAt: entry.storedAt,
        })),
      );
    } catch {
      // The listener persists snapshots; a throwing listener must not strand the deferred waiters that
      // applyExit resolves right after this call.
    }
  };

  const bootedAt = now();
  let droppedPersisted = false;
  for (const entry of options?.persistedCatalogs ?? []) {
    if (bootedAt - entry.storedAt > staleTtlMs) {
      droppedPersisted = true;
      continue;
    }
    catalogs.set(entry.key, { result: entry.result, storedAt: entry.storedAt });
    while (catalogs.size > maxEntries) {
      const oldest = catalogs.keys().next().value;
      if (oldest === undefined) break;
      catalogs.delete(oldest);
      droppedPersisted = true;
    }
  }
  if (droppedPersisted) emitCatalogsChanged();

  const readCatalog = (serialized: string, at: number): CatalogEntry | undefined => {
    const entry = catalogs.get(serialized);
    if (entry === undefined) return undefined;
    if (at - entry.storedAt > staleTtlMs) {
      catalogs.delete(serialized);
      emitCatalogsChanged();
      return undefined;
    }
    return entry;
  };

  const readFailure = (serialized: string, at: number): FailureEntry<E> | undefined => {
    const entry = failures.get(serialized);
    if (entry === undefined) return undefined;
    if (at - entry.storedAt > failureTtlMs) {
      failures.delete(serialized);
      return undefined;
    }
    return entry;
  };

  const storeCatalog = (serialized: string, result: ProviderListModelsResult, at: number) => {
    failures.delete(serialized);

    catalogs.delete(serialized);
    catalogs.set(serialized, { result: { ...result, cached: false }, storedAt: at });
    while (catalogs.size > maxEntries) {
      const oldest = catalogs.keys().next().value;
      if (oldest === undefined) break;
      catalogs.delete(oldest);
    }
    emitCatalogsChanged();
  };

  const storeFailure = (serialized: string, exit: DiscoveryExit<E>, at: number) => {
    failures.set(serialized, { exit, storedAt: at });
    while (failures.size > maxEntries) {
      const oldest = failures.keys().next().value;
      if (oldest === undefined) break;
      failures.delete(oldest);
    }
  };

  const applyExit = (serialized: string, exit: DiscoveryExit<E>) => {
    const at = now();
    if (Exit.isSuccess(exit) && isUsableCatalog(exit.value)) {
      storeCatalog(serialized, exit.value, at);
      return;
    }

    if (Exit.isSuccess(exit) && exit.value.error === undefined && catalogs.delete(serialized)) {
      emitCatalogsChanged();
    }
    storeFailure(serialized, exit, at);
  };

  const startDiscovery = (
    key: ProviderModelDiscoveryCacheKey,
    serialized: string,
    discover: Effect.Effect<ProviderListModelsResult, E>,
  ): Effect.Effect<Deferred.Deferred<ProviderListModelsResult, E | ProviderAdapterRequestError>> =>
    Effect.gen(function* () {
      const existing = inflight.get(serialized);
      if (existing !== undefined) return existing;
      const deferred = yield* Deferred.make<
        ProviderListModelsResult,
        E | ProviderAdapterRequestError
      >();
      inflight.set(serialized, deferred);
      const run = discover.pipe(
        Effect.timeoutOption(timeoutMs),
        Effect.flatMap((result) =>
          Option.isSome(result)
            ? Effect.succeed(result.value)
            : Effect.fail(
                new ProviderAdapterRequestError({
                  provider: key.provider,
                  method: "models/list",
                  detail: `Model discovery timed out after ${Math.round(timeoutMs / 1000)}s.`,
                }),
              ),
        ),
        Effect.exit,
        Effect.flatMap((exit) => {
          inflight.delete(serialized);
          applyExit(serialized, exit);
          return Deferred.done(deferred, exit);
        }),
      );
      yield* Effect.forkDetach(run);
      return deferred;
    });

  const awaitDiscovery = (
    deferred: Deferred.Deferred<ProviderListModelsResult, E | ProviderAdapterRequestError>,
  ): Effect.Effect<ProviderListModelsResult, E | ProviderAdapterRequestError> =>
    Deferred.await(deferred);

  const lookup: ProviderModelDiscoveryCache<E>["lookup"] = (key, discover) =>
    Effect.gen(function* () {
      const serialized = serializeProviderModelDiscoveryCacheKey(key);
      const at = now();
      const entry = readCatalog(serialized, at);
      const failure = readFailure(serialized, at);
      if (entry !== undefined) {
        if (at - entry.storedAt <= freshTtlMs) {
          return { ...entry.result, cached: true };
        }

        if (failure === undefined) {
          yield* startDiscovery(key, serialized, discover);
        }
        return { ...entry.result, cached: true };
      }
      const pending = inflight.get(serialized);
      if (pending !== undefined) {
        return yield* awaitDiscovery(pending);
      }
      if (failure !== undefined) {
        return yield* failure.exit;
      }
      const deferred = yield* startDiscovery(key, serialized, discover);
      return yield* awaitDiscovery(deferred);
    });

  return {
    lookup,
    clear: () => {
      const hadCatalogs = catalogs.size > 0;
      catalogs.clear();
      failures.clear();
      if (hadCatalogs) emitCatalogsChanged();
    },
    size: () => catalogs.size,
  };
}
