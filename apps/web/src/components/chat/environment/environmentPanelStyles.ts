// FILE: environmentPanelStyles.ts
// Purpose: Shared Environment panel typography tokens. Section labels, the panel title,
//          reuse the composer placeholder color so secondary chrome reads
//          consistently across the chat shell.
// Layer: Environment panel design tokens

import { COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { cn } from "~/lib/utils";

/** Panel title and section labels. */
const ENVIRONMENT_PANEL_LABEL_CLASS_NAME = cn("font-normal", COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME);

/** Top-of-card title row. */
export const ENVIRONMENT_PANEL_TITLE_CLASS_NAME = cn(ENVIRONMENT_PANEL_LABEL_CLASS_NAME, "text-ui");

/**
 * Section-heading typography without row padding — used inline inside the collapsible
 * section header (which owns the padding alongside its chevron).
 */
export const ENVIRONMENT_PANEL_SECTION_LABEL_INLINE_CLASS_NAME = cn(
  ENVIRONMENT_PANEL_LABEL_CLASS_NAME,
  "text-ui-sm",
);

/**
 * Section headings inside the card (standalone label row). Shares the collapsible-section
 * header's `px-2 py-1` box so static labels (e.g. "Repository", "Editor") line up on the same
 * vertical rhythm as the expand/collapse section headers.
 */
export const ENVIRONMENT_PANEL_SECTION_LABEL_CLASS_NAME = cn(
  ENVIRONMENT_PANEL_SECTION_LABEL_INLINE_CLASS_NAME,
  "px-2 py-1",
);
