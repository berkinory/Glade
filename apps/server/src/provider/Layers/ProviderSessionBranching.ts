import { ProviderSessionBranching } from "../Services/ProviderSessionBranching";
import { Layer } from "effect";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderLifecycle } from "../Services/ProviderLifecycle";

import { Effect, Option } from "effect";
import { type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  decodeInputOrValidationError,
  validateAutoRuntimeMode,
  toValidationError,
} from "../core/providerServiceValidation";
import { ProviderForkThreadInput } from "@glade/contracts/provider/provider";
import {
  hasResumeCursor,
  readPersistedProviderOptions,
  readPersistedCwd,
} from "../core/providerRuntimeBinding";
import { ProviderRuntimeBindings } from "../Services/ProviderRuntimeBindings";

export const ProviderSessionBranchingLive = Layer.effect(
  ProviderSessionBranching,
  Effect.gen(function* () {
    const bindings = yield* ProviderRuntimeBindings;
    const directory = yield* ProviderSessionDirectory;
    const registry = yield* ProviderAdapterRegistry;
    const lifecycle = yield* ProviderLifecycle;
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
          // The fork target starts without a binding, so a resumable one is the target's own native
          // session: the fork itself, or what it became after later turns, interrupts or idle stops.
          // Turn delivery resumes it; forking the source again would drop the target's own turns.
          if (hasResumeCursor(existingTargetBinding.resumeCursor)) {
            return {
              threadId: input.threadId,
              resumeCursor: existingTargetBinding.resumeCursor,
            };
          }
          return yield* toValidationError(
            "ProviderService.forkThread",
            "The fork target has a native session that cannot be resumed.",
          );
        }

        const sourceBinding = Option.getOrUndefined(
          yield* directory.getBinding(input.sourceThreadId),
        );
        if (!sourceBinding) {
          return yield* toValidationError(
            "ProviderService.forkThread",
            "The source has no owned native session binding.",
          );
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

        if (input.forkPoint && input.forkPoint.provider !== sourceBinding.provider)
          return yield* toValidationError(
            "ProviderService.forkThread",
            "The fork point belongs to another provider.",
          );
        const adapter = yield* registry.getByProvider(sourceBinding.provider);
        if (!adapter.forkThread) {
          return yield* toValidationError(
            "ProviderService.forkThread",
            "This provider does not expose native forking.",
          );
        }

        if (
          input.modelSelection !== undefined &&
          input.modelSelection.provider !== adapter.provider
        ) {
          return yield* toValidationError(
            "ProviderService.forkThread",
            "Native forks must keep the source provider.",
          );
        }

        const forked = yield* adapter.forkThread({
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
        });
        if (!forked) {
          return yield* toValidationError(
            "ProviderService.forkThread",
            "The provider did not return a native fork.",
          );
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

    return { forkThread };
  }),
);
