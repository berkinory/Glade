import type {
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
} from "@glade/contracts/orchestration/orchestration";

type EmptyRouteRestoreRefreshHandler = () => Promise<boolean>;

const EMPTY_ROUTE_PROJECTION_POLL_ATTEMPTS = 12;
const EMPTY_ROUTE_PROJECTION_POLL_INTERVAL_MS = 500;

let activeEmptyRouteRestoreRefreshHandler: EmptyRouteRestoreRefreshHandler | null = null;

export function registerEmptyRouteRestoreRefresh(
  handler: EmptyRouteRestoreRefreshHandler,
): () => void {
  let inFlight: Promise<boolean> | null = null;
  const singleFlightHandler = () => {
    if (inFlight) {
      return inFlight;
    }

    const recovery = Promise.resolve().then(handler);
    const sharedRecovery = recovery.finally(() => {
      if (inFlight === sharedRecovery) {
        inFlight = null;
      }
    });
    inFlight = sharedRecovery;
    return sharedRecovery;
  };

  activeEmptyRouteRestoreRefreshHandler = singleFlightHandler;
  return () => {
    if (activeEmptyRouteRestoreRefreshHandler === singleFlightHandler) {
      activeEmptyRouteRestoreRefreshHandler = null;
    }
  };
}

export function requestEmptyRouteRestoreRefresh(): Promise<boolean> {
  return activeEmptyRouteRestoreRefreshHandler?.() ?? Promise.resolve(false);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export async function runEmptyRouteRestoreRefresh(input: {
  readonly getShellSnapshot: () => Promise<OrchestrationShellSnapshot>;
  readonly getSnapshot: () => Promise<OrchestrationReadModel>;
  readonly repairState: () => Promise<OrchestrationReadModel>;
  readonly applyShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
  readonly hasThreads: () => boolean;
}): Promise<boolean> {
  const applyFreshShellSnapshot = async () => {
    const snapshot = await input.getShellSnapshot();
    input.applyShellSnapshot(snapshot);
    return input.hasThreads();
  };

  for (let attempt = 0; attempt < EMPTY_ROUTE_PROJECTION_POLL_ATTEMPTS; attempt += 1) {
    if (await applyFreshShellSnapshot()) {
      return true;
    }

    if (attempt + 1 < EMPTY_ROUTE_PROJECTION_POLL_ATTEMPTS) {
      await delay(EMPTY_ROUTE_PROJECTION_POLL_INTERVAL_MS);
    }
  }

  // Applying it here would bypass EventRouter's shell sequence fence, which is the race this
  // coordinator exists to remove.
  const readModel = await input.getSnapshot();
  if (readModel.threads.length > 0) {
    return await applyFreshShellSnapshot();
  }

  await input.repairState();
  return await applyFreshShellSnapshot();
}
