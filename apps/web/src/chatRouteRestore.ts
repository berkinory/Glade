export type LastThreadRoute = {
  threadId: string;
};

export type EmptyRouteRestoreRecoveryState = "idle" | "pending" | "done";

export const EMPTY_ROUTE_RESTORE_FALLBACK_DELAY_MS = 1_800;

export function resolveRestorableThreadRoute(input: {
  lastThreadRoute: LastThreadRoute | null;
  availableThreadIds: ReadonlySet<string>;
}): LastThreadRoute | null {
  const { lastThreadRoute, availableThreadIds } = input;
  if (!lastThreadRoute || !availableThreadIds.has(lastThreadRoute.threadId)) {
    return null;
  }
  return { threadId: lastThreadRoute.threadId };
}

export function shouldStartRememberedRouteRecovery(input: {
  lastThreadRoute: LastThreadRoute | null;
  availableThreadCount: number;
  recoveryState: EmptyRouteRestoreRecoveryState;
}): boolean {
  return Boolean(
    input.lastThreadRoute && input.availableThreadCount === 0 && input.recoveryState === "idle",
  );
}

export function shouldHoldRememberedRouteFallback(input: {
  lastThreadRoute: LastThreadRoute | null;
  availableThreadCount: number;
  recoveryState: EmptyRouteRestoreRecoveryState;
}): boolean {
  return Boolean(
    input.lastThreadRoute && input.availableThreadCount === 0 && input.recoveryState !== "done",
  );
}

export function shouldStartMissingThreadRouteRecovery(input: {
  hasKnownServerThreads: boolean;
  recoveryState: EmptyRouteRestoreRecoveryState;
  routeThreadExists: boolean;
}): boolean {
  return !input.routeThreadExists && !input.hasKnownServerThreads && input.recoveryState === "idle";
}

export function shouldHoldMissingThreadRouteFallback(input: {
  hasKnownServerThreads: boolean;
  recoveryState: EmptyRouteRestoreRecoveryState;
  routeThreadExists: boolean;
}): boolean {
  return !input.routeThreadExists && !input.hasKnownServerThreads && input.recoveryState !== "done";
}
