import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const CHAT_ROW_HEIGHT = 32;

export function SidebarVirtualChatList<T extends { thread: { id: string } }>({
  rows,
  renderRow,
}: {
  rows: readonly T[];
  renderRow: (row: T, offset: number) => ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    const viewport = list?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const content = list?.closest<HTMLElement>('[data-slot="sidebar-content"]');
    if (!list || !viewport || !content) return;

    setScrollElement(viewport);
    const measureOffset = () => {
      const next =
        list.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top +
        viewport.scrollTop;
      setScrollMargin((current) => (current === next ? current : next));
    };
    measureOffset();
    const observer = new ResizeObserver(measureOffset);
    observer.observe(content);
    viewport.addEventListener("scroll", measureOffset, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", measureOffset);
    };
  }, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => CHAT_ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.thread.id ?? index,
    overscan: 8,
    scrollMargin,
  });

  return (
    <ul
      ref={listRef}
      className="relative w-full min-w-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        return row ? renderRow(row, item.start - scrollMargin) : null;
      })}
    </ul>
  );
}
