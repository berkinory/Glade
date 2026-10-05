import { AlertCircleIcon } from "~/lib/icons";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "~/lib/utils";
const DRAFT_ATTACHMENT_WARNING_LABEL = "Draft attachment may not persist";
export const DRAFT_ATTACHMENT_WARNING_DESCRIPTION =
  "Draft attachment is kept in memory and may be lost on navigation.";
type DraftAttachmentWarningVariant = "inline" | "badge";
type DraftAttachmentWarningIconProps = ComponentPropsWithoutRef<"span"> & {
  variant?: DraftAttachmentWarningVariant;
};
export const DraftAttachmentWarningIcon = forwardRef<
  HTMLSpanElement,
  DraftAttachmentWarningIconProps
>(function DraftAttachmentWarningIcon({ variant: variantProp, className, ...rest }, ref) {
  const variant = variantProp ?? "inline";
  return (
    <span
      ref={ref}
      {...rest}
      role="img"
      aria-label={DRAFT_ATTACHMENT_WARNING_LABEL}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-amber-600",
        variant === "badge" ? "size-5 bg-[var(--composer-surface)] shadow-sm" : "size-4",
        className,
      )}
    >
      <AlertCircleIcon className="size-3" />
    </span>
  );
});
