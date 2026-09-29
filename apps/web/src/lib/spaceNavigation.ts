// FILE: spaceNavigation.ts
// Purpose: Where selecting a Space lands, and which threads a Space is allowed to land on.
// Layer: Spaces domain helper
// Why: `isOrdinarySpaceProject` states which *projects* Spaces organize; every Space-scoped
//      navigation needs the thread-level consequence of that rule. The Space switcher and the
//      "/" restore landing both make that judgement, and spelling it out separately is exactly
//      how selecting an empty Space ended up restoring another Space's thread.

import type { ProjectId, SpaceId, ThreadId } from "@glade/contracts";

import type { ServerWorkspacePaths } from "~/lib/serverWorkspacePaths";
import { isOrdinarySpaceProject } from "~/lib/spaces";
import type { Project, SidebarThreadSummary } from "~/types";

/** Strict membership: a project Spaces organize, filed into `spaceId`. */
function isProjectInSpace(
  project: Project | null | undefined,
  spaceId: SpaceId | null,
  paths: ServerWorkspacePaths,
): project is Project {
  return isOrdinarySpaceProject(project, paths) && (project.spaceId ?? null) === spaceId;
}

/**
 * Project-level reachability for Space landings. Container projects have no Space themselves;
 * callers must check a Home chat's thread assignment separately. Ordinary threads belong to
 * their project's Space. Fails closed when the project cannot be resolved.
 */
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

/**
 * Where selecting a Space should go. `empty` is a real destination, not a failure: a Space with
 * nothing in it still has to be *entered*, and routing it through the generic "/" restore without
 * saying which Space was chosen is what let the previous Space's remembered thread win.
 */
export type SpaceSelectionTarget =
  | { readonly kind: "thread"; readonly threadId: ThreadId }
  | { readonly kind: "project"; readonly projectId: ProjectId }
  | { readonly kind: "empty"; readonly spaceId: SpaceId | null };

/**
 * Landing policy for a Space switch: the Space's remembered thread, else its remembered project
 * board, else its most recent thread, else the Space itself (empty).
 */
export function resolveSpaceSelectionTarget(input: {
  spaceId: SpaceId | null;
  /** Space-assignable projects only; the containers are filtered out by `isProjectInSpace`. */
  projects: readonly Project[];
  projectById: ReadonlyMap<ProjectId, Project>;
  threads: readonly SidebarThreadSummary[];
  rememberedThreadId: ThreadId | null;
  rememberedProjectId: ProjectId | null;
  paths: ServerWorkspacePaths;
  /** Injected so this stays a domain helper instead of importing sidebar presentation. */
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
