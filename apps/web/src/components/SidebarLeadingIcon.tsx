import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "~/lib/utils";

const SLOT_SIZE = {
  sm: "size-4",
  md: "size-5",
} as const;

type SidebarLeadingIconSize = keyof typeof SLOT_SIZE;

export type SidebarLeadingIconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: SidebarLeadingIconSize;
  tone?: string;
};

export const SidebarLeadingIcon = forwardRef<HTMLSpanElement, SidebarLeadingIconProps>(
  function SidebarLeadingIcon(
    { size: sizeProp, tone: toneProp, className, children, ...props },
    ref,
  ) {
    const size = sizeProp ?? "md";
    const tone = toneProp ?? "text-muted-foreground/79";
    return (
      <span
        {...props}
        ref={ref}
        className={cn(
          "relative inline-flex shrink-0 translate-y-px items-center justify-center",
          SLOT_SIZE[size],
          tone,
          className,
        )}
      >
        {children}
      </span>
    );
  },
);
