import { type ReactNode } from "react";
import { cn } from "~/lib/utils";

export type ComposerChoiceTone = "neutral" | "primary" | "destructive";

interface ComposerChoiceRowProps {
  shortcut: number | null;
  label: string;
  description?: string | null;

  selected?: boolean;
  tone?: ComposerChoiceTone;
  disabled?: boolean;

  trailing?: ReactNode;
  onSelect: () => void;
}

const ROW_TONE_CLASS_NAME: Record<ComposerChoiceTone, string> = {
  neutral: "hover:bg-[var(--color-background-button-secondary-hover)]",
  primary: "hover:bg-[var(--color-background-button-secondary-hover)]",
  destructive:
    "hover:bg-[color-mix(in_srgb,var(--destructive)_10%,var(--color-background-button-secondary-hover))]",
};

const CHIP_TONE_CLASS_NAME: Record<ComposerChoiceTone, string> = {
  neutral:
    "border border-[color:var(--color-border)] text-[var(--color-text-foreground-secondary)] group-hover:text-[var(--color-text-foreground)]",
  primary:
    "border border-[color:color-mix(in_srgb,var(--color-accent-blue)_50%,var(--color-border))] text-[var(--color-accent-blue)] group-hover:border-[color:color-mix(in_srgb,var(--color-accent-blue)_78%,var(--color-border))]",
  destructive:
    "border border-[color:color-mix(in_srgb,var(--destructive)_42%,var(--color-border))] text-destructive group-hover:border-[color:color-mix(in_srgb,var(--destructive)_68%,var(--color-border))]",
};

export function ComposerChoiceRow({
  shortcut,
  label,
  description,
  selected: selectedProp,
  tone: toneProp,
  disabled: disabledProp,
  trailing,
  onSelect,
}: ComposerChoiceRowProps) {
  const selected = selectedProp ?? false;
  const tone = toneProp ?? "neutral";
  const disabled = disabledProp ?? false;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selectedProp === undefined ? undefined : selected}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-left text-ui-lg leading-snug transition-colors duration-100",
        selected ? "bg-[var(--color-background-button-secondary)]" : ROW_TONE_CLASS_NAME[tone],
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {/* Baseline alignment puts the digit on the label's baseline; centering the chip on the line
          box reads as too high next to lowercase text. */}
      {shortcut !== null ? (
        <span
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-full text-ui-sm leading-none font-medium tabular-nums transition-colors duration-100",
            selected
              ? "bg-[var(--color-text-foreground)] text-[var(--color-background-surface)]"
              : CHIP_TONE_CLASS_NAME[tone],
          )}
        >
          {shortcut}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground/90">{label}</span>
        {description && description !== label ? (
          <span className="ml-1.5 text-ui text-muted-foreground/55">{description}</span>
        ) : null}
      </div>
      {trailing ? (
        <span className="flex h-[1lh] shrink-0 items-center self-start">{trailing}</span>
      ) : null}
    </button>
  );
}
