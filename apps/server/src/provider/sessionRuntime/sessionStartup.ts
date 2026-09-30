import { type ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Option, Duration, Cause, Exit } from "effect";
import { ProviderValidationError, type ProviderAdapterError } from "../core/Errors.ts";
import type { ServiceMap } from "effect";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { makeProviderLifecycleCoordinator } from "../core/providerLifecycleCoordinator.ts";
import {
  ProviderInterruptionFence,
  readPersistedProviderOptions,
  PRIOR_TRANSCRIPT_BOOTSTRAP_PENDING,
  readPersistedComputerControl,
  hasResumeCursor,
  readPersistedModelSelection,
  readPersistedCwd,
} from "../core/providerRuntimeBinding";
import { type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  decodeInputOrValidationError,
  toValidationError,
  validateAutoRuntimeMode,
  CompletePriorTranscriptBootstrapInput,
} from "../core/providerServiceValidation";
import {
  ProviderSessionStartInput,
  type ProviderSession,
} from "@glade/contracts/provider/provider";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { asRecord } from "@glade/shared/transport/payloadValues";
import {
  ProviderStartupLifecycle,
  observeProviderStartup,
  startupPhaseDurations,
} from "../core/providerStartupLifecycle.ts";
import {
  PROVIDER_START_SESSION_TIMEOUT,
  PROVIDER_STOP_SESSION_TIMEOUT,
} from "../core/providerServiceConfiguration";
import { AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED } from "../../agentGateway/sessionLease.ts";
import { makeProviderInterruptionFence } from "./interruptionFence";
import { makeProviderIdleLifecycle } from "./idleLifecycle";
import { makeProviderRuntimeBinding } from "./runtimeBinding";

export function makeProviderSessionStartup(input: {
  readonly ensureProviderEnabled: (
    provider: ProviderKind,
    operation: string,
  ) => Effect.Effect<void, ProviderValidationError>;
  readonly waitForCurrentInterruptionFence: ReturnType<
    typeof makeProviderInterruptionFence
  >["waitForCurrentInterruptionFence"];
  readonly clearRuntimeIdleTimer: ReturnType<
    typeof makeProviderIdleLifecycle
  >["clearRuntimeIdleTimer"];
  readonly waitForRuntimeIdleStop: ReturnType<
    typeof makeProviderIdleLifecycle
  >["waitForRuntimeIdleStop"];
  readonly registry: ServiceMap.Service.Shape<typeof ProviderAdapterRegistry>;
  readonly directory: ServiceMap.Service.Shape<typeof ProviderSessionDirectory>;
  readonly lifecycle: ReturnType<typeof makeProviderLifecycleCoordinator>;
  readonly withBindingWriteLock: ReturnType<
    typeof makeProviderRuntimeBinding
  >["withBindingWriteLock"];
  readonly upsertSessionBinding: ReturnType<
    typeof makeProviderRuntimeBinding
  >["upsertSessionBinding"];
  readonly providerInterruptionFences: Map<ThreadId, ProviderInterruptionFence>;
}): {
  readonly startSession: ProviderServiceShape["startSession"];
  readonly startSessionWithOutcome: NonNullable<ProviderServiceShape["startSessionWithOutcome"]>;
  readonly completePriorTranscriptBootstrap: NonNullable<
    ProviderServiceShape["completePriorTranscriptBootstrap"]
  >;
} {
  const {
    ensureProviderEnabled,
    waitForCurrentInterruptionFence,
    clearRuntimeIdleTimer,
    waitForRuntimeIdleStop,
    registry,
    directory,
    lifecycle,
    withBindingWriteLock,
    upsertSessionBinding,
    providerInterruptionFences,
  } = input;
  const startSessionWithOutcome: NonNullable<ProviderServiceShape["startSessionWithOutcome"]> = (
    threadId,
    rawInput,
    outcomeOptions,
  ) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderService.startSession",
        schema: ProviderSessionStartInput,
        payload: rawInput,
      });

      const resolvedProvider = parsed.provider ?? parsed.modelSelection?.provider;
      if (resolvedProvider === undefined) {
        return yield* toValidationError(
          "provider.session.start",
          "startSession requires an explicit provider or modelSelection with a provider",
        );
      }
      const input = {
        ...parsed,
        threadId,
        provider: resolvedProvider,
      };
      yield* ensureProviderEnabled(input.provider, "ProviderService.startSession");
      yield* validateAutoRuntimeMode(
        "ProviderService.startSession",
        input.provider,
        input.runtimeMode,
      );
      // An explicit start is the recovery authority for a failed retirement, but it must never interleave
      // with one still in progress. Capture the exact settled fence so this replacement cannot delete a
      // newer fence that was published while provider startup was running.
      const replacementFence = yield* waitForCurrentInterruptionFence(threadId);
      clearRuntimeIdleTimer(threadId);
      yield* waitForRuntimeIdleStop(threadId);
      const adapter = yield* registry.getByProvider(input.provider);
      let retiredSession: ProviderSession | undefined;
      let preparedStart: ProviderAdapterShape<ProviderAdapterError>["startSession"] | undefined;
      const prepareReplacement = adapter.prepareSessionReplacement
        ? Effect.gen(function* () {
            const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
            const providerOptions =
              input.providerOptions ??
              (binding?.provider === input.provider
                ? readPersistedProviderOptions(binding.runtimePayload)
                : undefined);
            const prepared = yield* adapter.prepareSessionReplacement!({
              ...input,
              ...(providerOptions !== undefined ? { providerOptions } : {}),
            });
            retiredSession = prepared?.previousSession;
            preparedStart = prepared?.startSession;
          })
        : undefined;
      return yield* lifecycle.run(
        threadId,
        (lease) =>
          Effect.gen(function* () {
            const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
            const effectiveResumeCursor =
              input.forkSourceResumeCursor !== undefined
                ? undefined
                : (input.resumeCursor ??
                  retiredSession?.resumeCursor ??
                  (persistedBinding?.provider === input.provider
                    ? persistedBinding.resumeCursor
                    : undefined));
            const persistedPriorTranscriptBootstrapPending =
              persistedBinding?.provider === input.provider &&
              (asRecord(persistedBinding.runtimePayload) ?? {})[
                PRIOR_TRANSCRIPT_BOOTSTRAP_PENDING
              ] === true;
            const { resumeCursor: _inputResumeCursor, ...adapterStartInput } = input;
            const effectiveProviderOptions =
              input.providerOptions ??
              (persistedBinding?.provider === input.provider
                ? readPersistedProviderOptions(persistedBinding.runtimePayload)
                : undefined);
            const effectiveComputerControl =
              input.enableComputerControl ??
              (persistedBinding?.provider === input.provider
                ? readPersistedComputerControl(persistedBinding.runtimePayload)
                : false);
            let replacementStarted = false;
            const startupLifecycle = new ProviderStartupLifecycle();
            const startAndPersistReplacement = Effect.gen(function* () {
              yield* ensureProviderEnabled(input.provider, "ProviderService.startSession");
              const resolvedAdapterStartInput = {
                ...adapterStartInput,
                enableComputerControl: effectiveComputerControl,
                lifecycleGeneration: lease.generation,
                ...(effectiveProviderOptions !== undefined
                  ? { providerOptions: effectiveProviderOptions }
                  : {}),
                ...(hasResumeCursor(effectiveResumeCursor)
                  ? { resumeCursor: effectiveResumeCursor }
                  : {}),
              };
              // A provider start that never returns holds this thread's lifecycle lock and the caller's command
              // slot forever.
              startupLifecycle.transition("starting");
              startupLifecycle.transition("handshaking");

              const started = yield* observeProviderStartup(
                (preparedStart ?? adapter.startSession)(resolvedAdapterStartInput),
                { lifecycle: startupLifecycle, timeout: PROVIDER_START_SESSION_TIMEOUT },
              ).pipe(
                Effect.tapError((cause) =>
                  Effect.logError("provider.session.start_failed", {
                    threadId,
                    provider: input.provider,
                    startup: startupLifecycle.snapshot(),
                    cause: cause instanceof Error ? cause.message : String(cause),
                  }),
                ),
                Effect.onInterrupt(() =>
                  Effect.logInfo("provider.session.start_cancelled", {
                    threadId,
                    provider: input.provider,
                    startup: startupLifecycle.snapshot(),
                  }),
                ),
              );
              if (Option.isNone(started)) {
                yield* Effect.logError("provider session start exceeded its deadline", {
                  threadId,
                  provider: input.provider,
                  timeoutMs: Duration.toMillis(PROVIDER_START_SESSION_TIMEOUT),
                  startup: startupLifecycle.snapshot(),
                });
                yield* adapter.stopSession(threadId).pipe(
                  Effect.timeoutOption(PROVIDER_STOP_SESSION_TIMEOUT),
                  Effect.catchCause((cause) =>
                    Effect.logWarning("failed to retire a timed-out provider session start", {
                      threadId,
                      provider: input.provider,
                      cause: Cause.pretty(cause),
                    }),
                  ),
                );
                return yield* toValidationError(
                  "ProviderService.startSession",
                  `Provider '${input.provider}' did not finish starting within ${Duration.toMillis(
                    PROVIDER_START_SESSION_TIMEOUT,
                  )}ms for thread '${threadId}'.`,
                );
              }
              const session = started.value;
              startupLifecycle.transition("ready");
              replacementStarted = true;
              const nativeResumeAttempted = hasResumeCursor(effectiveResumeCursor);
              const nativeResumeSucceeded = nativeResumeAttempted;
              const priorTranscriptBootstrapPending =
                persistedPriorTranscriptBootstrapPending ||
                (outcomeOptions?.registerPriorTranscriptBootstrapOnFreshStart === true &&
                  !nativeResumeSucceeded);

              if (session.provider !== adapter.provider) {
                return yield* toValidationError(
                  "ProviderService.startSession",
                  `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`,
                );
              }

              yield* withBindingWriteLock(
                threadId,
                upsertSessionBinding(session, threadId, {
                  modelSelection: input.modelSelection,
                  providerOptions: effectiveProviderOptions,
                  enableComputerControl: effectiveComputerControl,
                  lifecycleGeneration: lease.generation,
                  runtimePayload: {
                    [AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED]: false,
                    ...(effectiveComputerControl ? { enableComputerControl: true } : {}),
                    [PRIOR_TRANSCRIPT_BOOTSTRAP_PENDING]: priorTranscriptBootstrapPending,
                  },
                }),
              );
              lease.commit();
              startupLifecycle.transition("running");
              const startupSnapshot = startupLifecycle.snapshot();
              yield* Effect.logDebug("provider.session.started", {
                threadId,
                provider: input.provider,
                startup: startupSnapshot,
                startupDurationsMs: startupPhaseDurations(startupSnapshot),
              });
              if (
                replacementFence !== undefined &&
                providerInterruptionFences.get(threadId) === replacementFence
              ) {
                providerInterruptionFences.delete(threadId);
              }

              return {
                session,
                nativeResumeAttempted,
                nativeResumeSucceeded,
                priorTranscriptBootstrapPending,
              };
            });

            if (!persistedBinding || persistedBinding.provider === input.provider) {
              return yield* startAndPersistReplacement;
            }

            const previousAdapter = yield* registry.getByProvider(persistedBinding.provider);
            if (!(yield* previousAdapter.hasSession(threadId))) {
              return yield* startAndPersistReplacement;
            }

            const previousGeneration = persistedBinding.lifecycleGeneration ?? "legacy";
            const previousModelSelection = readPersistedModelSelection(
              persistedBinding.runtimePayload,
            );
            const previousProviderOptions = readPersistedProviderOptions(
              persistedBinding.runtimePayload,
            );
            const previousComputerControl = readPersistedComputerControl(
              persistedBinding.runtimePayload,
            );
            // Otherwise the previous binding's value is recycled with its generation.
            const restoredComputerControl = input.enableComputerControl ?? previousComputerControl;
            const previousCwd = readPersistedCwd(persistedBinding.runtimePayload);
            yield* previousAdapter.stopSession(threadId);

            return yield* startAndPersistReplacement.pipe(
              Effect.onExit((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.void
                  : Effect.gen(function* () {
                      if (replacementStarted) {
                        yield* adapter.stopSession(threadId);
                      }
                      const restored = yield* previousAdapter.startSession({
                        threadId,
                        provider: persistedBinding.provider,
                        lifecycleGeneration: previousGeneration,
                        runtimeMode: persistedBinding.runtimeMode ?? "full-access",
                        ...(previousCwd !== undefined ? { cwd: previousCwd } : {}),
                        ...(previousModelSelection !== undefined
                          ? { modelSelection: previousModelSelection }
                          : {}),
                        ...(previousProviderOptions !== undefined
                          ? { providerOptions: previousProviderOptions }
                          : {}),
                        ...(restoredComputerControl ? { enableComputerControl: true } : {}),
                        ...(persistedBinding.resumeCursor !== undefined
                          ? { resumeCursor: persistedBinding.resumeCursor }
                          : {}),
                      });
                      if (restored.provider !== previousAdapter.provider) {
                        return yield* toValidationError(
                          "ProviderService.startSession",
                          `Adapter/provider mismatch while restoring '${previousAdapter.provider}': received '${restored.provider}'.`,
                        );
                      }
                      yield* withBindingWriteLock(
                        threadId,
                        upsertSessionBinding(restored, threadId, {
                          lifecycleGeneration: previousGeneration,
                          modelSelection: previousModelSelection,
                          providerOptions: previousProviderOptions,
                          enableComputerControl: restoredComputerControl,
                        }),
                      );

                      lease.adopt(previousGeneration);
                    }),
              ),
            );
          }),
        prepareReplacement,
      );
    });

  const startSession: ProviderServiceShape["startSession"] = (threadId, input) =>
    startSessionWithOutcome(threadId, input).pipe(Effect.map(({ session }) => session));

  const completePriorTranscriptBootstrap: NonNullable<
    ProviderServiceShape["completePriorTranscriptBootstrap"]
  > = (rawInput) =>
    Effect.gen(function* () {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.completePriorTranscriptBootstrap",
        schema: CompletePriorTranscriptBootstrapInput,
        payload: rawInput,
      });
      yield* withBindingWriteLock(
        input.threadId,
        Effect.gen(function* () {
          const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
          if (!binding) {
            return;
          }
          yield* directory.upsert({
            threadId: input.threadId,
            provider: binding.provider,
            runtimePayload: {
              [PRIOR_TRANSCRIPT_BOOTSTRAP_PENDING]: false,
            },
          });
        }),
      );
    });
  return { startSession, startSessionWithOutcome, completePriorTranscriptBootstrap };
}
