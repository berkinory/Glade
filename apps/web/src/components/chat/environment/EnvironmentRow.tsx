import { ChevronDownIcon } from "~/lib/icons";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { cn } from "~/lib/utils";
import { ELEVATED_HOVER_SURFACE_CLASS_NAME } from "~/surfaceStyles";
import {
  ENVIRONMENT_PANEL_SECTION_LABEL_CLASS_NAME,
  ENVIRONMENT_PANEL_SECTION_LABEL_INLINE_CLASS_NAME,
  ENVIRONMENT_PANEL_TITLE_CLASS_NAME,
} from "./environmentPanelStyles";
export const ENVIRONMENT_ROW_CLASS_NAME = cn(
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left",
  "text-ui font-normal text-[var(--color-text-foreground)]",
  "outline-none",
  ELEVATED_HOVER_SURFACE_CLASS_NAME,
  "focus-visible:bg-[var(--color-background-elevated-secondary)]",
  "disabled:pointer-events-none disabled:opacity-50",
);
export const ENVIRONMENT_ROW_ICON_CLASS_NAME =
  "size-4 shrink-0 text-[var(--color-text-foreground)]";
export function EnvironmentRowChevron({ className }: { className?: string }) {
  return <ChevronDownIcon aria-hidden className={cn("size-3 shrink-0 opacity-60", className)} />;
}
export function EnvironmentPanelTitle({ children }: { children: ReactNode }) {
  return <p className={ENVIRONMENT_PANEL_TITLE_CLASS_NAME}>{children}</p>;
}

// Each optional section renders this as its own leading divider only when it actually renders, so
// toggling sections on/off never leaves a doubled or dangling rule.
export function EnvironmentSectionDivider() {
  return <div className="my-1 border-t border-[color:var(--color-border-light)]" />;
}
function EnvironmentSectionLabel({ children }: { children: ReactNode }) {
  return <p className={ENVIRONMENT_PANEL_SECTION_LABEL_CLASS_NAME}>{children}</p>;
}
export function EnvironmentLabeledSection({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <EnvironmentSectionDivider />
      <div className="flex flex-col gap-0.5">
        <EnvironmentSectionLabel>{label}</EnvironmentSectionLabel>
        {children}
      </div>
    </>
  );
}
export function EnvironmentCollapsibleSection({
  label,
  defaultOpen: defaultOpenProp,
  children,
}: {
  label: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const defaultOpen = defaultOpenProp ?? true;
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col">
      <CollapsibleTrigger
        className={cn(
          "group/section flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left",
          "outline-none",
          ELEVATED_HOVER_SURFACE_CLASS_NAME,
          "focus-visible:bg-[var(--color-background-elevated-secondary)]",
        )}
      >
        <span className={cn(ENVIRONMENT_PANEL_SECTION_LABEL_INLINE_CLASS_NAME, "min-w-0 truncate")}>
          {label}
        </span>
        <DisclosureChevron
          open={open}
          className="size-3 shrink-0 text-[var(--color-text-foreground-secondary)] opacity-60"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col pt-0.5">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
export function EnvironmentRowBody({
  icon,
  label,
  trailing,
  compact: compactProp,
}: {
  icon: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  compact?: boolean;
}) {
  const compact = compactProp ?? false;
  return (
    <>
      {compact ? (
        <span className="inline-flex shrink-0 items-center justify-center">{icon}</span>
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-1 tabular-nums">{trailing}</span>
      ) : null}
    </>
  );
}
type EnvironmentRowProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  icon: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
};
export function EnvironmentRow({
  icon,
  label,
  trailing,
  className,
  type,
  ...props
}: EnvironmentRowProps) {
  return (
    <button
      type={type ?? "button"}
      className={cn(ENVIRONMENT_ROW_CLASS_NAME, className)}
      {...props}
    >
      <EnvironmentRowBody icon={icon} label={label} trailing={trailing} />
    </button>
  );
}
