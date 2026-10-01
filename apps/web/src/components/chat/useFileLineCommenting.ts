import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

interface FileLineGeometry {
  lineNumber: number;
  top: number;
  height: number;
  left: number;
  containerWidth: number;
}

interface UseFileLineCommentingOptions {
  enabled: boolean;
  // Closes any open box / clears hover when the previewed file changes, so a stale geometry from the
  // previous file never leaks into the new one.
  resetKey: string | null;
}

export interface UseFileLineCommentingResult {
  hoveredLine: FileLineGeometry | null;
  activeLine: FileLineGeometry | null;
  onContainerMouseMove: (event: ReactMouseEvent<HTMLElement>) => void;
  onContainerMouseLeave: () => void;
  openComment: (line: FileLineGeometry) => void;
  closeComment: () => void;
}

function lineNumberOf(lineEl: Element): number {
  let count = 1;
  for (let node = lineEl.previousElementSibling; node; node = node.previousElementSibling) {
    if (node.classList.contains("line")) {
      count += 1;
    }
  }
  return count;
}

function measureLine(container: HTMLElement, lineEl: HTMLElement): FileLineGeometry {
  const containerRect = container.getBoundingClientRect();
  const lineRect = lineEl.getBoundingClientRect();
  return {
    lineNumber: lineNumberOf(lineEl),
    top: lineRect.top - containerRect.top + container.scrollTop,
    height: lineRect.height,
    left: lineRect.left - containerRect.left + container.scrollLeft,
    containerWidth: container.clientWidth,
  };
}

export function useFileLineCommenting(
  options: UseFileLineCommentingOptions,
): UseFileLineCommentingResult {
  const { enabled, resetKey } = options;
  const [lineState, setLineState] = useState<{
    enabled: boolean;
    resetKey: string | null;
    hoveredLine: FileLineGeometry | null;
    activeLine: FileLineGeometry | null;
  }>(() => ({ enabled, resetKey, hoveredLine: null, activeLine: null }));
  const scopeIsCurrent = lineState.enabled === enabled && lineState.resetKey === resetKey;
  if (!scopeIsCurrent) {
    setLineState({ enabled, resetKey, hoveredLine: null, activeLine: null });
  }
  const hoveredLine = scopeIsCurrent && enabled ? lineState.hoveredLine : null;
  const activeLine = scopeIsCurrent && enabled ? lineState.activeLine : null;
  const setHoveredLine = (line: FileLineGeometry | null) =>
    setLineState((current) => ({ ...current, hoveredLine: line }));
  const setActiveLine = (line: FileLineGeometry | null) =>
    setLineState((current) => ({ ...current, activeLine: line }));

  const hoveredElRef = useRef<Element | null>(null);
  const isActiveRef = useRef(false);

  const clearHover = () => {
    hoveredElRef.current = null;
    setHoveredLine(null);
  };

  const onContainerMouseMove = (event: ReactMouseEvent<HTMLElement>) => {
    // Suppress the affordance while disabled, while a box is open, and while a button is held (a
    // drag-selection): the gutter "+" must not flicker as the user sweeps a text selection.
    if (!enabled || isActiveRef.current || event.buttons !== 0) {
      return;
    }
    const container = event.currentTarget;
    const target = event.target instanceof Element ? event.target : null;

    if (target?.closest(".editor-file-viewer__comment-add")) {
      return;
    }
    const lineEl = target ? target.closest<HTMLElement>(".line") : null;
    if (!lineEl || !container.contains(lineEl)) {
      if (hoveredElRef.current) {
        clearHover();
      }
      return;
    }
    if (lineEl === hoveredElRef.current) {
      return;
    }
    hoveredElRef.current = lineEl;
    setHoveredLine(measureLine(container, lineEl));
  };

  const onContainerMouseLeave = () => {
    if (hoveredElRef.current) {
      clearHover();
    }
  };

  const openComment = (line: FileLineGeometry) => {
    isActiveRef.current = true;
    setActiveLine(line);
    clearHover();
  };

  const closeComment = () => {
    isActiveRef.current = false;
    setActiveLine(null);
  };

  useEffect(() => {
    if (enabled) {
      return;
    }
    isActiveRef.current = false;
    hoveredElRef.current = null;
  }, [enabled]);

  useEffect(() => {
    isActiveRef.current = false;
    hoveredElRef.current = null;
  }, [resetKey]);

  return {
    hoveredLine,
    activeLine,
    onContainerMouseMove,
    onContainerMouseLeave,
    openComment,
    closeComment,
  };
}
