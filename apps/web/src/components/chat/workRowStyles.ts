import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";

// Every work row in the transcript (tool calls, groups, subagent cards, notices) puts its icon in
// the same slot, so icons line up down the transcript whatever the row's density. Density changes
// vertical spacing only.
export const WORK_ROW_ICON_SLOT_CLASS_NAME = "flex size-4 shrink-0 items-center justify-center";

export const WORK_ROW_ICON_CLASS_NAME = "size-3.5";

export const WORK_ROW_GAP_CLASS_NAME = "gap-1.5";

// Muted rows light up while their own row is hovered or focused.
export const WORK_ROW_MUTED_HOVER_TONE: Record<"tool-row" | "file-row", string> = {
  "tool-row": `${MUTED_LABEL_TEXT_CLASS_NAME} transition-colors group-hover/tool-row:text-foreground group-focus-visible/tool-row:text-foreground`,
  "file-row": `${MUTED_LABEL_TEXT_CLASS_NAME} transition-colors group-hover/file-row:text-foreground group-focus-visible/file-row:text-foreground`,
};

// Details open under a row's text rather than under its icon: the icon slot plus the gap.
export const WORK_ROW_DETAILS_INSET_CLASS_NAME = "ml-[1.375rem]";
