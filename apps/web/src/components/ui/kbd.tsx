import type * as React from "react";

import { cn, isMacNavigatorPlatform } from "~/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded bg-muted px-1 font-medium font-sans text-muted-foreground text-ui leading-snug [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

function ShortcutKbd({
  shortcutLabel,
  className,
  ...props
}: Omit<React.ComponentProps<"kbd">, "children"> & { shortcutLabel: string }) {
  const match = /^(?:[⌃⌥⇧⌘]+|(?:(?:Ctrl|Alt|Shift|Meta|Cmd)\+)+|Ctrl )/.exec(shortcutLabel);
  const modifiers = match?.[0] ?? "";
  const key = shortcutLabel.slice(modifiers.length);
  const accessibleLabel = shortcutLabel
    .replaceAll("⌃", "Control ")
    .replaceAll("⌥", "Option ")
    .replaceAll("⇧", "Shift ")
    .replaceAll("⌘", "Command ")
    .replaceAll("↵", "Enter");
  return (
    <Kbd
      aria-label={accessibleLabel}
      title={shortcutLabel}
      {...props}
      className={cn("h-4 min-w-0 max-w-full gap-0.5 px-1 text-ui-2xs", className)}
    >
      {modifiers ? <span className="min-w-0 truncate">{modifiers}</span> : null}
      <span className="shrink-0">{key}</span>
    </Kbd>
  );
}

/** The "submit this dialog" chord, spelled for the host platform. */
function SubmitShortcutKbd({ className }: { className?: string }) {
  return (
    <ShortcutKbd shortcutLabel={isMacNavigatorPlatform() ? "⌘↵" : "Ctrl ↵"} className={className} />
  );
}

export { ShortcutKbd, SubmitShortcutKbd };
