import { ProviderValidationError } from "../core/Errors";
import { ProviderSessionRouting } from "../Services/ProviderSessionRouting";
import { ProviderSessionReads } from "../Services/ProviderSessionReads";
import { Layer } from "effect";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { type ProviderServiceShape } from "../Services/ProviderService.ts";
import { Effect, Option } from "effect";
import {
  type ProviderSession,
  ProviderCompactThreadInput,
} from "@glade/contracts/provider/provider";
import {
  decodeInputOrValidationError,
  ProviderRollbackConversationInput,
  toValidationError,
} from "../core/providerServiceValidation";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { ProviderIdleRuntime } from "../Services/ProviderIdleRuntime";

export const ProviderSessionReadsLive = Layer.effect(
  ProviderSessionReads,
  Effect.gen(function* () {
    const idle = yield* ProviderIdleRuntime;
    const registry = yield* ProviderAdapterRegistry;
    const adapters = yield* Effect.forEach(yield* registry.listProviders(), (provider) =>
      registry.getByProvider(provider),
    );
    const directory = yield* ProviderSessionDirectory;
    const { resolveRoutableSession } = yield* ProviderSessionRouting;
    const listSessions: ProviderServiceShape["listSessions"] = () =>
      Effect.gen(function* () {
        const activeSessions = (yield* Effect.forEach(adapters, (adapter) =>
          adapter.listSessions(),
        )).flatMap((sessions) => sessions);

        const persistedBindings = yield* directory
          .listBindings()
          .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<ProviderRuntimeBinding>));
        const bindingsByThreadId = new Map(
          persistedBindings.map((binding) => [binding.threadId, binding] as const),
        );

        return activeSessions.map((session) => {
          const binding = bindingsByThreadId.get(session.threadId);
          if (!binding) {
            return session;
          }

          const overrides: {
            resumeCursor?: ProviderSession["resumeCursor"];
            runtimeMode?: ProviderSession["runtimeMode"];
          } = {};
          if (session.resumeCursor === undefined && binding.resumeCursor !== undefined) {
            overrides.resumeCursor = binding.resumeCursor;
          }
          if (binding.runtimeMode !== undefined) {
            overrides.runtimeMode = binding.runtimeMode;
          }
          return Object.assign({}, session, overrides);
        });
      });

    const getCapabilities: ProviderServiceShape["getCapabilities"] = (provider) =>
      registry.getByProvider(provider).pipe(Effect.map((adapter) => adapter.capabilities));

    const rollbackConversation: ProviderServiceShape["rollbackConversation"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.rollbackConversation",
          schema: ProviderRollbackConversationInput,
          payload: rawInput,
        });
        if (input.numTurns === 0) {
          return;
        }
        yield* idle.runIdleSensitiveProviderWork(
          input.threadId,
          Effect.gen(function* () {
            const active = yield* resolveRoutableSession({
              threadId: input.threadId,
              operation: "ProviderService.rollbackConversation",
              allowRecovery: true,
            });
            yield* active.adapter.rollbackThread(input.threadId, input.numTurns);

            const session = (yield* active.adapter.listSessions()).find(
              (entry) => entry.threadId === input.threadId,
            );
            const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
            if (binding?.lifecycleGeneration !== active.lifecycleGeneration)
              return yield* new ProviderValidationError({
                operation: "ProviderService.rollbackConversation",
                issue: "The provider session changed during rewind.",
              });
            if (session && binding) {
              yield* directory.upsert({
                ...binding,
                resumeCursor: session.resumeCursor,
                status: "stopped",
                runtimePayload: {
                  ...asRecord(binding.runtimePayload),
                  activeTurnId: null,
                  lastRuntimeEvent: "provider.rollbackConversation",
                  lastRuntimeEventAt: new Date().toISOString(),
                },
              });
            }
          }),
          { scheduleIdleStopOnSuccess: true },
        );
      });

    const compactThread: ProviderServiceShape["compactThread"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.compactThread",
          schema: ProviderCompactThreadInput,
          payload: rawInput,
        });
        yield* idle.runIdleSensitiveProviderWork(
          input.threadId,
          Effect.gen(function* () {
            const routed = yield* resolveRoutableSession({
              threadId: input.threadId,
              operation: "ProviderService.compactThread",
              allowRecovery: true,
            });
            if (!routed.adapter.compactThread) {
              return yield* toValidationError(
                "ProviderService.compactThread",
                `Context compaction is unavailable for provider '${routed.adapter.provider}'.`,
              );
            }
            const session = (yield* routed.adapter.listSessions()).find(
              (entry) => entry.threadId === input.threadId,
            );
            if (session?.activeTurnId || session?.status === "running") {
              return yield* toValidationError(
                "ProviderService.compactThread",
                "Wait for active provider work to finish before compacting.",
              );
            }
            yield* routed.adapter.compactThread(input.threadId, input.instructions);
          }),
          { scheduleIdleStopOnSuccess: false },
        );
      });
    return {
      listSessions,
      getCapabilities,
      rollbackConversation,
      compactThread,
    };
  }),
);
