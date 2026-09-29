import type { NativeApi } from "@glade/contracts";

import { EMPTY_ROUTE_RESTORE_FALLBACK_DELAY_MS } from "./chatRouteRestore";
import { requestEmptyRouteRestoreRefresh } from "./routeRestoreRefreshCoordinator";

export function waitForEmptyRouteRestoreFallbackDelay(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, EMPTY_ROUTE_RESTORE_FALLBACK_DELAY_MS);
  });
}

export async function refreshEmptyRouteRestoreSnapshot(
  api: NativeApi | undefined,
): Promise<boolean> {
  if (!api) {
    return false;
  }

  return await requestEmptyRouteRestoreRefresh();
}
