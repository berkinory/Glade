import { useState } from "react";
import { ComposerChoiceRow } from "~/components/chat/ComposerChoiceRow";
import type { VisualBlockOf, VisualFollowUp } from "./visualBlockTypes";

export function ChoicesBlock({
  block,
  followUp,
}: {
  readonly block: VisualBlockOf<"choices">;
  readonly followUp: VisualFollowUp;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const choose = (index: number) => {
    if (!followUp.enabled || chosen !== null) return;
    setChosen(index);
    const option = block.options[index]!;
    void followUp.onChoose(option.message ?? option.label).then(
      (sent) => {
        if (!sent) setChosen(null);
      },
      () => setChosen(null),
    );
  };
  return (
    <div role="group" aria-label={block.prompt ?? "Follow-up choices"} className="flex flex-col">
      {block.prompt ? <p className="mb-1 text-muted-foreground">{block.prompt}</p> : null}
      <div className="-mx-2 flex flex-col">
        {block.options.map((option, index) => (
          <ComposerChoiceRow
            key={`${option.label}:${index}`}
            shortcut={index + 1}
            label={option.label}
            description={option.message && option.message !== option.label ? option.message : null}
            {...(chosen === null ? {} : { selected: chosen === index })}
            disabled={!followUp.enabled || chosen !== null}
            onSelect={() => choose(index)}
          />
        ))}
      </div>
    </div>
  );
}
