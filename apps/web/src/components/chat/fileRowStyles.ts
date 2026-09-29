import { cn } from "~/lib/utils";

const FILE_ROW_SELECTED_BLOCK_CLASS_NAME =
  "bg-[var(--color-background-button-secondary)] text-foreground";
const FILE_ROW_FOCUS_BLOCK_CLASS_NAME =
  "focus-visible:bg-[var(--color-background-button-secondary)] focus-visible:text-foreground";

const FILE_ROW_BASE_CLASS_NAME = cn(
  "flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-left text-ui transition-colors",
  "focus-visible:outline-none",
  FILE_ROW_FOCUS_BLOCK_CLASS_NAME,
);

function fileRowToneClassName(selected: boolean): string {
  return selected
    ? FILE_ROW_SELECTED_BLOCK_CLASS_NAME
    : "text-foreground/78 hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground";
}

export function fileRowClassName(selected: boolean, className?: string): string {
  return cn(FILE_ROW_BASE_CLASS_NAME, fileRowToneClassName(selected), className);
}

export function fileRowIndentStyle(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${0.5 + depth * 0.75}rem` };
}
