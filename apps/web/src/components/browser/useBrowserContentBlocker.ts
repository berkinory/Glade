import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const QUERY_KEY = ["browser-content-blocker"];

// The global on/off of the browser's content blocker, shared by Settings and the browser panel.
// `available` is false outside the desktop app.
export function useBrowserContentBlocker() {
  const bridge = window.desktopBridge?.browser?.contentBlocker;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => bridge!.getEnabled(),
    enabled: bridge !== undefined,
    retry: false,
  });
  const [changeError, setChangeError] = useState<string | null>(null);

  const setEnabled = async (next: boolean): Promise<void> => {
    if (!bridge) return;
    setChangeError(null);
    try {
      queryClient.setQueryData(QUERY_KEY, await bridge.setEnabled(next));
    } catch (cause) {
      setChangeError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return {
    available: bridge !== undefined,
    enabled: query.data,
    error: changeError ?? (query.error instanceof Error ? query.error.message : null),
    setEnabled,
  };
}
