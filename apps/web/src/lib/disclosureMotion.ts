import { cn } from "~/lib/utils";
import { UI_MOTION_DEFAULT_CLASS, UI_MOTION_DEFAULT_MS } from "~/lib/uiMotion";

export const DISCLOSURE_TRANSITION_MS = UI_MOTION_DEFAULT_MS;
export const DISCLOSURE_CLEANUP_BUFFER_MS = 40;

const DISCLOSURE_SHELL_MOTION_CLASS = `grid transition-[grid-template-rows,opacity] ${UI_MOTION_DEFAULT_CLASS}`;

const DISCLOSURE_SHELL_OPEN_CLASS = "grid-rows-[1fr] opacity-100";
const DISCLOSURE_SHELL_CLOSED_CLASS = "grid-rows-[0fr] opacity-0";

export const DISCLOSURE_INNER_CLASS = "min-h-0 overflow-hidden";

export const DISCLOSURE_CONTENT_MOTION_CLASS = `transition-[opacity,transform] ${UI_MOTION_DEFAULT_CLASS}`;

const DISCLOSURE_CONTENT_OPEN_CLASS = "translate-y-0 opacity-100";
const DISCLOSURE_CONTENT_CLOSED_CLASS = "-translate-y-1 opacity-0 pointer-events-none";

const DISCLOSURE_CHEVRON_MOTION_CLASS = `size-3.5 shrink-0 text-muted-foreground transition-transform ${UI_MOTION_DEFAULT_CLASS}`;

export const DISCLOSURE_COLLAPSIBLE_PANEL_CLASS = `h-(--collapsible-panel-height) overflow-hidden transition-[height] ${UI_MOTION_DEFAULT_CLASS} data-ending-style:h-0 data-starting-style:h-0 data-open:data-ending-style:[height:var(--collapsible-panel-height)]`;

const DISCLOSURE_WIDTH_MOTION_CLASS = `overflow-hidden transition-[width] ${UI_MOTION_DEFAULT_CLASS}`;

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
