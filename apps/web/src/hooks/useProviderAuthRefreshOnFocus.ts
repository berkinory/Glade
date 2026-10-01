import { useProviderStatusRefresh } from "./useProviderStatusRefresh";

// Minimum gap between window-focus-triggered provider auth re-probes, so rapid focus/visibility
// changes can't spawn redundant CLI probes on the server.
export const PROVIDER_AUTH_REFRESH_MIN_INTERVAL_MS = 15_000;

export function useProviderAuthRefreshOnFocus(options?: { readonly enabled?: boolean }): void {
  useProviderStatusRefresh({
    ...(options?.enabled !== undefined ? { enabled: options.enabled } : {}),
    minIntervalMs: PROVIDER_AUTH_REFRESH_MIN_INTERVAL_MS,
    refreshOnFocus: true,
  });
}
