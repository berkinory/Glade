import {
  PlusIcon,
  Archive04Icon,
  Copy01Icon,
  Folder02Icon,
  PencilEdit02Icon,
  PinIcon,
  Delete02Icon,
  XIcon,
} from "~/lib/icons";
import { useStore } from "../store";
import { createClientPointMenuAnchor } from "~/lib/clientPointMenuAnchor";
import { useMemo } from "react";
import { pinActionLabel } from "~/lib/pin";
import { SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { EditProjectDialog } from "./EditProjectDialog";
import { RelocateProjectDialog } from "./RelocateProjectDialog";
import { RenameThreadDialog } from "./RenameThreadDialog";
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
import type { useSidebarPanelEffects } from "./useSidebarPanelEffects";
export function SidebarDialogs({
  context,
}: {
  context: ReturnType<typeof useSidebarPanelEffects>;
}) {
  const {
    githubProvisioningAvailable,
    spaces,
    activeSpaceId,
    homeDir,
    navigate,
    createProjectDialogOpen,
    setCreateProjectDialogOpen,
    createProjectSpaceId,
    setCreateProjectSpaceId,
    searchPaletteOpen,
    setSearchPaletteOpen,
    openFeedbackDialog,
    renameDialogThreadId,
    setRenameDialogThreadId,
    editProjectDialog,
    setEditProjectDialog,
    setRelocateProjectDialogId,
    relocateProjectDialogId,
    projectContextMenuState,
    setProjectContextMenuState,
    handleOpenProjectFromSearch,
    handleCreateHomeChat,
    addProjectFromPath,
    handlePrimaryNewThread,
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
  } = context;
  const sidebarThreadSummaryById = useStore((state) => state.sidebarThreadSummaryById);
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
        {...(spaceEditorInitialValue
          ? {
              initialValue: spaceEditorInitialValue,
            }
          : {})}
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
                    "copy-path",
                  )
                }
              >
                <ProjectContextMenuIcon icon={Copy01Icon} />
                <span>Copy Path</span>
              </MenuItem>
              <MenuSeparator />

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
                      <PlusIcon />
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
                <ProjectContextMenuIcon icon={PencilEdit02Icon} />
                <span>Edit project</span>
              </MenuItem>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() =>
                  void handleProjectContextMenuAction(projectContextMenuState.projectId, "relocate")
                }
              >
                <ProjectContextMenuIcon icon={Folder02Icon} />
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
                  <ProjectContextMenuIcon icon={Archive04Icon} />
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
                  <ProjectContextMenuIcon icon={Delete02Icon} />
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
              setEditProjectDialog(
                (current) =>
                  current && {
                    ...current,
                    open: false,
                  },
              );
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
          onOpenChange={setSearchPaletteOpen}
          actions={searchPaletteActions}
          projects={searchPaletteProjects}
          onCreateChat={() => void handleCreateHomeChat()}
          onCreateThread={handlePrimaryNewThread}
          onAddProjectPath={addProjectFromPath}
          homeDir={homeDir}
          onOpenSettings={() => {
            void navigate({
              to: "/settings",
            });
          }}
          onOpenFeedback={openFeedbackDialog}
          onOpenUsageSettings={() => {
            void navigate({
              to: "/settings",
              search: {
                section: "usage",
              },
            });
          }}
          onOpenProject={handleOpenProjectFromSearch}
          onOpenThread={(threadId) => {
            activateThreadFromSidebarIntent(ThreadId.makeUnsafe(threadId));
          }}
        />
      ) : null}
    </>
  );
}
