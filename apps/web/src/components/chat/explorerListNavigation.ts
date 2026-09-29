import { type KeyboardEvent as ReactKeyboardEvent } from "react";

export const EXPLORER_ROW_PROPS = { "data-explorer-row": "" } as const;
const EXPLORER_ROW_SELECTOR = "[data-explorer-row]";

type ExplorerNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

function nextExplorerRowIndex(
  key: ExplorerNavigationKey,
  currentIndex: number,
  rowCount: number,
): number {
  switch (key) {
    case "ArrowDown":
      return currentIndex < 0 ? 0 : Math.min(currentIndex + 1, rowCount - 1);
    case "ArrowUp":
      return currentIndex < 0 ? rowCount - 1 : Math.max(currentIndex - 1, 0);
    case "Home":
      return 0;
    case "End":
      return rowCount - 1;
  }
}

function isTextEntryElement(element: Element | null): boolean {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function focusExplorerRow(row: HTMLElement): void {
  row.focus();

  row.scrollIntoView?.({ block: "nearest" });
}

function handleExplorerListKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const { key } = event;
  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") {
    return;
  }
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(EXPLORER_ROW_SELECTOR));
  if (rows.length === 0) {
    return;
  }

  const active = document.activeElement;
  let target: HTMLElement | undefined;
  if (isTextEntryElement(active)) {
    if (key !== "ArrowDown") {
      return;
    }
    target = rows[0];
  } else {
    const currentIndex = active instanceof HTMLElement ? rows.indexOf(active) : -1;
    target = rows[nextExplorerRowIndex(key, currentIndex, rows.length)];
  }

  if (!target) {
    return;
  }
  event.preventDefault();
  focusExplorerRow(target);
}

export function useExplorerListNavigation() {
  return handleExplorerListKeyDown;
}
