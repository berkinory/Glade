import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { IconComponent } from "./iconComponent";
import { cn } from "./utils";

export function createUiIcon(icon: IconSvgElement, defaultFilled = false): IconComponent {
  const filledIcon: IconSvgElement = icon.map(([tag, attributes]) => [
    tag,
    {
      ...attributes,
      ...(tag === "circle" ||
      tag === "rect" ||
      (tag === "path" && /z\s*$/i.test(String(attributes.d)))
        ? { fill: "currentColor" }
        : {}),
    },
  ]);
  return function UiIcon({
    size = 16,
    filled = defaultFilled,
    className,
    strokeWidth = 1.5,
    ...props
  }) {
    const label = props["aria-label"];
    return (
      <HugeiconsIcon
        icon={filled ? filledIcon : icon}
        size={size}
        strokeWidth={Number(strokeWidth)}
        role={label ? "img" : undefined}
        aria-hidden={label ? undefined : true}
        className={cn("size-4 shrink-0", className)}
        {...props}
      />
    );
  };
}
