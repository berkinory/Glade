import { WorkflowCircle04Icon, PencilEdit02Icon } from "~/lib/icons";
import { type EditorId } from "@glade/contracts/settings/editor";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import { isGenericChatThreadTitle } from "@glade/shared/threads/chatThreads";
import React, { useContext } from "react";
import { WorkspaceHeaderContext } from "./WorkspaceHeaderContext";
import GitActionsControl from "../GitActionsControl";
import { ChatHeaderIconButton } from "./chatHeaderControls";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarHeaderNavigationControls } from "../SidebarHeaderNavigationControls";
import { useSidebar } from "../ui/sidebar";
import { cn } from "~/lib/utils";
import { useOpenFavoriteEditorShortcut } from "~/hooks/useOpenFavoriteEditorShortcut";
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
  openInTarget: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  gitCwd: string | null;
  showGitActions?: boolean;
  // When provided, the header shows one Environment button that drives the Environment panel.
  environment?: EnvironmentToggleState | null;
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
  openInTarget,
  keybindings,
  availableEditors,
  gitCwd,
  showGitActions: showGitActionsProp,
  environment: environmentProp,
  onNavigateToThread,
  onRenameThread,
}: ChatHeaderProps) {
  const hideSidebarControls = hideSidebarControlsProp ?? false;
  const workspaceHeader = useContext(WorkspaceHeaderContext);
  const minimalChrome = minimalChromeProp ?? false;
  const showGitActions = showGitActionsProp ?? true;
  const environment = environmentProp ?? null;
  const { isMobile, state } = useSidebar();
  useOpenFavoriteEditorShortcut({
    keybindings,
    availableEditors,
    openInTarget,
    enabled: Boolean(activeProjectName),
  });
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
            visibleWhen="pull-available"
          />
        ) : null}

        {environment ? <EnvironmentToggle environment={environment} /> : null}
      </div>
    </div>
  );
}
