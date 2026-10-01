import { resolveProviderModelSelection } from "~/lib/providerModelSelection";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import { useCallback } from "react";
import {
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ProjectId } from "@glade/contracts/core/baseSchemas";
import { pluralize } from "@glade/shared/text/text";
import { newCommandId, newProjectId } from "../lib/utils";
import { expandProjectHomePath, joinProjectPath } from "../lib/projectPaths";
import { deleteProjectFromClient } from "../lib/projectDelete";
import { shortcutLabelForCommand, spaceJumpCommandForIndex } from "../keybindings";
import { readNativeApi } from "../nativeApi";
import { toastManager } from "./ui/toast";
import {
  findWorkspaceRootMatch,
  runExclusiveProjectAddition,
  runProjectProvisionWithCancellationRecovery,
} from "./Sidebar.logic.status";
import {
  type CreateProjectSubmitOptions,
  type CreateProjectSubmitValue,
} from "./CreateProjectDialog";
import { useSpacesController } from "./useSpacesController";
import type { useSidebarThreadCommands } from "./useSidebarThreadCommands";
import { ProjectContextMenuId } from "./sidebarSupport";

export function useSidebarProjectCommands(context: ReturnType<typeof useSidebarThreadCommands>) {
  const {
    projects,
    activeSpaceId,
    syncServerShellSnapshot,
    removeDeletedProjectFromClientState,
    homeDir,
    appSettings,
    routeThreadId,
    keybindings,
    projectAdditionLockRef,
    setEditProjectDialog,
    setRelocateProjectDialogId,
    setProjectContextMenuState,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    sidebarThreads,
    projectById,
    archiveAllThreadsInProject,
    deleteProjectThreads,
    openProjectRunDialog,
    handleStopProjectRun,
    handleOpenProjectRunServer,
    activeRouteProjectId,
    toggleProjectPinned,
    openExistingProjectFromSnapshot,
    waitForProjectInSnapshot,
    waitForCancelledGitHubProjectInSnapshot,
    addProjectFromPath,
    copyPathToClipboard,
    activateThreadFromSidebarIntent,
    handleCloseProjectContextMenu,
  } = context;
  const reorderProjects = useStore((state) => state.reorderProjects);
  const clearProjectDraftThreads = useComposerDraftStore((state) => state.clearProjectDraftThreads);

  const {
    activeSpace,
    voidSpace,
    spaceEditorOpen,
    spaceEditorMode,
    spaceEditorInitialValue,
    spaceEditorExistingNames,
    spaceProjectPickerTarget,
    openSpaceCreator,
    openSpaceEditor,
    openVoidEditor,
    closeSpaceEditor,
    openSpaceProjectPicker,
    closeSpaceProjectPicker,
    handleSelectSpace,
    handleSelectSpaceForIncomingProject,
    handleReorderSpaces,
    handleRenameSpace,
    handleRenameVoid,
    resetVoidSpace,
    handleDeleteSpace,
    handleMoveProjectToSpace,
    handleSpaceEditorSubmit,
    handleBulkMoveProjects,
  } = useSpacesController({
    routeThreadId,
    activeRouteProjectId,
    activateThreadFromSidebarIntent,
    onCloseProjectContextMenu: handleCloseProjectContextMenu,
  });

  const handleCreateProjectSubmit = async (
    value: CreateProjectSubmitValue,
    options: CreateProjectSubmitOptions,
  ) => {
    const previousSpaceId = activeSpaceId;
    const existingProject =
      value.source === "local"
        ? findWorkspaceRootMatch(projects, value.workspaceRoot, (project) => project.cwd)
        : null;

    const destinationSpaceId = existingProject ? (existingProject.spaceId ?? null) : value.spaceId;
    const runCreateProject = async () => {
      if (value.source === "github") {
        const api = readNativeApi();
        if (!api) throw new Error("The app server is unavailable.");
        await runExclusiveProjectAddition(projectAdditionLockRef, async () => {
          const openProvisionedProject = async (
            projectId: ProjectId,
            workspaceRoot: string | undefined,
            waitForProject: typeof waitForProjectInSnapshot,
          ) => {
            const { project, snapshot } = await waitForProject(api, projectId, workspaceRoot);
            if (snapshot) {
              syncServerShellSnapshot(snapshot);
            }
            if (!project || !snapshot) return false;

            handleSelectSpaceForIncomingProject(project.spaceId ?? null);
            return openExistingProjectFromSnapshot(project.id, snapshot);
          };
          const requestedProjectId = newProjectId();
          const requestedWorkspaceRoot = joinProjectPath(
            expandProjectHomePath(value.destinationParent, homeDir),
            value.directoryName,
          );
          const provision = await runProjectProvisionWithCancellationRecovery({
            signal: options.signal,
            provision: async () =>
              api.projects.provisionFromGitHub(
                {
                  operationId: value.operationId,
                  repository: value.repository,
                  destinationParent: value.destinationParent,
                  directoryName: value.directoryName,
                  commandId: newCommandId(),
                  projectId: requestedProjectId,
                  newProjectSpaceId: value.spaceId,
                  defaultModelSelection: await resolveProviderModelSelection({
                    api,
                    selection: { provider: "codex", model: "" },
                  }),
                  createdAt: new Date().toISOString(),
                },
                { signal: options.signal },
              ),
            // Cancellation can race the server's project.create commit. If that commit won, recover the durable
            // project and report success instead of telling the user a registered project was cancelled.
            recoverCommittedProject: () =>
              openProvisionedProject(
                requestedProjectId,
                requestedWorkspaceRoot,
                waitForCancelledGitHubProjectInSnapshot,
              ),
          });
          if (provision.status === "recovered") return;
          if (
            !(await openProvisionedProject(
              provision.result.projectId,
              undefined,
              waitForProjectInSnapshot,
            ))
          ) {
            throw new Error(
              "The GitHub project was added, but it has not synced into the sidebar yet. Try again in a moment.",
            );
          }
        });
      } else {
        handleSelectSpaceForIncomingProject(destinationSpaceId);
        await addProjectFromPath(value.workspaceRoot, {
          createIfMissing: value.createIfMissing,
          spaceId: value.spaceId,
        });
      }
    };

    try {
      await runCreateProject();
    } catch (error) {
      // Project creation is one UI transaction: a failed command must not strand the sidebar in a Space
      // unrelated to the current route.
      handleSelectSpaceForIncomingProject(previousSpaceId);
      throw error;
    }
  };

  const jumpShortcutLabelForSpaceTab = (tabIndex: number) => {
    const command = spaceJumpCommandForIndex(tabIndex);
    if (!command) return null;
    return shortcutLabelForCommand(keybindings, command, { platform: navigator.platform });
  };

  const handleProjectContextMenuAction = async (
    projectId: ProjectId,
    clicked: ProjectContextMenuId,
  ) => {
    setProjectContextMenuState(null);
    const api = readNativeApi();
    if (!api) return;
    const project = projectById.get(projectId);
    if (!project) return;

    if (clicked === "open-in-finder") {
      try {
        await api.shell.showInFolder(project.cwd);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Unable to open in Finder",
          description:
            error instanceof Error
              ? error.message
              : "An unknown error occurred opening the folder.",
        });
      }
      return;
    }
    if (clicked === "copy-path") {
      copyPathToClipboard(project.cwd);
      return;
    }
    if (clicked === "start-dev") {
      openProjectRunDialog(projectId);
      return;
    }
    if (clicked === "stop-dev") {
      await handleStopProjectRun(projectId);
      return;
    }
    if (clicked === "open-dev-server") {
      await handleOpenProjectRunServer(projectId);
      return;
    }
    if (clicked === "relocate") {
      setRelocateProjectDialogId(projectId);
      return;
    }
    if (clicked === "rename") {
      setEditProjectDialog({ projectId, open: true });
      return;
    }
    if (clicked === "toggle-pin") {
      toggleProjectPinned(projectId);
      return;
    }
    if (clicked === "archive-threads") {
      await archiveAllThreadsInProject(projectId);
      return;
    }
    if (clicked === "delete-threads") {
      await deleteProjectThreads(projectId);
      return;
    }
    if (clicked !== "delete") return;

    const projectThreads = sidebarThreads.filter((thread) => thread.projectId === projectId);
    const confirmed = await api.dialogs.confirm(
      projectThreads.length > 0
        ? [
            `Remove project "${project.name}"?`,
            `This will delete ${projectThreads.length} ${pluralize(projectThreads.length, "thread")} in this folder and remove the project.`,
            "Their Codex or Claude session history will also be deleted.",
          ].join("\n")
        : `Remove project "${project.name}"?`,
    );
    if (!confirmed) return;

    const runRemoveProject = async () => {
      const deletionResult = await deleteProjectThreads(projectId, {
        confirmMessage: null,
        showEmptyToast: false,
        showResultToast: false,
        worktreeCleanupMode: "skip",
      });
      if (deletionResult === null) {
        return;
      }
      if (deletionResult.failureCount > 0) {
        toastManager.add({
          type: "error",
          title: `Failed to remove "${project.name}"`,
          description: `Could not delete ${deletionResult.failureCount} ${pluralize(deletionResult.failureCount, "thread")} in "${project.name}".`,
        });
        return;
      }

      await deleteProjectFromClient({
        api: api.orchestration,
        projectId,
        removeDeletedProjectFromClientState,
      });
      clearProjectDraftThreads(projectId);
      toastManager.add({
        type: "success",
        title: `Removed "${project.name}"`,
        description:
          deletionResult.deletedCount > 0
            ? `Deleted ${deletionResult.deletedCount} ${pluralize(deletionResult.deletedCount, "thread")} and removed the project.`
            : "Project removed.",
      });
    };

    try {
      await runRemoveProject();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error removing project.";
      console.error("Failed to remove project", { projectId, error });
      toastManager.add({
        type: "error",
        title: `Failed to remove "${project.name}"`,
        description: message,
      });
    }
  };

  const handleProjectContextMenu = (projectId: ProjectId, position: { x: number; y: number }) => {
    if (!readNativeApi()) return;
    if (!projectById.has(projectId)) return;
    setProjectContextMenuState({ projectId, position });
  };

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (appSettings.sidebarProjectSortOrder !== "manual") {
        dragInProgressRef.current = false;
        return;
      }
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = projects.find((project) => project.id === active.id);
      const overProject = projects.find((project) => project.id === over.id);
      if (!activeProject || !overProject) return;
      reorderProjects(activeProject.id, overProject.id);
    },
    [appSettings.sidebarProjectSortOrder, projects, reorderProjects, dragInProgressRef],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (appSettings.sidebarProjectSortOrder !== "manual") {
        return;
      }
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [appSettings.sidebarProjectSortOrder, suppressProjectClickAfterDragRef, dragInProgressRef],
  );

  const handleProjectDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      dragInProgressRef.current = false;
    },
    [dragInProgressRef],
  );
  return {
    ...context,
    activeSpace,
    voidSpace,
    spaceEditorOpen,
    spaceEditorMode,
    spaceEditorInitialValue,
    spaceEditorExistingNames,
    spaceProjectPickerTarget,
    openSpaceCreator,
    openSpaceEditor,
    openVoidEditor,
    closeSpaceEditor,
    openSpaceProjectPicker,
    closeSpaceProjectPicker,
    handleSelectSpace,
    handleReorderSpaces,
    handleRenameSpace,
    handleRenameVoid,
    resetVoidSpace,
    handleDeleteSpace,
    handleMoveProjectToSpace,
    handleSpaceEditorSubmit,
    handleBulkMoveProjects,
    handleCreateProjectSubmit,
    jumpShortcutLabelForSpaceTab,
    handleProjectContextMenuAction,
    handleProjectContextMenu,
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragEnd,
    handleProjectDragStart,
    handleProjectDragCancel,
  };
}
