import {
  WorkflowCircle04Icon,
  ArrowExpandIcon,
  ArrowLeftRightIcon,
  LayoutAlignRightIcon,
  PencilEdit02Icon,
} from "~/lib/icons";
import { type EditorId } from "@glade/contracts/settings/editor";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import { isGenericChatThreadTitle } from "@glade/shared/threads/chatThreads";
import React, { useContext } from "react";
import { WorkspaceHeaderContext } from "./WorkspaceHeaderContext";
import GitActionsControl from "../GitActionsControl";
import {
  CHAT_HEADER_TOGGLE_CLASS_NAME,
  ChatHeaderIconButton,
  SurfaceChipIcon,
} from "./chatHeaderControls";
import { DiffStat } from "../ui/diff-stat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarHeaderNavigationControls } from "../SidebarHeaderNavigationControls";
import { Toggle } from "../ui/toggle";
import { useSidebar } from "../ui/sidebar";
import { cn } from "~/lib/utils";
import { useOpenFavoriteEditorShortcut } from "~/hooks/useOpenFavoriteEditorShortcut";
import type { RepoDiffTotals } from "~/hooks/useRepoDiffTotals";
import { ProviderIcon } from "../ProviderIcon";
import { EnvironmentToggle, type EnvironmentToggleState } from "./environment/EnvironmentToggle";
interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProvider: ProviderKind;
  activeProjectName: string | undefined;
  threadBreadcrumbs: ReadonlyArray<{
    threadId: ThreadId;
    title: string;
  }>;
  className?: string;
  hideSidebarControls?: boolean;
  minimalChrome?: boolean;
  isGitRepo: boolean;
  openInTarget: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffTotals: RepoDiffTotals;
  showGitActions?: boolean;
  showDiffToggle?: boolean;
  diffOpen: boolean;
  diffDisabledReason?: string | null;
  rightDockOpen?: boolean;
  onToggleRightDock?: () => void;
  surfaceMode?: "single" | "split";
  // When provided, the header collapses the Open-in-editor + git-actions + diff-toggle cluster into
  // one Environment button that drives the Environment panel; otherwise the legacy cluster is
  // rendered.
  environment?: EnvironmentToggleState | null;
  chatLayoutAction?: {
    kind: "split" | "maximize";
    label: string;
    shortcutLabel: string | null;
    onClick: () => void;
  } | null;
  changeThreadAction?: {
    label: string;
    onClick: () => void;
  } | null;
  onToggleDiff: () => void;
  onNavigateToThread: (threadId: ThreadId) => void;
  onRenameThread: () => void;
}
export function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProvider,
  activeProjectName,
  threadBreadcrumbs,
  className,
  hideSidebarControls: hideSidebarControlsProp,
  minimalChrome: minimalChromeProp,
  isGitRepo,
  openInTarget,
  keybindings,
  availableEditors,
  diffToggleShortcutLabel,
  gitCwd,
  diffTotals,
  showGitActions: showGitActionsProp,
  showDiffToggle: showDiffToggleProp,
  diffOpen,
  diffDisabledReason: diffDisabledReasonProp,
  rightDockOpen: rightDockOpenProp,
  onToggleRightDock,
  surfaceMode: surfaceModeProp,
  environment: environmentProp,
  chatLayoutAction: chatLayoutActionProp,
  changeThreadAction: changeThreadActionProp,
  onToggleDiff,
  onNavigateToThread,
  onRenameThread,
}: ChatHeaderProps) {
  const hideSidebarControls = hideSidebarControlsProp ?? false;
  const workspaceHeader = useContext(WorkspaceHeaderContext);
  const minimalChrome = minimalChromeProp ?? false;
  const showGitActions = showGitActionsProp ?? true;
  const showDiffToggle = showDiffToggleProp ?? true;
  const diffDisabledReason = diffDisabledReasonProp ?? null;
  const rightDockOpen = rightDockOpenProp ?? false;
  const surfaceMode = surfaceModeProp ?? "single";
  const environment = environmentProp ?? null;
  const chatLayoutAction = chatLayoutActionProp ?? null;
  const changeThreadAction = changeThreadActionProp ?? null;
  const { isMobile, state } = useSidebar();
  const {
    additions: diffAdditions,
    deletions: diffDeletions,
    hasChanges: showDiffTotals,
  } = diffTotals;
  useOpenFavoriteEditorShortcut({
    keybindings,
    availableEditors,
    openInTarget,
    enabled: Boolean(activeProjectName),
  });
  const isSplitPane = surfaceMode === "split";
  const compact = isSplitPane;
  const inlineChatLayoutAction = chatLayoutAction?.kind === "maximize" ? chatLayoutAction : null;
  const showThreadProviderIcon = !isGenericChatThreadTitle(activeThreadTitle);
  const renderProviderIcon = (provider: ProviderKind | null, className: string) => {
    return (
      <ProviderIcon
        provider={provider}
        tone="header"
        className={className}
        fallback={<WorkflowCircle04Icon className={className} />}
      />
    );
  };
  const togglesRightDock = onToggleRightDock !== undefined;
  const rightPanelToggleControl = showDiffToggle ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className={cn(
              CHAT_HEADER_TOGGLE_CLASS_NAME,
              togglesRightDock || !showDiffTotals
                ? "!size-7 [&_svg,&_[data-slot=central-icon]]:mx-0"
                : null,
            )}
            pressed={togglesRightDock ? rightDockOpen : diffOpen}
            onPressedChange={togglesRightDock ? onToggleRightDock : onToggleDiff}
            aria-label={togglesRightDock ? "Toggle right sidebar" : "Toggle diff panel"}
            variant="default"
            size="xs"
            disabled={
              togglesRightDock ? false : !isGitRepo || (diffDisabledReason !== null && !diffOpen)
            }
          >
            {!togglesRightDock && showDiffTotals ? (
              <DiffStat
                className="font-system-ui text-ui-sm sm:text-ui-xs font-normal tracking-normal"
                insertions={diffAdditions}
                deletions={diffDeletions}
              />
            ) : null}
            <SurfaceChipIcon icon={LayoutAlignRightIcon} className="size-4" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {togglesRightDock
          ? rightDockOpen
            ? "Close right sidebar"
            : "Open right sidebar"
          : !isGitRepo
            ? "Diff panel is unavailable because this project is not a git repository."
            : diffDisabledReason && !diffOpen
              ? diffDisabledReason
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
      </TooltipPopup>
    </Tooltip>
  ) : null;
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center",
          "overflow-hidden",
          !isMobile && state === "collapsed" ? "gap-4" : "gap-2 sm:gap-3",
        )}
      >
        {hideSidebarControls ? null : <SidebarHeaderNavigationControls />}
        {workspaceHeader ? (
          workspaceHeader.tabs
        ) : (
          <div className={cn("flex min-w-0 flex-1 items-center gap-2", minimalChrome && "hidden")}>
            <div className="flex min-w-0 flex-1 flex-col">
              {threadBreadcrumbs.length > 0 ? (
                <div className="flex min-w-0 items-center gap-1 overflow-hidden text-ui-sm text-muted-foreground/55">
                  {threadBreadcrumbs.map((breadcrumb, index) => (
                    <React.Fragment key={breadcrumb.threadId}>
                      {index > 0 ? (
                        <span className="shrink-0 text-muted-foreground/35">/</span>
                      ) : null}
                      <button
                        type="button"
                        className="min-w-0 truncate transition-colors hover:text-foreground/80"
                        title={breadcrumb.title}
                        onClick={() => onNavigateToThread(breadcrumb.threadId)}
                      >
                        {breadcrumb.title}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {showThreadProviderIcon ? (
                    <span
                      className="inline-flex size-3.5 shrink-0 items-center justify-center"
                      title={PROVIDER_DISPLAY_NAMES[activeProvider]}
                    >
                      {renderProviderIcon(activeProvider, "size-3.5")}
                    </span>
                  ) : null}
                  <h2
                    className="max-w-[clamp(12rem,42vw,36rem)] truncate font-system-ui text-ui font-normal text-foreground"
                    title={activeThreadTitle}
                  >
                    {activeThreadTitle}
                  </h2>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <ChatHeaderIconButton label="Rename chat" onClick={onRenameThread}>
                          <PencilEdit02Icon className="size-3.5" />
                        </ChatHeaderIconButton>
                      }
                    />
                    <TooltipPopup side="bottom">Rename chat</TooltipPopup>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!minimalChrome && environment && activeProjectName && showGitActions ? (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadId={activeThreadId}
            hideQuickActionLabel={compact}
            visibleWhen="pull-available"
          />
        ) : null}

        {inlineChatLayoutAction ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <ChatHeaderIconButton
                  type="button"
                  label={inlineChatLayoutAction.label}
                  onClick={inlineChatLayoutAction.onClick}
                >
                  <ArrowExpandIcon className="size-3.5" />
                </ChatHeaderIconButton>
              }
            />
            <TooltipPopup side="bottom">{inlineChatLayoutAction.label}</TooltipPopup>
          </Tooltip>
        ) : null}

        {}
        {changeThreadAction ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <ChatHeaderIconButton
                  type="button"
                  label={changeThreadAction.label}
                  onClick={changeThreadAction.onClick}
                >
                  <ArrowLeftRightIcon className="size-3.5" />
                </ChatHeaderIconButton>
              }
            />
            <TooltipPopup side="bottom">{changeThreadAction.label}</TooltipPopup>
          </Tooltip>
        ) : null}

        {}
        {environment ? (
          <>
            <EnvironmentToggle environment={environment} />
            {rightPanelToggleControl}
          </>
        ) : (
          <>
            {}
            {rightPanelToggleControl}
          </>
        )}
      </div>
    </div>
  );
}
