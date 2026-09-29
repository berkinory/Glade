import { ELEVATED_HOVER_SURFACE_CLASS_NAME } from "~/surfaceStyles";
import { COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME } from "./composerPickerStyles";

export const PICKER_PANEL_PLAIN_SEARCH_HEADER_CLASS_NAME =
  "sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b border-border bg-transparent px-2.5 py-0 *:min-w-0";

export const PICKER_PANEL_PLAIN_SEARCH_ICON_CLASS_NAME =
  "size-3.5 shrink-0 text-muted-foreground/55";

// Pair with the `unstyled` Input prop so no border/ring/fill is emitted; the child selector strips
// the field's own horizontal padding because the magnifier already owns the left gutter.
export const PICKER_PANEL_PLAIN_SEARCH_INPUT_CLASS_NAME =
  "flex min-h-8 w-full items-center bg-transparent shadow-none [&>[data-slot=input]]:px-0 [&>[data-slot=input]]:placeholder:text-muted-foreground/55";

export const PICKER_PANEL_ROW_GEOMETRY_CLASS_NAME =
  "min-h-[1.625rem] gap-2 rounded-md px-1.5 py-px sm:min-h-[1.625rem]";

export const PICKER_PANEL_ROW_ICON_CLASS_NAME = "size-3.5 shrink-0 text-muted-foreground/70";

export const PICKER_PANEL_ROW_SELECTED_CLASS_NAME =
  "bg-[var(--color-background-elevated-secondary)] text-[var(--color-text-foreground)]";

export const PICKER_PANEL_GROUP_LABEL_CLASS_NAME =
  "px-1.5 py-1 font-normal text-muted-foreground/60 text-ui-xs";

export const PICKER_PANEL_ACTION_ROW_CLASS_NAME = `flex w-full items-center text-left text-ui ${PICKER_PANEL_ROW_GEOMETRY_CLASS_NAME} ${ELEVATED_HOVER_SURFACE_CLASS_NAME} hover:text-[var(--color-text-foreground)]`;

export const PICKER_PANEL_PLAIN_BODY_CLASS_NAME = COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME;
