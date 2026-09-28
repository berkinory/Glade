// FILE: _chat.index.tsx
// Purpose: Restores the last chat route on app launch, falling back to a fresh home-chat draft.
//          Also the landing for a Space that has nothing to open.
// Layer: Routing
// Depends on: the shared restore/create route surface plus the home-chat new-chat handler.

import { SpaceId, type ProjectId } from "@glade/contracts";
import { createFileRoute } from "@tanstack/react-router";

import {
  RestoreOrCreateChatRoute,
  type RestoreRouteResolver,
} from "../components/RestoreOrCreateChatRoute";
import { readSidebarUiState } from "../components/Sidebar.uiState";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewChat } from "../hooks/useHandleNewChat";
import { isHomeChatContainerProject } from "../lib/chatProjects";
import { VOID_SPACE_KEY } from "../lib/spaceGrouping";
import { resolveSplitViewThreadIds, useSplitViewStore } from "../splitViewStore";
import { EMPTY_THREAD_IDS, useStore } from "../store";
import { useSpacesUiStore } from "../spacesUiStore";
import { useWorkspacePathsStore } from "../workspacePathsStore";
import { resolveChatIndexRestoreRoute, type ChatIndexLandingSpace } from "./-chatIndexRoute.logic";

/**
 * Set by the Space switcher when the selected Space has nothing to open (`spaceKey`, so Void
 * survives as a string). It scopes the restore below to that Space — without it this landing
 * happily reopens the *previous* Space's thread, and the route-to-Space sync then writes that
 * Space back over the user's click.
 */
export interface ChatIndexSearch {
  readonly space?: string | undefined;
}

function ChatIndexRouteView() {
  const { handleNewChat } = useHandleNewChat();
  const landingSpaceKey = Route.useSearch({ select: (search) => search.space });
  const threadIds = useStore((state) => state.threadIds ?? EMPTY_THREAD_IDS);
  const projects = useStore((state) => state.projects);
  const sidebarThreadSummaryById = useStore((state) => state.sidebarThreadSummaryById);
  const draftThreadsByThreadId = useComposerDraftStore((state) => state.draftThreadsByThreadId);
  const homeDir = useWorkspacePathsStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspacePathsStore((state) => state.chatWorkspaceRoot);
  const createFreshChat = async () => {
    const result = await handleNewChat({ fresh: true, standalone: landingSpaceKey !== undefined });
    if (landingSpaceKey !== undefined && result.ok && result.threadId) {
      useSpacesUiStore
        .getState()
        .rememberDraftThread(
          landingSpaceKey === VOID_SPACE_KEY ? null : SpaceId.makeUnsafe(landingSpaceKey),
          result.threadId,
        );
    }
    return result;
  };

  const workspacePaths = { homeDir, chatWorkspaceRoot };
  // Only still-unsent drafts qualify as restore targets.
  const draftProjectIdByThreadId = new Map<string, ProjectId>();
  for (const [threadId, draft] of Object.entries(draftThreadsByThreadId)) {
    if (draft.promotedTo === undefined) {
      draftProjectIdByThreadId.set(threadId, draft.projectId);
    }
  }

  const landingSpace: ChatIndexLandingSpace | null =
    landingSpaceKey === undefined
      ? null
      : {
          spaceId: landingSpaceKey === VOID_SPACE_KEY ? null : SpaceId.makeUnsafe(landingSpaceKey),
          chatSpaceByThreadId: useSpacesUiStore.getState().chatSpaceByThreadId,
          projectById: new Map(projects.map((project) => [project.id, project])),
          workspacePaths,
        };

  const resolveRestoreRoute: RestoreRouteResolver = ({ availableSplitViewIds }) => {
    const rememberedDraftId = landingSpace
      ? useSpacesUiStore.getState().getLastDraftThreadId(landingSpace.spaceId)
      : null;
    const rememberedDraft = rememberedDraftId ? draftThreadsByThreadId[rememberedDraftId] : null;
    const rememberedDraftProject = rememberedDraft
      ? projects.find((project) => project.id === rememberedDraft.projectId)
      : null;
    const lastThreadRoute = landingSpace
      ? rememberedDraftId &&
        rememberedDraft &&
        !rememberedDraft.promotedTo &&
        rememberedDraftProject &&
        isHomeChatContainerProject(rememberedDraftProject, workspacePaths)
        ? { threadId: rememberedDraftId }
        : null
      : readSidebarUiState().lastThreadRoute;
    const rememberedSplitView = lastThreadRoute?.splitViewId
      ? useSplitViewStore.getState().splitViewsById[lastThreadRoute.splitViewId]
      : undefined;
    return resolveChatIndexRestoreRoute({
      lastThreadRoute,
      availableSplitViewIds,
      threadIds,
      sidebarThreadSummaryById,
      draftProjectIdByThreadId,
      rememberedSplitViewThreadIds: rememberedSplitView
        ? resolveSplitViewThreadIds(rememberedSplitView)
        : undefined,
      landingSpace,
    });
  };

  return (
    <RestoreOrCreateChatRoute
      resolveRestoreRoute={resolveRestoreRoute}
      createFreshChat={createFreshChat}
      recoverRememberedRoute={landingSpaceKey === undefined}
    />
  );
}

export const Route = createFileRoute("/_chat/")({
  validateSearch: (raw: Record<string, unknown>): ChatIndexSearch =>
    typeof raw.space === "string" && raw.space.length > 0 ? { space: raw.space } : {},
  component: ChatIndexRouteView,
});
