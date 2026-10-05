import { UndoIcon, Brain03Icon } from "~/lib/icons";
import { Slider } from "../ui/slider";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
type EffortLevel = {
  value: string;
  label: string;
  description?: string;
  isDefault?: boolean;
};
export function ComposerEffortSlider(props: {
  levels: ReadonlyArray<EffortLevel>;
  value: string | null;
  onValueChange: (value: string) => void;
  onReset?: () => void;
  canReset?: boolean;
}) {
  const index = Math.max(
    0,
    props.levels.findIndex((level) => level.value === props.value),
  );
  const level = props.levels[index];
  if (!level) return null;
  return (
    <div className="space-y-2 rounded-lg bg-muted/20 px-2.5 py-2.5" data-slot="effort-slider-card">
      <div className="flex items-center gap-2">
        <Brain03Icon className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-ui font-medium">Thinking</span>
        <span className="text-ui-sm font-medium text-[var(--color-text-accent)]">
          {level.label}
        </span>
        {props.onReset ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Reset thinking to default"
                  disabled={!props.canReset}
                  className="flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                  onClick={props.onReset}
                />
              }
            >
              <UndoIcon aria-hidden="true" className="size-3" />
            </TooltipTrigger>
            <TooltipPopup variant="picker">Reset to default</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <Slider
        value={index}
        min={0}
        max={props.levels.length - 1}
        step={1}
        size="large"
        showStepMarks
        magnetic
        disabled={props.levels.length === 1}
        aria-label="Thinking effort"
        getAriaValueText={(nextIndex) => props.levels[nextIndex]?.label ?? String(nextIndex)}
        onValueChange={(nextIndex) => {
          const next = props.levels[nextIndex];
          if (next && nextIndex !== index) props.onValueChange(next.value);
        }}
      />
    </div>
  );
}
