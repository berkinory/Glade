import { useEffect, useRef } from "react";
import { shouldRepairDesktopProjectSnapshot } from "../lib/desktopProjectRecovery";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import type { AppState } from "../storeState";
import {
  createDesktopProjectRecoveryAttemptGate,
  type DesktopProjectRecoveryAttemptGate,
} from "./-desktopProjectRecoveryAttempt";

// Returns a primitive so streaming deltas, which replace thread shells, do not re-render this.
function selectHasThreadWithoutProject(state: AppState): boolean {
  const threadIds = state.threadIds ?? [];
  if (threadIds.length === 0) return false;
  const projectIds = new Set(state.projects.map((project) => project.id));
  return threadIds.some((threadId) => {
    const shell = state.threadShellById?.[threadId];
    return shell !== undefined && !projectIds.has(shell.projectId);
  });
}

export function DesktopProjectBootstrap() {
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const hasProjects = useStore((store) => store.projects.length > 0);
  const hasThreadWithoutProject = useStore(selectHasThreadWithoutProject);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const recoveryAttemptGateRef = useRef<DesktopProjectRecoveryAttemptGate | null>(null);
  if (recoveryAttemptGateRef.current === null) {
    recoveryAttemptGateRef.current = createDesktopProjectRecoveryAttemptGate();
  }
  const recoveryAttemptGate = recoveryAttemptGateRef.current;

  useEffect(() => {
    let disposed = false;
    const api = readNativeApi();
    if (!api || !threadsHydrated) {
      return;
    }
    if (hasProjects && !hasThreadWithoutProject) {
      return;
    }

    const attempt = recoveryAttemptGate.begin();
    if (!attempt) return;
    const ownsAttempt = () => !disposed && attempt.isCurrent();

    void api.orchestration
      .getShellSnapshot()
      .then((snapshot) => {
        if (!ownsAttempt()) return;
        const needsRepair = shouldRepairDesktopProjectSnapshot(snapshot);
        if (!needsRepair) {
          if (!ownsAttempt() || !attempt.complete()) return;
          useStore.getState().syncServerShellSnapshot(snapshot);
          return;
        }
        return api.orchestration.repairState().then((repairedSnapshot) => {
          if (!ownsAttempt() || !attempt.complete()) return;
          syncServerReadModel(repairedSnapshot);
        });
      })
      .catch(() => {
        attempt.release();
      });

    return () => {
      disposed = true;
      attempt.release();
    };
  }, [
    hasThreadWithoutProject,
    hasProjects,
    recoveryAttemptGate,
    syncServerReadModel,
    threadsHydrated,
  ]);

  return null;
}
