import type { ComponentType } from "react";

import { cn } from "~/lib/utils";
import {
  SIDEBAR_HEADER_ROW_CLASS_NAME,
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
} from "~/sidebarRowStyles";
import type { SidebarActionBadge } from "./Sidebar.logic.statusTypes";
import { SidebarGlyph } from "./sidebarGlyphs";
import { SidebarLeadingIcon } from "./SidebarLeadingIcon";
import { ShortcutKbd } from "./ui/kbd";
import { SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";

export function SidebarPrimaryAction({
  icon: Icon,
  iconClassName,
  label,
  onClick,
  onMouseEnter,
  onFocus,
  active: activeProp,
  disabled: disabledProp,
  shortcutLabel,
  badge,
}: {
  icon: ComponentType<{ className?: string }>;

  iconClassName?: string;
  label: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  active?: boolean;
  disabled?: boolean;
  shortcutLabel?: string | null;
  badge?: SidebarActionBadge | null;
}) {
  const active = activeProp ?? false;
  const disabled = disabledProp ?? false;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        data-active={active}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/sidebar-primary-action",
          SIDEBAR_HEADER_ROW_CLASS_NAME,
          active
            ? SIDEBAR_ROW_ACTIVE_CLASS_NAME
            : cn(SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME, SIDEBAR_ROW_HOVER_CLASS_NAME),
        )}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onFocus={onFocus}
      >
        <SidebarLeadingIcon size="sm" tone="text-inherit">
          <SidebarGlyph
            icon={Icon}
            variant="leading"
            {...(iconClassName ? { className: iconClassName } : {})}
          />
        </SidebarLeadingIcon>
        <span className="truncate">{label}</span>
        {badge ? (
          <span
            className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-muted px-1 text-ui-xs font-medium text-muted-foreground"
            aria-label={badge.accessibleLabel}
            title={badge.accessibleLabel}
          >
            {badge.text}
          </span>
        ) : shortcutLabel ? (
          <span className="ml-auto opacity-0 transition-opacity group-hover/sidebar-primary-action:opacity-100 group-focus-visible/sidebar-primary-action:opacity-100">
            <ShortcutKbd shortcutLabel={shortcutLabel} />
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
