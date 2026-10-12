// Every work row in the transcript (tool calls, groups, subagent cards, notices) puts its icon in
// the same slot, so icons line up down the transcript whatever the row's density. Density changes
// vertical spacing only.
export const WORK_ROW_ICON_SLOT_CLASS_NAME = "flex size-4 shrink-0 items-center justify-center";

export const WORK_ROW_ICON_CLASS_NAME = "size-3.5";

export const WORK_ROW_GAP_CLASS_NAME = "gap-1.5";

// Details open under a row's text rather than under its icon: the icon slot plus the gap.
export const WORK_ROW_DETAILS_INSET_CLASS_NAME = "ml-[1.375rem]";
