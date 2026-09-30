import type { ProjectId, SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";

import type { ServerWorkspacePaths } from "~/lib/serverWorkspacePaths";
import { isOrdinarySpaceProject } from "~/lib/spaces";
import type { Project, SidebarThreadSummary } from "~/types";

function isProjectInSpace(
  project: Project | null | undefined,
  spaceId: SpaceId | null,
  paths: ServerWorkspacePaths,
): project is Project {
  return isOrdinarySpaceProject(project, paths) && (project.spaceId ?? null) === spaceId;
}

// Fails closed when the project cannot be resolved.
export function isThreadReachableFromSpace(input: {
  project: Project | null | undefined;
  spaceId: SpaceId | null;
  paths: ServerWorkspacePaths;
}): boolean {
  const { paths, project, spaceId } = input;
  if (!project) return false;
  if (!isOrdinarySpaceProject(project, paths)) return true;
  return (project.spaceId ?? null) === spaceId;
}

export type SpaceSelectionTarget =
  | { readonly kind: "thread"; readonly threadId: ThreadId }
  | { readonly kind: "project"; readonly projectId: ProjectId }
  | { readonly kind: "empty"; readonly spaceId: SpaceId | null };

export function resolveSpaceSelectionTarget(input: {
  spaceId: SpaceId | null;

  projects: readonly Project[];
  projectById: ReadonlyMap<ProjectId, Project>;
  threads: readonly SidebarThreadSummary[];
  rememberedThreadId: ThreadId | null;
  rememberedProjectId: ProjectId | null;
  paths: ServerWorkspacePaths;

  sortThreads: (threads: readonly SidebarThreadSummary[]) => readonly SidebarThreadSummary[];
}): SpaceSelectionTarget {
  const { paths, projectById, projects, rememberedProjectId, rememberedThreadId, spaceId } = input;

  const availableThreads = input.threads.filter(
    (thread) =>
      thread.archivedAt == null &&
      isProjectInSpace(projectById.get(thread.projectId), spaceId, paths),
  );

  const rememberedThread = rememberedThreadId
    ? availableThreads.find((thread) => thread.id === rememberedThreadId)
    : undefined;
  if (rememberedThread) {
    return { kind: "thread", threadId: rememberedThread.id };
  }

  const rememberedProject = rememberedProjectId
    ? projects.find(
        (project) =>
          project.id === rememberedProjectId && isProjectInSpace(project, spaceId, paths),
      )
    : undefined;
  if (rememberedProject) {
    return { kind: "project", projectId: rememberedProject.id };
  }

  const targetThread = input.sortThreads(availableThreads)[0];
  if (targetThread) {
    return { kind: "thread", threadId: targetThread.id };
  }

  return { kind: "empty", spaceId };
}
