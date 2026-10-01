import { useCallback } from "react";
import { useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { useEffect, startTransition } from "react";
import { MAX_PINNED_PROJECTS } from "@glade/contracts/orchestration/threadEntities";
import { type OrchestrationShellSnapshot } from "@glade/contracts/orchestration/snapshots";
import { ProjectId, SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { newCommandId } from "../lib/utils";
import { isSidebarThreadVisible } from "../storeSelectors";
import {
  resolveCurrentProjectTargetId,
  resolveLatestProjectTargetIdWithFallback,
  resolveNewThreadTarget,
} from "../lib/projectShortcutTargets";
import { prefetchModelsForNewThread } from "../lib/providerModelPrefetch";
import { hasReconciledServerProviderStatuses } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { isHomeChatContainerProject, prewarmHomeChatProject } from "../lib/chatProjects";
import { useProjectPreferencesStore } from "../projectPreferencesStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { type SidebarThreadSummary } from "../types";
import { toastManager } from "./ui/toast";
import { useSidebarStateStore } from "../sidebarStateStore";
import {
  findWorkspaceRootMatch,
  recoverExistingAddProjectTarget,
  runExclusiveProjectAddition,
} from "./Sidebar.logic.status";
import { resolveSettingsBackTarget, type SettingsBackTarget } from "./Sidebar.logic.statusTypes";
import { sortThreadsForSidebar } from "./Sidebar.logic.projectData";
import { isLatestPinMutation, reconcileOptimisticPinState } from "../pinning.logic";
import { waitForRecoverableProjectInReadModel } from "../lib/projectCreateRecovery";
import {
  createOrRecoverProjectFromPath,
  PROJECT_CREATE_EXISTING_SYNC_ERROR,
} from "../lib/projectCreation";
import type { useSidebarShellState } from "./useSidebarShellState";
import {
  ADD_PROJECT_SNAPSHOT_CATCH_UP_MAX_ATTEMPTS,
  ADD_PROJECT_SNAPSHOT_CATCH_UP_DELAY_MS,
  GITHUB_CANCEL_RECOVERY_MAX_ATTEMPTS,
  GITHUB_CANCEL_RECOVERY_DELAY_MS,
} from "./sidebarSupport";

export function useSidebarProjectNavigation(context: ReturnType<typeof useSidebarShellState>) {
  const {
    projects,
    chatSpaceByThreadId,
    activeSpaceId,
    threadsHydrated,
    syncServerShellSnapshot,
    homeDir,
    chatWorkspaceRoot,
    navigate,
    queryClient,
    appSettings,
    serverSettings,
    handleNewThread,
    handleNewChat,
    serverCwd,
    providerStatuses,
    focusedProjectId,
    latestProjectId,
    setCreateProjectDialogOpen,
    projectAdditionLockRef,
    optimisticPinnedStateByProjectIdRef,
    latestPinnedMutationVersionByProjectIdRef,
    optimisticPinnedStateByProjectId,
    setOptimisticPinnedStateByProjectId,
    hideAutomationRunThreads,
    sidebarThreads,
    projectLastActivityAt,
    projectById,
    visibleSidebarActivityThreads,
    ordinarySpaceProjects,
    projectByIdRef,
  } = context;
  const draftThreadsByThreadId = useComposerDraftStore((state) => state.draftThreadsByThreadId);
  const splitViewsById = useSplitViewStore((state) => state.splitViewsById);

  const setProjectExpanded = useStore((state) => state.setProjectExpanded);

  const pinProjectLocally = useSidebarStateStore((state) => state.pinProject);
  const unpinProject = useSidebarStateStore((state) => state.unpinProject);

  const lastThreadRoute = useSidebarStateStore((state) => state.lastThreadRoute);

  const setOptimisticProjectPinned = (projectId: ProjectId, isPinned: boolean) => {
    optimisticPinnedStateByProjectIdRef.current.set(projectId, isPinned);
    setOptimisticPinnedStateByProjectId((current) => {
      if (current.get(projectId) === isPinned) {
        return current;
      }
      const next = new Map(current);
      next.set(projectId, isPinned);
      return next;
    });
  };

  const clearOptimisticProjectPinned = (projectId: ProjectId) => {
    optimisticPinnedStateByProjectIdRef.current.delete(projectId);
    setOptimisticPinnedStateByProjectId((current) => {
      if (!current.has(projectId)) {
        return current;
      }
      const next = new Map(current);
      next.delete(projectId);
      return next;
    });
  };

  const dispatchProjectPinnedState = async (projectId: ProjectId, isPinned: boolean) => {
    const api = readNativeApi();
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "project.meta.update",
      commandId: newCommandId(),
      projectId,
      isPinned,
    });
  };

  const setProjectPinned = async (projectId: ProjectId, isPinned: boolean) => {
    const api = readNativeApi();
    if (!api) return;
    const project = projectByIdRef.current.get(projectId);
    if (!project || project.kind !== "project") {
      return;
    }
    const requestVersion =
      (latestPinnedMutationVersionByProjectIdRef.current.get(projectId) ?? 0) + 1;
    latestPinnedMutationVersionByProjectIdRef.current.set(projectId, requestVersion);

    setOptimisticProjectPinned(projectId, isPinned);
    if (isPinned) {
      const accepted = pinProjectLocally(projectId);
      if (!accepted) {
        clearOptimisticProjectPinned(projectId);
        toastManager.add({
          type: "warning",
          title: "Project pin limit reached",
          description: `You can pin up to ${MAX_PINNED_PROJECTS} projects.`,
        });
        return;
      }
    } else {
      unpinProject(projectId);
    }

    try {
      await dispatchProjectPinnedState(projectId, isPinned);
    } catch (error) {
      if (
        !isLatestPinMutation({
          id: projectId,
          requestVersion,
          latestMutationVersionById: latestPinnedMutationVersionByProjectIdRef.current,
        })
      ) {
        return;
      }

      const confirmedPinned = projectByIdRef.current.get(projectId)?.isPinned === true;
      if (confirmedPinned) {
        pinProjectLocally(projectId);
      } else {
        unpinProject(projectId);
      }
      clearOptimisticProjectPinned(projectId);
      throw error;
    }
  };

  const toggleProjectPinned = (projectId: ProjectId) => {
    const optimisticPinned = optimisticPinnedStateByProjectIdRef.current.get(projectId);
    const locallyPinned = useSidebarStateStore.getState().pinnedProjectIds.includes(projectId);
    const serverPinned = projectByIdRef.current.get(projectId)?.isPinned === true;
    const isPinned = optimisticPinned ?? (locallyPinned || serverPinned);
    void setProjectPinned(projectId, !isPinned).catch((error) => {
      console.error("Failed to update pinned project state", {
        projectId,
        error,
      });
      toastManager.add({
        type: "error",
        title: isPinned ? "Unable to unpin project" : "Unable to pin project",
        description: error instanceof Error ? error.message : undefined,
      });
    });
  };

  useEffect(() => {
    if (optimisticPinnedStateByProjectId.size === 0) {
      return;
    }

    const serverPinnedStateByProjectId = new Map(
      projects.map((project) => [project.id, project.isPinned === true] as const),
    );

    const settle = window.setTimeout(() => {
      setOptimisticPinnedStateByProjectId((current) => {
        const reconciled = reconcileOptimisticPinState({
          optimisticPinnedStateById: current,
          serverPinnedStateById: serverPinnedStateByProjectId,
        });
        for (const projectId of reconciled.settledIds) {
          optimisticPinnedStateByProjectIdRef.current.delete(projectId);
        }
        return reconciled.optimisticPinnedStateById;
      });
    }, 0);
    return () => window.clearTimeout(settle);
  }, [
    optimisticPinnedStateByProjectId,
    projects,
    setOptimisticPinnedStateByProjectId,
    optimisticPinnedStateByProjectIdRef,
  ]);

  const focusMostRecentThreadForProject = (projectId: ProjectId) => {
    const latestThread = sortThreadsForSidebar(
      sidebarThreads.filter(
        (thread) =>
          thread.projectId === projectId &&
          isSidebarThreadVisible(thread, { hideAutomationRunThreads }),
      ),
      appSettings.sidebarThreadSortOrder,
    )[0];
    if (!latestThread) return;

    void navigate({
      to: "/$threadId",
      params: { threadId: latestThread.id },
    });
  };

  const openOrCreateProjectThreadFromSnapshot = async (
    projectId: ProjectId,
    snapshot: OrchestrationShellSnapshot,
  ): Promise<boolean> => {
    const latestThread = sortThreadsForSidebar(
      snapshot.threads
        .filter((thread) => thread.projectId === projectId && (thread.archivedAt ?? null) === null)
        .map((thread) => ({
          id: thread.id,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          latestUserMessageAt: thread.latestUserMessageAt,
        })),
      appSettings.sidebarThreadSortOrder,
    )[0];
    if (latestThread) {
      await navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
      return true;
    }

    return (await handleNewThread(projectId).catch(() => null)) !== null;
  };

  const openExistingProjectFromSnapshot = async (
    projectId: ProjectId,
    snapshot: OrchestrationShellSnapshot,
  ): Promise<boolean> => {
    const existingProject =
      snapshot.projects.find((candidate) => candidate.id === projectId) ?? null;
    if (!existingProject) {
      return false;
    }

    const latestThread = sortThreadsForSidebar(
      snapshot.threads
        .filter((thread) => thread.projectId === projectId && (thread.archivedAt ?? null) === null)
        .map((thread) => ({
          id: thread.id,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          latestUserMessageAt: thread.latestUserMessageAt,
        })),
      appSettings.sidebarThreadSortOrder,
    )[0];
    if (latestThread) {
      await navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
      return true;
    }

    setProjectExpanded(projectId, true);
    return (await handleNewThread(projectId).catch(() => null)) !== null;
  };

  const waitForProjectInSnapshot = async (
    api: NonNullable<ReturnType<typeof readNativeApi>>,
    projectId: ProjectId,
    workspaceRoot?: string,
  ): Promise<{
    project: OrchestrationShellSnapshot["projects"][number] | null;
    snapshot: OrchestrationShellSnapshot | null;
  }> =>
    waitForRecoverableProjectInReadModel({
      projectId,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
      maxAttempts: ADD_PROJECT_SNAPSHOT_CATCH_UP_MAX_ATTEMPTS,
      delayMs: ADD_PROJECT_SNAPSHOT_CATCH_UP_DELAY_MS,
    });

  const waitForCancelledGitHubProjectInSnapshot = async (
    api: NonNullable<ReturnType<typeof readNativeApi>>,
    projectId: ProjectId,
    workspaceRoot?: string,
  ): Promise<{
    project: OrchestrationShellSnapshot["projects"][number] | null;
    snapshot: OrchestrationShellSnapshot | null;
  }> =>
    waitForRecoverableProjectInReadModel({
      projectId,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
      maxAttempts: GITHUB_CANCEL_RECOVERY_MAX_ATTEMPTS,
      delayMs: GITHUB_CANCEL_RECOVERY_DELAY_MS,
    });

  const waitForProjectWorkspaceRootInSnapshot = async (
    api: NonNullable<ReturnType<typeof readNativeApi>>,
    workspaceRoot: string,
  ): Promise<{
    project: OrchestrationShellSnapshot["projects"][number] | null;
    snapshot: OrchestrationShellSnapshot | null;
  }> =>
    waitForRecoverableProjectInReadModel({
      workspaceRoot,
      loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
      maxAttempts: ADD_PROJECT_SNAPSHOT_CATCH_UP_MAX_ATTEMPTS,
      delayMs: ADD_PROJECT_SNAPSHOT_CATCH_UP_DELAY_MS,
    });

  const recoverExistingProjectFromServer = async (
    api: NonNullable<ReturnType<typeof readNativeApi>>,
    projectId: ProjectId,
  ): Promise<boolean> => {
    const { project, snapshot } = await waitForProjectInSnapshot(api, projectId);
    if (snapshot) {
      syncServerShellSnapshot(snapshot);
    }
    if (!project || !snapshot) {
      return false;
    }

    return openExistingProjectFromSnapshot(project.id, snapshot);
  };

  const recoverExistingProjectByWorkspaceRootFromServer = async (
    api: NonNullable<ReturnType<typeof readNativeApi>>,
    workspaceRoot: string,
  ): Promise<boolean> => {
    const { project, snapshot } = await waitForProjectWorkspaceRootInSnapshot(api, workspaceRoot);
    if (snapshot) {
      syncServerShellSnapshot(snapshot);
    }
    if (!project || !snapshot) {
      return false;
    }

    return openExistingProjectFromSnapshot(project.id, snapshot);
  };

  const handleOpenProjectFromSearch = (projectId: string) => {
    const typedProjectId = ProjectId.makeUnsafe(projectId);

    const hasProjectThread = sidebarThreads.some(
      (thread) =>
        thread.projectId === typedProjectId &&
        isSidebarThreadVisible(thread, { hideAutomationRunThreads }),
    );
    if (hasProjectThread) {
      focusMostRecentThreadForProject(typedProjectId);
      return;
    }

    void handleNewThread(typedProjectId);
  };

  const resolveBackTargetForThreads = (
    threads: readonly SidebarThreadSummary[],
    extraAvailableThreadIds?: ReadonlySet<string>,
  ) => {
    const latestThread =
      sortThreadsForSidebar(threads, appSettings.sidebarThreadSortOrder)[0] ?? null;
    const availableThreadIds = new Set<string>(threads.map((thread) => thread.id));
    if (extraAvailableThreadIds) {
      for (const threadId of extraAvailableThreadIds) {
        availableThreadIds.add(threadId);
      }
    }
    return resolveSettingsBackTarget({
      lastThreadRoute,
      availableThreadIds,
      availableSplitViewIds: new Set(
        Object.keys(splitViewsById).filter((splitViewId) => splitViewsById[splitViewId]),
      ),
      latestThreadId: latestThread?.id ?? null,
    });
  };

  const draftThreadIds = (() => {
    const draftThreadIds = new Set<string>();
    for (const [threadId, draft] of Object.entries(draftThreadsByThreadId)) {
      const project = projectById.get(draft.projectId);
      if (
        !isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot }) ||
        (chatSpaceByThreadId[threadId] ?? null) === activeSpaceId
      ) {
        draftThreadIds.add(threadId);
      }
    }
    return draftThreadIds;
  })();

  const resolveBackToThreadsTarget = () =>
    resolveBackTargetForThreads(visibleSidebarActivityThreads, draftThreadIds);

  const navigateToBackTarget = (target: SettingsBackTarget) => {
    if (target.kind !== "thread") {
      return false;
    }

    startTransition(() => {
      void navigate({
        to: "/$threadId",
        params: { threadId: ThreadId.makeUnsafe(target.threadId) },
        search: () => ({
          splitViewId: target.splitViewId,
        }),
      });
    });
    return true;
  };

  const handleBackToAppFromSettings = () => {
    const target = resolveBackToThreadsTarget();

    if (navigateToBackTarget(target)) {
      return;
    }

    void navigate({ to: "/" });
  };

  const handleBackToThreads = () => {
    if (navigateToBackTarget(resolveBackToThreadsTarget())) {
      return;
    }

    void handleNewChat();
  };

  useEffect(() => {
    if (!threadsHydrated || !homeDir) {
      return;
    }
    prewarmHomeChatProject({ homeDir, chatWorkspaceRoot });
  }, [chatWorkspaceRoot, homeDir, threadsHydrated]);

  const handleCreateHomeChat = async () => {
    await handleNewChat();
  };

  const addProjectFromPath = async (
    rawCwd: string,
    options: { createIfMissing?: boolean; spaceId?: SpaceId | null } = {},
  ) => {
    const cwd = rawCwd.trim();
    if (!cwd) {
      throw new Error("Project folder path is empty.");
    }
    const api = readNativeApi();
    if (!api) {
      throw new Error("The app server is unavailable.");
    }

    const runAddProject = async () => {
      const existing = findWorkspaceRootMatch(projects, cwd, (project) => project.cwd);
      const existingRecovery = await recoverExistingAddProjectTarget({
        existingProjectId: existing?.id,
        workspaceRoot: cwd,
        recoverByProjectId: (projectId) => recoverExistingProjectFromServer(api, projectId),
        recoverByWorkspaceRoot: (workspaceRoot) =>
          recoverExistingProjectByWorkspaceRootFromServer(api, workspaceRoot),
      });
      if (existingRecovery === "recovered") {
        return;
      }
      if (existing) {
      }

      const creationResult = await createOrRecoverProjectFromPath({
        api,
        workspaceRoot: cwd,
        ...(options.createIfMissing === undefined
          ? {}
          : { createIfMissing: options.createIfMissing }),
        ...(options.spaceId === undefined ? {} : { spaceId: options.spaceId }),
        defaultProvider: appSettings.defaultProvider,
        loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
        maxAttempts: ADD_PROJECT_SNAPSHOT_CATCH_UP_MAX_ATTEMPTS,
        delayMs: ADD_PROJECT_SNAPSHOT_CATCH_UP_DELAY_MS,
      });
      if (creationResult.snapshot) {
        syncServerShellSnapshot(creationResult.snapshot);
      }
      if (creationResult.project && creationResult.snapshot) {
        const recovered = creationResult.created
          ? await openOrCreateProjectThreadFromSnapshot(
              creationResult.project.id,
              creationResult.snapshot,
            )
          : await openExistingProjectFromSnapshot(
              creationResult.project.id,
              creationResult.snapshot,
            );
        if (recovered) {
          return;
        }
        if (creationResult.created) {
          throw new Error("Project creation was superseded before its chat opened.");
        }
      }

      if (!creationResult.created) {
        const recovered = await recoverExistingProjectFromServer(api, creationResult.projectId);
        if (recovered) {
          return;
        }
        throw new Error(PROJECT_CREATE_EXISTING_SYNC_ERROR);
      }

      setProjectExpanded(creationResult.projectId, true);
      const threadId = await handleNewThread(creationResult.projectId).catch(() => null);
      if (!threadId) {
        throw new Error("Project creation was superseded before its chat opened.");
      }
    };

    await runExclusiveProjectAddition(projectAdditionLockRef, runAddProject);
  };

  const handleStartAddProject = () => {
    setCreateProjectDialogOpen(true);
  };

  const activeSpaceProjects = ordinarySpaceProjects.filter(
    (project) => (project.spaceId ?? null) === activeSpaceId,
  );

  const currentProjectShortcutTargetId = resolveCurrentProjectTargetId(
    activeSpaceProjects,
    focusedProjectId,
  );

  const latestUsableProjectId = resolveLatestProjectTargetIdWithFallback(
    activeSpaceProjects,
    latestProjectId,
    projectLastActivityAt,
  );

  const primaryNewThreadTarget = resolveNewThreadTarget({
    currentProjectId: currentProjectShortcutTargetId,
    latestUsableProjectId,
  });

  const prefetchModelsForProjectNewThread = useCallback(
    (projectId: ProjectId) => {
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) {
        return;
      }

      const draftStore = useComposerDraftStore.getState();
      const draftThread = draftStore.getDraftThreadByProjectId(projectId);
      const draftComposer = draftThread
        ? (draftStore.draftsByThreadId[draftThread.threadId] ?? null)
        : null;
      prefetchModelsForNewThread(queryClient, {
        settings: appSettings,
        serverSettings: serverSettings ?? null,
        hiddenProviders: appSettings.hiddenProviders,
        draftActiveProvider: draftComposer?.activeProvider ?? null,
        stickyActiveProvider: draftStore.stickyActiveProvider,
        projectDefaultProvider: project.defaultModelSelection?.provider ?? null,
        projectCwd: project.cwd,
        draftWorktreePath: draftThread?.worktreePath ?? null,
        serverCwd,

        envMode:
          draftThread?.envMode ??
          useProjectPreferencesStore.getState().envModeByProjectId[projectId] ??
          appSettings.defaultThreadEnvMode,
        providerStatuses,
        statusesReconciled: hasReconciledServerProviderStatuses(queryClient),
        providerOrder: appSettings.providerOrder,
      });
    },
    [appSettings, projects, providerStatuses, queryClient, serverCwd, serverSettings],
  );

  const prefetchModelsForPrimaryNewThread = () => {
    if (!primaryNewThreadTarget) {
      return;
    }
    prefetchModelsForProjectNewThread(primaryNewThreadTarget.projectId);
  };

  useEffect(() => {
    if (!primaryNewThreadTarget) {
      return;
    }
    prefetchModelsForProjectNewThread(primaryNewThreadTarget.projectId);
  }, [prefetchModelsForProjectNewThread, primaryNewThreadTarget]);

  const handlePrimaryNewThread = () => {
    if (primaryNewThreadTarget) {
      prefetchModelsForProjectNewThread(primaryNewThreadTarget.projectId);
      void handleNewThread(primaryNewThreadTarget.projectId);
      return;
    }

    if (!threadsHydrated) {
      return;
    }
    handleStartAddProject();
  };
  return {
    ...context,
    toggleProjectPinned,
    openExistingProjectFromSnapshot,
    waitForProjectInSnapshot,
    waitForCancelledGitHubProjectInSnapshot,
    handleOpenProjectFromSearch,
    handleBackToAppFromSettings,
    handleBackToThreads,
    handleCreateHomeChat,
    addProjectFromPath,
    handleStartAddProject,
    currentProjectShortcutTargetId,
    prefetchModelsForProjectNewThread,
    prefetchModelsForPrimaryNewThread,
    handlePrimaryNewThread,
  };
}
