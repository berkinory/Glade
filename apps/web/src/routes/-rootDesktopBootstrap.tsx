import { useEffect, useRef } from "react";
import { shouldRepairDesktopProjectSnapshot } from "../lib/desktopProjectRecovery";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { createAllThreadsSelector } from "../storeSelectors";
import { createDesktopProjectRecoveryAttemptGate } from "./-desktopProjectRecoveryAttempt";

export function DesktopProjectBootstrap() {
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const projects = useStore((store) => store.projects);
  const threads = useStore(selectAllThreads);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const recoveryAttemptGateRef = useRef<ReturnType<
    typeof createDesktopProjectRecoveryAttemptGate
  > | null>(null);
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

    const projectIds = new Set(projects.map((project) => project.id));
    const hasThreadWithoutProject = threads.some((thread) => !projectIds.has(thread.projectId));
    if (projects.length > 0 && !hasThreadWithoutProject) {
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
  }, [projects, recoveryAttemptGate, syncServerReadModel, threads, threadsHydrated]);

  return null;
}
const selectAllThreads = createAllThreadsSelector();
