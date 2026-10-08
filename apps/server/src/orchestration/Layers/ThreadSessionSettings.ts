import { Effect, Layer } from "effect";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";

export const ThreadSessionSettingsLive = Layer.effect(
  ThreadSessionSettings,
  Effect.acquireRelease(
    Effect.sync(() => {
      const modelSelections = new Map<string, ModelSelection>();
      const providerOptions = new Map<string, ProviderStartOptions>();
      const editResendStartKeys = new Set<string>();
      const computerToolsListed = new Set<string>();
      const clearEditResendStartsForThread = (threadId: string) => {
        const prefix = `${threadId}:`;
        for (const key of editResendStartKeys) {
          if (key.startsWith(prefix)) editResendStartKeys.delete(key);
        }
      };
      const settings = {
        getModelSelection: (threadId: string) => modelSelections.get(threadId),
        hasModelSelection: (threadId: string) => modelSelections.has(threadId),
        setModelSelection: (threadId: string, selection: ModelSelection) => {
          modelSelections.set(threadId, selection);
        },
        getProviderOptions: (threadId: string) => providerOptions.get(threadId),
        setProviderOptions: (threadId: string, options: ProviderStartOptions) => {
          providerOptions.set(threadId, options);
        },
        markEditResendStart: (threadId: string, messageId: string) => {
          editResendStartKeys.add(`${threadId}:${messageId}`);
        },
        clearEditResendStart: (threadId: string, messageId: string) => {
          editResendStartKeys.delete(`${threadId}:${messageId}`);
        },
        clearEditResendStartsForThread,
        computerToolsListed: (threadId: string) => computerToolsListed.has(threadId),
        setComputerToolsListed: (threadId: string, listed: boolean) => {
          if (listed) computerToolsListed.add(threadId);
          else computerToolsListed.delete(threadId);
        },
        clearThread: (threadId: string) => {
          modelSelections.delete(threadId);
          providerOptions.delete(threadId);
          computerToolsListed.delete(threadId);
          clearEditResendStartsForThread(threadId);
        },
      };
      return {
        settings,
        dispose: () => {
          modelSelections.clear();
          providerOptions.clear();
          editResendStartKeys.clear();
          computerToolsListed.clear();
        },
      };
    }),
    (state) => Effect.sync(state.dispose),
  ).pipe(Effect.map((state) => state.settings)),
);
