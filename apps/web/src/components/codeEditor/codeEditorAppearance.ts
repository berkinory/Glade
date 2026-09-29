import { buildDiffPanelUnsafeCSS } from "~/lib/diffRendering";

const EDITOR_UNSAFE_CSS = `
:host {
  /* Stable gutter through 9,999 lines without pushing short files far right. */
  --diffs-min-number-column-width: 4ch;
}

[data-column-number],
[data-gutter-buffer] {
  padding-left: 0.75ch !important;
}

/* Pierre paints selection behind the lines, so their fill must stay transparent. */
[data-line] {
  background-color: transparent !important;
}

[data-line][data-editor-active-line],
[data-column-number][data-editor-active-line] {
  --diffs-line-bg: color-mix(
    in srgb,
    var(--diffs-computed-diff-line-bg, var(--background)) 91%,
    var(--foreground)
  ) !important;
}

[data-column-number][data-editor-active-line] {
  background-color: var(--diffs-line-bg) !important;
}

[data-line][data-editor-active-line]::after {
  background-color: var(--diffs-line-bg) !important;
  box-shadow: none !important;
}

[data-selection-range] {
  background-color: color-mix(in srgb, var(--primary) 34%, var(--background)) !important;
}

[data-caret] {
  width: var(--glade-editor-caret-width, 2px) !important;
  height: var(--glade-editor-caret-height, 1.3em) !important;
  top: var(--glade-editor-caret-top, calc((1lh - 1.3em) / 2)) !important;
  margin-left: var(--glade-editor-caret-offset, 0);
  background-color: var(--glade-editor-caret-color, var(--foreground)) !important;
  mix-blend-mode: var(--glade-editor-caret-blend, normal);
  animation: glade-editor-caret-blink 1s step-end infinite !important;
}

@keyframes glade-editor-caret-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  [data-caret] { animation: none !important; }
}
`;

export function buildCodeEditorUnsafeCSS(theme: "light" | "dark"): string {
  return buildDiffPanelUnsafeCSS(theme) + EDITOR_UNSAFE_CSS;
}
