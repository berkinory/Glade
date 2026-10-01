import { forwardRef, type ComponentProps, type ReactNode } from "react";

import { CHAT_SURFACE_HEADER_HEIGHT_PX } from "@glade/shared/platform/desktopChrome";

import { CentralIcon } from "~/lib/central-icons";
import { type LucideIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";

export const CHAT_SURFACE_HEADER_HEIGHT_CLASS: `h-[${typeof CHAT_SURFACE_HEADER_HEIGHT_PX}px]` =
  "h-[46px]";

export const CHAT_SURFACE_HEADER_PADDING_X_CLASS = "px-3 sm:px-5";

// Implemented as the `.chat-surface-divider` component class (a 1px background gradient, see
// index.css) rather than a CSS border: it reads from the SAME `--app-surface-divider` token as the
// vertical sidebar↔chat seam, and — because it's a gradient — the seam corner retracts it 1px so
// the horizontal hairline butts against the vertical seam instead of crossing it (overlapping 1px
// lines double their alpha into a brighter dot). Apply alongside {@link
// CHAT_SURFACE_HEADER_HEIGHT_CLASS} so heights and dividers line up.
export const CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME = "chat-surface-divider";

export const CHAT_SURFACE_HEADER_ROW_CLASS_NAME = cn(
  "flex shrink-0 items-center",
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
);

export const CHAT_HEADER_ICON_STRENGTH_CLASS_NAME =
  "text-[var(--color-text-foreground)] [&_svg]:!opacity-100";

export const CHAT_HEADER_CONTROL_CLASS_NAME = "!h-7 shrink-0 rounded-lg";

const CHAT_SURFACE_CONTROL_IDLE_TEXT_CLASS_NAME = "text-[var(--color-text-foreground-secondary)]";

export const CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME =
  "bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground)]";

const CHAT_SURFACE_CONTROL_HOVER_CLASS_NAME =
  "hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]";

// Shared flat "chip" skin for the header diff toggle and the right-dock tabs so the two read as the
// exact same control: 28px tall, lg radius, no border, ui-sm muted text that brightens + fills on
// hover, with a smooth color transition. The active (pressed/selected) background is layered on per
// call site because the mechanism differs (Toggle `data-pressed` vs the dock tab's `active` flag),
// but both resolve to `--color-background-button-secondary`.
export const CHAT_SURFACE_CHIP_CLASS_NAME = cn(
  CHAT_HEADER_CONTROL_CLASS_NAME,
  "gap-1.5 border-0 px-1.5 text-ui-sm font-normal transition-colors",
  CHAT_SURFACE_CONTROL_IDLE_TEXT_CLASS_NAME,
  CHAT_SURFACE_CONTROL_HOVER_CLASS_NAME,
);

export const CHAT_SURFACE_CHIP_GLYPH_CLASS_NAME = "size-3.5 shrink-0";

export const CHAT_SURFACE_CHIP_ICON_CLASS_NAME = cn(
  CHAT_SURFACE_CHIP_GLYPH_CLASS_NAME,
  "opacity-70",
);

export function SurfaceChipIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return <Icon aria-hidden className={cn(CHAT_SURFACE_CHIP_ICON_CLASS_NAME, className)} />;
}

export const CHAT_HEADER_TOGGLE_CLASS_NAME = cn(
  CHAT_SURFACE_CHIP_CLASS_NAME,
  "data-pressed:text-[var(--color-text-foreground)]",
);

const DOCK_TAB_CHIP_CLASS_NAME = cn(
  CHAT_SURFACE_CHIP_CLASS_NAME,
  "inline-flex min-w-0 items-center pr-2.5",
);

const DOCK_TAB_ICON_SLOT_CLASS_NAME =
  "relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-[var(--color-text-foreground-secondary)] transition-colors group-hover/dock-tab:bg-[var(--color-background-button-secondary-hover)] group-focus-within/dock-tab:bg-[var(--color-background-button-secondary-hover)] hover:bg-[var(--color-background-button-secondary)] hover:text-[var(--color-text-foreground)]";

const DOCK_TAB_ICON_HOVER_HIDE_CLASS_NAME =
  "transition-opacity group-hover/dock-tab:opacity-0 group-focus-within/dock-tab:opacity-0";

const DOCK_TAB_CLOSE_GLYPH_CLASS_NAME =
  "absolute size-3.5 shrink-0 opacity-0 transition-opacity group-hover/dock-tab:opacity-100 group-focus-within/dock-tab:opacity-100";

// Keep the chip's hover group and close affordance together so callers cannot mismatch their group
// names.
export function SurfaceTabChip({
  icon,
  label,
  active,
  title,
  leading,
  trailing,
  className,
  labelClassName,
  closeLabel,
  onSelect,
  onClose,
}: {
  icon: ReactNode;
  label: ReactNode;
  active?: boolean | undefined;
  title?: string | undefined;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string | undefined;
  labelClassName?: string | undefined;
  closeLabel?: string | undefined;
  onSelect?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}) {
  return (
    <div
      className={cn(
        "group/dock-tab",
        DOCK_TAB_CHIP_CLASS_NAME,
        active && CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
        className,
      )}
    >
      {onClose ? (
        <button
          type="button"
          className={DOCK_TAB_ICON_SLOT_CLASS_NAME}
          aria-label={closeLabel}
          title={closeLabel}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <span
            className={cn("flex items-center justify-center", DOCK_TAB_ICON_HOVER_HIDE_CLASS_NAME)}
          >
            {icon}
          </span>
          <CentralIcon name="cross-small" className={DOCK_TAB_CLOSE_GLYPH_CLASS_NAME} />
        </button>
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      )}
      {onSelect ? (
        <button
          type="button"
          className={cn("flex min-w-0 items-center gap-1.5 text-left", labelClassName)}
          title={title}
          aria-pressed={active}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          {leading}
          <span className="truncate">{label}</span>
          {trailing}
        </button>
      ) : (
        <span
          className={cn("flex min-w-0 items-center gap-1.5 text-left", labelClassName)}
          title={title}
        >
          {leading}
          <span className="truncate">{label}</span>
          {trailing}
        </span>
      )}
    </div>
  );
}

export const CHAT_HEADER_ICON_CONTROL_CLASS_NAME =
  "!size-7 shrink-0 rounded-lg [&_svg,&_[data-slot=central-icon]]:mx-0";

export const CHAT_HEADER_SPLIT_LEADING_CLASS_NAME = "rounded-e-none border-e-0";

export const CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME = "rounded-s-none border-s-0";

export function ChatHeaderSplitGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex items-stretch", className)}>
      {children}
    </div>
  );
}

export function ChatHeaderSplitDivider() {
  return <div aria-hidden="true" className="w-px self-stretch bg-border" />;
}

type ChatHeaderControlTone = "plain" | "outline";

function chatHeaderControlVariant(
  tone: ChatHeaderControlTone,
): NonNullable<ComponentProps<typeof Button>["variant"]> {
  return tone === "outline" ? "chrome-outline" : "chrome";
}

type ChatHeaderButtonBaseProps = Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  tone?: ChatHeaderControlTone;
};

export const ChatHeaderButton = forwardRef<HTMLButtonElement, ChatHeaderButtonBaseProps>(
  function ChatHeaderButton({ tone: toneProp, className, ...props }, ref) {
    const tone = toneProp ?? "outline";
    return (
      <Button
        {...props}
        ref={ref}
        size="xs"
        variant={chatHeaderControlVariant(tone)}
        className={cn(
          CHAT_HEADER_CONTROL_CLASS_NAME,
          CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
          className,
        )}
      />
    );
  },
);

type ChatHeaderIconButtonBaseProps = Omit<
  ComponentProps<typeof Button>,
  "variant" | "size" | "aria-label"
> & {
  label: string;
  tone?: ChatHeaderControlTone;
  children?: ReactNode;
};

export const ChatHeaderIconButton = forwardRef<HTMLButtonElement, ChatHeaderIconButtonBaseProps>(
  function ChatHeaderIconButton({ label, tone: toneProp, className, children, ...props }, ref) {
    const tone = toneProp ?? "plain";
    return (
      <Button
        {...props}
        ref={ref}
        aria-label={label}
        size="icon-xs"
        variant={chatHeaderControlVariant(tone)}
        className={cn(
          CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
          CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
          className,
        )}
      >
        {children}
      </Button>
    );
  },
);
