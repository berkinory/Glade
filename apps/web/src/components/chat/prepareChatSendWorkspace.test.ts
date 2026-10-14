import { CommandId, ProjectId } from "@glade/contracts/core/baseSchemas";
import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type { ClientOrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationShellSnapshot } from "@glade/contracts/orchestration/snapshots";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createAppStore } from "../../appStore";
import { useComposerDraftStore } from "../../composerDraftStore";
import { setActiveEnvironment } from "../../environments/activeEnvironment";
import {
  environmentOfProject,
  environmentOfThread,
  environmentStore,
  registerEnvironmentStore,
  unregisterEnvironmentStore,
} from "../../environments/environmentStores";
import "../../store";
import { REMOTE_STORE_SIDE_EFFECTS } from "../../storeSideEffects";
import { initialState } from "../../storeState";
import { makeProject, makeReadModelThread, makeThread } from "../../storeTestFixtures";
import { promoteThreadCreate } from "../../lib/threadCreatePromotion";
import { prepareChatSendWorkspace } from "./prepareChatSendWorkspace";

const remote = vi.hoisted(() => ({ api: null as NativeApi | null }));
vi.mock("../../environments/remoteEnvironments", () => ({
  remoteEnvironment: () => ({ api: { api: remote.api } }),
  remoteEnvironments: () => [],
}));

const key = "ssh:first-send";
afterEach(() => {
  unregisterEnvironmentStore(key);
  environmentStore("local")?.setState(initialState);
  setActiveEnvironment("local");
  vi.unstubAllGlobals();
});

it.each([null, "/shared/project"])(
  "keeps first-send project creation and draft ownership on SSH with workspace %s",
  async (selectedWorkspaceRoot) => {
    const home = makeProject({
      id: ProjectId.makeUnsafe("remote-home"),
      kind: "chat",
      cwd: "/remote/home",
      environmentKey: key,
    });
    const localProject = makeProject({ cwd: "/shared/project" });
    environmentStore("local")!.setState({ projects: [localProject] });
    const store = createAppStore({
      environmentKey: key,
      initialState: { ...initialState, projects: [home] },
      effects: REMOTE_STORE_SIDE_EFFECTS,
      onProjectUiStateChanged: () => undefined,
    });
    registerEnvironmentStore(key, store);
    setActiveEnvironment(key);
    const thread = makeThread({ projectId: home.id });
    const drafts = useComposerDraftStore.getState();
    drafts.setProjectDraftThreadId(home.id, thread.id);
    let snapshot: OrchestrationShellSnapshot = {
      snapshotSequence: 1,
      spaces: [],
      projects: [],
      threads: [],
      updatedAt: thread.createdAt,
    };
    const localDispatch = vi.fn(async () => ({ sequence: 1 }));
    const remoteDispatch = vi.fn(async (command: ClientOrchestrationCommand) => {
      if (command.type !== "project.create") throw new Error("Unexpected command");
      snapshot = {
        ...snapshot,
        projects: [
          ...snapshot.projects,
          {
            id: command.projectId,
            kind: command.kind ?? "project",
            title: command.title,
            workspaceRoot: command.workspaceRoot,
            defaultModelSelection: command.defaultModelSelection ?? null,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        ],
      };
      return { sequence: 1 };
    });
    const localOrchestration: Partial<NativeApi["orchestration"]> = {
      dispatchCommand: localDispatch,
      getShellSnapshot: async () => snapshot,
    };
    const remoteOrchestration: Partial<NativeApi["orchestration"]> = {
      dispatchCommand: remoteDispatch,
      getShellSnapshot: async () => snapshot,
    };
    const localApi = { orchestration: localOrchestration } as NativeApi;
    remote.api = { orchestration: remoteOrchestration } as NativeApi;
    vi.stubGlobal("window", { nativeApi: localApi });
    const setDraftThreadContext = vi.fn<typeof drafts.setDraftThreadContext>((id, context) => {
      expect(environmentOfProject(context.projectId!)).toBe(key);
      drafts.setDraftThreadContext(id, context);
    });
    const input = {
      activeThread: thread,
      activeProject: home,
      isServerThread: false,
      hasNativeUserMessages: false,
      composerImagesForSend: [],
      trimmedPromptForSend: "hello remote",
      composerFilesForSend: [],
      composerAssistantSelectionsForSend: [],
      sendableComposerTerminalContexts: [],
      composerFileCommentsForSend: [],
      sendableComposerPastedTexts: [],
      selectedModelSelectionForSend: thread.modelSelection,
      selectedModelForSend: thread.modelSelection.model,
      chatWorkspaceRoot: "/remote/chats",
      isHomeChatContainer: true,
      resolvedThreadWorktreePath: selectedWorkspaceRoot,
      runtimeModeForSend: thread.runtimeMode,
      envModeForSend: "local" as const,
      copyLocalChangesToWorktree: false,
      currentActiveGitBranch: null,
      isContainerLandingProject: true,
      clearProjectDraftThreadId: drafts.clearProjectDraftThreadId,
      setDraftThreadContext,
      activeRootBranch: null,
      gitBranchSourceCwd: null,
      setStoreThreadError: vi.fn(),
      queryClient: new QueryClient(),
    };
    const result = await prepareChatSendWorkspace(input);
    if (!result) throw new Error("First-send preparation failed");
    expect(result.api).toBe(remote.api);
    expect(localDispatch).not.toHaveBeenCalled();
    expect(remoteDispatch).toHaveBeenCalledOnce();
    expect(setDraftThreadContext).toHaveBeenCalledOnce();
    snapshot = {
      ...snapshot,
      snapshotSequence: 2,
      threads: [makeReadModelThread({ id: thread.id, projectId: result.targetProjectIdForSend })],
    };
    remoteDispatch.mockRejectedValueOnce(
      new Error(
        `Orchestration command invariant failed (thread.create): Thread '${thread.id}' already exists and cannot be created twice.`,
      ),
    );
    expect(
      await promoteThreadCreate(
        {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("retry-create"),
          threadId: thread.id,
          projectId: result.targetProjectIdForSend,
          title: result.title,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          branch: null,
          worktreePath: null,
          createdAt: thread.createdAt,
        },
        result.api,
      ),
    ).toBe("exists");
    expect(environmentOfThread(thread.id)).toBe(key);
    expect(environmentStore("local")!.getState().projects).toEqual([localProject]);
  },
);
