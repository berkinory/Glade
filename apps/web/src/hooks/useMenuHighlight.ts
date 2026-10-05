import { useLayoutEffect, useEffectEvent, useRef, type MouseEvent } from "react";

export function useMenuHighlight<Value>(
  activeValue: Value,
  onHighlight: (value: Value) => void,
  getActiveElement: () => HTMLElement | null | undefined,
) {
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const pointerHighlight = useRef<{ value: Value } | null>(null);
  const scrollToHighlight = useEffectEvent(() => {
    const fromPointer = pointerHighlight.current?.value === activeValue;
    pointerHighlight.current = null;
    if (!fromPointer) getActiveElement()?.scrollIntoView({ block: "nearest", behavior: "instant" });
  });

  useLayoutEffect(() => {
    scrollToHighlight();
  }, [activeValue]);

  return (value: Value, event: MouseEvent<HTMLElement>) => {
    const previous = pointerPosition.current;
    pointerPosition.current = { x: event.clientX, y: event.clientY };
    // Scrolling can emit mouse moves as rows pass under a stationary pointer.
    if (previous?.x === event.clientX && previous.y === event.clientY) return;
    if (value === activeValue) return;
    pointerHighlight.current = { value };
    onHighlight(value);
  };
}
