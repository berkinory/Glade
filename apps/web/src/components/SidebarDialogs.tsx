import { firstLocalServerUrl } from "../hooks/useSidebarProjectRunController";
import { createClientPointMenuAnchor } from "~/lib/clientPointMenuAnchor";
import { useMemo } from "react";
import {
  AddPlusIcon,
  ArchiveIcon,
  CopyIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  KanbanIcon,
  PencilIcon,
  PinIcon,
  PlayIcon,
  StopFilledIcon,
  Trash2,
  XIcon,
} from "~/lib/icons";
import { pinActionLabel } from "~/lib/pin";
import { SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { EditProjectDialog } from "./EditProjectDialog";
import { RelocateProjectDialog } from "./RelocateProjectDialog";
import { RenameThreadDialog } from "./RenameThreadDialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
} from "./ui/menu";
import {
  ComposerPickerMenuPopup,
  ComposerPickerMenuSubPopup,
} from "./chat/ComposerPickerMenuPopup";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { SpaceEditorDialog } from "./SpaceEditorDialog";
import { SpaceIcon } from "./SpaceIcon";
import { SpaceProjectPickerDialog } from "./SpaceProjectPickerDialog";
import { VOID_SPACE_KEY, spaceDisplayIcon, spaceKey } from "../lib/spaceGrouping";
import {
  PROJECT_CONTEXT_MENU_PANEL_CLASS_NAME,
  PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME,
  PROJECT_CONTEXT_MENU_ICON_CLASS_NAME,
  ProjectContextMenuIcon,
} from "./sidebarSupport";
import { SidebarSearchPaletteController } from "./SidebarSearchPaletteController";
import type { useSidebarRows } from "./useSidebarRows";

export function SidebarDialogs({ context }: { context: ReturnType<typeof useSidebarRows> }) {
  const {
    githubProvisioningAvailable,
    spaces,
    activeSpaceId,
    sidebarThreadSummaryById,
    homeDir,
    navigate,
    createProjectDialogOpen,
    setCreateProjectDialogOpen,
    createProjectSpaceId,
    setCreateProjectSpaceId,
    searchPaletteOpen,
    setSearchPaletteOpen,
    openFeedbackDialog,
    searchPaletteMode,
    setSearchPaletteMode,
    renameDialogThreadId,
    setRenameDialogThreadId,
    editProjectDialog,
    setEditProjectDialog,
    setRelocateProjectDialogId,
    relocateProjectDialogId,
    projectContextMenuState,
    setProjectContextMenuState,
    projectRunDialogProjectId,
    projectRunDialogProject,
    projectRunDialogExistingRun,
    projectRunDialogCommandDraft,
    setProjectRunDialogCommandDraft,
    projectRunDialogCommandIsValid,
    closeProjectRunDialog,
    handleConfirmProjectRun,
    handleOpenProjectFromSearch,
    handleCreateHomeChat,
    addProjectFromPath,
    handlePrimaryNewThread,
    handleImportThread,
    commitRename,
    activateThreadFromSidebarIntent,
    voidSpace,
    spaceEditorOpen,
    spaceEditorMode,
    spaceEditorInitialValue,
    spaceEditorExistingNames,
    spaceProjectPickerTarget,
    openSpaceCreator,
    closeSpaceEditor,
    closeSpaceProjectPicker,
    handleMoveProjectToSpace,
    handleSpaceEditorSubmit,
    handleBulkMoveProjects,
    handleCreateProjectSubmit,
    handleProjectContextMenuAction,
    handleEditProjectSave,
    allStandardProjectsBase,
    searchPaletteProjects,
    searchPaletteActions,
    projectById,
    sidebarThreads,
    pinnedProjectIdSet,
    projectRunsByProjectId,
    projectRunServerByProjectId,
  } = context;
  const relocateProjectDialogProject = relocateProjectDialogId
    ? (projectById.get(relocateProjectDialogId) ?? null)
    : null;

  const editProjectDialogProject = editProjectDialog
    ? (projectById.get(editProjectDialog.projectId) ?? null)
    : null;

  const projectContextMenuProject = projectContextMenuState
    ? (projectById.get(projectContextMenuState.projectId) ?? null)
    : null;

  const projectContextMenuThreads = useMemo(
    () =>
      projectContextMenuState
        ? sidebarThreads.filter((thread) => thread.projectId === projectContextMenuState.projectId)
        : [],
    [projectContextMenuState, sidebarThreads],
  );

  const projectContextMenuAnchor = useMemo(
    () =>
      projectContextMenuState
        ? createClientPointMenuAnchor(projectContextMenuState.position)
        : null,
    [projectContextMenuState],
  );

  const projectContextMenuHasAnyThreads = projectContextMenuThreads.length > 0;

  const projectContextMenuHasArchivableThreads = projectContextMenuThreads.some(
    (thread) => thread.archivedAt == null,
  );

  const projectContextMenuIsPinned = projectContextMenuProject
    ? pinnedProjectIdSet.has(projectContextMenuProject.id)
    : false;

  const projectContextMenuIsRunning = projectContextMenuProject
    ? Boolean(projectRunsByProjectId[projectContextMenuProject.id])
    : false;

  const projectContextMenuServer = projectContextMenuProject
    ? (projectRunServerByProjectId.get(projectContextMenuProject.id) ?? null)
    : null;

  const projectContextMenuHasOpenServer =
    projectContextMenuServer !== null && firstLocalServerUrl(projectContextMenuServer) !== null;
  return (
    <>
      <CreateProjectDialog
        open={createProjectDialogOpen}
        githubProvisioningAvailable={githubProvisioningAvailable}
        spaces={spaces}
        activeSpaceId={createProjectSpaceId === undefined ? activeSpaceId : createProjectSpaceId}
        defaultCloneParent={homeDir ?? "~"}
        onOpenChange={(open) => {
          setCreateProjectDialogOpen(open);
          if (!open) setCreateProjectSpaceId(undefined);
        }}
        onSubmit={handleCreateProjectSubmit}
      />

      <SpaceEditorDialog
        open={spaceEditorOpen}
        mode={spaceEditorMode}
        {...(spaceEditorInitialValue ? { initialValue: spaceEditorInitialValue } : {})}
        existingNames={spaceEditorExistingNames}
        onOpenChange={(open) => {
          if (!open) closeSpaceEditor();
        }}
        onSubmit={handleSpaceEditorSubmit}
      />

      <SpaceProjectPickerDialog
        open={spaceProjectPickerTarget !== null}
        targetSpace={spaceProjectPickerTarget}
        projects={allStandardProjectsBase}
        spaces={spaces}
        onOpenChange={(open) => {
          if (!open) closeSpaceProjectPicker();
        }}
        onSubmit={(projectIds) => {
          if (!spaceProjectPickerTarget) return;
          return handleBulkMoveProjects(projectIds, spaceProjectPickerTarget.id);
        }}
      />

      {projectContextMenuState && projectContextMenuProject && projectContextMenuAnchor ? (
        <Menu
          keepOpenOnSubmenuInteraction
          open
          onOpenChange={(open) => {
            if (!open) {
              setProjectContextMenuState(null);
            }
          }}
        >
          <ComposerPickerMenuPopup
            anchor={projectContextMenuAnchor}
            align="start"
            side="bottom"
            sideOffset={0}
            className={PROJECT_CONTEXT_MENU_PANEL_CLASS_NAME}
          >
            <MenuGroup>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() =>
                  void handleProjectContextMenuAction(
                    projectContextMenuState.projectId,
                    "open-in-finder",
                  )
                }
              >
                <span className={PROJECT_CONTEXT_MENU_ICON_CLASS_NAME}>
                  <img src="/finder.png" alt="" className="size-3.5 object-contain" />
                </span>
                <span>Open in Finder</span>
              </MenuItem>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() =>
                  void handleProjectContextMenuAction(
                    projectContextMenuState.projectId,
                    "open-in-kanban",
                  )
                }
              >
                <ProjectContextMenuIcon icon={KanbanIcon} />
                <span>Open in Kanban</span>
              </MenuItem>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() =>
                  void handleProjectContextMenuAction(
                    projectContextMenuState.projectId,
                    "copy-path",
                  )
                }
              >
                <ProjectContextMenuIcon icon={CopyIcon} />
                <span>Copy Path</span>
              </MenuItem>
              <MenuSeparator />
              {projectContextMenuIsRunning ? (
                <MenuItem
                  className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                  onClick={() =>
                    void handleProjectContextMenuAction(
                      projectContextMenuState.projectId,
                      "stop-dev",
                    )
                  }
                >
                  <ProjectContextMenuIcon icon={StopFilledIcon} />
                  <span>Stop dev</span>
                </MenuItem>
              ) : (
                <MenuItem
                  className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                  onClick={() =>
                    void handleProjectContextMenuAction(
                      projectContextMenuState.projectId,
                      "start-dev",
                    )
                  }
                >
                  <ProjectContextMenuIcon icon={PlayIcon} />
                  <span>Start dev</span>
                </MenuItem>
              )}
              {projectContextMenuHasOpenServer ? (
                <MenuItem
                  className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                  onClick={() =>
                    void handleProjectContextMenuAction(
                      projectContextMenuState.projectId,
                      "open-dev-server",
                    )
                  }
                >
                  <ProjectContextMenuIcon icon={ExternalLinkIcon} />
                  <span>Open dev server</span>
                </MenuItem>
              ) : null}
              <MenuSub keepOpenOnFocusOut>
                <MenuSubTrigger className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}>
                  {}
                  <span className={PROJECT_CONTEXT_MENU_ICON_CLASS_NAME}>
                    <SpaceIcon
                      icon={spaceDisplayIcon(projectContextMenuProject.spaceId, spaces, voidSpace)}
                    />
                  </span>
                  <span>Move to space</span>
                </MenuSubTrigger>
                <ComposerPickerMenuSubPopup className="min-w-48">
                  <MenuRadioGroup
                    value={spaceKey(projectContextMenuProject.spaceId ?? null)}
                    onValueChange={(value) => {
                      void handleMoveProjectToSpace(
                        projectContextMenuProject.id,
                        value === VOID_SPACE_KEY ? null : SpaceId.makeUnsafe(value),
                      );
                    }}
                  >
                    <MenuRadioItem value={VOID_SPACE_KEY}>
                      <SpaceIcon icon={voidSpace.icon} className="size-3.5" />
                      <span className="min-w-0 truncate">{voidSpace.name}</span>
                    </MenuRadioItem>
                    {spaces.map((space) => (
                      <MenuRadioItem key={space.id} value={space.id}>
                        <SpaceIcon icon={space.icon} className="size-3.5" />
                        <span className="min-w-0 truncate">{space.name}</span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                  <MenuSeparator />
                  <MenuItem
                    className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                    onClick={() => {
                      const projectId = projectContextMenuProject.id;
                      setProjectContextMenuState(null);
                      openSpaceCreator(projectId);
                    }}
                  >
                    <span className={PROJECT_CONTEXT_MENU_ICON_CLASS_NAME}>
                      <AddPlusIcon />
                    </span>
                    <span>New space…</span>
                  </MenuItem>
                </ComposerPickerMenuSubPopup>
              </MenuSub>
              <MenuSeparator />
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() =>
                  void handleProjectContextMenuAction(projectContextMenuState.projectId, "rename")
                }
              >
                <ProjectContextMenuIcon icon={PencilIcon} />
                <span>Edit project</span>
              </MenuItem>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() =>
                  void handleProjectContextMenuAction(projectContextMenuState.projectId, "relocate")
                }
              >
                <ProjectContextMenuIcon icon={FolderOpenIcon} />
                <span>Change project path…</span>
              </MenuItem>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() =>
                  void handleProjectContextMenuAction(
                    projectContextMenuState.projectId,
                    "toggle-pin",
                  )
                }
              >
                <ProjectContextMenuIcon icon={PinIcon} />
                <span>{pinActionLabel("project", projectContextMenuIsPinned)}</span>
              </MenuItem>
              {projectContextMenuHasArchivableThreads || projectContextMenuHasAnyThreads ? (
                <MenuSeparator />
              ) : null}
              {projectContextMenuHasArchivableThreads ? (
                <MenuItem
                  className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                  onClick={() =>
                    void handleProjectContextMenuAction(
                      projectContextMenuState.projectId,
                      "archive-threads",
                    )
                  }
                >
                  <ProjectContextMenuIcon icon={ArchiveIcon} />
                  <span>Archive threads</span>
                </MenuItem>
              ) : null}
              {projectContextMenuHasAnyThreads ? (
                <MenuItem
                  className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                  onClick={() =>
                    void handleProjectContextMenuAction(
                      projectContextMenuState.projectId,
                      "delete-threads",
                    )
                  }
                >
                  <ProjectContextMenuIcon icon={Trash2} />
                  <span>Delete threads</span>
                </MenuItem>
              ) : null}
              <MenuSeparator />
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() =>
                  void handleProjectContextMenuAction(projectContextMenuState.projectId, "delete")
                }
              >
                <ProjectContextMenuIcon icon={XIcon} />
                <span>Remove</span>
              </MenuItem>
            </MenuGroup>
          </ComposerPickerMenuPopup>
        </Menu>
      ) : null}

      <Dialog
        open={projectRunDialogProjectId !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectRunDialog();
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <PlayIcon className="size-4 text-emerald-500" />
              Start dev
            </DialogTitle>
            <DialogDescription>
              {projectRunDialogProject ? projectRunDialogProject.name : "Project"}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-2">
            <label
              htmlFor="project-run-command-input"
              className="block text-ui-xs font-medium text-[var(--color-text-foreground-secondary)]"
            >
              Command
            </label>
            <Input
              id="project-run-command-input"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="e.g. npm run dev"
              value={projectRunDialogCommandDraft}
              aria-invalid={projectRunDialogCommandIsValid ? undefined : true}
              onChange={(event) => setProjectRunDialogCommandDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleConfirmProjectRun();
                }
              }}
            />
            {projectRunDialogCommandIsValid ? null : (
              <p className="text-ui-sm text-destructive">Enter a command to run.</p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectRunDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmProjectRun}
              disabled={!projectRunDialogCommandIsValid || Boolean(projectRunDialogExistingRun)}
            >
              <PlayIcon className="size-4" />
              Run
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <RenameThreadDialog
        open={renameDialogThreadId !== null}
        currentTitle={
          renameDialogThreadId ? (sidebarThreadSummaryById[renameDialogThreadId]?.title ?? "") : ""
        }
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRenameDialogThreadId(null);
        }}
        onSave={(newTitle) => {
          if (renameDialogThreadId === null) return;
          const target = sidebarThreadSummaryById[renameDialogThreadId];
          if (!target) return;
          void commitRename(target.id, newTitle, target.title);
        }}
      />

      {relocateProjectDialogProject ? (
        <RelocateProjectDialog
          projectId={relocateProjectDialogProject.id}
          workspaceRoot={relocateProjectDialogProject.cwd}
          onOpenChange={(open) => {
            if (!open) setRelocateProjectDialogId(null);
          }}
        />
      ) : null}

      {editProjectDialogProject ? (
        <EditProjectDialog
          open={editProjectDialog?.open ?? false}
          cwd={editProjectDialogProject.cwd}
          folderName={editProjectDialogProject.folderName}
          initialValue={{
            name: editProjectDialogProject.localName ?? "",
            appearance: editProjectDialogProject.appearance ?? null,
          }}
          onOpenChange={(nextOpen) => {
            if (!nextOpen)
              setEditProjectDialog((current) => current && { ...current, open: false });
          }}
          onSave={(next) =>
            handleEditProjectSave(
              editProjectDialogProject.id,
              next,
              editProjectDialogProject.localName,
            )
          }
        />
      ) : null}

      {searchPaletteOpen ? (
        <SidebarSearchPaletteController
          open={searchPaletteOpen}
          mode={searchPaletteMode}
          onModeChange={setSearchPaletteMode}
          onOpenChange={(open) => {
            setSearchPaletteOpen(open);
            if (!open) {
              setSearchPaletteMode("search");
            }
          }}
          actions={searchPaletteActions}
          projects={searchPaletteProjects}
          onCreateChat={() => void handleCreateHomeChat()}
          onCreateThread={handlePrimaryNewThread}
          onAddProjectPath={addProjectFromPath}
          homeDir={homeDir}
          onOpenSettings={() => {
            void navigate({ to: "/settings" });
          }}
          onOpenFeedback={openFeedbackDialog}
          onOpenUsageSettings={() => {
            void navigate({
              to: "/settings",
              search: { section: "usage" },
            });
          }}
          onOpenProject={handleOpenProjectFromSearch}
          onImportThread={handleImportThread}
          onOpenThread={(threadId) => {
            activateThreadFromSidebarIntent(ThreadId.makeUnsafe(threadId));
          }}
        />
      ) : null}
    </>
  );
}
