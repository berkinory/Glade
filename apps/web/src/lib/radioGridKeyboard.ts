import type { KeyboardEvent } from "react";

export function handleRadioGridKeyDown(
  event: KeyboardEvent<HTMLElement>,
  cellSelector: string,
  options?: { readonly columns?: number; readonly selectOnMove?: boolean },
): void {
  const columns = options?.columns;
  const rowStep = columns ?? 1;
  const stepByKey: Record<string, number | "first" | "last"> = {
    ArrowLeft: -1,
    ArrowUp: -rowStep,
    ArrowRight: 1,
    ArrowDown: rowStep,
    Home: "first",
    End: "last",
  };
  const step = stepByKey[event.key];
  if (step === undefined) return;
  const cells = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(cellSelector));
  if (cells.length === 0) return;
  event.preventDefault();
  const currentIndex = Math.max(cells.indexOf(document.activeElement as HTMLElement), 0);
  let nextIndex: number;
  if (step === "first") nextIndex = 0;
  else if (step === "last") nextIndex = cells.length - 1;
  else if (columns === undefined) nextIndex = (currentIndex + step + cells.length) % cells.length;
  else nextIndex = currentIndex + step;
  const next = cells[nextIndex];
  if (!next) return;
  next.focus();
  if (options?.selectOnMove !== false) next.click();
}
