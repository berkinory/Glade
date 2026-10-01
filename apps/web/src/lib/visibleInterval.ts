export function startVisibleInterval(onTick: () => void, intervalMs: number): () => void {
  let intervalId: number | null = null;
  let refreshId: number | null = null;

  const stop = () => {
    if (refreshId !== null) {
      window.clearTimeout(refreshId);
      refreshId = null;
    }
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };

  const syncVisibility = () => {
    if (document.visibilityState !== "visible") {
      stop();
      return;
    }
    if (intervalId !== null) {
      return;
    }

    refreshId = window.setTimeout(() => {
      refreshId = null;
      onTick();
    }, 0);
    intervalId = window.setInterval(onTick, intervalMs);
  };

  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();
  return () => {
    document.removeEventListener("visibilitychange", syncVisibility);
    stop();
  };
}
