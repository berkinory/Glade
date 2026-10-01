import { useEffect, useState } from "react";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";

export function useVisibleSidebarThreadIds(ids: readonly ThreadId[]): readonly ThreadId[] {
  const [visibleIds, setVisibleIds] = useState<readonly ThreadId[]>([]);
  const idsKey = JSON.stringify(ids);
  useEffect(() => {
    const targets = new Map<string, ThreadId>(
      (JSON.parse(idsKey) as ThreadId[]).map((id) => [id, id]),
    );
    const rows = new Map<Element, ThreadId>();
    const visible = new Set<Element>();
    let frame: number | undefined;
    const publish = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const next = [...new Set([...visible].flatMap((row) => rows.get(row) ?? []))].toSorted();
        setVisibleIds((previous) =>
          previous.length === next.length && previous.every((id, index) => id === next[index])
            ? previous
            : next,
        );
      });
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      publish();
    });
    const selector = "[data-sidebar-thread-id]";
    const reconcile = () => {
      for (const row of document.querySelectorAll(selector)) {
        const id = targets.get(row.getAttribute("data-sidebar-thread-id") ?? "");
        if (id && !rows.has(row)) {
          rows.set(row, id);
          observer.observe(row);
        }
      }
      for (const row of rows.keys()) {
        if (row.isConnected) continue;
        observer.unobserve(row);
        rows.delete(row);
        visible.delete(row);
      }
      publish();
    };
    const mutations = new MutationObserver((changes) => {
      if (
        changes.some((change) =>
          [...change.addedNodes, ...change.removedNodes].some(
            (node) =>
              node instanceof Element && (node.matches(selector) || node.querySelector(selector)),
          ),
        )
      )
        reconcile();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    reconcile();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [idsKey]);
  return visibleIds;
}
