import { SearchIcon } from "~/lib/icons";
import { forwardRef } from "react";
import { cn } from "~/lib/utils";
import { Input, type InputProps } from "./input";
export const SearchInput = forwardRef<HTMLInputElement, InputProps>(function SearchInput(
  { className, type: typeProp, size: sizeProp, variant: variantProp, ...props },
  ref,
) {
  const type = typeProp ?? "text";
  const size = sizeProp ?? "sm";
  const variant = variantProp ?? "soft";
  return (
    <div className="relative w-full">
      <Input
        ref={ref}
        type={type}
        size={size}
        variant={variant}
        className={cn(
          "[&>[data-slot=input]]:pl-[calc(var(--app-font-size-ui,14px)+1.125rem)]",
          className,
        )}
        {...props}
      />
      <SearchIcon
        className="pointer-events-none absolute left-2.5 top-1/2 size-[var(--app-font-size-ui,14px)] -translate-y-1/2 text-muted-foreground/70"
        aria-hidden="true"
      />
    </div>
  );
});
