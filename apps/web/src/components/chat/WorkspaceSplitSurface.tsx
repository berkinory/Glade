import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { WorkspaceLayout, WorkspaceSplitDirection } from "~/mainWorkspaceLayout";
import {
  WORKSPACE_RESOURCE_DRAG_TYPE,
  readWorkspaceResourceDrag,
  type WorkspaceResourceDrag,
} from "~/lib/workspaceResourceDrag";
import {
  attachPanelPointerOverlaySession,
  createPanelResizeOverlay,
  removePanelResizeOverlay,
} from "~/lib/panelResize";
import { notifyNativeSurfaceOcclusionChange } from "~/lib/nativeSurfaceOcclusion";
import { cn } from "~/lib/utils";

type DropTarget = { group: number; split: WorkspaceSplitDirection | null };

export function workspaceGroupPlacement(layout: WorkspaceLayout, group: number): CSSProperties {
  return layout.groups.length === 1
    ? { gridArea: "1 / 1" }
    : layout.direction === "horizontal"
      ? { gridRow: 1, gridColumn: group * 2 + 1 }
      : { gridColumn: 1, gridRow: group * 2 + 1 };
}

export function useWorkspaceDragging() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const start = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(WORKSPACE_RESOURCE_DRAG_TYPE)) setDragging(true);
    };
    const end = () => setDragging(false);
    document.addEventListener("dragstart", start);
    document.addEventListener("dragend", end);
    document.addEventListener("drop", end, true);
    window.addEventListener("blur", end);
    return () => {
      document.removeEventListener("dragstart", start);
      document.removeEventListener("dragend", end);
      document.removeEventListener("drop", end, true);
      window.removeEventListener("blur", end);
    };
  }, []);
  return dragging;
}

export function WorkspaceSplitSurface(props: {
  layout: WorkspaceLayout;
  children: ReactNode;
  dragging: boolean;
  onFocus: (group: number) => void;
  onDropResource: (resource: WorkspaceResourceDrag, target: DropTarget) => void;
  onResize: (ratio: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const stopResize = useRef<(() => void) | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const split = props.layout.groups.length > 1;
  const horizontal = props.layout.direction === "horizontal";
  useEffect(() => () => stopResize.current?.(), []);
  useEffect(() => {
    notifyNativeSurfaceOcclusionChange();
  }, [props.layout.ratio, props.layout.direction, split]);
  const locate = (x: number, y: number): DropTarget => {
    const bounds = root.current!.getBoundingClientRect();
    const group =
      split &&
      (horizontal
        ? x - bounds.left >= bounds.width * props.layout.ratio
        : y - bounds.top >= bounds.height * props.layout.ratio)
        ? 1
        : 0;
    const width =
      split && horizontal
        ? bounds.width * (group === 0 ? props.layout.ratio : 1 - props.layout.ratio)
        : bounds.width;
    const height =
      split && !horizontal
        ? bounds.height * (group === 0 ? props.layout.ratio : 1 - props.layout.ratio)
        : bounds.height;
    const left = bounds.left + (group === 1 && horizontal ? bounds.width * props.layout.ratio : 0);
    const top = bounds.top + (group === 1 && !horizontal ? bounds.height * props.layout.ratio : 0);
    const rightDistance = left + width - x;
    const bottomDistance = top + height - y;
    return {
      group,
      split: split
        ? null
        : rightDistance < Math.min(64, width * 0.25) &&
            rightDistance / width < bottomDistance / height
          ? "horizontal"
          : bottomDistance < Math.min(64, height * 0.25)
            ? "vertical"
            : null,
    };
  };
  const track = horizontal
    ? `${props.layout.ratio}fr 4px ${1 - props.layout.ratio}fr`
    : "minmax(0, 1fr)";
  return (
    <div
      ref={root}
      className="relative grid min-h-0 min-w-0 flex-1 overflow-hidden"
      style={{
        gridTemplateColumns: split ? track : "minmax(0, 1fr)",
        gridTemplateRows:
          split && !horizontal
            ? `${props.layout.ratio}fr 4px ${1 - props.layout.ratio}fr`
            : "minmax(0, 1fr)",
      }}
      onPointerDownCapture={(event) => props.onFocus(locate(event.clientX, event.clientY).group)}
      onFocusCapture={(event) => {
        const element = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-workspace-group]",
        );
        if (element) props.onFocus(Number(element.dataset.workspaceGroup));
      }}
      onDragOverCapture={(event) => {
        if (!event.dataTransfer.types.includes(WORKSPACE_RESOURCE_DRAG_TYPE)) return;
        const next = locate(event.clientX, event.clientY);
        if (!next.split && (event.target as HTMLElement).closest("[data-chat-composer-form]")) {
          setTarget(null);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setTarget((current) =>
          current?.group === next.group && current.split === next.split ? current : next,
        );
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
      }}
      onDropCapture={(event) => {
        if (!target) return;
        const resource = readWorkspaceResourceDrag(event.dataTransfer);
        if (!resource) return;
        event.preventDefault();
        event.stopPropagation();
        props.onDropResource(resource, target);
        setTarget(null);
      }}
    >
      {props.children}
      {split ? (
        <div
          role="separator"
          aria-label="Resize workspace groups"
          aria-orientation={horizontal ? "vertical" : "horizontal"}
          tabIndex={0}
          aria-valuenow={Math.round(props.layout.ratio * 100)}
          aria-valuemin={20}
          aria-valuemax={80}
          style={horizontal ? { gridRow: 1, gridColumn: 2 } : { gridRow: 2, gridColumn: 1 }}
          className={cn(
            "z-20 bg-border/60 hover:bg-primary/40 focus-visible:bg-primary/40",
            horizontal ? "cursor-col-resize" : "cursor-row-resize",
          )}
          onDoubleClick={() => props.onResize(0.5)}
          onKeyDown={(event) => {
            if (event.key === "Home") {
              event.preventDefault();
              props.onResize(0.5);
            }
            const negative = horizontal ? "ArrowLeft" : "ArrowUp";
            const positive = horizontal ? "ArrowRight" : "ArrowDown";
            if (event.key === negative || event.key === positive) {
              event.preventDefault();
              props.onResize(props.layout.ratio + (event.key === negative ? -0.05 : 0.05));
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !root.current) return;
            event.preventDefault();
            event.stopPropagation();
            stopResize.current?.();
            const bounds = root.current.getBoundingClientRect();
            const overlay = createPanelResizeOverlay(horizontal ? "col-resize" : "row-resize");
            let detach = () => {};
            let frame = 0;
            let ratio = props.layout.ratio;
            const stop = () => {
              cancelAnimationFrame(frame);
              props.onResize(ratio);
              detach();
              removePanelResizeOverlay(overlay);
              stopResize.current = null;
            };
            detach = attachPanelPointerOverlaySession(overlay, {
              onMove: (move) => {
                ratio = horizontal
                  ? (move.clientX - bounds.left) / bounds.width
                  : (move.clientY - bounds.top) / bounds.height;
                if (!frame)
                  frame = requestAnimationFrame(() => {
                    frame = 0;
                    props.onResize(ratio);
                  });
              },
              onRelease: stop,
              onAbort: stop,
            });
            stopResize.current = stop;
          }}
        />
      ) : null}
      {props.dragging && target ? (
        <div
          aria-hidden
          className="pointer-events-none z-30 flex flex-col justify-end p-1"
          style={workspaceGroupPlacement(props.layout, target.group)}
        >
          <div
            className={cn(
              "h-full rounded-md border-2 border-primary/70 bg-primary/10",
              target.split === "horizontal" && "ml-auto w-1/2",
              target.split === "vertical" && "h-1/2",
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
