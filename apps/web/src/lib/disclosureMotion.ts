// FILE: disclosureMotion.ts
// Purpose: Shared open/close motion tokens for collapsible UI (sidebar lists, transcript panels, etc.).
// Layer: Web UI motion primitive
// Exports: class-name helpers + Collapsible panel tokens
// Why: Sidebar project/thread expand and chat disclosures reused the same grid/opacity
//      timing in multiple places; centralize it so new expand/collapse surfaces stay consistent.

import { cn } from "~/lib/utils";
import { UI_MOTION_QUICK_CLASS, UI_MOTION_REVEAL_CLASS, UI_MOTION_REVEAL_MS } from "~/lib/uiMotion";

export const DISCLOSURE_TRANSITION_MS = UI_MOTION_REVEAL_MS;
export const DISCLOSURE_CLEANUP_BUFFER_MS = 40;

/** Shell grid that animates height via grid-template-rows + fade. */
const DISCLOSURE_SHELL_MOTION_CLASS = `grid transition-[grid-template-rows,opacity] ${UI_MOTION_REVEAL_CLASS}`;

const DISCLOSURE_SHELL_OPEN_CLASS = "grid-rows-[1fr] opacity-100";
const DISCLOSURE_SHELL_CLOSED_CLASS = "grid-rows-[0fr] opacity-0";

/** Required inner wrapper so grid-row collapse measures correctly. */
export const DISCLOSURE_INNER_CLASS = "min-h-0 overflow-hidden";

/** Optional content drift/fade layered on top of the shell animation. */
export const DISCLOSURE_CONTENT_MOTION_CLASS = `transition-[opacity,transform] ${UI_MOTION_REVEAL_CLASS}`;

const DISCLOSURE_CONTENT_OPEN_CLASS = "translate-y-0 opacity-100";
const DISCLOSURE_CONTENT_CLOSED_CLASS = "-translate-y-1 opacity-0 pointer-events-none";

/** Chevron rotation paired with the shell motion. */
const DISCLOSURE_CHEVRON_MOTION_CLASS = `size-3.5 shrink-0 text-muted-foreground transition-transform ${UI_MOTION_REVEAL_CLASS}`;

/** Base-ui Collapsible panel height animation using the same timing curve. */
export const DISCLOSURE_COLLAPSIBLE_PANEL_CLASS = `h-(--collapsible-panel-height) overflow-hidden transition-[height] ${UI_MOTION_REVEAL_CLASS} data-ending-style:h-0 data-starting-style:h-0 data-open:data-ending-style:[height:var(--collapsible-panel-height)]`;

/**
 * Inline-axis (width) reveal for side panels that open/close along the
 * horizontal axis. Same timing curve as the vertical disclosures so every
 * toggle in the app stays consistent. Pair `open ? openWidthClassName : "w-0"`.
 */
const DISCLOSURE_WIDTH_MOTION_CLASS = `overflow-hidden transition-[width] ${UI_MOTION_REVEAL_CLASS}`;

export function disclosureWidthClassName(
  open: boolean,
  openWidthClassName: string,
  className?: string,
) {
  return cn(DISCLOSURE_WIDTH_MOTION_CLASS, open ? openWidthClassName : "w-0", className);
}

export function disclosureShellClassName(open: boolean, className?: string) {
  return cn(
    DISCLOSURE_SHELL_MOTION_CLASS,
    open ? DISCLOSURE_SHELL_OPEN_CLASS : DISCLOSURE_SHELL_CLOSED_CLASS,
    className,
  );
}

export function disclosureContentClassName(open: boolean, className?: string) {
  return cn(
    DISCLOSURE_CONTENT_MOTION_CLASS,
    open ? DISCLOSURE_CONTENT_OPEN_CLASS : DISCLOSURE_CONTENT_CLOSED_CLASS,
    className,
  );
}

export function disclosureChevronClassName(open: boolean, className?: string) {
  return cn(DISCLOSURE_CHEVRON_MOTION_CLASS, open && "rotate-90", className);
}

/** Base transition covering opacity+transform with the open duration. */
const DISCLOSURE_POP_MOTION_CLASS = `origin-top-right transition-[opacity,transform] ${UI_MOTION_REVEAL_CLASS}`;

const DISCLOSURE_POP_OPEN_CLASS = "translate-y-0 scale-100 opacity-100";
const DISCLOSURE_POP_CLOSED_CLASS = `translate-y-1 scale-[0.985] opacity-0 pointer-events-none ${UI_MOTION_QUICK_CLASS}`;

export function disclosurePopClassName(open: boolean, className?: string) {
  return cn(
    DISCLOSURE_POP_MOTION_CLASS,
    open ? DISCLOSURE_POP_OPEN_CLASS : DISCLOSURE_POP_CLOSED_CLASS,
    className,
  );
}
