import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  contentTabs?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const wheelRegionRef = useRef<HTMLElement>(null);
  const [frozenWidths, setFrozenWidths] = useState<Record<string, number> | null>(null);
  const pinnedTabs = props.tabs.filter((tab) => tab.id === props.pinnedTabId);
  const scrollableTabs = props.tabs.filter((tab) => tab.id !== props.pinnedTabId);
  const tabIds = JSON.stringify(props.tabs.map((tab) => tab.id));
  useEffect(() => {
    const scroller = scrollerRef.current;
    const wheelRegion = wheelRegionRef.current;
    if (!scroller || !wheelRegion) return;
    const wheel = (event: WheelEvent) => {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta || scroller.scrollWidth <= scroller.clientWidth) return;
      if (event.deltaX && event.target instanceof Node && scroller.contains(event.target)) return;
      event.preventDefault();
      scroller.scrollLeft +=
        delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientWidth : 1);
    };
    wheelRegion.addEventListener("wheel", wheel, { passive: false });
    return () => wheelRegion.removeEventListener("wheel", wheel);
  }, []);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const reveal = () => {
      const active = Array.from(scroller.children).find(
        (element) => element.getAttribute("data-tab-id") === props.activeId,
      );
      if (!active) return;
      const bounds = scroller.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      if (tab.left < bounds.left) scroller.scrollLeft += tab.left - bounds.left;
      else if (tab.right > bounds.right) scroller.scrollLeft += tab.right - bounds.right;
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [props.activeId, tabIds]);
  const renderTab = (tab: PanelTab, index: number, pinned = false) => {
    const content = props.contentTabs && !pinned;
    const previous = scrollableTabs[index - 1];
    const frozenWidth = content ? frozenWidths?.[tab.id] : undefined;
    return (
      <div
        key={tab.id}
        data-tab-id={tab.id}
        data-separator={
          props.contentTabs &&
          previous &&
          previous.id !== props.activeId &&
          tab.id !== props.activeId
            ? ""
            : undefined
        }
        className={cn(
          "[-webkit-app-region:no-drag]",
          content
            ? "workspace-content-tab min-w-[min(9em,100%)] max-w-[24em] basis-[max-content] shrink text-ui-sm"
            : "shrink-0",
          frozenWidth !== undefined && "!min-w-0 !shrink-0",
        )}
        style={frozenWidth !== undefined ? { flexBasis: frozenWidth } : undefined}
      >
        <SurfaceTabChip
          active={tab.id === props.activeId}
          title={tab.label}
          label={tab.label}
          labelClassName={cn(!content && "max-w-40", tab.preview && "italic")}
          className={cn(
            content && "w-full",
            content &&
              tab.id === props.activeId &&
              "shadow-[inset_0_0_0_0.5px_var(--app-surface-divider)]",
          )}
          closePlacement={content ? "trailing" : "icon"}
          icon={tab.icon}
          leading={tab.leading}
          trailing={tab.trailing}
          closeLabel={`Close ${tab.label}`}
          onSelect={() => props.onSelect(tab.id)}
          onClose={
            tab.onClose
              ? () => {
                  const scroller = scrollerRef.current;
                  if (content && wheelRegionRef.current?.matches(":hover") && scroller)
                    setFrozenWidths(
                      Object.fromEntries(
                        Array.from(scroller.children).map((element) => [
                          element.getAttribute("data-tab-id")!,
                          element.getBoundingClientRect().width,
                        ]),
                      ),
                    );
                  tab.onClose?.();
                }
              : undefined
          }
          onDoubleClick={tab.onDoubleClick}
        />
      </div>
    );
  };
  return (
    <div
      className={cn(
        "flex h-[calc(var(--spacing)*9+1px)] min-w-0 shrink-0 items-center gap-1 border-b border-border/70 bg-[var(--app-content-surface)] px-1.5 py-1",
        props.className,
      )}
    >
      <div className="min-w-0 flex-1">
        <nav
          ref={wheelRegionRef}
          aria-label={props.label}
          className="[-webkit-app-region:no-drag] flex w-fit min-w-0 max-w-full items-center gap-1"
          onPointerLeave={() => setFrozenWidths(null)}
        >
          {pinnedTabs.map((tab, index) => renderTab(tab, index, true))}
          {props.contentTabs && pinnedTabs.length > 0 && scrollableTabs.length > 0 ? (
            <span aria-hidden="true" className="mx-1 h-3 w-px shrink-0 bg-foreground/12" />
          ) : null}
          <div
            ref={scrollerRef}
            className={cn(
              "flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              props.contentTabs &&
                "scroll-fade-x [--scroll-fade-size:1rem] [--scroll-fade-reveal:1rem]",
            )}
          >
            {scrollableTabs.map((tab, index) => renderTab(tab, index))}
          </div>
        </nav>
      </div>
      {props.actions ? (
        <div className="[-webkit-app-region:no-drag] ml-2 flex shrink-0 items-center self-center">
          {props.actions}
        </div>
      ) : null}
    </div>
  );
}
