import {
  cloneElement,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "~/lib/utils";
import { type SidebarGlyphVariant, sidebarGlyphClass } from "./sidebarGlyphs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const SLOT_SIZE = {
  sm: "size-[18px]",
  md: "size-5",

  header: "size-6 rounded-md",

  lg: "size-7",
} as const;

export type SidebarIconButtonSize = keyof typeof SLOT_SIZE;

export function sidebarIconButtonSlotClass(size: SidebarIconButtonSize): string {
  return SLOT_SIZE[size];
}

type TooltipSide = "top" | "right" | "bottom" | "left";

export type SidebarIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: ComponentType<{ className?: string }>;

  label: string;

  glyph?: SidebarGlyphVariant;
  iconClassName?: string;
  size?: SidebarIconButtonSize;

  tooltip?: ReactNode;
  tooltipSide?: TooltipSide;

  render?: ReactElement;
  "data-testid"?: string;
};

export function SidebarIconButton({
  icon: Icon,
  label,
  glyph: glyphProp,
  iconClassName,
  size: sizeProp,
  tooltip,
  tooltipSide: tooltipSideProp,
  render,
  className,
  ...buttonProps
}: SidebarIconButtonProps) {
  const glyph = glyphProp ?? "chrome";
  const size = sizeProp ?? "md";
  const tooltipSide = tooltipSideProp ?? "top";
  const triggerElement = (render ?? <button type="button" />) as ReactElement<{
    className?: string;
  }>;
  const mergedProps: Record<string, unknown> = {
    ...buttonProps,
    "aria-label": label,
    className: cn(
      "sidebar-icon-button inline-flex shrink-0 cursor-pointer",
      SLOT_SIZE[size],
      triggerElement.props.className,
      className,
    ),
  };
  const iconNode = <Icon className={iconClassName ?? sidebarGlyphClass(glyph)} />;
  const trigger = triggerElement as ReactElement<Record<string, unknown>>;

  if (!tooltip) {
    return cloneElement(trigger, mergedProps, iconNode);
  }

  return (
    <Tooltip>
      <TooltipTrigger render={cloneElement(trigger, mergedProps)}>{iconNode}</TooltipTrigger>
      <TooltipPopup side={tooltipSide}>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
