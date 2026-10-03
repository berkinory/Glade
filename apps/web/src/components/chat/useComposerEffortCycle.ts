import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { useEffect, useRef } from "react";
import type { ProviderOptions } from "~/providerModelOptions";
import {
  getComposerTraitSelection,
  planComposerEffortChange,
  resolveComposerEffortLadderIndex,
} from "./composerTraits";
import { useComposerTraitCommit } from "./useComposerTraitCommit";

export function useComposerEffortCycle(input: {
  threadId: ThreadId;
  provider: ProviderKind;
  model: string;
  modelOptions: ProviderOptions | undefined;
  runtimeModel: ProviderModelDescriptor | undefined;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}) {
  const { threadId, provider, model, setPickerOpen } = input;
  const commit = useComposerTraitCommit(input);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPreview = () => {
    if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    previewTimer.current = null;
  };
  useEffect(() => {
    return () => {
      if (previewTimer.current !== null) {
        clearTimeout(previewTimer.current);
        setPickerOpen(false);
      }
      previewTimer.current = null;
    };
  }, [threadId, provider, model, setPickerOpen]);
  useEffect(() => {
    const takeOwnership = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-model-picker-popup]"))
        cancelPreview();
    };
    window.addEventListener("pointerdown", takeOwnership, true);
    return () => window.removeEventListener("pointerdown", takeOwnership, true);
  }, []);
  return {
    cancelEffortPreview: cancelPreview,
    cycleEffort: () => {
      const selection = getComposerTraitSelection(
        input.provider,
        input.model,
        "",
        input.modelOptions,
        input.runtimeModel,
      );
      if (selection.effortLevels.length < 2) return false;
      const next =
        selection.effortLevels[
          (resolveComposerEffortLadderIndex(selection) + 1) % selection.effortLevels.length
        ]!;
      const plan = planComposerEffortChange({
        provider: input.provider,
        selection,
        prompt: "",
        value: next.value,
      });
      if (!plan) return false;
      commit(plan.patch);
      if (!input.pickerOpen || previewTimer.current !== null) {
        cancelPreview();
        setPickerOpen(true);
        previewTimer.current = setTimeout(() => {
          previewTimer.current = null;
          setPickerOpen(false);
        }, 1200);
      }
      return true;
    },
  };
}
