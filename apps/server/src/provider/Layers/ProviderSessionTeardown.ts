import { ProviderSessionTeardown } from "../Services/ProviderSessionTeardown";
import { ProviderSessionRouting } from "../Services/ProviderSessionRouting";
import { Layer } from "effect";
import { ProviderInterruptions } from "../Services/ProviderInterruptions";
import { ProviderLifecycle } from "../Services/ProviderLifecycle";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  StopRuntimeSessionInput,
  StopRuntimeSessionEffect,
  StopRuntimeSession,
} from "../core/providerRuntimeBinding";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { type ProviderServiceShape } from "../Services/ProviderService.ts";
import { Effect, Option } from "effect";
import {
  decodeInputOrValidationError,
  ClearSessionResumeCursorInput,
} from "../core/providerServiceValidation";
import { ProviderStopSessionInput } from "@glade/contracts/provider/provider";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED } from "../../agentGateway/sessionLease.ts";
import { ProviderIdleRuntime } from "../Services/ProviderIdleRuntime";
import { ProviderRuntimeBindings } from "../Services/ProviderRuntimeBindings";

export const ProviderSessionTeardownLive = Layer.effect(
  ProviderSessionTeardown,
  Effect.gen(function* () {
    const bindings = yield* ProviderRuntimeBindings;
    const idle = yield* ProviderIdleRuntime;
    const interruptions = yield* ProviderInterruptions;
    const lifecycle = yield* ProviderLifecycle;
    const { resolveRoutableSession } = yield* ProviderSessionRouting;
    const directory = yield* ProviderSessionDirectory;
    const registry = yield* ProviderAdapterRegistry;
    const stopSession: ProviderServiceShape["stopSession"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.stopSession",
          schema: ProviderStopSessionInput,
          payload: rawInput,
        });
        yield* idle.waitForRuntimeIdleStop(input.threadId);
        idle.clearRuntimeIdleTimer(input.threadId);
        return yield* lifecycle.run(input.threadId, (lease) =>
          Effect.gen(function* () {
            const routed = yield* resolveRoutableSession({
              threadId: input.threadId,
              operation: "ProviderService.stopSession",
              allowRecovery: false,
            }).pipe(
              Effect.catchTag("ProviderValidationError", (error) =>
                error.issue.includes("no persisted provider binding exists")
                  ? Effect.succeed(null)
                  : Effect.fail(error),
              ),
            );
            if (routed === null) {
              idle.clearLiveRuntimeTasks(input.threadId);
              lease.retire();
              idle.retireRuntimeIdleGeneration(input.threadId);
              return;
            }

            yield* routed.adapter.stopSession(input.threadId);
            idle.clearLiveRuntimeTasks(input.threadId);
            yield* idle.waitForRuntimeIdleStop(input.threadId);
            yield* bindings.withBindingWriteLock(input.threadId, directory.remove(input.threadId));
            interruptions.clear(input.threadId);
            lease.retire();
            idle.retireRuntimeIdleGeneration(input.threadId);
          }),
        );
      });

    const stopRuntimeSessionInternal = (
      rawInput: StopRuntimeSessionInput,
      expectedIdleGeneration?: symbol,
      options?: { readonly requireAgentGatewayCredentialRotation?: boolean },
    ): StopRuntimeSessionEffect =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.stopRuntimeSession",
          schema: ProviderStopSessionInput,
          payload: rawInput,
        });
        const isExpectedIdleStopCurrent = () =>
          expectedIdleGeneration === undefined ||
          idle.isRuntimeIdleGenerationCurrent(input.threadId, expectedIdleGeneration);
        if (expectedIdleGeneration === undefined) {
          yield* idle.waitForRuntimeIdleStop(input.threadId);
          idle.clearRuntimeIdleTimer(input.threadId);
        } else if (!isExpectedIdleStopCurrent()) {
          return;
        }
        return yield* lifecycle.run(input.threadId, (lease) =>
          Effect.gen(function* () {
            if (!isExpectedIdleStopCurrent()) {
              return;
            }
            const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
            if (!binding || !isExpectedIdleStopCurrent()) {
              return;
            }
            const adapter = yield* registry.getByProvider(binding.provider);
            const hasActiveSession = yield* adapter.hasSession(input.threadId);
            let resumeCursor = binding.resumeCursor;
            if (!isExpectedIdleStopCurrent()) {
              return;
            }
            if (hasActiveSession) {
              const activeSessions = yield* adapter.listSessions();
              const activeSession = activeSessions.find(
                (session) => session.threadId === input.threadId,
              );
              if (activeSession?.resumeCursor !== undefined) {
                resumeCursor = activeSession.resumeCursor;
              }
            }

            if (!isExpectedIdleStopCurrent()) {
              return;
            }
            yield* adapter.stopSession(input.threadId);
            if (!isExpectedIdleStopCurrent()) {
              return;
            }
            idle.clearLiveRuntimeTasks(input.threadId);
            yield* bindings.withBindingWriteLock(
              input.threadId,
              directory.upsert({
                threadId: input.threadId,
                provider: binding.provider,
                ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
                ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
                status: "stopped",
                lifecycleGeneration: lease.generation,
                resumeCursor,
                runtimePayload: {
                  ...asRecord(binding.runtimePayload),
                  activeTurnId: null,
                  lastRuntimeEvent:
                    options?.requireAgentGatewayCredentialRotation === true
                      ? "provider.interruptRuntimeFenced"
                      : "provider.stopRuntimeSession",
                  lastRuntimeEventAt: new Date().toISOString(),
                  lifecycleGeneration: lease.generation,
                  ...(options?.requireAgentGatewayCredentialRotation === true
                    ? { [AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED]: true }
                    : {}),
                },
              }),
            );
            lease.commit();
            idle.retireRuntimeIdleGeneration(input.threadId, expectedIdleGeneration);
          }),
        );
      });

    const stopRuntimeSession: StopRuntimeSession = (rawInput) =>
      stopRuntimeSessionInternal(rawInput);

    const hasLiveRuntimeTasks: NonNullable<ProviderServiceShape["hasLiveRuntimeTasks"]> = (input) =>
      Effect.sync(() => idle.hasLiveTasks(input.threadId));

    const clearSessionResumeCursor: NonNullable<
      ProviderServiceShape["clearSessionResumeCursor"]
    > = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.clearSessionResumeCursor",
          schema: ClearSessionResumeCursorInput,
          payload: rawInput,
        });
        yield* idle.waitForRuntimeIdleStop(input.threadId);

        // Share the runtime-event binding lock so a delayed session.exited update cannot restore the stale
        // cursor after this explicit clear.
        const cleared = yield* lifecycle.run(input.threadId, (lease) =>
          bindings.withBindingWriteLock(
            input.threadId,
            Effect.gen(function* () {
              const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
              if (!binding) {
                return undefined;
              }
              if (
                input.expectedGeneration !== undefined &&
                binding.lifecycleGeneration !== input.expectedGeneration
              )
                return;
              if (
                input.expectedTurnId !== undefined &&
                asRecord(binding.runtimePayload)?.lastNativeTurnId !== input.expectedTurnId
              )
                return;
              idle.clearRuntimeIdleTimer(input.threadId);
              const adapter = yield* registry.getByProvider(binding.provider);
              const hasActiveSession = yield* adapter.hasSession(input.threadId);
              const preserveActive = hasActiveSession && input.preserveActiveRuntime === true;
              if (hasActiveSession && !preserveActive) {
                yield* adapter.stopSession(input.threadId);
              }
              if (!preserveActive) {
                idle.clearLiveRuntimeTasks(input.threadId);
              }
              // A preserved runtime keeps stamping its events with the generation it was started under, so
              // clearing the cursor must not re-label the thread with a generation that runtime will never emit.
              const effectiveGeneration = preserveActive
                ? (binding.lifecycleGeneration ?? lease.generation)
                : lease.generation;
              yield* directory.upsert({
                threadId: input.threadId,
                provider: binding.provider,
                ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
                ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
                status: preserveActive ? (binding.status ?? "running") : "stopped",
                lifecycleGeneration: effectiveGeneration,
                resumeCursor: null,
                runtimePayload: {
                  ...asRecord(binding.runtimePayload),
                  ...(preserveActive ? {} : { activeTurnId: null }),
                  lifecycleGeneration: effectiveGeneration,
                },
              });
              lease.adopt(effectiveGeneration);
              return binding.provider;
            }),
          ),
        );
        if (cleared === undefined) return;
        yield* idle.waitForRuntimeIdleStop(input.threadId);
        idle.retireRuntimeIdleGeneration(input.threadId);
      });
    return {
      stopRuntimeSessionInternal,
      stopSession,
      stopRuntimeSession,
      hasLiveRuntimeTasks,
      clearSessionResumeCursor,
    };
  }),
);
