import type { ProjectId } from "@glade/contracts/core/baseSchemas";

import type { Project } from "../types";

function resolveUsableProjectId(
  projects: readonly Project[],
  projectId: ProjectId | null,
): ProjectId | null {
  if (!projectId) {
    return null;
  }

  const project = projects.find(
    (candidate) => candidate.id === projectId && candidate.kind === "project",
  );
  return project?.id ?? null;
}

export function resolveCurrentProjectTargetId(
  projects: readonly Project[],
  focusedProjectId: ProjectId | null,
): ProjectId | null {
  return resolveUsableProjectId(projects, focusedProjectId);
}

export function resolveLatestProjectTargetId(
  projects: readonly Project[],
  latestProjectId: ProjectId | null,
): ProjectId | null {
  return resolveUsableProjectId(projects, latestProjectId);
}

export type ProjectLastActivityAt = ReadonlyMap<ProjectId, string>;

function projectRecencyKey(project: Project, lastActivityAt: ProjectLastActivityAt): string {
  return lastActivityAt.get(project.id) ?? project.updatedAt ?? project.createdAt ?? "";
}

const NO_PROJECT_ACTIVITY: ProjectLastActivityAt = new Map<ProjectId, string>();

export function resolveLatestProjectTargetIdWithFallback(
  projects: readonly Project[],
  latestProjectId: ProjectId | null,
  lastActivityAt: ProjectLastActivityAt = NO_PROJECT_ACTIVITY,
): ProjectId | null {
  return (
    resolveLatestProjectTargetId(projects, latestProjectId) ??
    projects
      .filter((project) => project.kind === "project")
      .toSorted((left, right) =>
        projectRecencyKey(right, lastActivityAt).localeCompare(
          projectRecencyKey(left, lastActivityAt),
        ),
      )
      .at(0)?.id ??
    null
  );
}
