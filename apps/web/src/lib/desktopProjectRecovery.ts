import type {
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
} from "@glade/contracts/orchestration/orchestration";

type ProjectRecoverySnapshot = OrchestrationReadModel | OrchestrationShellSnapshot;

export function hasLiveThreadsWithMissingProjects(snapshot: ProjectRecoverySnapshot): boolean {
  const liveProjectIds = new Set(
    snapshot.projects
      .filter((project) => !("deletedAt" in project) || project.deletedAt === null)
      .map((project) => project.id),
  );

  return snapshot.threads.some((thread) => {
    const isLiveThread = !("deletedAt" in thread) || thread.deletedAt === null;
    return isLiveThread && !liveProjectIds.has(thread.projectId);
  });
}

export function shouldRepairDesktopProjectSnapshot(snapshot: ProjectRecoverySnapshot): boolean {
  const requiresEmptyProjectShellRepair =
    "requiresEmptyProjectShellRepair" in snapshot &&
    snapshot.requiresEmptyProjectShellRepair === true;

  return (
    hasLiveThreadsWithMissingProjects(snapshot) ||
    (snapshot.projects.length === 0 &&
      snapshot.threads.length === 0 &&
      requiresEmptyProjectShellRepair)
  );
}
