import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { UI_MOTION } from "@glade/shared/uiMotion";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import type { ComponentProps } from "react";

export function SortablePanelTab({
  id,
  disabled,
  style,
  className,
  ...props
}: ComponentProps<"div"> & { id: string; disabled: boolean }) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled,
    transition: reduceMotion ? null : { duration: UI_MOTION.defaultMs, easing: UI_MOTION.easing },
  });
  return (
    <div
      {...props}
      ref={setNodeRef}
      className={cn(
        className,
        isDragging &&
          "rounded-lg bg-[var(--app-content-surface)] opacity-70 [&_button]:cursor-grabbing",
      )}
      style={{
        ...style,
        transform: CSS.Translate.toString(transform),
        transition,
        position: isDragging ? "relative" : undefined,
        zIndex: isDragging ? 20 : undefined,
        touchAction: disabled ? undefined : "none",
      }}
      onPointerDown={(event) => {
        // Close buttons must never activate a drag.
        const button = (event.target as Element).closest("button");
        if (button && !button.hasAttribute("aria-pressed")) return;
        listeners?.onPointerDown?.(event);
      }}
    />
  );
}
