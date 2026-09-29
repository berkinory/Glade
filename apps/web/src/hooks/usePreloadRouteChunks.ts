import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

// Settings and thread routes are reached through programmatic `navigate()` calls (sidebar gear,
// keyboard shortcut, the "New thread" button), so the router's intent-based preloading never fires
// for them — without this, the first open pays the chunk download/parse cost. For a brand-new
// thread that cost lands right on the draft-landing paint, so warming the thread chunk is the
// largest single lever for new-chat startup time.
export function usePreloadRouteChunks() {
  const router = useRouter();

  useEffect(() => {
    router
      .preloadRoute({ to: "/$threadId", params: { threadId: "chunk-preload" } })
      .catch(() => {});

    const preloadSettings = () => {
      router.preloadRoute({ to: "/settings" }).catch(() => {});
    };

    if (typeof requestIdleCallback === "function") {
      const idleCallbackId = requestIdleCallback(preloadSettings, { timeout: 5000 });
      return () => cancelIdleCallback(idleCallbackId);
    }
    const timeoutId = setTimeout(preloadSettings, 1500);
    return () => clearTimeout(timeoutId);
  }, [router]);
}
