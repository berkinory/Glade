import type { ThreadId } from "@glade/contracts";
import { type PointerEvent, type RefObject, useMemo, useRef } from "react";

import {
  selectThreadComputerPreviewFloating,
  useComputerPreviewStore,
  type ComputerPreviewFloatingPosition,
} from "../../computerPreviewStore";
import { clampComputerPreviewFloat } from "../chat/ComputerPreviewPopover.logic";

export interface ComputerPreviewFloat {
  readonly position: ComputerPreviewFloatingPosition | undefined;

  readonly popOut: () => void;

  readonly dock: () => void;
  readonly onFloatPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onFloatPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onFloatPointerEnd: (event: PointerEvent<HTMLDivElement>) => void;
}

export function useComputerPreviewFloat(input: {
  readonly threadId: ThreadId;
  readonly cardRef: RefObject<HTMLDivElement | null>;

  readonly cardWidthPx: number;
  readonly cardHeightPx: number;
}): ComputerPreviewFloat {
  const { threadId, cardRef } = input;
  const floating = useComputerPreviewStore(selectThreadComputerPreviewFloating(threadId));
  const setPreviewFloating = useComputerPreviewStore((store) => store.setPreviewFloating);
  const movePreviewFloating = useComputerPreviewStore((store) => store.movePreviewFloating);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  const position = useMemo(
    () =>
      floating === undefined
        ? undefined
        : clampComputerPreviewFloat({
            x: floating.x,
            y: floating.y,
            cardWidthPx: input.cardWidthPx,
            cardHeightPx: input.cardHeightPx,
            viewportWidthPx:
              typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerWidth,
            viewportHeightPx:
              typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerHeight,
          }),
    [floating, input.cardWidthPx, input.cardHeightPx],
  );

  const popOut = () => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPreviewFloating(
      threadId,
      clampComputerPreviewFloat({
        x: rect.left,
        y: rect.top,
        cardWidthPx: rect.width,
        cardHeightPx: rect.height,
        viewportWidthPx: window.innerWidth,
        viewportHeightPx: window.innerHeight,
      }),
    );
  };

  const dock = () => setPreviewFloating(threadId, null);

  const onFloatPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (floating === undefined || event.button !== 0) return;
    // Buttons inside the card (dock, close) must not start a drag.
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onFloatPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (floating === undefined || !drag || drag.pointerId !== event.pointerId) return;
    const rect = cardRef.current?.getBoundingClientRect();
    movePreviewFloating(
      threadId,
      clampComputerPreviewFloat({
        x: event.clientX - drag.offsetX,
        y: event.clientY - drag.offsetY,
        cardWidthPx: rect?.width ?? input.cardWidthPx,
        cardHeightPx: rect?.height ?? input.cardHeightPx,
        viewportWidthPx: window.innerWidth,
        viewportHeightPx: window.innerHeight,
      }),
    );
  };

  const onFloatPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return { position, popOut, dock, onFloatPointerDown, onFloatPointerMove, onFloatPointerEnd };
}
