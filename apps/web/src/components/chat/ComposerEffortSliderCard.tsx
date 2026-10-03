import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import type { ProviderOptions } from "../../providerModelOptions";
import { ComposerEffortSlider } from "./ComposerEffortSlider";
import { getComposerTraitSelection, planComposerEffortChange } from "./composerTraits";
import { useComposerTraitCommit } from "./useComposerTraitCommit";

type ComposerEffortSliderCardProps = {
  provider: ProviderKind;
  threadId: ThreadId;
  model: string | null | undefined;
  runtimeModel?: ProviderModelDescriptor | undefined;
  modelOptions: ProviderOptions | null | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
};

export function ComposerEffortSliderCard(props: ComposerEffortSliderCardProps) {
  const { provider, threadId, model, modelOptions, prompt } = props;
  const selection = getComposerTraitSelection(
    provider,
    model,
    prompt,
    modelOptions,
    props.runtimeModel,
  );
  const commitTrait = useComposerTraitCommit({ threadId, provider, model, modelOptions });
  const primaryId = selection.primarySelectDescriptor?.id;

  return (
    <div className="p-1">
      <ComposerEffortSlider
        levels={selection.effortLevels}
        value={selection.effort}
        canReset={
          primaryId !== undefined &&
          modelOptions?.[primaryId as keyof ProviderOptions] !== undefined
        }
        onReset={() => {
          if (primaryId) commitTrait({ [primaryId]: undefined });
        }}
        onValueChange={(value) => {
          const plan = planComposerEffortChange({ provider, selection, prompt, value });
          if (plan) commitTrait(plan.patch);
        }}
      />
    </div>
  );
}
