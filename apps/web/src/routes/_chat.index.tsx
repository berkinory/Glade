import { SpaceId, type ProjectId } from "@glade/contracts/core/baseSchemas";
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
import { EMPTY_THREAD_IDS } from "../storeState";
import { useStore } from "../store";
import { useSpacesUiStore } from "../spacesUiStore";
import { useWorkspacePathsStore } from "../workspacePathsStore";
import { resolveChatIndexRestoreRoute, type ChatIndexLandingSpace } from "./-chatIndexRoute.logic";

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

  const resolveRestoreRoute: RestoreRouteResolver = () => {
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
    return resolveChatIndexRestoreRoute({
      lastThreadRoute,
      threadIds,
      sidebarThreadSummaryById,
      draftProjectIdByThreadId,
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
