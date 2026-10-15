import { useId, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";
import type { VisualBlockOf } from "./visualBlockTypes";

// Ticks are the reader's scratch state for this view; they are neither saved nor sent.
export function ChecklistBlock({ block }: { readonly block: VisualBlockOf<"checklist"> }) {
  const id = useId();
  const [checked, setChecked] = useState(() => block.items.map((item) => item.checked === true));
  const done = checked.filter(Boolean).length;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 flex w-full items-baseline gap-2">
        {block.title ? <span className="font-medium">{block.title}</span> : null}
        <span className="text-chat-meta text-muted-foreground tabular-nums">
          {done}/{checked.length} done
        </span>
      </legend>
      {block.items.map((item, index) => (
        <div key={`${item.label}:${index}`} className="flex items-start gap-2.5">
          <Checkbox
            id={`${id}-${index}`}
            className="mt-[0.2lh]"
            checked={checked[index] ?? false}
            onCheckedChange={(next) =>
              setChecked((current) => current.map((value, at) => (at === index ? next : value)))
            }
            {...(item.detail ? { "aria-describedby": `${id}-${index}-detail` } : {})}
          />
          <div className="min-w-0">
            <label
              htmlFor={`${id}-${index}`}
              className={cn(
                "break-words",
                checked[index] &&
                  "text-muted-foreground line-through decoration-muted-foreground/60",
              )}
            >
              {item.label}
            </label>
            {item.detail ? (
              <p id={`${id}-${index}-detail`} className="text-chat-meta text-muted-foreground">
                {item.detail}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
