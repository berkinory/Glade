import { PointerSensor, type SensorProps, type SensorInstance } from "@dnd-kit/core";

interface SidebarPointerSensorOptions {
  activationConstraint: { distance: number };
}

export class SidebarPointerSensor implements SensorInstance {
  static activators = PointerSensor.activators;
  autoScrollEnabled = true;

  constructor(props: SensorProps<SidebarPointerSensorOptions>) {
    const initialEvent = props.event;
    if (!(initialEvent instanceof PointerEvent)) {
      throw new TypeError("Sidebar dragging requires a pointer event.");
    }
    const ownerDocument = props.activeNode.node.current?.ownerDocument ?? document;
    const ownerWindow = ownerDocument.defaultView ?? window;
    const controller = new AbortController();
    const initialCoordinates = { x: initialEvent.clientX, y: initialEvent.clientY };
    let activated = false;
    const finish = (cancelled: boolean) => {
      controller.abort();
      if (!activated) props.onAbort(props.active);
      if (cancelled) props.onCancel();
      else props.onEnd();
    };
    const cancel = () => finish(true);
    const move = (event: PointerEvent) => {
      if (event.pointerId !== initialEvent.pointerId) return;
      // A release outside the window can be lost; its next hover must cancel the old gesture.
      if (event.pointerType !== "touch" && !(event.buttons & 1)) {
        cancel();
        return;
      }
      const coordinates = { x: event.clientX, y: event.clientY };
      if (!activated) {
        const distance = Math.hypot(
          coordinates.x - initialCoordinates.x,
          coordinates.y - initialCoordinates.y,
        );
        if (distance <= props.options.activationConstraint.distance) {
          props.onPending(props.active, props.options.activationConstraint, initialCoordinates, {
            x: coordinates.x - initialCoordinates.x,
            y: coordinates.y - initialCoordinates.y,
          });
          return;
        }
        activated = true;
        ownerDocument.getSelection()?.removeAllRanges();
        props.onStart(initialCoordinates);
        const suppressClick = (click: MouseEvent) => click.stopPropagation();
        ownerDocument.addEventListener("click", suppressClick, true);
        controller.signal.addEventListener("abort", () => {
          ownerWindow.setTimeout(() => {
            ownerDocument.removeEventListener("click", suppressClick, true);
          }, 50);
        });
      }
      if (event.cancelable) event.preventDefault();
      props.onMove(coordinates);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === initialEvent.pointerId) finish(event.type === "pointercancel");
    };
    const options = { capture: true, passive: false, signal: controller.signal };
    ownerDocument.addEventListener("pointermove", move, options);
    ownerDocument.addEventListener("pointerup", end, options);
    ownerDocument.addEventListener("pointercancel", end, options);
    ownerDocument.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") cancel();
      },
      options,
    );
    ownerDocument.addEventListener("visibilitychange", cancel, options);
    ownerWindow.addEventListener("blur", cancel, options);
    ownerWindow.addEventListener("resize", cancel, options);
    props.onPending(props.active, props.options.activationConstraint, initialCoordinates);
  }
}
