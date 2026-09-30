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
  | { readonly kind: "empty"; readonly spaceId: SpaceId | null };

export function resolveSpaceSelectionTarget(input: {
  spaceId: SpaceId | null;

  projectById: ReadonlyMap<ProjectId, Project>;
  threads: readonly SidebarThreadSummary[];
  rememberedThreadId: ThreadId | null;
  paths: ServerWorkspacePaths;

  sortThreads: (threads: readonly SidebarThreadSummary[]) => readonly SidebarThreadSummary[];
}): SpaceSelectionTarget {
  const { paths, projectById, rememberedThreadId, spaceId } = input;

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

  const targetThread = input.sortThreads(availableThreads)[0];
  if (targetThread) {
    return { kind: "thread", threadId: targetThread.id };
  }

  return { kind: "empty", spaceId };
}
