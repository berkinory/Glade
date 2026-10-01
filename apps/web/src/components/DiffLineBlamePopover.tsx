import type { DiffLineClickProps } from "./chat/FileDiffView";
import { resolveTranscriptSelectionActionLayout } from "./chat/chatSelectionActions";
const BLAME_POPOVER_WIDTH_PX = 288;
const BLAME_POPOVER_HEIGHT_PX = 116;
export interface DiffLineBlameTarget {
  filePath: string;
  line: number;

  side: "base" | "workingTree";
  left: number;
  top: number;
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && selection.rangeCount > 0 && !selection.isCollapsed;
}

export function resolveDiffLineBlameTarget(
  filePath: string,
  line: DiffLineClickProps,
): DiffLineBlameTarget | null {
  if (!Number.isFinite(line.lineNumber) || line.lineNumber < 1) {
    return null;
  }
  if (hasActiveTextSelection()) {
    return null;
  }
  const lineRect = line.lineElement.getBoundingClientRect();
  const layout = resolveTranscriptSelectionActionLayout({
    selectionRect: new DOMRect(line.event.clientX, lineRect.top, 0, lineRect.height),
    pointer: { x: line.event.clientX, y: line.event.clientY },
    size: { width: BLAME_POPOVER_WIDTH_PX, height: BLAME_POPOVER_HEIGHT_PX },
  });
  return {
    filePath,
    line: line.lineNumber,
    side: line.lineType === "change-deletion" ? "base" : "workingTree",
    left: layout.left,
    top: layout.top,
  };
}
