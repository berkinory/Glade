import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ProviderSessionBranching } from "../Services/ProviderSessionBranching";
import { ProviderAdmission } from "../Services/ProviderAdmission";
import { Layer } from "effect";
import { ProviderInterruptions } from "../Services/ProviderInterruptions";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderLifecycle } from "../Services/ProviderLifecycle";

import { Effect, Option, Exit } from "effect";
import { type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  decodeInputOrValidationError,
  validateAutoRuntimeMode,
  ImportExternalThreadInput,
  toValidationError,
} from "../core/providerServiceValidation";
import { ProviderForkThreadInput } from "@glade/contracts/provider/provider";
import { asRecord } from "@glade/shared/transport/payloadValues";
import {
  hasResumeCursor,
  readPersistedProviderOptions,
  readPersistedCwd,
  toRuntimeStatus,
} from "../core/providerRuntimeBinding";
import {
  PROVIDER_START_SESSION_TIMEOUT,
  PROVIDER_STOP_SESSION_TIMEOUT,
} from "../core/providerServiceConfiguration";
import { ProviderRuntimeBindings } from "../Services/ProviderRuntimeBindings";
import { ProviderIdleRuntime } from "../Services/ProviderIdleRuntime";

export const ProviderSessionBranchingLive = Layer.effect(
  ProviderSessionBranching,
  Effect.gen(function* () {
    const bindings = yield* ProviderRuntimeBindings;
    const idle = yield* ProviderIdleRuntime;
    const interruptions = yield* ProviderInterruptions;
    const directory = yield* ProviderSessionDirectory;
    const registry = yield* ProviderAdapterRegistry;
    const lifecycle = yield* ProviderLifecycle;
    const { ensureProviderEnabled } = yield* ProviderAdmission;
    const forkThread: NonNullable<ProviderServiceShape["forkThread"]> = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.forkThread",
          schema: ProviderForkThreadInput,
          payload: rawInput,
        });

        const existingTargetBinding = Option.getOrUndefined(
          yield* directory.getBinding(input.threadId),
        );
        if (existingTargetBinding) {
          const existingTargetPayload = asRecord(existingTargetBinding.runtimePayload) ?? {};
          if (
            existingTargetPayload.lastRuntimeEvent === "provider.thread.forked" &&
            hasResumeCursor(existingTargetBinding.resumeCursor)
          ) {
            return {
              threadId: input.threadId,
              resumeCursor: existingTargetBinding.resumeCursor,
            };
          }
          return null;
        }

        const sourceBinding = Option.getOrUndefined(
          yield* directory.getBinding(input.sourceThreadId),
        );
        if (!sourceBinding) {
          return null;
        }

        const effectiveProviderOptions =
          input.providerOptions ?? readPersistedProviderOptions(sourceBinding.runtimePayload);
        const sourceCwd = readPersistedCwd(sourceBinding.runtimePayload);
        const targetCwd = input.cwd ?? sourceCwd;
        yield* validateAutoRuntimeMode(
          "ProviderService.forkThread",
          sourceBinding.provider,
          input.runtimeMode,
        );

        const adapter = yield* registry.getByProvider(sourceBinding.provider);
        if (!adapter.forkThread) {
          return null;
        }

        if (
          input.modelSelection !== undefined &&
          input.modelSelection.provider !== adapter.provider
        ) {
          return null;
        }

        const forked = yield* adapter
          .forkThread({
            ...input,
            threadId: input.threadId,
            sourceThreadId: input.sourceThreadId,
            ...(effectiveProviderOptions !== undefined
              ? { providerOptions: effectiveProviderOptions }
              : {}),
            ...(sourceBinding.resumeCursor !== null && sourceBinding.resumeCursor !== undefined
              ? { sourceResumeCursor: sourceBinding.resumeCursor }
              : {}),
            ...(sourceCwd ? { sourceCwd } : {}),
            runtimeMode: input.runtimeMode,
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("provider native fork failed; falling back", {
                sourceThreadId: input.sourceThreadId,
                targetThreadId: input.threadId,
                cause: error instanceof Error ? error.message : String(error),
              }).pipe(Effect.as(null)),
            ),
          );
        if (!forked) {
          return null;
        }

        const forkedSession = (yield* adapter.listSessions()).find(
          (session) => session.threadId === input.threadId,
        );

        yield* lifecycle.run(input.threadId, (lease) =>
          Effect.gen(function* () {
            if (forkedSession) {
              yield* bindings.upsertSessionBinding(forkedSession, input.threadId, {
                lifecycleGeneration: lease.generation,
                ...(input.modelSelection !== undefined
                  ? { modelSelection: input.modelSelection }
                  : {}),
                ...(effectiveProviderOptions !== undefined
                  ? { providerOptions: effectiveProviderOptions }
                  : {}),

                ...(input.enableComputerControl ? { enableComputerControl: true } : {}),
                lastRuntimeEvent: "provider.thread.forked",
                lastRuntimeEventAt: new Date().toISOString(),
              });
            } else {
              yield* directory.upsert({
                threadId: input.threadId,
                provider: adapter.provider,
                runtimeMode: input.runtimeMode,
                status: "stopped",
                lifecycleGeneration: lease.generation,
                ...(forked.resumeCursor !== undefined ? { resumeCursor: forked.resumeCursor } : {}),
                runtimePayload: {
                  cwd: targetCwd ?? null,
                  model: input.modelSelection?.model ?? null,
                  activeTurnId: null,
                  lastError: null,
                  ...(input.modelSelection !== undefined
                    ? { modelSelection: input.modelSelection }
                    : {}),
                  ...(effectiveProviderOptions !== undefined
                    ? { providerOptions: effectiveProviderOptions }
                    : {}),
                  ...(input.enableComputerControl ? { enableComputerControl: true } : {}),
                  lastRuntimeEvent: "provider.thread.forked",
                  lastRuntimeEventAt: new Date().toISOString(),
                },
              });
            }
            lease.commit();
          }),
        );
        return forked;
      });

    const importExternalThread: NonNullable<ProviderServiceShape["importExternalThread"]> = (
      rawInput,
    ) =>
      Effect.gen(function* () {
        const operation = "ProviderService.importExternalThread";
        const input = yield* decodeInputOrValidationError({
          operation,
          schema: ImportExternalThreadInput,
          payload: rawInput,
        });
        if (input.modelSelection.provider !== input.provider) {
          return yield* toValidationError(
            operation,
            "Import model and source provider must match.",
          );
        }
        yield* ensureProviderEnabled(input.provider, operation);
        yield* validateAutoRuntimeMode(operation, input.provider, input.runtimeMode);
        yield* interruptions.wait(input.threadId);
        idle.clearRuntimeIdleTimer(input.threadId);
        yield* idle.waitForRuntimeIdleStop(input.threadId);
        return yield* lifecycle.run(input.threadId, (lease) =>
          Effect.gen(function* () {
            const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
            if (binding) {
              const payload = asRecord(binding.runtimePayload) ?? {};
              if (
                binding.provider === input.provider &&
                payload.importExternalThreadId === input.externalThreadId &&
                payload.importSourceCwd === input.sourceCwd &&
                hasResumeCursor(binding.resumeCursor)
              ) {
                lease.adopt(binding.lifecycleGeneration ?? "legacy");
                return { threadId: input.threadId, resumeCursor: binding.resumeCursor };
              }
              return yield* toValidationError(
                operation,
                "The target conversation already has a different provider binding.",
              );
            }
            yield* ensureProviderEnabled(input.provider, operation);
            const adapter = yield* registry.getByProvider(input.provider);
            if (!adapter.forkThread) {
              return yield* toValidationError(
                operation,
                "This provider cannot copy native conversations.",
              );
            }

            yield* adapter.stopSession(input.threadId);
            return yield* Effect.gen(function* () {
              const forkedOption = yield* adapter.forkThread!({
                threadId: input.threadId,
                sourceThreadId: ThreadId.makeUnsafe(input.externalThreadId),
                sourceResumeCursor:
                  input.provider === "codex"
                    ? { threadId: input.externalThreadId }
                    : { resume: input.externalThreadId },
                sourceCwd: input.sourceCwd,
                ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
                modelSelection: input.modelSelection,
                runtimeMode: input.runtimeMode,
                ...(input.providerOptions !== undefined
                  ? { providerOptions: input.providerOptions }
                  : {}),
                lifecycleGeneration: lease.generation,
                requireCompletedSource: true,
              }).pipe(Effect.timeoutOption(PROVIDER_START_SESSION_TIMEOUT));
              if (Option.isNone(forkedOption)) {
                return yield* toValidationError(
                  operation,
                  "The native conversation copy timed out.",
                );
              }
              const forked = forkedOption.value;
              const nativeCopyId = (asRecord(forked.resumeCursor) ?? {})[
                input.provider === "codex" ? "threadId" : "resume"
              ];
              if (
                forked.threadId !== input.threadId ||
                typeof nativeCopyId !== "string" ||
                nativeCopyId.length === 0 ||
                nativeCopyId === input.externalThreadId
              ) {
                return yield* toValidationError(
                  operation,
                  "The provider returned an invalid conversation copy.",
                );
              }
              const session = (yield* adapter.listSessions()).find(
                (candidate) => candidate.threadId === input.threadId,
              );
              if (session && session.provider !== input.provider) {
                return yield* toValidationError(
                  operation,
                  "The copied session belongs to a different provider.",
                );
              }
              const runtimePayload = {
                importExternalThreadId: input.externalThreadId,
                importSourceCwd: input.sourceCwd,
                cwd: input.cwd ?? input.sourceCwd,
                modelSelection: input.modelSelection,
                model: input.modelSelection.model,
                ...(input.providerOptions !== undefined
                  ? { providerOptions: input.providerOptions }
                  : {}),
                activeTurnId: null,
                lastError: null,
                lastRuntimeEvent: "provider.thread.imported",
                lastRuntimeEventAt: new Date().toISOString(),
              };

              yield* bindings.withBindingWriteLock(
                input.threadId,
                directory.upsert({
                  threadId: input.threadId,
                  provider: input.provider,
                  runtimeMode: input.runtimeMode,
                  status: session ? toRuntimeStatus(session) : "stopped",
                  lifecycleGeneration: lease.generation,
                  resumeCursor: forked.resumeCursor,
                  runtimePayload,
                }),
              );
              lease.commit();
              return forked;
            }).pipe(
              Effect.onExit((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.void
                  : adapter.stopSession(input.threadId).pipe(
                      Effect.timeoutOption(PROVIDER_STOP_SESSION_TIMEOUT),
                      Effect.flatMap((stopped) =>
                        Option.isSome(stopped)
                          ? Effect.void
                          : Effect.fail(
                              toValidationError(
                                operation,
                                "The failed import runtime did not finish stopping.",
                              ),
                            ),
                      ),
                    ),
              ),
            );
          }),
        );
      });
    return { forkThread, importExternalThread };
  }),
);
