const SCROLL_IDLE_MS = 700;

export function trackScrollActivity(root: Document): void {
  const idleTimers = new WeakMap<HTMLElement, number>();
  root.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.dataset.scrolling === undefined) {
        target.dataset.scrolling = "";
      }
      window.clearTimeout(idleTimers.get(target));
      idleTimers.set(
        target,
        window.setTimeout(() => {
          idleTimers.delete(target);
          delete target.dataset.scrolling;
        }, SCROLL_IDLE_MS),
      );
    },
    { capture: true, passive: true },
  );
}
