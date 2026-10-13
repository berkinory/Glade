import { envPathKeyFor } from "@glade/shared/platform/executable";
import { isPathName } from "@glade/shared/platform/shell";
import * as OS from "node:os";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerSettings } from "@glade/contracts/settings/settings";
import type {
  ServerProviderStatus,
  ServerProviderUpdateState,
} from "@glade/contracts/server/server";
import { ServerProviderUpdateError } from "@glade/contracts/server/server";
import { modelDiscoveryContext } from "../core/modelDiscoveryContext";
import {
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  PubSub,
  Ref,
  Result,
  Scope,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { spawnEffectProcess } from "../../platform/effectProcessRuntime.ts";

import { ServerConfig } from "../../server/config";
import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import { ServerSettingsService } from "../../settings/serverSettings";
import { nonEmptyTrimmed, PROVIDER_COMMAND_TIMEOUT_DETAIL } from "../core/providerCliOutput";
import { ProviderHealth, type ProviderHealthShape } from "../Services/ProviderHealth";
import {
  orderProviderStatuses,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "../core/providerStatusCache";
import { makeProviderMaintenanceCommandCoordinator } from "../core/providerMaintenanceCommandCoordinator";
import { invalidateCliVersionGates } from "../core/cliVersionGate.ts";
import {
  enrichProviderStatusWithVersionAdvisory,
  makeProviderMaintenanceCapabilities,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../core/providerMaintenance";
import { collectUint8StreamText } from "../../stream/collectUint8StreamText";
import { BUILT_IN_PROVIDERS, serverProviderDescriptor } from "../builtInProviders";

type ProviderStatuses = ReadonlyArray<ServerProviderStatus>;
const DISABLED_PROVIDER_STATUS_MESSAGE = "Provider is disabled in Glade settings.";

const PROVIDERS = BUILT_IN_PROVIDERS.map((descriptor) => descriptor.kind);

const providerCommandEnv = (provider: ProviderKind): NodeJS.ProcessEnv =>
  buildProviderChildEnvironment({
    credentialGrants: serverProviderDescriptor(provider).environment.credentialGrants,
  });

const UPDATE_OUTPUT_MAX_BYTES = 10_000;
const MAX_REFRESH_REVISION_RETRIES = 1;
const REFRESH_REVISION_RESCHEDULE_DELAY_MS = 100;
const PROVIDER_UPDATE_ENABLEMENT_POLL_MS = 100;
const PROVIDER_UPDATE_TIMEOUT_MS = 2 * 60_000;

function formatProviderUpdateTimeout(timeoutMs: number): string {
  if (timeoutMs < 1_000) {
    return `${timeoutMs} ${timeoutMs === 1 ? "millisecond" : "milliseconds"}`;
  }
  if (timeoutMs % 60_000 === 0) {
    const minutes = timeoutMs / 60_000;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const seconds = timeoutMs / 1_000;
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

function comparableProviderVersionAdvisory(
  advisory: ServerProviderStatus["versionAdvisory"] | undefined,
): Omit<NonNullable<ServerProviderStatus["versionAdvisory"]>, "checkedAt"> | null {
  if (!advisory) {
    return null;
  }
  const { checkedAt: _checkedAt, ...comparableAdvisory } = advisory;
  return comparableAdvisory;
}

function providerStatusesEqual(
  left: ReadonlyArray<ServerProviderStatus>,
  right: ReadonlyArray<ServerProviderStatus>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((status, index) => {
    const next = right[index];
    return (
      next !== undefined &&
      status.provider === next.provider &&
      status.status === next.status &&
      status.available === next.available &&
      status.authStatus === next.authStatus &&
      (status.authType ?? null) === (next.authType ?? null) &&
      (status.authLabel ?? null) === (next.authLabel ?? null) &&
      status.modelCatalogContextIdentity === next.modelCatalogContextIdentity &&
      status.voiceTranscriptionAvailable === next.voiceTranscriptionAvailable &&
      status.supportsAutoRuntimeMode === next.supportsAutoRuntimeMode &&
      (status.autoRuntimeModeBinaryPath ?? null) === (next.autoRuntimeModeBinaryPath ?? null) &&
      (status.version ?? null) === (next.version ?? null) &&
      (status.message ?? null) === (next.message ?? null) &&
      JSON.stringify(comparableProviderVersionAdvisory(status.versionAdvisory)) ===
        JSON.stringify(comparableProviderVersionAdvisory(next.versionAdvisory)) &&
      JSON.stringify(status.updateState ?? null) === JSON.stringify(next.updateState ?? null)
    );
  });
}

function isTransientProviderCommandTimeout(status: ServerProviderStatus): boolean {
  return (
    status.status !== "ready" &&
    status.authStatus === "unknown" &&
    (status.message ?? "").includes(PROVIDER_COMMAND_TIMEOUT_DETAIL)
  );
}

function wasPreviouslyUsableProviderStatus(status: ServerProviderStatus): boolean {
  return status.available && status.status === "ready";
}

function stabilizeProviderStatusesAgainstTransientTimeouts(
  previousStatuses: ReadonlyArray<ServerProviderStatus>,
  nextStatuses: ReadonlyArray<ServerProviderStatus>,
): ReadonlyArray<ServerProviderStatus> {
  if (previousStatuses.length === 0) {
    return nextStatuses;
  }

  const previousByProvider = new Map(
    previousStatuses.map((status) => [status.provider, status] as const),
  );

  return nextStatuses.map((status) => {
    const previous = previousByProvider.get(status.provider);
    if (
      !previous ||
      !wasPreviouslyUsableProviderStatus(previous) ||
      !isTransientProviderCommandTimeout(status)
    ) {
      return status;
    }

    // A single slow CLI probe should not make an already usable provider look broken. The previous
    // update advisory is network-backed evidence, though, so it must not survive a probe that could not
    // confirm the installed version.
    const stabilizedStatus = {
      ...previous,
      checkedAt: status.checkedAt,
      ...(status.updateState !== undefined ? { updateState: status.updateState } : {}),
    };
    return previous.versionAdvisory
      ? suppressProviderVersionAdvisory(stabilizedStatus)
      : stabilizedStatus;
  });
}

function isProviderEnabledForSettings(provider: ProviderKind, settings: ServerSettings): boolean {
  return (
    settings.providers[provider]?.enabled !== false && settings.providers[provider] !== undefined
  );
}

function makeDisabledProviderStatus(
  provider: ProviderKind,
  checkedAt = new Date().toISOString(),
): ServerProviderStatus {
  return {
    provider,
    status: "warning" as const,
    available: false,
    authStatus: "unknown" as const,
    checkedAt,
    message: DISABLED_PROVIDER_STATUS_MESSAGE,
  } satisfies ServerProviderStatus;
}

function isDisabledProviderStatusOverlay(status: ServerProviderStatus): boolean {
  return status.message === DISABLED_PROVIDER_STATUS_MESSAGE && status.available === false;
}

function mergeProviderStatusUpdates(
  previousStatuses: ReadonlyArray<ServerProviderStatus>,
  updatedStatuses: ReadonlyArray<ServerProviderStatus>,
): ProviderStatuses {
  const statusByProvider = new Map(
    previousStatuses.map((status) => [status.provider, status] as const),
  );
  for (const status of updatedStatuses) {
    statusByProvider.set(status.provider, status);
  }
  return orderProviderStatuses([...statusByProvider.values()]);
}

function makeSuppressedProviderVersionAdvisory(
  status: ServerProviderStatus,
  currentVersion?: string | null,
): NonNullable<ServerProviderStatus["versionAdvisory"]> {
  return {
    status: "unknown",
    currentVersion: currentVersion ?? status.version ?? null,
    latestVersion: null,
    updateCommand: null,
    canUpdate: false,
    checkedAt: status.checkedAt,
    message: null,
  };
}

function suppressProviderVersionAdvisory(status: ServerProviderStatus): ServerProviderStatus {
  return {
    ...status,
    versionAdvisory: makeSuppressedProviderVersionAdvisory(status),
  };
}

function projectProviderStatusesForSettings(
  statuses: ReadonlyArray<ServerProviderStatus>,
  settings: ServerSettings,
  checkedAt = new Date().toISOString(),
): ProviderStatuses {
  const statusByProvider = new Map(statuses.map((status) => [status.provider, status] as const));
  const projected: ServerProviderStatus[] = [];

  for (const provider of PROVIDERS) {
    const status = statusByProvider.get(provider);
    if (!isProviderEnabledForSettings(provider, settings)) {
      const disabledStatus = makeDisabledProviderStatus(provider, status?.checkedAt ?? checkedAt);
      const disabledStatusWithAdvisory = {
        ...disabledStatus,
        versionAdvisory: makeSuppressedProviderVersionAdvisory(disabledStatus, status?.version),
      } satisfies ServerProviderStatus;
      projected.push(
        status?.updateState
          ? { ...disabledStatusWithAdvisory, updateState: status.updateState }
          : disabledStatusWithAdvisory,
      );
      continue;
    }

    if (status && !isDisabledProviderStatusOverlay(status)) {
      projected.push(
        settings.enableProviderUpdateChecks ? status : suppressProviderVersionAdvisory(status),
      );
    }
  }

  return orderProviderStatuses(projected);
}

function makeProviderHealthLive(options?: { readonly providerUpdateTimeoutMs?: number }) {
  const providerUpdateTimeoutMs = options?.providerUpdateTimeoutMs ?? PROVIDER_UPDATE_TIMEOUT_MS;
  return Layer.effect(
    ProviderHealth,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const serverConfig = yield* ServerConfig;
      const serverSettings = yield* ServerSettingsService;
      const changesPubSub = yield* Effect.acquireRelease(
        PubSub.unbounded<ReadonlyArray<ServerProviderStatus>>(),
        PubSub.shutdown,
      );
      const refreshScope = yield* Scope.make("sequential");
      yield* Effect.addFinalizer(() => Scope.close(refreshScope, Exit.void));

      const cachePathByProvider = new Map(
        PROVIDERS.map(
          (provider) =>
            [
              provider,
              resolveProviderStatusCachePath({
                stateDir: serverConfig.stateDir,
                provider,
              }),
            ] as const,
        ),
      );

      const cachedStatuses: ProviderStatuses = yield* Effect.forEach(
        PROVIDERS,
        (provider) =>
          readProviderStatusCache(cachePathByProvider.get(provider)!).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
          ),
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map((statuses) =>
          orderProviderStatuses(
            statuses.filter(
              (status): status is ServerProviderStatus =>
                status !== undefined && !isDisabledProviderStatusOverlay(status),
            ),
          ),
        ),
      );

      const statusesRef = yield* Ref.make<ProviderStatuses>(cachedStatuses);
      const updateStatesRef = yield* Ref.make<ReadonlyMap<ProviderKind, ServerProviderUpdateState>>(
        new Map(),
      );
      const refreshFiberRef = yield* Ref.make<Fiber.Fiber<ProviderStatuses, never> | null>(null);
      const refreshNeedsFollowUpRef = yield* Ref.make(false);
      const commandCoordinator = yield* makeProviderMaintenanceCommandCoordinator({
        makeAlreadyRunningError: (provider) =>
          new ServerProviderUpdateError({
            provider: provider as ProviderKind,
            reason: "An update is already running for this provider.",
          }),
      });

      const statusChecks = yield* Effect.forEach(BUILT_IN_PROVIDERS, (descriptor) =>
        descriptor
          .makeStatusCheck({ homeDir: serverConfig.homeDir })
          .pipe(Effect.map((check) => ({ descriptor, check }))),
      );

      const getProviderMaintenanceCapabilities = Effect.fn("getProviderMaintenanceCapabilities")(
        function* (provider: ProviderKind) {
          const settings = yield* serverSettings.getSettings;
          if (!isProviderEnabledForSettings(provider, settings)) {
            return makeProviderMaintenanceCapabilities({
              provider,
              packageName: null,
              latestVersionSource: null,
              updateExecutable: null,
              updateArgs: [],
              updateLockKey: null,
            });
          }
          const { maintenance } = serverProviderDescriptor(provider);
          return yield* resolveProviderMaintenanceCapabilitiesEffect(maintenance, {
            binaryPath: settings.providers[provider].binaryPath,
            env: providerCommandEnv(provider),
            platform: process.platform,
          }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem));
        },
      );

      const applyVolatileProviderState = Effect.fn("applyVolatileProviderState")(function* (
        status: ServerProviderStatus,
      ) {
        const updateStates = yield* Ref.get(updateStatesRef);
        const updateState = updateStates.get(status.provider);
        if (!updateState) {
          const { updateState: _updateState, ...statusWithoutUpdateState } = status;
          return statusWithoutUpdateState;
        }
        return {
          ...status,
          updateState,
        };
      });

      const projectStatusesForCurrentSettings = Effect.fn(
        "projectProviderStatusesForCurrentSettings",
      )(function* (statuses: ReadonlyArray<ServerProviderStatus>) {
        return yield* serverSettings.getSettings.pipe(
          Effect.map((settings) => projectProviderStatusesForSettings(statuses, settings)),
          Effect.catch(() => Effect.succeed(statuses)),
          Effect.flatMap((projected) =>
            Effect.forEach(projected, applyVolatileProviderState, {
              concurrency: "unbounded",
            }),
          ),
        );
      });

      const publishProjectedStatuses = Effect.fn("publishProjectedProviderStatuses")(function* () {
        const rawStatuses = yield* Ref.get(statusesRef);
        const projectedStatuses = yield* projectStatusesForCurrentSettings(rawStatuses);
        yield* PubSub.publish(changesPubSub, projectedStatuses);
        return projectedStatuses;
      });

      const setProviderUpdateState = Effect.fn("setProviderUpdateState")(function* (
        provider: ProviderKind,
        state: ServerProviderUpdateState | null,
      ) {
        yield* Ref.update(updateStatesRef, (previous) => {
          const next = new Map(previous);
          if (!state || state.status === "idle") {
            next.delete(provider);
          } else {
            next.set(provider, state);
          }
          return next;
        });

        return yield* publishProjectedStatuses();
      });

      const enrichStatuses = Effect.fn("enrichProviderStatuses")(function* (
        statuses: ReadonlyArray<ServerProviderStatus>,
      ) {
        const settings = yield* serverSettings.ready.pipe(
          Effect.flatMap(() => serverSettings.getSettings),
          Effect.catch(() => Effect.succeed(null)),
        );
        if (settings?.enableProviderUpdateChecks === false) {
          return yield* Effect.forEach(
            statuses.map(suppressProviderVersionAdvisory),
            applyVolatileProviderState,
            { concurrency: "unbounded" },
          );
        }

        const enriched = yield* Effect.forEach(
          statuses,
          (status) =>
            getProviderMaintenanceCapabilities(status.provider).pipe(
              Effect.flatMap((capabilities) =>
                enrichProviderStatusWithVersionAdvisory(status, capabilities),
              ),
              Effect.catch(() =>
                Effect.succeed({
                  ...status,
                  versionAdvisory: {
                    status: "unknown" as const,
                    currentVersion: status.version ?? null,
                    latestVersion: null,
                    updateCommand: null,
                    canUpdate: false,
                    checkedAt: status.checkedAt,
                    message: null,
                  },
                }),
              ),
            ),
          { concurrency: "unbounded" },
        );
        return yield* Effect.forEach(enriched, applyVolatileProviderState, {
          concurrency: "unbounded",
        });
      });

      const checkProviderWhenEnabled = (
        settings: ServerSettings,
        { descriptor, check }: (typeof statusChecks)[number],
      ) =>
        isProviderEnabledForSettings(descriptor.kind, settings)
          ? check(settings).pipe(
              Effect.map(
                (status): ServerProviderStatus => ({
                  ...status,
                  autoRuntimeModeBinaryPath:
                    nonEmptyTrimmed(settings.providers[descriptor.kind].binaryPath) ??
                    descriptor.cli.command,
                }),
              ),
              Effect.flatMap((status) =>
                modelDiscoveryContext({
                  request: { provider: descriptor.kind },
                  settings,
                  homeDir: serverConfig.homeDir,
                }).pipe(
                  Effect.match({
                    onSuccess: (context): ServerProviderStatus => ({
                      ...status,
                      modelCatalogContextIdentity: context.identity,
                    }),
                    onFailure: (error): ServerProviderStatus => ({
                      ...status,
                      status: "warning",
                      message: error.detail,
                    }),
                  }),
                ),
              ),
              Effect.map(Option.some),
            )
          : Effect.succeed(Option.none<ServerProviderStatus>());

      const loadProviderStatuses = serverSettings.ready
        .pipe(
          Effect.flatMap(() => serverSettings.getSettings),
          Effect.flatMap((settings) =>
            Effect.forEach(statusChecks, (entry) => checkProviderWhenEnabled(settings, entry), {
              concurrency: "unbounded",
            }),
          ),
        )
        .pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.map((statuses) =>
            orderProviderStatuses(
              statuses.flatMap((status) => (Option.isSome(status) ? [status.value] : [])),
            ),
          ),
          Effect.flatMap(enrichStatuses),
        );

      const persistStatuses = (statuses: ProviderStatuses) =>
        Effect.forEach(
          statuses,
          (status) => {
            const { updateState: _updateState, ...statusToPersist } = status;
            return writeProviderStatusCache({
              filePath: cachePathByProvider.get(status.provider)!,
              provider: statusToPersist,
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.tapError(Effect.logError),
              Effect.ignore,
            );
          },
          { concurrency: "unbounded", discard: true },
        );

      const refreshNow = Effect.gen(function* () {
        let revisionRetries = 0;
        while (true) {
          const refreshRevision = (yield* serverSettings.getSnapshot).revision;

          const loadedStatuses = yield* loadProviderStatuses;
          if ((yield* serverSettings.getSnapshot).revision !== refreshRevision) {
            // A caller that joined this refresh expects the settings mutation it just made to be reflected.
            // Retry in the same shared fiber so an enable cannot resolve with the stale pre-mutation probe.
            if (revisionRetries < MAX_REFRESH_REVISION_RETRIES) {
              revisionRetries += 1;
              continue;
            }

            yield* Ref.set(refreshNeedsFollowUpRef, true);
            const currentStatuses = yield* Ref.get(statusesRef);
            return yield* projectStatusesForCurrentSettings(currentStatuses);
          }
          const previousRawStatuses = yield* Ref.get(statusesRef);
          const previousStatuses = yield* projectStatusesForCurrentSettings(previousRawStatuses);
          const stabilizedLoadedStatuses = stabilizeProviderStatusesAgainstTransientTimeouts(
            previousRawStatuses,
            loadedStatuses,
          );
          const nextRawStatuses = mergeProviderStatusUpdates(
            previousRawStatuses,
            stabilizedLoadedStatuses,
          );
          const nextStatuses = yield* projectStatusesForCurrentSettings(nextRawStatuses);
          yield* Ref.set(statusesRef, nextRawStatuses);
          if (providerStatusesEqual(previousStatuses, nextStatuses)) {
            return nextStatuses;
          }
          yield* persistStatuses(nextRawStatuses);
          yield* PubSub.publish(changesPubSub, nextStatuses);
          return nextStatuses;
        }
      });

      function ensureRefreshFiber(): Effect.Effect<Fiber.Fiber<ProviderStatuses, never>> {
        return Effect.gen(function* () {
          const inFlight = yield* Ref.get(refreshFiberRef);
          if (inFlight) {
            return inFlight;
          }
          const refreshFiber = yield* Effect.gen(function* () {
            const refreshExit = yield* Effect.exit(
              Effect.gen(function* () {
                const statuses = yield* refreshNow;
                if (!(yield* Ref.getAndSet(refreshNeedsFollowUpRef, false))) {
                  return statuses;
                }
                return yield* refreshNow;
              }),
            );
            if (Exit.isSuccess(refreshExit)) {
              return refreshExit.value;
            }

            const rawStatuses = yield* Ref.get(statusesRef);
            return yield* projectStatusesForCurrentSettings(rawStatuses);
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                yield* Ref.set(refreshFiberRef, null);
                if (!(yield* Ref.getAndSet(refreshNeedsFollowUpRef, false))) {
                  return;
                }

                yield* Effect.sleep(Duration.millis(REFRESH_REVISION_RESCHEDULE_DELAY_MS)).pipe(
                  Effect.andThen(ensureRefreshFiber().pipe(Effect.asVoid)),
                  Effect.forkIn(refreshScope),
                  Effect.asVoid,
                );
              }),
            ),
            Effect.forkIn(refreshScope),
          );
          yield* Ref.set(refreshFiberRef, refreshFiber);
          return refreshFiber;
        });
      }

      yield* serverSettings.streamChanges.pipe(
        Stream.runForEach(() => publishProjectedStatuses().pipe(Effect.asVoid)),
        Effect.forkIn(refreshScope),
      );

      const refresh: Effect.Effect<ProviderStatuses> = ensureRefreshFiber().pipe(
        Effect.flatMap(Fiber.join),
      );

      const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

      const makeUpdateState = (input: {
        readonly status: ServerProviderUpdateState["status"];
        readonly startedAt: string | null;
        readonly finishedAt: string | null;
        readonly message: string | null;
        readonly output?: string | null;
      }): ServerProviderUpdateState => ({
        status: input.status,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        message: input.message,
        output: input.output ?? null,
      });

      const describeUpdateCommandError = (error: unknown): string => {
        if (error instanceof Error && error.message.trim().length > 0) {
          if (error.message.includes("initial is not a function")) {
            return "Update command failed before producing output. Try running the provider update command from a terminal.";
          }
          return error.message;
        }
        if (typeof error === "string" && error.trim().length > 0) {
          return error;
        }
        return "Update command could not be started.";
      };

      const runUpdateCommand = Effect.fn("runProviderUpdateCommand")(function* (input: {
        readonly provider: ProviderKind;
        readonly command: string;
        readonly args: ReadonlyArray<string>;
        readonly pathPrepend?: string;
      }) {
        const baseEnv = providerCommandEnv(input.provider);
        const updateEnv = { ...baseEnv };
        if (input.pathPrepend) {
          const windows = OS.platform() === "win32";
          const pathKey = windows ? envPathKeyFor(baseEnv, "win32") : "PATH";
          const existingPaths = windows
            ? Object.entries(baseEnv)
                .filter(([key]) => isPathName(key))
                .map(([, value]) => value)
            : [baseEnv.PATH];
          if (windows) {
            for (const key of Object.keys(updateEnv)) {
              if (isPathName(key)) delete updateEnv[key];
            }
          }
          updateEnv[pathKey] = [input.pathPrepend, ...existingPaths]
            .filter((entry): entry is string => Boolean(entry))
            .join(windows ? ";" : ":");
        }
        const child = yield* spawnEffectProcess(spawner, input.command, input.args, {
          env: updateEnv,
          stdin: "ignore",
        });
        yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collectUint8StreamText({
              stream: child.stdout,
              maxBytes: UPDATE_OUTPUT_MAX_BYTES,
            }),
            collectUint8StreamText({
              stream: child.stderr,
              maxBytes: UPDATE_OUTPUT_MAX_BYTES,
            }),
            child.exitCode.pipe(Effect.map(Number)),
          ],
          { concurrency: "unbounded" },
        );
        return {
          stdout: stdout.text,
          stderr: stderr.text,
          exitCode,
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
        };
      });

      const updateProvider: ProviderHealthShape["updateProvider"] = Effect.fn(
        "ProviderHealth.updateProvider",
      )(function* (input) {
        const provider = input.provider;
        const toUpdateError = (reason: unknown) =>
          new ServerProviderUpdateError({
            provider,
            reason: reason instanceof Error ? reason.message : String(reason),
          });
        const providerIsEnabled = serverSettings.getSettings.pipe(
          Effect.mapError(toUpdateError),
          Effect.map((settings) => isProviderEnabledForSettings(provider, settings)),
        );
        const disabledError = () =>
          new ServerProviderUpdateError({
            provider,
            reason: "Provider is disabled in Glade settings.",
          });
        if (!(yield* providerIsEnabled)) {
          return yield* disabledError();
        }
        const capabilities = yield* getProviderMaintenanceCapabilities(provider).pipe(
          Effect.mapError(toUpdateError),
        );
        const update = capabilities.update;
        if (!update) {
          return yield* new ServerProviderUpdateError({
            provider,
            reason: "This provider does not support one-click updates.",
          });
        }

        const run = Effect.gen(function* () {
          if (!(yield* providerIsEnabled)) {
            const finishedAt = yield* nowIso;
            yield* setProviderUpdateState(
              provider,
              makeUpdateState({
                status: "failed",
                startedAt: null,
                finishedAt,
                message: "Provider was disabled before its queued update could start.",
              }),
            );
            return yield* disabledError();
          }
          const startedAt = yield* nowIso;
          yield* setProviderUpdateState(
            provider,
            makeUpdateState({
              status: "running",
              startedAt,
              finishedAt: null,
              message: "Updating provider.",
            }),
          );

          const waitForProviderDisablement = Effect.gen(function* () {
            while (yield* providerIsEnabled.pipe(Effect.catch(() => Effect.succeed(true)))) {
              yield* Effect.sleep(Duration.millis(PROVIDER_UPDATE_ENABLEMENT_POLL_MS));
            }
          });
          const commandOutcome = yield* Effect.raceFirst(
            runUpdateCommand({
              provider,
              command: update.executable,
              args: update.args,
              ...(update.pathPrepend ? { pathPrepend: update.pathPrepend } : {}),
            }).pipe(
              Effect.scoped,
              Effect.timeoutOption(Duration.millis(providerUpdateTimeoutMs)),
              Effect.result,
              Effect.map((result) => ({ _tag: "completed" as const, result })),
            ),
            waitForProviderDisablement.pipe(Effect.as({ _tag: "disabled" as const })),
          );
          // Even a failed or interrupted update may have replaced the binary.
          invalidateCliVersionGates();
          const finishedAt = yield* nowIso;
          if (commandOutcome._tag === "disabled") {
            const providers = yield* setProviderUpdateState(
              provider,
              makeUpdateState({
                status: "failed",
                startedAt,
                finishedAt,
                message: "Update stopped because the provider was disabled.",
              }),
            );
            return { providers };
          }
          const commandResult = commandOutcome.result;
          if (Result.isFailure(commandResult)) {
            const providers = yield* setProviderUpdateState(
              provider,
              makeUpdateState({
                status: "failed",
                startedAt,
                finishedAt,
                message: describeUpdateCommandError(commandResult.failure),
              }),
            );
            return { providers };
          }
          const result = commandResult.success;
          const output = Option.isSome(result)
            ? [result.value.stderr, result.value.stdout].filter(Boolean).join("\n\n").trim() || null
            : null;
          const failed = Option.isNone(result) || result.value.exitCode !== 0;
          if (failed) {
            const message = Option.isNone(result)
              ? `Update timed out after ${formatProviderUpdateTimeout(providerUpdateTimeoutMs)}. The provider process was stopped.`
              : `Update command exited with code ${result.value.exitCode}.`;
            const providers = yield* setProviderUpdateState(
              provider,
              makeUpdateState({
                status: "failed",
                startedAt,
                finishedAt,
                message,
                output: output ? output.slice(0, UPDATE_OUTPUT_MAX_BYTES) : null,
              }),
            );
            return { providers };
          }

          const providers = yield* refreshNow.pipe(Effect.mapError(toUpdateError));
          const refreshed = providers.find((status) => status.provider === provider);
          const refreshedAdvisory = refreshed?.versionAdvisory;
          const stillOutdated = refreshedAdvisory?.status === "behind_latest";
          const stillOutdatedVersions =
            refreshedAdvisory?.currentVersion && refreshedAdvisory.latestVersion
              ? ` (installed ${refreshedAdvisory.currentVersion}, latest ${refreshedAdvisory.latestVersion})`
              : "";
          const finalProviders = yield* setProviderUpdateState(
            provider,
            makeUpdateState({
              status: stillOutdated ? "unchanged" : "succeeded",
              startedAt,
              finishedAt,
              message: stillOutdated
                ? `Update command completed, but Glade still detects an outdated provider version${stillOutdatedVersions}.`
                : "Provider updated.",
              output: output ? output.slice(0, UPDATE_OUTPUT_MAX_BYTES) : null,
            }),
          );
          return { providers: finalProviders };
        });

        return yield* commandCoordinator.withCommandLock({
          targetKey: provider,
          lockKey: update.lockKey,
          onQueued: setProviderUpdateState(
            provider,
            makeUpdateState({
              status: "queued",
              startedAt: null,
              finishedAt: null,
              message: "Waiting for another provider update to finish.",
            }),
          ).pipe(Effect.asVoid),
          run,
        });
      });

      return {
        getStatuses: Ref.get(statusesRef).pipe(Effect.flatMap(projectStatusesForCurrentSettings)),
        refresh,
        updateProvider,
        get streamChanges() {
          return Stream.fromPubSub(changesPubSub);
        },
      } satisfies ProviderHealthShape;
    }),
  );
}

export const ProviderHealthLive = makeProviderHealthLive();
