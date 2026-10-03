import { ProviderAdmission } from "../Services/ProviderAdmission";
import { ProviderSessionRouting } from "../Services/ProviderSessionRouting";
import { Layer } from "effect";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import { ProviderLifecycle } from "../Services/ProviderLifecycle";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Option } from "effect";
import { ProviderValidationError } from "../core/Errors.ts";
import { toValidationError, validateAutoRuntimeMode } from "../core/providerServiceValidation";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED } from "../../agentGateway/sessionLease.ts";
import {
  hasResumeCursor,
  readPersistedCwd,
  readPersistedModelSelection,
  readPersistedProviderOptions,
  readPersistedComputerControl,
} from "../core/providerRuntimeBinding";
import { ProviderIdleRuntime } from "../Services/ProviderIdleRuntime";
import { ProviderRuntimeBindings } from "../Services/ProviderRuntimeBindings";

export const ProviderSessionRoutingLive = Layer.effect(
  ProviderSessionRouting,
  Effect.gen(function* () {
    const bindings = yield* ProviderRuntimeBindings;
    const idle = yield* ProviderIdleRuntime;
    const directory = yield* ProviderSessionDirectory;
    const lifecycle = yield* ProviderLifecycle;
    const registry = yield* ProviderAdapterRegistry;
    const { ensureProviderEnabled } = yield* ProviderAdmission;
    const adapters = yield* Effect.forEach(yield* registry.listProviders(), (provider) =>
      registry.getByProvider(provider),
    );
    const recoverSessionForThread = (input: {
      readonly binding: ProviderRuntimeBinding;
      readonly operation: string;
    }) =>
      Effect.gen(function* () {
        const threadId = input.binding.threadId;
        const getCurrentBinding = () =>
          directory.getBinding(threadId).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    toValidationError(
                      input.operation,
                      `Cannot recover thread '${threadId}' because its provider binding was removed.`,
                    ),
                  ),
                onSome: Effect.succeed,
              }),
            ),
          );

        // Otherwise its terminal task event would be rejected as stale and this drain could wait forever.
        yield* lifecycle.runCurrent(threadId, () =>
          Effect.gen(function* () {
            let binding = yield* getCurrentBinding();
            const requiresCredentialRotation =
              (asRecord(binding.runtimePayload) ?? {})[
                AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED
              ] === true;
            if (!requiresCredentialRotation) {
              return;
            }

            let adapter = yield* registry.getByProvider(binding.provider);
            if (!(yield* adapter.hasSession(threadId))) {
              return;
            }

            yield* idle.waitForLiveRuntimeTasksToSettle(threadId);

            binding = yield* getCurrentBinding();
            if (
              (asRecord(binding.runtimePayload) ?? {})[
                AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED
              ] !== true
            ) {
              return;
            }
            adapter = yield* registry.getByProvider(binding.provider);
            if (!(yield* adapter.hasSession(threadId))) {
              return;
            }

            const activeSession = (yield* adapter.listSessions()).find(
              (session) => session.threadId === threadId,
            );
            if (activeSession?.resumeCursor !== undefined) {
              yield* bindings.withBindingWriteLock(
                threadId,
                directory.upsert({
                  threadId,
                  provider: binding.provider,
                  resumeCursor: activeSession.resumeCursor,
                }),
              );
            }
            yield* adapter.stopSession(threadId);
          }),
        );

        return yield* lifecycle.run(threadId, (lease) =>
          Effect.gen(function* () {
            const binding = yield* getCurrentBinding();
            const adapter = yield* registry.getByProvider(binding.provider);
            const hasPersistedResumeCursor = hasResumeCursor(binding.resumeCursor);
            const requiresCredentialRotation =
              (asRecord(binding.runtimePayload) ?? {})[
                AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED
              ] === true;
            const hasActiveSession = yield* adapter.hasSession(threadId);

            if (hasActiveSession && !requiresCredentialRotation) {
              const existing = (yield* adapter.listSessions()).find(
                (session) => session.threadId === threadId,
              );
              if (existing) {
                lease.adopt(binding.lifecycleGeneration ?? "legacy");
                return adapter;
              }
            }

            if (hasActiveSession && requiresCredentialRotation) {
              return yield* toValidationError(
                input.operation,
                `Cannot recover thread '${threadId}' because its retired provider runtime is still active.`,
              );
            }

            if (!hasPersistedResumeCursor && !requiresCredentialRotation) {
              return yield* toValidationError(
                input.operation,
                `Cannot recover thread '${threadId}' because no provider resume state is persisted.`,
              );
            }

            const persistedCwd = readPersistedCwd(binding.runtimePayload);
            const persistedModelSelection = readPersistedModelSelection(binding.runtimePayload);
            const persistedProviderOptions = readPersistedProviderOptions(binding.runtimePayload);
            if (
              input.operation === "ProviderService.compactThread" &&
              (!persistedModelSelection || !persistedCwd || binding.runtimeMode === undefined)
            ) {
              return yield* toValidationError(
                input.operation,
                "The saved native session profile is incomplete. Send an ordinary message before compacting.",
              );
            }
            const persistedComputerControl = readPersistedComputerControl(binding.runtimePayload);
            yield* validateAutoRuntimeMode(
              input.operation,
              binding.provider,
              binding.runtimeMode ?? "full-access",
            );
            yield* ensureProviderEnabled(binding.provider, input.operation);

            const resumeStartInput = {
              threadId,
              provider: binding.provider,
              lifecycleGeneration: lease.generation,
              ...(persistedCwd ? { cwd: persistedCwd } : {}),
              ...(persistedModelSelection ? { modelSelection: persistedModelSelection } : {}),
              ...(persistedProviderOptions ? { providerOptions: persistedProviderOptions } : {}),
              ...(persistedComputerControl ? { enableComputerControl: true } : {}),
              ...(hasPersistedResumeCursor ? { resumeCursor: binding.resumeCursor } : {}),
              runtimeMode: binding.runtimeMode ?? "full-access",
            };

            const resumed = yield* adapter.startSession(resumeStartInput);
            if (resumed.provider !== adapter.provider) {
              return yield* toValidationError(
                input.operation,
                `Adapter/provider mismatch while recovering thread '${threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`,
              );
            }

            yield* bindings.withBindingWriteLock(
              threadId,
              bindings
                .upsertSessionBinding(resumed, threadId, {
                  lifecycleGeneration: lease.generation,
                  ...(persistedComputerControl ? { enableComputerControl: true } : {}),
                })
                .pipe(
                  Effect.andThen(
                    requiresCredentialRotation
                      ? directory.upsert({
                          threadId,
                          provider: binding.provider,
                          runtimePayload: {
                            [AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED]: false,
                            ...(persistedComputerControl ? { enableComputerControl: true } : {}),
                          },
                        })
                      : Effect.void,
                  ),
                ),
            );
            lease.commit();
            return adapter;
          }),
        );
      });

    const findLiveSessionAdapter = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const matches = yield* Effect.forEach(
          adapters,
          (adapter) =>
            adapter.hasSession(threadId).pipe(
              Effect.map((hasSession) => (hasSession ? adapter : null)),
              Effect.orElseSucceed(() => null),
            ),
          { concurrency: "unbounded" },
        );
        return matches.find((adapter) => adapter !== null) ?? null;
      });

    const resolveRoutableSession = (input: {
      readonly threadId: ThreadId;
      readonly operation: string;
      readonly allowRecovery: boolean;
    }) =>
      Effect.gen(function* () {
        const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
        if (!binding) {
          const liveAdapter = yield* findLiveSessionAdapter(input.threadId);
          if (liveAdapter) {
            if (input.allowRecovery) {
              yield* ensureProviderEnabled(liveAdapter.provider, input.operation);
            }
            return {
              adapter: liveAdapter,
              isActive: true,
              lifecycleGeneration: lifecycle.currentGeneration(input.threadId),
            } as const;
          }
          return yield* new ProviderValidationError({
            operation: input.operation,
            issue: `Cannot route thread '${input.threadId}' because no persisted provider binding exists.`,
            reason: "runtime-unavailable",
          });
        }
        const adapter = yield* registry.getByProvider(binding.provider);
        if (input.allowRecovery) {
          yield* ensureProviderEnabled(binding.provider, input.operation);
        }

        const hasActiveSession = yield* adapter.hasSession(input.threadId);
        const requiresCredentialRotation =
          (asRecord(binding.runtimePayload) ?? {})[AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED] ===
          true;
        // A live adapter session whose persisted generation no longer matches the thread's current
        // generation is a zombie: its runtime events are rejected by the stale-generation gate, so a turn
        // routed into it can produce no visible output and the thread appears wedged.
        const bindingMatchesCurrentGeneration =
          binding.lifecycleGeneration === undefined ||
          binding.lifecycleGeneration === lifecycle.currentGeneration(input.threadId);
        if (
          hasActiveSession &&
          (!input.allowRecovery || (bindingMatchesCurrentGeneration && !requiresCredentialRotation))
        ) {
          return {
            adapter,
            isActive: true,
            lifecycleGeneration: binding.lifecycleGeneration,
          } as const;
        }

        if (!input.allowRecovery) {
          return {
            adapter,
            isActive: false,
            lifecycleGeneration: binding.lifecycleGeneration,
          } as const;
        }

        return {
          adapter: yield* recoverSessionForThread({ binding, operation: input.operation }),
          isActive: true,
          lifecycleGeneration: lifecycle.currentGeneration(input.threadId),
        } as const;
      });
    return { resolveRoutableSession, recoverSessionForThread };
  }),
);
