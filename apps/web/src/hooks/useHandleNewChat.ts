import { ensureHomeChatProject } from "../lib/chatProjects";
import { startContainerChat, type StartContainerChatResult } from "../lib/startContainerChat";
import { useWorkspacePathsStore } from "../workspacePathsStore";
import { useSpacesUiStore } from "../spacesUiStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewThread } from "./useHandleNewThread";

export function useHandleNewChat() {
  const homeDir = useWorkspacePathsStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspacePathsStore((state) => state.chatWorkspaceRoot);
  const { handleNewThread } = useHandleNewThread();

  const handleNewChat = async (options?: {
    fresh?: boolean;
    standalone?: boolean;
  }): Promise<StartContainerChatResult> => {
    if (!homeDir) {
      return {
        ok: false,
        error: "Home folder is not available yet.",
      };
    }

    const spaceId = useSpacesUiStore.getState().activeSpaceId;
    const result = await startContainerChat({
      ensureProjectId: () => ensureHomeChatProject({ homeDir, chatWorkspaceRoot }),
      handleNewThread: (projectId, threadOptions) => {
        const storedDraft = useComposerDraftStore
          .getState()
          .getDraftThreadByProjectId(projectId, "chat");
        const draftBelongsToAnotherSpace =
          storedDraft !== null &&
          useSpacesUiStore.getState().getChatThreadSpaceId(storedDraft.threadId) !== spaceId;
        return handleNewThread(projectId, {
          ...threadOptions,
          ...(draftBelongsToAnotherSpace ? { fresh: true, standalone: true } : {}),
        });
      },
      fresh: options?.fresh,
      standalone: options?.standalone,
      errorLabel: "Unable to prepare a new chat.",
    });
    if (result.ok && result.threadId) {
      useSpacesUiStore.getState().assignChatThread(result.threadId, spaceId);
    }
    return result;
  };

  return { handleNewChat };
}
