"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";

import { cn } from "~/lib/utils";

type TextareaProps = React.ComponentProps<"textarea"> & {
  size?: "xs" | "sm" | "default" | "lg" | number;
  unstyled?: boolean;
  trailingAction?: React.ReactNode;
};

function Textarea({
  className,
  size: sizeProp,
  unstyled: unstyledProp,
  trailingAction,
  ...props
}: TextareaProps) {
  const size = sizeProp ?? "default";
  const unstyled = unstyledProp ?? false;
  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-lg border border-input bg-background text-ui text-foreground has-aria-invalid:border-destructive/36 has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:border-foreground/30 has-disabled:opacity-64 sm:text-ui dark:bg-input/32",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        render={(defaultProps) => (
          <textarea
            className={cn(
              "font-system-ui field-sizing-content min-h-17.5 w-full resize-none rounded-[inherit] px-[calc(--spacing(3)-1px)] py-[calc(--spacing(1.5)-1px)] outline-none max-sm:min-h-20.5",
              trailingAction != null && "min-w-0 flex-1",
              size === "xs" &&
                "min-h-7 max-h-32 overflow-y-auto px-2 py-1 text-ui-sm max-sm:min-h-7",
              size === "sm" &&
                "min-h-16.5 px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1)-1px)] max-sm:min-h-19.5",
              size === "lg" && "min-h-18.5 py-[calc(--spacing(2)-1px)] max-sm:min-h-21.5",
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
      {trailingAction != null ? (
        <span className="shrink-0 self-start p-0.5">{trailingAction}</span>
      ) : null}
    </span>
  );
}

export { Textarea, type TextareaProps };
