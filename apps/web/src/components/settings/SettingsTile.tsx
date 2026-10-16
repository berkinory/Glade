import type { ReactNode } from "react";

// The neutral square that leads a settings row for things without brand artwork: skills,
// machines, devices and agents. A badge sits on its corner, such as a host's status dot.
export function SettingsTile(props: { readonly children: ReactNode; readonly badge?: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] text-muted-foreground [&>svg]:size-4"
    >
      {props.children}
      {props.badge ? (
        <span className="absolute -right-0.5 -bottom-0.5 inline-flex rounded-full bg-background p-0.5">
          {props.badge}
        </span>
      ) : null}
    </span>
  );
}
