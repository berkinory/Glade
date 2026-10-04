import { useCallback } from "react";

import { CheckIcon, FolderOpenFrontIcon, NewChatIcon } from "~/lib/icons";
import { type FilesystemBrowseResult } from "@glade/contracts/workspace/filesystem";
import { isGenericChatThreadTitle } from "@glade/shared/threads/chatThreads";
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { LuCornerLeftUp } from "react-icons/lu";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderClosed } from "./FolderClosed";
import {
  ACTION_ICONS,
  buildThemeCommandItems,
  CodeThemeBadge,
  THEME_MODE_ICONS,
} from "./SidebarSearchPaletteCommands";
import { ProjectSidebarIcon } from "./ProjectSidebarIcon";
import { ProviderIcon as SharedProviderIcon } from "./ProviderIcon";
import { readNativeApi } from "~/nativeApi";
import { cn, getNavigatorPlatform, isMacPlatform } from "~/lib/utils";
import { ShortcutKbd } from "./ui/shortcut-kbd";
import {
  appendBrowsePathSegment,
  canNavigateUp,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
  isUnsupportedWindowsProjectPath,
  normalizeProjectPathForDispatch,
} from "~/lib/projectPaths";

import {
  type SidebarSearchAction,
  type SidebarSearchProject,
  type SidebarSearchTheme,
  type SidebarSearchThread,
  matchSidebarSearchActions,
  matchSidebarSearchProjects,
  matchSidebarSearchThemes,
  matchSidebarSearchThreads,
} from "./SidebarSearchPalette.logic";
import { useTheme } from "../hooks/useTheme";
import { getAvailableCodeThemes, getCodeThemeSeed } from "../theme/theme.logic.shared";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandStatus,
} from "./ui/command";
import { Button } from "./ui/button";

const PALETTE_INPUT_CLASS =
  "font-system-ui h-11 w-full min-w-0 bg-transparent px-3.5 text-ui-lg text-foreground outline-none placeholder:text-muted-foreground/70";
const PALETTE_GROUP_LABEL_CLASS =
  "flex items-center justify-between px-2.5 pt-2 pb-1 font-normal text-ui-xs text-muted-foreground/70";
const PALETTE_ITEM_CLASS =
  "palette-row min-h-[30px] cursor-pointer items-center gap-3 rounded-[20px] px-2.5 py-0 text-foreground data-highlighted:bg-zinc-500/8 data-highlighted:text-foreground sm:min-h-[30px] dark:data-highlighted:bg-zinc-400/10";
const PALETTE_ICON_CLASS = "size-3.5 shrink-0 text-muted-foreground";
const PALETTE_TEXT_CLASS = "min-w-0 flex-1 truncate text-ui";
const PALETTE_META_CLASS = "max-w-[45%] shrink-0 truncate text-ui-meta text-muted-foreground/70";
const PALETTE_STATUS_CLASS = "px-4 pt-1 pb-3 text-ui text-muted-foreground/79";

const SETTINGS_ACTION_IDS: ReadonlySet<string> = new Set([
  "settings",
  "usage-settings",
  "feedback",
]);

interface SidebarSearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly SidebarSearchAction[];
  projects: readonly SidebarSearchProject[];
  threads: readonly SidebarSearchThread[];
  onCreateChat: () => void;
  onCreateThread: () => void;
  onAddProjectPath: (path: string, options?: { createIfMissing?: boolean }) => Promise<void>;
  homeDir: string | null;
  onOpenSettings: () => void;
  onOpenFeedback: () => void;
  onOpenUsageSettings: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenThread: (threadId: string) => void;
}

function actionHandler(
  actionId: string,
  props: Pick<
    SidebarSearchPaletteProps,
    "onCreateChat" | "onCreateThread" | "onOpenFeedback" | "onOpenSettings" | "onOpenUsageSettings"
  >,
): (() => void) | null {
  switch (actionId) {
    case "new-chat":
      return props.onCreateChat;
    case "new-thread":
      return props.onCreateThread;
    case "settings":
      return props.onOpenSettings;
    case "feedback":
      return props.onOpenFeedback;
    case "usage-settings":
      return props.onOpenUsageSettings;
    default:
      return null;
  }
}

const BROWSE_STALE_TIME_MS = 10_000;

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];

function expandHomeInPath(value: string, homeDir: string | null): string {
  if (!homeDir) return value;
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return `${homeDir}${value.slice(1)}`;
  }
  return value;
}

export function SidebarSearchPalette(props: SidebarSearchPaletteProps) {
  const { activeTheme, resolvedTheme, setCodeThemeId, setTheme, theme } = useTheme();
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const [addProjectErrorState, setAddProjectErrorState] = useState<{
    query: string;
    message: string;
  } | null>(null);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const addProjectError =
    addProjectErrorState !== null && addProjectErrorState.query === query
      ? addProjectErrorState.message
      : null;
  const setAddProjectError = useCallback(
    (message: string | null) =>
      setAddProjectErrorState(message === null ? null : { query, message }),
    [query],
  );

  useEffect(() => {
    if (props.open) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setQuery("");
      setHighlightedItemValue(null);
      setAddProjectError(null);
      setIsAddingProject(false);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [props.open, setAddProjectError]);

  const platform = getNavigatorPlatform();
  const trimmedQuery = query.trim();
  const unsupportedWindowsPath = isUnsupportedWindowsProjectPath(trimmedQuery, platform);
  const isBrowsing = trimmedQuery.length > 0 && isFilesystemBrowseQuery(trimmedQuery, platform);
  const canBrowse = isBrowsing && !unsupportedWindowsPath;
  const browseDirectoryPath = canBrowse ? getBrowseDirectoryPath(query) : "";
  const leafSegment =
    canBrowse && !hasTrailingPathSeparator(query) ? getBrowseLeafPathSegment(query) : "";
  const expandedBrowsePath = canBrowse ? expandHomeInPath(browseDirectoryPath, props.homeDir) : "";

  const { data: browseResult, isFetching: isBrowseFetching } =
    useQuery<FilesystemBrowseResult | null>({
      queryKey: ["sidebar-palette-browse", expandedBrowsePath],
      queryFn: async () => {
        if (!canBrowse || expandedBrowsePath.length === 0) return null;
        const api = readNativeApi();
        if (!api) return null;
        return await api.filesystem.browse({ partialPath: expandedBrowsePath });
      },
      enabled: canBrowse && expandedBrowsePath.length > 0,
      staleTime: BROWSE_STALE_TIME_MS,
    });

  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const lowerFilter = leafSegment.toLowerCase();
  const showHidden = leafSegment.startsWith(".");
  const filteredBrowseEntries = browseEntries.filter(
    (entry) =>
      entry.name.toLowerCase().startsWith(lowerFilter) &&
      (showHidden || !entry.name.startsWith(".")),
  );

  const exactBrowseEntry =
    leafSegment.length === 0
      ? null
      : (filteredBrowseEntries.find((entry) => entry.name === leafSegment) ?? null);

  const browseParentPath = canBrowse ? getBrowseParentPath(query) : null;
  const canBrowseUp = canBrowse && canNavigateUp(query);

  const matchedActions =
    isBrowsing || !trimmedQuery
      ? []
      : matchSidebarSearchActions(
          props.actions.filter((action) => !SETTINGS_ACTION_IDS.has(action.id)),
          query,
        );
  const themeCommandItems = buildThemeCommandItems({
    query,
    resolvedTheme,
    theme,
  });
  const currentCodeThemeItems: SidebarSearchTheme[] = getAvailableCodeThemes(resolvedTheme).map(
    (option) => ({
      id: `theme-code:${resolvedTheme}:${option.id}`,
      type: "code-theme",
      label: option.label,
      description: `Apply to the current ${resolvedTheme} theme slot.`,
      keywords: ["appearance", "theme", resolvedTheme, option.id],
      codeThemeId: option.id,
      variant: resolvedTheme,
      isActive: activeTheme.codeThemeId === option.id,
    }),
  );
  const matchedCurrentThemes =
    isBrowsing || query.trim().length === 0
      ? []
      : matchSidebarSearchThemes(currentCodeThemeItems, query);
  const showThemeSection =
    !isBrowsing &&
    query.trim().length > 0 &&
    (themeCommandItems.length > 0 || matchedCurrentThemes.length > 0);
  const matchedProjects = isBrowsing ? [] : matchSidebarSearchProjects(props.projects, query);

  const matchedThreads = useMemo(
    () => (isBrowsing ? [] : matchSidebarSearchThreads(props.threads, query)),
    [isBrowsing, props.threads, query],
  );
  const hasSearchResults =
    matchedActions.length > 0 ||
    themeCommandItems.length > 0 ||
    matchedCurrentThemes.length > 0 ||
    matchedProjects.length > 0 ||
    matchedThreads.length > 0;
  const hasHighlightedFolderItem =
    highlightedItemValue !== null && highlightedItemValue.startsWith("folder:");
  const hasHighlightedBrowseItem =
    hasHighlightedFolderItem || highlightedItemValue === "__browse_up__";

  const highlightedFolderPath = hasHighlightedFolderItem
    ? (highlightedItemValue?.slice("folder:".length) ?? null)
    : null;

  const willCreateMissingFolder =
    canBrowse &&
    !hasHighlightedFolderItem &&
    trimmedQuery.length > 0 &&
    !hasTrailingPathSeparator(query) &&
    exactBrowseEntry === null &&
    !isBrowseFetching;

  const browseSubmitLabel = willCreateMissingFolder ? "Create & Add" : "Add";

  const resolveBrowseSubmitPath = (): string => {
    if (highlightedFolderPath) {
      return normalizeProjectPathForDispatch(highlightedFolderPath);
    }
    const raw = hasTrailingPathSeparator(query)
      ? (browseResult?.parentPath ?? expandHomeInPath(trimmedQuery, props.homeDir))
      : (exactBrowseEntry?.fullPath ?? expandHomeInPath(trimmedQuery, props.homeDir));
    return normalizeProjectPathForDispatch(raw);
  };

  const submitBrowsePath = async () => {
    if (isAddingProject) return;
    if (trimmedQuery.length === 0 && !highlightedFolderPath) {
      setAddProjectError("Enter a folder path.");
      return;
    }
    if (unsupportedWindowsPath) {
      setAddProjectError("Windows paths are not supported on this platform.");
      return;
    }
    if (!highlightedFolderPath && isExplicitRelativeProjectPath(trimmedQuery)) {
      setAddProjectError(
        "Relative paths are not supported. Use an absolute path or start with ~/.",
      );
      return;
    }
    setIsAddingProject(true);
    setAddProjectError(null);

    void Promise.resolve(
      props.onAddProjectPath(resolveBrowseSubmitPath(), {
        createIfMissing: willCreateMissingFolder,
      }),
    )
      .then(() => {
        props.onOpenChange(false);
      })
      .catch((cause: unknown) => {
        setAddProjectError(cause instanceof Error ? cause.message : "Failed to add project.");
      })
      .finally(() => {
        setIsAddingProject(false);
      });
  };

  const isMac = isMacPlatform(platform);
  const submitModifierLabel = isMac ? "⌘" : "Ctrl";

  const handleBrowseInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isBrowsing) return;
    const isModifierPressed = isMac ? event.metaKey : event.ctrlKey;
    if (
      event.key === "Enter" &&
      (!hasHighlightedBrowseItem || (isModifierPressed && hasHighlightedFolderItem))
    ) {
      event.preventDefault();
      void submitBrowsePath();
      return;
    }
    if (
      event.key === "Backspace" &&
      hasTrailingPathSeparator(query) &&
      browseParentPath &&
      event.currentTarget.selectionStart === query.length &&
      event.currentTarget.selectionEnd === query.length
    ) {
      event.preventDefault();
      setQuery(browseParentPath);
    }
  };

  const renderActionItem = (action: SidebarSearchAction) => {
    const onSelect = action.run ?? actionHandler(action.id, props);
    const Icon = action.icon ?? ACTION_ICONS[action.id];
    return (
      <CommandItem
        key={action.id}
        value={`action:${action.id}`}
        className={PALETTE_ITEM_CLASS}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          if (!onSelect) return;
          props.onOpenChange(false);
          onSelect();
        }}
      >
        {Icon ? (
          <Icon className={PALETTE_ICON_CLASS} />
        ) : (
          <span className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className={PALETTE_TEXT_CLASS}>{action.label}</span>
        {action.shortcutLabel ? <ShortcutKbd shortcutLabel={action.shortcutLabel} /> : null}
      </CommandItem>
    );
  };

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup className="max-w-lg rounded-3xl border-transparent before:rounded-[calc(var(--radius-3xl)-1px)] before:shadow-none dark:before:shadow-none">
        <Command
          autoHighlight={isBrowsing ? false : "always"}
          mode="none"
          onItemHighlighted={(value) => {
            setHighlightedItemValue(typeof value === "string" ? value : null);
          }}
        >
          {}
          <div className="relative">
            <AutocompletePrimitive.Input
              autoFocus
              className={cn(
                PALETTE_INPUT_CLASS,
                isBrowsing ? (willCreateMissingFolder ? "pe-36" : "pe-24") : undefined,
              )}
              placeholder={
                isBrowsing
                  ? "Enter project path (e.g. ~/projects/my-app)"
                  : "Search chats or run a command"
              }
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={handleBrowseInputKeyDown}
            />
            {isBrowsing ? (
              <Button
                variant="outline"
                size="xs"
                tabIndex={-1}
                className="-translate-y-1/2 absolute end-3 top-1/2 gap-1.5 pe-1 ps-2"
                disabled={
                  isAddingProject ||
                  unsupportedWindowsPath ||
                  (trimmedQuery.length === 0 && !highlightedFolderPath) ||
                  (!highlightedFolderPath && isExplicitRelativeProjectPath(trimmedQuery))
                }
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => void submitBrowsePath()}
                title={
                  hasHighlightedFolderItem
                    ? `${browseSubmitLabel} highlighted folder (${submitModifierLabel} Enter)`
                    : `${browseSubmitLabel} (Enter)`
                }
              >
                <span>{browseSubmitLabel}</span>
                <ShortcutKbd
                  shortcutLabel={
                    hasHighlightedFolderItem ? `${submitModifierLabel} Enter` : "Enter"
                  }
                  className="-me-0.5"
                />
              </Button>
            ) : null}
          </div>
          <CommandList className="max-h-[min(30rem,60vh)] not-empty:px-1.5 not-empty:pt-0 not-empty:pb-2">
            {canBrowse && (canBrowseUp || filteredBrowseEntries.length > 0) ? (
              <CommandGroup>
                {canBrowseUp ? (
                  <CommandItem
                    key="browse-up"
                    value="__browse_up__"
                    className={PALETTE_ITEM_CLASS}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      if (browseParentPath) setQuery(browseParentPath);
                    }}
                  >
                    <LuCornerLeftUp className={PALETTE_ICON_CLASS} />
                    <span className={PALETTE_TEXT_CLASS}>..</span>
                  </CommandItem>
                ) : null}
                {filteredBrowseEntries.map((entry) => (
                  <CommandItem
                    key={entry.fullPath}
                    value={`folder:${entry.fullPath}`}
                    className={PALETTE_ITEM_CLASS}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => setQuery(appendBrowsePathSegment(query, entry.name))}
                  >
                    <FolderClosed className={PALETTE_ICON_CLASS} />
                    <span className={PALETTE_TEXT_CLASS}>{entry.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {}
            {!isBrowsing && matchedThreads.length > 0 ? (
              <CommandGroup>
                <CommandGroupLabel className={PALETTE_GROUP_LABEL_CLASS}>
                  <span>{query ? "Threads" : "Recent chats"}</span>
                </CommandGroupLabel>
                {matchedThreads.map(({ id, matchKind, snippet, thread }) => {
                  const normalizedQuery = trimmedQuery.replaceAll(/\s+/g, " ").toLowerCase();
                  const matchContext =
                    snippet ??
                    (matchKind === "project"
                      ? [
                          ...new Set([
                            thread.projectName,
                            thread.projectRemoteName,
                            thread.spaceName,
                          ]),
                        ]
                          .filter((name) =>
                            name
                              .trim()
                              .replaceAll(/\s+/g, " ")
                              .toLowerCase()
                              .includes(normalizedQuery),
                          )
                          .join(" · ")
                      : null);
                  return (
                    <CommandItem
                      key={id}
                      value={id}
                      className={cn(PALETTE_ITEM_CLASS, matchContext ? "py-1" : undefined)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => {
                        props.onOpenChange(false);
                        props.onOpenThread(thread.id);
                      }}
                    >
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        {isGenericChatThreadTitle(thread.title) ? null : (
                          <SharedProviderIcon
                            provider={thread.provider}
                            className={PALETTE_ICON_CLASS}
                          />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <div className={PALETTE_TEXT_CLASS}>
                            {thread.title || "Untitled thread"}
                          </div>
                          <span
                            className={cn(PALETTE_META_CLASS, "inline-flex items-center gap-1")}
                          >
                            {thread.projectName ? (
                              <FolderClosed className="size-3 shrink-0" />
                            ) : (
                              <NewChatIcon className="size-3 shrink-0" />
                            )}
                            <span className="truncate">{thread.projectName || "Chat"}</span>
                          </span>
                        </div>
                        {matchContext ? (
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1 line-clamp-1 text-ui-meta leading-4 text-muted-foreground/78">
                              {matchContext}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}

            {!isBrowsing && matchedActions.length > 0 ? (
              <CommandGroup>
                <CommandGroupLabel className={PALETTE_GROUP_LABEL_CLASS}>
                  <span>Actions</span>
                </CommandGroupLabel>
                {matchedActions.map(renderActionItem)}
              </CommandGroup>
            ) : null}

            {!isBrowsing && matchedProjects.length > 0 ? (
              <CommandGroup>
                <CommandGroupLabel className={PALETTE_GROUP_LABEL_CLASS}>
                  <span>Projects</span>
                </CommandGroupLabel>
                {matchedProjects.map(({ id, project }) => (
                  <CommandItem
                    key={id}
                    value={id}
                    className={PALETTE_ITEM_CLASS}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      props.onOpenChange(false);
                      props.onOpenProject(project.id);
                    }}
                  >
                    {project.appearance ? (
                      <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                        <ProjectSidebarIcon
                          cwd={project.cwd}
                          expanded
                          appearance={project.appearance}
                          glyphClassName="size-3.5"
                        />
                      </span>
                    ) : (
                      <FolderOpenFrontIcon className={PALETTE_ICON_CLASS} />
                    )}
                    <span className={PALETTE_TEXT_CLASS}>{project.name || "Untitled project"}</span>
                    {}
                    <span className={PALETTE_META_CLASS}>
                      {project.spaceName ? `${project.spaceName} · ${project.cwd}` : project.cwd}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {showThemeSection ? (
              <>
                {themeCommandItems.length > 0 ? (
                  <CommandGroup>
                    <CommandGroupLabel className={PALETTE_GROUP_LABEL_CLASS}>
                      <span>Configure</span>
                    </CommandGroupLabel>
                    {themeCommandItems.map((themeCommandItem) => {
                      const ThemeIcon = THEME_MODE_ICONS[themeCommandItem.mode];
                      return (
                        <CommandItem
                          key={themeCommandItem.id}
                          value={themeCommandItem.id}
                          className={PALETTE_ITEM_CLASS}
                          onMouseDown={(event) => {
                            event.preventDefault();
                          }}
                          onClick={() => {
                            if (themeCommandItem.isActive) return;
                            props.onOpenChange(false);
                            setTheme(themeCommandItem.mode);
                          }}
                        >
                          <ThemeIcon className={PALETTE_ICON_CLASS} />
                          <span className={PALETTE_TEXT_CLASS}>{themeCommandItem.label}</span>
                          <span
                            className="flex size-3.5 shrink-0 items-center justify-center"
                            aria-hidden={!themeCommandItem.isActive}
                          >
                            {themeCommandItem.isActive ? (
                              <CheckIcon className={PALETTE_ICON_CLASS} />
                            ) : null}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : null}
                {matchedCurrentThemes.length > 0 ? (
                  <CommandGroup>
                    <CommandGroupLabel className={PALETTE_GROUP_LABEL_CLASS}>
                      <span>{resolvedTheme === "dark" ? "Dark themes" : "Light themes"}</span>
                    </CommandGroupLabel>
                    {matchedCurrentThemes.map((themeItem) => {
                      const seed =
                        themeItem.codeThemeId && themeItem.variant
                          ? getCodeThemeSeed(themeItem.codeThemeId, themeItem.variant)
                          : null;
                      return (
                        <CommandItem
                          key={themeItem.id}
                          value={themeItem.id}
                          className={PALETTE_ITEM_CLASS}
                          onMouseDown={(event) => {
                            event.preventDefault();
                          }}
                          onClick={() => {
                            if (!themeItem.codeThemeId || !themeItem.variant) return;
                            props.onOpenChange(false);
                            setCodeThemeId(themeItem.variant, themeItem.codeThemeId);
                          }}
                        >
                          {seed ? (
                            <CodeThemeBadge
                              accent={seed.accent}
                              background={seed.surface}
                              foreground={seed.ink}
                            />
                          ) : null}
                          <span className={PALETTE_TEXT_CLASS}>{themeItem.label}</span>
                          <span className={PALETTE_META_CLASS}>
                            {resolvedTheme === "dark" ? "Dark color theme" : "Light color theme"}
                          </span>
                          <span
                            className="flex size-3.5 shrink-0 items-center justify-center"
                            aria-hidden={!themeItem.isActive}
                          >
                            {themeItem.isActive ? (
                              <CheckIcon className={PALETTE_ICON_CLASS} />
                            ) : null}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : null}
              </>
            ) : null}
          </CommandList>
          {}
          <CommandStatus className="p-0">
            {isBrowsing ? (
              unsupportedWindowsPath ? (
                <div className={PALETTE_STATUS_CLASS}>
                  Windows paths are not supported on this platform.
                </div>
              ) : (
                <>
                  {!canBrowseUp && filteredBrowseEntries.length === 0 && !isBrowseFetching ? (
                    <div className={PALETTE_STATUS_CLASS}>No matching folders.</div>
                  ) : null}
                  {willCreateMissingFolder ? (
                    <div className="palette-row mx-3 mb-2 rounded-lg border border-dashed border-[color:var(--color-border)] px-3 py-2 text-ui text-muted-foreground">
                      Press Enter to create <span className="text-foreground">{trimmedQuery}</span>{" "}
                      and add it as a project.
                    </div>
                  ) : null}
                  {addProjectError ? (
                    <div className="palette-row mx-3 mb-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-ui text-destructive">
                      {addProjectError}
                    </div>
                  ) : null}
                  <div className={cn(PALETTE_STATUS_CLASS, "flex justify-between gap-3")}>
                    <span>
                      {isAddingProject
                        ? "Adding project..."
                        : "Type a path, ↑↓ to navigate folders."}
                    </span>
                    <span>
                      {hasHighlightedFolderItem
                        ? `Enter to open · ${submitModifierLabel}+Enter to add`
                        : hasHighlightedBrowseItem
                          ? "Enter to go up"
                          : "Enter to add project"}
                    </span>
                  </div>
                </>
              )
            ) : !hasSearchResults ? (
              <div className={PALETTE_STATUS_CLASS}>No matches.</div>
            ) : null}
          </CommandStatus>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
