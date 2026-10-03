import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { SurfaceTabChip } from "./chatHeaderControls";

export interface PanelTab {
  id: string;
  label: string;
  icon: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  preview?: boolean;
  onDoubleClick?: () => void;
  onClose?: (() => void) | undefined;
}

export function PanelTabBar(props: {
  className?: string;
  pinnedTabId?: string;
  label: string;
  tabs: readonly PanelTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  actions?: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabIds = JSON.stringify(props.tabs.map((tab) => tab.id));
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const wheel = (event: WheelEvent) => {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta || scroller.scrollWidth <= scroller.clientWidth) return;
      event.preventDefault();
      scroller.scrollLeft +=
        delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientWidth : 1);
    };
    scroller.addEventListener("wheel", wheel, { passive: false });
    return () => scroller.removeEventListener("wheel", wheel);
  }, []);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const active = Array.from(scroller.children).find(
      (element) => element.getAttribute("data-tab-id") === props.activeId,
    );
    if (!active) return;
    const bounds = scroller.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < bounds.left) scroller.scrollLeft += tab.left - bounds.left;
    else if (tab.right > bounds.right) scroller.scrollLeft += tab.right - bounds.right;
  }, [props.activeId, tabIds]);
  const renderTab = (tab: PanelTab) => (
    <div key={tab.id} data-tab-id={tab.id} className="[-webkit-app-region:no-drag] shrink-0">
      <SurfaceTabChip
        active={tab.id === props.activeId}
        title={tab.label}
        label={tab.label}
        labelClassName={cn("max-w-40", tab.preview && "italic")}
        icon={tab.icon}
        leading={tab.leading}
        trailing={tab.trailing}
        closeLabel={`Close ${tab.label}`}
        onSelect={() => props.onSelect(tab.id)}
        onClose={tab.onClose}
        onDoubleClick={tab.onDoubleClick}
      />
    </div>
  );
  return (
    <div
      className={cn(
        "flex h-[calc(var(--spacing)*9+1px)] min-w-0 shrink-0 items-center gap-1 border-b border-border/70 bg-[var(--color-background-surface)] px-1.5 py-1",
        props.className,
      )}
    >
      <nav aria-label={props.label} className="flex min-w-0 flex-1 items-center gap-1">
        {props.tabs.filter((tab) => tab.id === props.pinnedTabId).map(renderTab)}
        <div
          ref={scrollerRef}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {props.tabs.filter((tab) => tab.id !== props.pinnedTabId).map(renderTab)}
        </div>
      </nav>
      {props.actions ? (
        <div className="[-webkit-app-region:no-drag] flex shrink-0 items-center">
          {props.actions}
        </div>
      ) : null}
    </div>
  );
}
