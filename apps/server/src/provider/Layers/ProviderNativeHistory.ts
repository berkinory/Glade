import type { ProviderServiceShape } from "../Services/ProviderService.ts";
import { Effect, Exit, Layer, Option } from "effect";
import { ProviderNativeHistory } from "../Services/ProviderNativeHistory.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderLifecycle } from "../Services/ProviderLifecycle.ts";
import { ProviderRuntimeBindings } from "../Services/ProviderRuntimeBindings.ts";
import { ProviderIdleRuntime } from "../Services/ProviderIdleRuntime.ts";
import { ProviderInterruptions } from "../Services/ProviderInterruptions.ts";
import { ProviderValidationError } from "../core/Errors.ts";
import { readPersistedCwd, readPersistedProviderOptions } from "../core/providerRuntimeBinding.ts";

export const ProviderNativeHistoryLive = Layer.effect(
  ProviderNativeHistory,
  Effect.gen(function* () {
    const directory = yield* ProviderSessionDirectory;
    const registry = yield* ProviderAdapterRegistry;
    const lifecycle = yield* ProviderLifecycle;
    const bindings = yield* ProviderRuntimeBindings;
    const idle = yield* ProviderIdleRuntime;
    const interruptions = yield* ProviderInterruptions;
    const updateNativeHistory: ProviderServiceShape["updateNativeHistory"] = (input) =>
      lifecycle.run(input.threadId, (lease) =>
        Effect.gen(function* () {
          const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
          // Threads without a binding have never acquired provider history.
          if (!binding) return;
          if (
            binding.provider === "claudeAgent" &&
            (input.action.type === "archive" || input.action.type === "unarchive")
          )
            return;
          const adapter = yield* registry.getByProvider(binding.provider);
          const activeSession = (yield* adapter.listSessions()).find(
            (session) => session.threadId === input.threadId,
          );
          const resumeCursor = activeSession?.resumeCursor ?? binding.resumeCursor;
          const result = yield* Effect.exit(
            Effect.gen(function* () {
              if (input.action.type === "delete" || input.action.type === "archive") {
                yield* adapter.stopSession(input.threadId);
              }
              if (resumeCursor === undefined || resumeCursor === null) return;
              if (!adapter.updateNativeHistory)
                return yield* new ProviderValidationError({
                  operation: "ProviderService.updateNativeHistory",
                  issue: `${binding.provider} does not expose native history operations.`,
                });
              yield* adapter.updateNativeHistory({
                threadId: input.threadId,
                action: input.action,
                resumeCursor,
                cwd: readPersistedCwd(binding.runtimePayload),
                providerOptions: readPersistedProviderOptions(binding.runtimePayload),
              });
            }),
          );
          if (input.action.type === "delete") {
            // Retire ownership even when native deletion fails; failed history deletion is not retried.
            idle.clearRuntimeIdleTimer(input.threadId);
            idle.clearLiveRuntimeTasks(input.threadId);
            yield* bindings.withBindingWriteLock(input.threadId, directory.remove(input.threadId));
            interruptions.clear(input.threadId);
            lease.retire();
          }
          if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause);
        }),
      );
    return { updateNativeHistory };
  }),
);
