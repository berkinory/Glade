import { useId } from "react";
import { Switch } from "~/components/ui/switch";
import type { VisualInputScope } from "@glade/shared/visualComponentScope";
import type { VisualBlockOf } from "./visualBlockTypes";
import { formatVisualNumber } from "./visualNumber";

// Values are the reader's scratch state for this view; they are neither saved nor sent.
export function InputsBlock({
  block,
  scope,
  onChange,
}: {
  readonly block: VisualBlockOf<"inputs">;
  readonly scope: VisualInputScope;
  readonly onChange: (id: string, value: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-x-6 gap-y-3">
      {block.items.map((input) => {
        const value = scope[input.id] ?? 0;
        const inputId = `${id}-${input.id}`;
        if (input.kind === "toggle")
          return (
            <div key={input.id} className="flex items-center gap-2.5">
              <Switch
                id={inputId}
                checked={value !== 0}
                onCheckedChange={(checked) => onChange(input.id, Number(checked))}
              />
              <label htmlFor={inputId} className="min-w-0 break-words">
                {input.label}
              </label>
            </div>
          );
        return (
          <div key={input.id} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={inputId} className="min-w-0 truncate">
                {input.label}
              </label>
              <output htmlFor={inputId} className="shrink-0 text-chat-meta tabular-nums">
                {formatVisualNumber(value)}
                {input.unit ? ` ${input.unit}` : ""}
              </output>
            </div>
            <input
              id={inputId}
              type="range"
              min={input.min}
              max={input.max}
              step={input.step ?? "any"}
              value={value}
              onChange={(event) => onChange(input.id, event.currentTarget.valueAsNumber)}
              className="w-full accent-[var(--color-text-accent)]"
            />
          </div>
        );
      })}
    </div>
  );
}
