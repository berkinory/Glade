import { PlusIcon, XIcon, FolderIcon } from "~/lib/icons";
import {
  Fragment,
  memo,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from "react";
import { type ProjectDirectoryEntry } from "@glade/contracts/workspace/project";
import { type ProjectId, type SpaceId } from "@glade/contracts/core/baseSchemas";
import { ensureEnvironmentNativeApi, readNativeApi } from "../../nativeApi";
import { useRemoteEnvironments } from "~/environments/remoteEnvironments";
import type { NativeApi } from "@glade/contracts/ipc/ipc";
import { useActiveEnvironment, useLocalDesktopActive } from "~/environments/activeEnvironment";
import { LOCAL_ENVIRONMENT } from "~/environments/environmentKey";
import { useStore } from "../../store";
import { getLocalFoldersGroupLabel } from "~/lib/localFoldersGroupLabel";
import type { ProjectAppearance } from "~/lib/projectAppearance";
import { groupItemsBySpace, spaceDisplayName } from "~/lib/spaceGrouping";
import { useVoidSpace } from "~/spacesUiStore";
import { cn } from "~/lib/utils";
import { ProjectSidebarIcon } from "../ProjectSidebarIcon";
import { SpaceIcon } from "../SpaceIcon";
import { PickerPanelShell } from "./PickerPanelShell";
import { PickerTriggerButton } from "./PickerTriggerButton";
import {
  PICKER_PANEL_ACTION_ROW_CLASS_NAME,
  PICKER_PANEL_GROUP_LABEL_CLASS_NAME,
  PICKER_PANEL_PLAIN_SEARCH_INPUT_CLASS_NAME,
  PICKER_PANEL_ROW_GEOMETRY_CLASS_NAME,
  PICKER_PANEL_ROW_ICON_CLASS_NAME,
  PICKER_PANEL_ROW_SELECTED_CLASS_NAME,
} from "./pickerPanelStyles";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSeparator,
  ComboboxTrigger,
} from "../ui/combobox";
import { useWorkspacePathsStore } from "../../workspacePathsStore";
import { useSpacesUiStore } from "../../spacesUiStore";
interface ProjectPickerProps {
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  selectionMode?: "workspace-root" | "project";
  showResetToHome?: boolean;
  selectedProjectId?: ProjectId | null;
  selectedWorkspaceRoot?: string | null;
  onSelectProject?: ((projectId: ProjectId) => void | Promise<void>) | undefined;
  onSelectWorkspaceRoot?: ((workspaceRoot: string) => void) | undefined;
  onCreateProjectFromPath?: ((workspaceRoot: string) => void | Promise<void>) | undefined;
  onResetToHome?: (() => void | Promise<void>) | undefined;
  triggerClassName?: string;
  triggerVariant?: ComponentProps<typeof PickerTriggerButton>["variant"];
  renderTrigger?: ReactElement<Record<string, unknown>>;
  emptyTriggerLabel?: string;
  addActionLabel?: string;
  resetActionLabel?: string;
  searchPlaceholder?: string;
}
interface ActiveFolderOption {
  projectId: ProjectId | null;
  appearance: ProjectAppearance | null;
  spaceId: SpaceId | null;
  spaceName: string;
  cwd: string;
  primaryLabel: string;
  secondaryLabel: string | null;
}
function startActiveFolderSelection(
  folder: ActiveFolderOption,
  handlers: {
    isProjectSelectionMode: boolean;
    onSelectProject?: ((projectId: ProjectId) => void | Promise<void>) | undefined;
    onSelectWorkspaceRoot?: ((workspaceRoot: string) => void) | undefined;
  },
): void | Promise<void> {
  if (folder.projectId && handlers.onSelectProject) {
    return handlers.onSelectProject(folder.projectId);
  }
  if (handlers.isProjectSelectionMode) {
    return undefined;
  }
  return handlers.onSelectWorkspaceRoot?.(folder.cwd);
}
function basenameOfPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const basename = separatorIndex === -1 ? normalized : normalized.slice(separatorIndex + 1);
  return basename.length > 0 ? basename : null;
}
function directorySearchHaystack(entry: ProjectDirectoryEntry): string {
  return [entry.name, entry.path].join(" ").toLowerCase();
}
function joinDirectoryPath(rootPath: string, relativePath: string): string {
  if (!relativePath) return rootPath;
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const normalizedRoot = rootPath.endsWith(separator) ? rootPath.slice(0, -1) : rootPath;
  const normalizedRelative = relativePath.split(/[\\/]+/).join(separator);
  return `${normalizedRoot}${separator}${normalizedRelative}`;
}
function getNavigatorPlatform(): string {
  const navigatorLike = globalThis.navigator as
    | (Navigator & {
        userAgentData?: {
          platform?: string;
        };
      })
    | undefined;
  return [navigatorLike?.platform, navigatorLike?.userAgentData?.platform]
    .filter(Boolean)
    .join(" ");
}
export const ProjectPicker = memo(function ProjectPicker({
  align: alignProp,
  side: sideProp,
  selectionMode: selectionModeProp,
  showResetToHome: showResetToHomeProp,
  selectedProjectId: selectedProjectIdProp,
  selectedWorkspaceRoot: selectedWorkspaceRootProp,
  onSelectProject,
  onSelectWorkspaceRoot,
  onCreateProjectFromPath,
  onResetToHome,
  triggerClassName,
  triggerVariant,
  renderTrigger,
  emptyTriggerLabel: emptyTriggerLabelProp,
  addActionLabel,
  resetActionLabel: resetActionLabelProp,
  searchPlaceholder: searchPlaceholderProp,
}: ProjectPickerProps) {
  const isLocalDesktop = useLocalDesktopActive();
  const align = alignProp ?? "start";
  const side = sideProp ?? "bottom";
  const selectionMode = selectionModeProp ?? "workspace-root";
  const showResetToHome = showResetToHomeProp ?? false;
  const selectedProjectId = selectedProjectIdProp ?? null;
  const selectedWorkspaceRoot = selectedWorkspaceRootProp ?? null;
  const emptyTriggerLabel = emptyTriggerLabelProp ?? "Work in a project";
  const resetActionLabel = resetActionLabelProp ?? "Don't work in a project";
  const searchPlaceholder = searchPlaceholderProp ?? "Search projects";
  const activeEnvironmentKey = useActiveEnvironment();
  const allProjects = useStore((state) => state.projects);
  // A chat runs on one machine, so it can only move to projects of that machine.
  const projects = allProjects.filter(
    (project) => (project.environmentKey ?? LOCAL_ENVIRONMENT) === activeEnvironmentKey,
  );
  const spaces = useStore((state) => state.spaces);
  const activeSpaceId = useSpacesUiStore((state) => state.activeSpaceId);
  const voidSpace = useVoidSpace();
  const localHomeDir = useWorkspacePathsStore((state) => state.homeDir);
  const remoteEnvironments = useRemoteEnvironments();
  const homeDir =
    activeEnvironmentKey === LOCAL_ENVIRONMENT
      ? localHomeDir
      : (remoteEnvironments.find((environment) => environment.key === activeEnvironmentKey)
          ?.workspacePaths?.homeDir ?? null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [isPicking, setIsPicking] = useState(false);
  const [isLoadingDirectories, setIsLoadingDirectories] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [directoryEntries, setDirectoryEntries] = useState<readonly ProjectDirectoryEntry[]>([]);
  const [resetTriggerFocused, setResetTriggerFocused] = useState(false);
  const resetInFlightRef = useRef(false);
  const isProjectSelectionMode = selectionMode === "project";
  const activeFolderOptions = (() => {
    const seen = new Set<string>();
    const nextOptions: ActiveFolderOption[] = [];
    const getSpaceName = (spaceId: SpaceId | null) => spaceDisplayName(spaceId, spaces, voidSpace);
    for (const project of projects.filter((project) => project.kind === "project")) {
      const folderName = basenameOfPath(project.cwd) ?? project.folderName ?? project.name;
      if (!folderName || folderName.startsWith(".") || seen.has(project.cwd)) {
        continue;
      }
      seen.add(project.cwd);
      const primaryLabel = project.localName?.trim() || folderName;
      const secondaryLabel =
        project.localName?.trim() && project.localName.trim() !== folderName ? folderName : null;
      const spaceId = project.spaceId ?? null;
      nextOptions.push({
        projectId: project.id,
        appearance: project.appearance ?? null,
        spaceId,
        spaceName: getSpaceName(spaceId),
        cwd: project.cwd,
        primaryLabel,
        secondaryLabel,
      });
    }
    const selectedFolderName = basenameOfPath(selectedWorkspaceRoot);
    if (
      !isProjectSelectionMode &&
      selectedWorkspaceRoot &&
      selectedFolderName &&
      !selectedFolderName.startsWith(".") &&
      !seen.has(selectedWorkspaceRoot)
    ) {
      nextOptions.unshift({
        projectId: null,
        appearance: null,
        spaceId: activeSpaceId,
        spaceName: getSpaceName(activeSpaceId),
        cwd: selectedWorkspaceRoot,
        primaryLabel: selectedFolderName,
        secondaryLabel: selectedWorkspaceRoot,
      });
    }
    return nextOptions;
  })();
  const activeFolderPathSet = new Set(activeFolderOptions.map((entry) => entry.cwd));
  const localFolderOptions = (() => {
    if (isProjectSelectionMode) return [];
    return directoryEntries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => ({
        absolutePath: homeDir ? joinDirectoryPath(homeDir, entry.path) : entry.path,
        entry,
      }))
      .filter((entry) => !activeFolderPathSet.has(entry.absolutePath));
  })();
  const localFoldersGroupLabel = getLocalFoldersGroupLabel(homeDir, getNavigatorPlatform());
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const matchingActiveFolderOptions = (() => {
    if (normalizedQuery.length === 0) return activeFolderOptions;
    return activeFolderOptions.filter((entry) =>
      [entry.primaryLabel, entry.secondaryLabel, entry.spaceName, entry.cwd]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  })();
  const filteredActiveFolderGroups = groupItemsBySpace({
    items: matchingActiveFolderOptions,
    spaces,
    activeSpaceId,
    spaceIdOf: (option) => option.spaceId,
    voidSpace,
  });
  const filteredActiveFolderOptions = filteredActiveFolderGroups.flatMap((group) => group.items);
  const filteredLocalFolderOptions = (() => {
    if (normalizedQuery.length === 0) return localFolderOptions;
    return localFolderOptions.filter(({ entry }) =>
      directorySearchHaystack(entry).includes(normalizedQuery),
    );
  })();
  const selectableDirectoryPaths = [
    ...activeFolderOptions.map((entry) => entry.cwd),
    ...localFolderOptions.map((entry) => entry.absolutePath),
  ];
  const filteredDirectoryPaths = [
    ...filteredActiveFolderOptions.map((entry) => entry.cwd),
    ...filteredLocalFolderOptions.map((entry) => entry.absolutePath),
  ];
  const selectedFolderOption = (() => {
    if (isProjectSelectionMode) {
      if (!selectedProjectId) return null;
      return activeFolderOptions.find((entry) => entry.projectId === selectedProjectId) ?? null;
    }
    if (!selectedWorkspaceRoot) return null;
    return (
      activeFolderOptions.find((entry) => entry.cwd === selectedWorkspaceRoot) ??
      localFolderOptions
        .filter(({ absolutePath }) => absolutePath === selectedWorkspaceRoot)
        .map(({ entry, absolutePath }) => ({
          cwd: absolutePath,
          primaryLabel: entry.name,
          secondaryLabel: null,
        }))[0] ??
      null
    );
  })();
  const triggerLabel = selectedFolderOption ? (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="min-w-0 truncate text-[var(--color-text-foreground)]">
        {selectedFolderOption.primaryLabel}
      </span>
      {selectedFolderOption.secondaryLabel ? (
        <span className="min-w-0 truncate text-muted-foreground/60 text-ui leading-snug">
          {selectedFolderOption.secondaryLabel}
        </span>
      ) : null}
    </span>
  ) : (
    emptyTriggerLabel
  );
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setErrorMessage(null);
    }
  };
  useEffect(() => {
    if (
      isProjectSelectionMode ||
      !open ||
      !homeDir ||
      directoryEntries.length > 0 ||
      isLoadingDirectories
    ) {
      return;
    }
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      let api: NativeApi;
      try {
        api = ensureEnvironmentNativeApi(activeEnvironmentKey);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "App is still connecting.");
        return;
      }
      setIsLoadingDirectories(true);
      setErrorMessage(null);
      void api.projects
        .listDirectories({
          cwd: homeDir,
        })
        .then((result) => {
          setDirectoryEntries(
            result.entries.flatMap((entry) =>
              entry.kind === "directory"
                ? [
                    {
                      path: entry.path,
                      name: entry.name,
                      ...(entry.parentPath
                        ? {
                            parentPath: entry.parentPath,
                          }
                        : {}),
                    } satisfies ProjectDirectoryEntry,
                  ]
                : [],
            ),
          );
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "Unable to load folders.");
        })
        .finally(() => {
          setIsLoadingDirectories(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    activeEnvironmentKey,
    directoryEntries.length,
    homeDir,
    isLoadingDirectories,
    isProjectSelectionMode,
    open,
  ]);
  const handleSelectActiveFolder = (folder: ActiveFolderOption) => {
    try {
      const selection = startActiveFolderSelection(folder, {
        isProjectSelectionMode,
        onSelectProject,
        onSelectWorkspaceRoot,
      });
      void Promise.resolve(selection)
        .then(() => {
          setOpen(false);
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "Unable to select project.");
        });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to select project.");
    }
  };
  const handleAddNewProject = async () => {
    if (isPicking) return;
    const api = readNativeApi();
    if (!api) {
      setErrorMessage("App is still connecting. Try again in a moment.");
      return;
    }
    setIsPicking(true);
    setErrorMessage(null);
    try {
      const pickedPath = await api.dialogs.pickFolder();
      if (!pickedPath) {
        setIsPicking(false);
        return;
      }
      if (onCreateProjectFromPath) {
        await onCreateProjectFromPath(pickedPath);
      } else if (onSelectWorkspaceRoot) {
        onSelectWorkspaceRoot(pickedPath);
      }
      setIsPicking(false);
      setOpen(false);
    } catch (error) {
      setIsPicking(false);
      setErrorMessage(error instanceof Error ? error.message : "Unable to open the folder picker.");
    }
  };
  const handleResetToHome = () => {
    if (resetInFlightRef.current) {
      return;
    }
    resetInFlightRef.current = true;
    setErrorMessage(null);
    try {
      let reset: void | Promise<void> | undefined;
      if (onResetToHome) {
        reset = onResetToHome();
      }
      void Promise.resolve(reset)
        .then(() => {
          resetInFlightRef.current = false;
          setOpen(false);
        })
        .catch((error) => {
          resetInFlightRef.current = false;
          setErrorMessage(error instanceof Error ? error.message : "Unable to update project.");
          setOpen(true);
        });
    } catch (error) {
      resetInFlightRef.current = false;
      setErrorMessage(error instanceof Error ? error.message : "Unable to update project.");
      setOpen(true);
    }
  };
  const shouldShowResetToHome = showResetToHome || isProjectSelectionMode;
  const canResetFromTrigger =
    renderTrigger === undefined && selectedFolderOption !== null && onResetToHome !== undefined;
  const addProjectLabel =
    addActionLabel ?? (isProjectSelectionMode ? "New project" : "Add new project");
  const loadingAddProjectLabel = isProjectSelectionMode
    ? "Adding project..."
    : "Opening folder picker...";
  const renderActiveFolderOption = (folder: ActiveFolderOption, index: number) => {
    const selected = isProjectSelectionMode
      ? folder.projectId === selectedProjectId
      : folder.cwd === selectedWorkspaceRoot;
    return (
      <ComboboxItem
        hideIndicator={!selected}
        key={folder.cwd}
        index={index}
        value={folder.cwd}
        className={cn(
          PICKER_PANEL_ROW_GEOMETRY_CLASS_NAME,
          selected && PICKER_PANEL_ROW_SELECTED_CLASS_NAME,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {folder.appearance ? (
            <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70">
              <ProjectSidebarIcon
                cwd={folder.cwd}
                expanded={false}
                appearance={folder.appearance}
                glyphClassName="size-3.5"
              />
            </span>
          ) : (
            <FolderIcon className={PICKER_PANEL_ROW_ICON_CLASS_NAME} />
          )}
          <span className="min-w-0 truncate">{folder.primaryLabel}</span>
          {folder.secondaryLabel ? (
            <span className="min-w-0 truncate text-muted-foreground/60 text-ui leading-snug">
              {folder.secondaryLabel}
            </span>
          ) : null}
        </div>
      </ComboboxItem>
    );
  };
  const handleValueChange = (selectedValue: string | null) => {
    if (!selectedValue) return;
    const activeFolder = activeFolderOptions.find((entry) => entry.cwd === selectedValue);
    if (activeFolder) {
      handleSelectActiveFolder(activeFolder);
      return;
    }
    const localFolder = localFolderOptions.find((entry) => entry.absolutePath === selectedValue);
    if (localFolder) {
      if (onSelectWorkspaceRoot) {
        onSelectWorkspaceRoot(localFolder.absolutePath);
      }
      setOpen(false);
    }
  };
  return (
    <Combobox
      items={selectableDirectoryPaths}
      filteredItems={filteredDirectoryPaths}
      autoHighlight
      onOpenChange={handleOpenChange}
      open={open}
      onValueChange={handleValueChange}
    >
      {renderTrigger ? (
        <ComboboxTrigger render={renderTrigger} />
      ) : (
        <div className="group/project-picker-trigger relative inline-flex min-w-0 max-w-full">
          <ComboboxTrigger
            render={
              <PickerTriggerButton
                data-testid={
                  isProjectSelectionMode ? "project-picker-trigger" : "workspace-picker-trigger"
                }
                icon={
                  <FolderIcon
                    className={cn(
                      "size-3.5 transition-opacity duration-100 ease-out motion-reduce:transition-none",
                      canResetFromTrigger && "group-hover/project-picker-trigger:opacity-0",
                      resetTriggerFocused && "opacity-0",
                    )}
                  />
                }
                label={triggerLabel}
                hideChevron
                {...(triggerVariant
                  ? {
                      variant: triggerVariant,
                    }
                  : {})}
                {...(triggerClassName
                  ? {
                      className: triggerClassName,
                    }
                  : {})}
              />
            }
          />
          {canResetFromTrigger ? (
            <button
              type="button"
              data-testid="project-picker-reset-trigger"
              aria-label={resetActionLabel}
              title={resetActionLabel}
              className={cn(
                "group/reset-project pointer-events-none absolute top-1/2 left-1.5 z-10 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center sm:left-2",
                "opacity-0 transition-opacity duration-100 ease-out",
                "focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                "group-hover/project-picker-trigger:pointer-events-auto group-hover/project-picker-trigger:opacity-100",
                "motion-reduce:transition-none",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onFocus={() => setResetTriggerFocused(true)}
              onBlur={() => setResetTriggerFocused(false)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleResetToHome();
              }}
            >
              <span className="inline-flex size-3.5 items-center justify-center rounded-full bg-muted-foreground/58 text-background transition-colors duration-100 group-hover/reset-project:bg-muted-foreground/75 motion-reduce:transition-none">
                <XIcon className="size-2" aria-hidden />
              </span>
            </button>
          ) : null}
        </div>
      )}
      {}
      <ComboboxPopup align={align} side={side} surface="composer" className="min-w-60 p-0">
        <PickerPanelShell
          variant="plain"
          widthClassName="w-full"
          searchInput={
            <ComboboxInput
              inputClassName={PICKER_PANEL_PLAIN_SEARCH_INPUT_CLASS_NAME}
              placeholder={searchPlaceholder}
              showTrigger={false}
              size="sm"
              unstyled
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          }
          footer={
            <>
              {isLocalDesktop ? (
                <button
                  type="button"
                  className={cn(
                    PICKER_PANEL_ACTION_ROW_CLASS_NAME,
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                  onClick={() => void handleAddNewProject()}
                  disabled={isPicking}
                >
                  <PlusIcon className={PICKER_PANEL_ROW_ICON_CLASS_NAME} />
                  <span className="truncate">
                    {isPicking ? loadingAddProjectLabel : addProjectLabel}
                  </span>
                </button>
              ) : null}
              {shouldShowResetToHome ? (
                <button
                  type="button"
                  className={PICKER_PANEL_ACTION_ROW_CLASS_NAME}
                  onClick={handleResetToHome}
                >
                  <XIcon className={PICKER_PANEL_ROW_ICON_CLASS_NAME} />
                  <span className="truncate">{resetActionLabel}</span>
                </button>
              ) : null}
              {errorMessage ? (
                <div className="px-2 pb-1 text-destructive text-ui leading-snug">
                  {errorMessage}
                </div>
              ) : null}
            </>
          }
        >
          <ComboboxEmpty>
            {isLoadingDirectories
              ? "Loading folders…"
              : activeFolderOptions.length === 0 && localFolderOptions.length === 0
                ? "No folders found"
                : "No matches"}
          </ComboboxEmpty>
          <ComboboxList className="max-h-64">
            {filteredActiveFolderGroups.map((group, groupIndex) => {
              const precedingOptionCount = filteredActiveFolderGroups
                .slice(0, groupIndex)
                .reduce((count, candidate) => count + candidate.items.length, 0);
              return (
                <Fragment key={group.key}>
                  {groupIndex > 0 ? <ComboboxSeparator /> : null}
                  <ComboboxGroup>
                    <ComboboxGroupLabel
                      className={cn(
                        PICKER_PANEL_GROUP_LABEL_CLASS_NAME,
                        "flex items-center gap-1.5",
                      )}
                    >
                      <SpaceIcon icon={group.icon} className="size-3 shrink-0" />
                      <span className="min-w-0 truncate">{group.label}</span>
                    </ComboboxGroupLabel>
                    {group.items.map((folder, index) =>
                      renderActiveFolderOption(folder, precedingOptionCount + index),
                    )}
                  </ComboboxGroup>
                </Fragment>
              );
            })}
            {filteredActiveFolderOptions.length > 0 && filteredLocalFolderOptions.length > 0 ? (
              <ComboboxSeparator />
            ) : null}
            {filteredLocalFolderOptions.length > 0 ? (
              <ComboboxGroup>
                <ComboboxGroupLabel className={PICKER_PANEL_GROUP_LABEL_CLASS_NAME}>
                  {localFoldersGroupLabel}
                </ComboboxGroupLabel>
                {filteredLocalFolderOptions.map(({ absolutePath, entry }, index) => (
                  <ComboboxItem
                    hideIndicator={absolutePath !== selectedWorkspaceRoot}
                    key={absolutePath}
                    index={filteredActiveFolderOptions.length + index}
                    value={absolutePath}
                    className={cn(
                      PICKER_PANEL_ROW_GEOMETRY_CLASS_NAME,
                      absolutePath === selectedWorkspaceRoot &&
                        PICKER_PANEL_ROW_SELECTED_CLASS_NAME,
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FolderIcon className={PICKER_PANEL_ROW_ICON_CLASS_NAME} />
                      <span className="truncate">{entry.name}</span>
                    </div>
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            ) : null}
          </ComboboxList>
        </PickerPanelShell>
      </ComboboxPopup>
    </Combobox>
  );
});
