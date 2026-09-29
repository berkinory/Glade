import type { ReactNode } from "react";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

export function GitDialogShell({
  open,
  onOpenChange,
  onSubmitShortcut,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitShortcut: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-w-md"
        showCloseButton={false}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmitShortcut();
          }
        }}
      >
        {children}
      </DialogPopup>
    </Dialog>
  );
}

export function GitDialogHeading({
  eyebrow,
  eyebrowTrailing,
  subject,
  subjectMuted,
}: {
  eyebrow: ReactNode;
  eyebrowTrailing?: ReactNode;
  subject: string;

  subjectMuted?: boolean;
}) {
  return (
    <DialogHeader className="gap-0.5">
      <DialogTitle className="flex items-center justify-between gap-2 font-normal font-sans text-muted-foreground text-ui leading-snug">
        <span className="truncate">{eyebrow}</span>
        {eyebrowTrailing}
      </DialogTitle>
      <DialogDescription
        className={cn(
          "truncate font-medium text-ui-lg leading-snug",
          subjectMuted ? "text-muted-foreground italic" : "text-[var(--color-text-foreground)]",
        )}
      >
        {subject}
      </DialogDescription>
    </DialogHeader>
  );
}

export function GitDialogBody({ children }: { children: ReactNode }) {
  return <DialogPanel className="space-y-1 pt-2">{children}</DialogPanel>;
}

export const GIT_DIALOG_FIELD_CLASS =
  "w-full bg-transparent py-1 font-system-ui text-ui leading-snug outline-none placeholder:text-muted-foreground/70";

export function GitDialogActionList({ children }: { children: ReactNode }) {
  return <div className="border-[color:var(--color-border)] border-t p-2">{children}</div>;
}

export function GitDialogActionRow({
  highlighted,
  disabled,
  disabledReason,
  onClick,
  icon,
  label,
  trailing,
}: {
  highlighted?: boolean;
  disabled?: boolean;

  disabledReason?: string | null;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
}) {
  const row = (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-ui leading-snug outline-none transition-colors",
        "hover:bg-[var(--color-background-button-secondary-hover)] focus-visible:bg-[var(--color-background-button-secondary-hover)]",
        highlighted && "bg-[var(--color-background-button-secondary-hover)]",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );

  if (!disabled || !disabledReason) {
    return row;
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        nativeButton={false}
        render={<span className="block cursor-not-allowed" />}
      >
        {row}
      </PopoverTrigger>
      <PopoverPopup tooltipStyle side="top" align="center">
        {disabledReason}
      </PopoverPopup>
    </Popover>
  );
}
