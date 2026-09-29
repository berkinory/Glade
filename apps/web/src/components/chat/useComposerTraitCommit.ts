import type { ProviderKind, ThreadId } from "@glade/contracts";
import { useCallback } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { buildNextProviderOptions, type ProviderOptions } from "../../providerModelOptions";

export function useComposerTraitCommit(input: {
  threadId: ThreadId;
  provider: ProviderKind;
  model: string | null | undefined;
  modelOptions: ProviderOptions | null | undefined;
}): (patch: Record<string, unknown>) => void {
  const { threadId, provider, model, modelOptions } = input;
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  return useCallback(
    (patch: Record<string, unknown>) => {
      setProviderModelOptions(
        threadId,
        provider,
        buildNextProviderOptions(provider, modelOptions, patch),
        { ...(model !== undefined ? { model } : {}), persistSticky: true },
      );
    },
    [threadId, provider, modelOptions, model, setProviderModelOptions],
  );
}
