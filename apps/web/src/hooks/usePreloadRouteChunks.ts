import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

const PRELOADED_CODE_LANGUAGES = ["ts", "tsx", "bash", "json", "text"];

// Programmatic navigation bypasses intent preloading. Warm chunks directly: a synthetic thread
// preload creates loader matches that navigation can evict while they are still loading.
export function usePreloadRouteChunks() {
  const router = useRouter();

  useEffect(() => {
    const reportPreloadFailure = (error: unknown) => {
      console.warn("[router] Route chunk preload failed", error);
    };
    void router.loadRouteChunk(router.routesById["/_chat/$threadId"])?.catch(reportPreloadFailure);

    const preloadSettings = () => {
      void import("../components/ThreadTerminalDrawer").catch(reportPreloadFailure);
      void router.loadRouteChunk(router.routesById["/_chat/settings"])?.catch(reportPreloadFailure);
      // A chat's code blocks show as plain text until the highlighter and their language load, so
      // the first chat opened would otherwise colour in after it appears.
      void import("../lib/syntaxHighlighting")
        .then((syntaxHighlighting) =>
          Promise.all(
            PRELOADED_CODE_LANGUAGES.map((language) =>
              syntaxHighlighting.getSyntaxHighlighterPromise(language),
            ),
          ),
        )
        .catch(reportPreloadFailure);
    };

    if (typeof requestIdleCallback === "function") {
      const idleCallbackId = requestIdleCallback(preloadSettings, { timeout: 5000 });
      return () => cancelIdleCallback(idleCallbackId);
    }
    const timeoutId = setTimeout(preloadSettings, 1500);
    return () => clearTimeout(timeoutId);
  }, [router]);
}
