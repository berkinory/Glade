import { useEffect, useRef, type RefObject } from "react";
import { resolveDiffSelectAllArmed, resolveDiffSelectAllWithinViewport } from "./DiffPanel.logic";

export function useDiffPanelCopyShortcut(
  patchViewportRef: RefObject<HTMLDivElement | null>,
  diffCopyText: string | null,
): void {
  const diffSelectAllArmedRef = useRef(false);
  const lastPointerInDiffViewportRef = useRef(false);
  useEffect(() => {
    const isEventWithinDiffViewport = (event: Event) => {
      const viewport = patchViewportRef.current;
      return viewport ? event.composedPath().includes(viewport) : false;
    };
    const isTextEditingEvent = (event: Event) =>
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            (target instanceof HTMLElement &&
              (target.isContentEditable || target.getAttribute("role") === "textbox")),
        );
    const handleKeyDown = (event: KeyboardEvent) => {
      const isWithinDiffViewport = resolveDiffSelectAllWithinViewport(
        isEventWithinDiffViewport(event),
        lastPointerInDiffViewportRef.current,
        isTextEditingEvent(event),
      );
      diffSelectAllArmedRef.current = resolveDiffSelectAllArmed(
        diffSelectAllArmedRef.current,
        event,
        isWithinDiffViewport,
      );
    };
    const handlePointerDown = (event: PointerEvent) => {
      lastPointerInDiffViewportRef.current = isEventWithinDiffViewport(event);
      diffSelectAllArmedRef.current = false;
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (isEventWithinDiffViewport(event)) {
        return;
      }
      lastPointerInDiffViewportRef.current = false;
      diffSelectAllArmedRef.current = false;
    };
    const handleCopy = (event: ClipboardEvent) => {
      if (!diffSelectAllArmedRef.current) {
        return;
      }
      diffSelectAllArmedRef.current = false;
      if (!diffCopyText || !event.clipboardData) {
        return;
      }
      event.preventDefault();
      event.clipboardData.setData("text/plain", diffCopyText);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("copy", handleCopy, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("copy", handleCopy, true);
    };
  }, [diffCopyText, patchViewportRef]);
}
