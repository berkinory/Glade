import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import { useCallback } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import type { ProviderOptionSelections } from "@glade/contracts/provider/model";
import { buildNextProviderOptions, type ProviderOptionPatch } from "../../providerModelOptions";

export function useComposerTraitCommit(input: {
  threadId: ThreadId;
  provider: ProviderKind;
  model: string | null | undefined;
  modelOptions: ProviderOptionSelections | null | undefined;
}): (patch: ProviderOptionPatch) => void {
  const { threadId, provider, model, modelOptions } = input;
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  return useCallback(
    (patch: ProviderOptionPatch) => {
      setProviderModelOptions(threadId, provider, buildNextProviderOptions(modelOptions, patch), {
        ...(model !== undefined ? { model } : {}),
        persistSticky: true,
      });
    },
    [threadId, provider, modelOptions, model, setProviderModelOptions],
  );
}
