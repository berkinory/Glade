import type { ProjectId, SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";

import { resolveRestorableThreadRoute, type LastThreadRoute } from "../chatRouteRestore";
import type { ServerWorkspacePaths } from "../lib/serverWorkspacePaths";
import { isThreadReachableFromSpace } from "../lib/spaceNavigation";
import { isHomeChatContainerProject } from "../lib/chatProjects";
import type { Project } from "../types";

export interface ChatIndexLandingSpace {
  readonly spaceId: SpaceId | null;
  readonly chatSpaceByThreadId: Readonly<Record<string, SpaceId>>;
  readonly projectById: ReadonlyMap<ProjectId, Project>;
  readonly workspacePaths: ServerWorkspacePaths;
}

export function resolveChatIndexRestoreRoute(input: {
  readonly lastThreadRoute: LastThreadRoute | null;
  readonly threadIds: readonly ThreadId[];
  readonly sidebarThreadSummaryById: Readonly<
    Record<
      string,
      | {
          readonly projectId: ProjectId;
        }
      | undefined
    >
  >;

  readonly draftProjectIdByThreadId: ReadonlyMap<string, ProjectId>;
  readonly landingSpace: ChatIndexLandingSpace | null;
}): LastThreadRoute | null {
  const { draftProjectIdByThreadId, landingSpace, sidebarThreadSummaryById } = input;

  const availableThreadIds = new Set<string>();
  for (const threadId of [...input.threadIds, ...draftProjectIdByThreadId.keys()]) {
    // Fail closed: a thread we can't classify is not restorable from "/". Summaries are built from the
    // same snapshot as threadIds, so this only ever excludes a thread if that invariant breaks — and
    // then a fresh draft beats restoring into the wrong segment.
    const threadSummary = sidebarThreadSummaryById[threadId];
    const projectId = threadSummary?.projectId ?? draftProjectIdByThreadId.get(threadId);
    if (projectId === undefined) continue;
    if (
      landingSpace &&
      isHomeChatContainerProject(
        landingSpace.projectById.get(projectId),
        landingSpace.workspacePaths,
      ) &&
      (landingSpace.chatSpaceByThreadId[threadId] ?? null) !== landingSpace.spaceId
    ) {
      continue;
    }
    if (
      landingSpace &&
      !isThreadReachableFromSpace({
        project: landingSpace.projectById.get(projectId),
        spaceId: landingSpace.spaceId,
        paths: landingSpace.workspacePaths,
      })
    ) {
      continue;
    }
    availableThreadIds.add(threadId);
  }

  return resolveRestorableThreadRoute({
    lastThreadRoute: input.lastThreadRoute,
    availableThreadIds,
  });
}
