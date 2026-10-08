import { Schema } from "effect";
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import {
  attachPanelPointerOverlaySession,
  canComposerHandlePanelWidth,
  createPanelResizeOverlay,
  removePanelResizeOverlay,
} from "../../lib/panelResize";

// Width of a panel docked to the right of a chat pane, dragged from its left edge and remembered
// under `storageKey`. Growing stops where the pane's composer would no longer fit.
export function usePanelWidthResize(input: {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly chatMinWidth: number;
}) {
  const { storageKey, defaultWidth, minWidth, chatMinWidth } = input;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidthState] = useState(
    () => getLocalStorageItem(storageKey, Schema.Finite) ?? defaultWidth,
  );
  const setWidth = (next: number) => {
    setWidthState(next);
    setLocalStorageItem(storageKey, next, Schema.Finite);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const wrapper = wrapperRef.current;
    const parent = wrapper?.parentElement;
    if (!wrapper || !parent) return;

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = wrapper.getBoundingClientRect().width;
    const maxWidth = Math.max(minWidth, parent.clientWidth - chatMinWidth);
    const resizeOverlay = createPanelResizeOverlay();
    let detachPointerSession = () => {};
    let pendingWidth = startWidth;
    let currentWidth = startWidth;
    let frameId = 0;
    let finished = false;

    const applyPendingWidth = () => {
      frameId = 0;
      if (pendingWidth === currentWidth) return;
      if (pendingWidth < currentWidth) {
        currentWidth = pendingWidth;
        wrapper.style.width = `${currentWidth}px`;
        return;
      }
      const accepted = canComposerHandlePanelWidth({
        nextWidth: pendingWidth,
        applyWidth: (width) => {
          wrapper.style.width = `${width}px`;
        },
        resetWidth: () => {
          wrapper.style.width = `${currentWidth}px`;
        },
      });
      if (!accepted) return;
      currentWidth = pendingWidth;
      wrapper.style.width = `${currentWidth}px`;
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      pendingWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
      if (frameId === 0) frameId = window.requestAnimationFrame(applyPendingWidth);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
      applyPendingWidth();
      detachPointerSession();
      removePanelResizeOverlay(resizeOverlay);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      wrapper.style.removeProperty("transition");
      if (currentWidth !== startWidth) setWidth(currentWidth);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // A panel that animates its width for open and close must follow the pointer without easing.
    wrapper.style.transition = "none";
    detachPointerSession = attachPanelPointerOverlaySession(resizeOverlay, {
      onMove: onPointerMove,
      onRelease: finish,
      onAbort: finish,
    });
  };

  return { wrapperRef, width, startResize };
}

export function PanelWidthResizeHandle(props: {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="absolute inset-y-0 left-0 z-20 w-2 -translate-x-1/2 cursor-col-resize bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-[var(--app-surface-divider)]"
      onPointerDown={props.onPointerDown}
    />
  );
}
