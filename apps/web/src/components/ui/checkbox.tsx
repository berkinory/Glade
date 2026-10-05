"use client";

import { MinusIcon, CheckIcon } from "~/lib/icons";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "~/lib/utils";
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-[.25rem] border border-[color:var(--color-border-light)] bg-background outline-none ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/48 data-disabled:opacity-64 sm:size-4 dark:not-data-checked:bg-input/32 dark:aria-invalid:ring-destructive/24",
        className,
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="-inset-px absolute flex items-center justify-center rounded-[.25rem] text-primary-foreground data-unchecked:hidden data-checked:bg-primary data-indeterminate:text-foreground"
        data-slot="checkbox-indicator"
        render={(props, state) => (
          <span {...props}>
            {state.indeterminate ? (
              <MinusIcon className="size-3.5 sm:size-3" strokeWidth="3" />
            ) : (
              <CheckIcon className="size-3.5 sm:size-3" strokeWidth="3" />
            )}
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  );
}
export { Checkbox };
