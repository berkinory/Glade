import { EnvironmentSubagentsSection } from "./EnvironmentSubagentsSection";
import { GitHubIcon } from "~/lib/brandIcons";
import { ArrowUpRightIcon, PlusMinusSquare01Icon, SettingsIcon } from "~/lib/icons";
import type { EditorId } from "@glade/contracts/settings/editor";
import type {
  MessageId,
  ProjectId,
  ProviderKind,
  ThreadId,
} from "@glade/contracts/core/baseSchemas";
import type { PinnedMessage } from "@glade/contracts/orchestration/threadEntities";
import type { ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import { useNavigate } from "@tanstack/react-router";
import { useAppSettings } from "~/appSettings";
import { SETTINGS_TARGETS } from "~/settingsNavigation";
import {
  ENVIRONMENT_PANEL_MOTION_CLASS,
  ENVIRONMENT_PANEL_SURFACE_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import BranchToolbar, { type BranchToolbarProps } from "~/components/BranchToolbar";
import GitActionsControl from "~/components/GitActionsControl";
import { DiffStat } from "~/components/ui/diff-stat";
import { IconButton } from "~/components/ui/icon-button";
import type { RepoDiffTotals } from "~/hooks/useRepoDiffTotals";
import { cn } from "~/lib/utils";
import { useWorkspacePathsStore } from "~/workspacePathsStore";
import { EnvironmentEditorSection } from "./EnvironmentEditorSection";
import { EnvironmentDirectoryPath } from "./EnvironmentDirectoryPath";
import { formatEnvironmentDirectory } from "./EnvironmentPanel.logic";
import { EnvironmentUsageSection } from "./EnvironmentUsageSection";
import { EnvironmentLocalServersSection } from "./EnvironmentLocalServersSection";
import { EnvironmentPullRequestSection } from "./EnvironmentPullRequestSection";
import { EnvironmentNotesSection } from "./EnvironmentNotesSection";
import { EnvironmentPinnedSection } from "./EnvironmentPinnedSection";
import {
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentLabeledSection,
  EnvironmentPanelTitle,
  EnvironmentRow,
  EnvironmentSectionDivider,
} from "./EnvironmentRow";
export const ENVIRONMENT_DOCKED_CONTENT_INSET_PX = 312;
const ENVIRONMENT_PANEL_OVERLAY_WRAPPER_CLASS_NAME =
  "pointer-events-none absolute inset-y-0 right-0 z-20 flex flex-col items-end gap-3 overflow-x-clip overflow-y-auto p-3";
export interface EnvironmentPanelProps {
  open: boolean;
  variant: "docked" | "floating";
  gitCwd: string | null;
  openInTarget: string | null;
  worktree: {
    readonly path: string | null;
    readonly pending: boolean;
    readonly baseDirectory: string | null;
  };
  githubRepository?: {
    readonly nameWithOwner: string;
    readonly url: string;
  } | null;
  githubRepositories?: ReadonlyArray<{
    readonly nameWithOwner: string;
  }>;
  isGitRepo: boolean;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  activeThreadId: ThreadId | null;
  activeProvider: ProviderKind;
  // Whether the active runtime exposes git actions (hides "Commit and Push" otherwise).
  showGitActions: boolean;
  diffOpen: boolean;
  diffDisabledReason?: string | null;
  diffTotals: RepoDiffTotals;
  branchToolbar: Omit<BranchToolbarProps, "variant">;
  pinnedMessages: readonly PinnedMessage[];
  pinnedMessageTextById: ReadonlyMap<MessageId, string>;
  notes: string;
  activeProjectId: ProjectId | null;
  onToggleDiff: () => void;
  onOpenGithubRepository?: (url: string) => void;
  onJumpToPinnedMessage: (messageId: MessageId) => void;
  onUnpinMessage: (messageId: MessageId) => void;
  onRenamePinnedMessage: (messageId: MessageId, label: string | null) => void;
  onNotesChange: (threadId: ThreadId, notes: string) => Promise<void>;
  onClose: () => void;
  onRegisterCommitAndPushTrigger?: (trigger: (() => void) | null) => void;
}
export function EnvironmentPanel({
  open,
  variant,
  gitCwd,
  openInTarget,
  worktree,
  githubRepository: githubRepositoryProp,
  githubRepositories: githubRepositoriesProp,
  isGitRepo,
  keybindings,
  availableEditors,
  activeThreadId,
  activeProvider,
  showGitActions,
  diffOpen,
  diffDisabledReason: diffDisabledReasonProp,
  diffTotals,
  branchToolbar,
  pinnedMessages,
  pinnedMessageTextById,
  notes,
  activeProjectId,
  onToggleDiff,
  onOpenGithubRepository,
  onJumpToPinnedMessage,
  onUnpinMessage,
  onRenamePinnedMessage,
  onNotesChange,
  onClose,
  onRegisterCommitAndPushTrigger,
}: EnvironmentPanelProps) {
  const githubRepository = githubRepositoryProp ?? null;
  const githubRepositories = githubRepositoriesProp ?? [];
  const diffDisabledReason = diffDisabledReasonProp ?? null;
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  const homeDir = useWorkspacePathsStore((state) => state.homeDir);
  const workingDirectory = worktree.pending ? worktree.baseDirectory : (openInTarget ?? gitCwd);
  const { additions, deletions, hasChanges } = diffTotals;

  // Disable the Changes row only when the diff cannot be opened *and* is not already open (so an open
  // diff stays toggleable closed even when there are no pending changes).
  const changesDisabled = diffDisabledReason !== null && !diffOpen;
  const content = (
    <div className="flex flex-col gap-0.5 p-1.5">
      <div className="flex items-center justify-between gap-2 px-2 pb-0.5 pt-0.5">
        <EnvironmentPanelTitle>Environment</EnvironmentPanelTitle>
        {}
        <IconButton
          label="Panel sections"
          tooltip="Panel sections"
          className="-mr-[7px] sm:-mr-[5px]"
          onClick={() =>
            void navigate({
              to: "/settings",
              search: {
                target: SETTINGS_TARGETS.environmentPanel,
              },
            })
          }
        >
          <SettingsIcon className="size-3.5" />
        </IconButton>
      </div>

      {isGitRepo ? (
        <EnvironmentRow
          icon={<PlusMinusSquare01Icon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
          label="Changes"
          trailing={hasChanges ? <DiffStat insertions={additions} deletions={deletions} /> : null}
          disabled={changesDisabled}
          onClick={() => {
            onToggleDiff();
            onClose();
          }}
        />
      ) : null}

      {isGitRepo ? <BranchToolbar {...branchToolbar} variant="panel" /> : null}

      {showGitActions ? (
        <GitActionsControl
          gitCwd={gitCwd}
          activeThreadId={activeThreadId}
          variant="panel"
          onRegisterCommitAndPushTrigger={onRegisterCommitAndPushTrigger}
        />
      ) : null}

      <EnvironmentLabeledSection
        label={
          worktree.pending ? "Worktree pending" : worktree.path ? "Worktree" : "Working directory"
        }
      >
        <div className="px-2 pb-1 text-ui-sm text-muted-foreground">
          {worktree.pending ? (
            <p className="mb-1">Created when you send the first message. Base directory:</p>
          ) : null}
          <EnvironmentDirectoryPath
            path={workingDirectory}
            displayPath={
              workingDirectory
                ? formatEnvironmentDirectory(workingDirectory, homeDir)
                : "No working directory available"
            }
          />
          {worktree.path && worktree.path !== openInTarget ? (
            <p className="mt-1">
              Worktree root:{" "}
              <code className="select-text break-all text-ui-sm">{worktree.path}</code>
            </p>
          ) : null}
        </div>
      </EnvironmentLabeledSection>

      <EnvironmentLocalServersSection enabled={open} />

      {/* Each renders its own leading divider only when it actually shows, so toggling any section via the
       header gear menu never leaves a doubled or dangling rule. */}
      {settings.showEnvironmentUsage ? <EnvironmentUsageSection provider={activeProvider} /> : null}

      {settings.showEnvironmentRepository && githubRepository && onOpenGithubRepository ? (
        <EnvironmentLabeledSection label="Repository">
          <EnvironmentRow
            icon={<GitHubIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
            label={<span className="truncate">{githubRepository.nameWithOwner}</span>}
            trailing={<ArrowUpRightIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
            onClick={() => {
              onOpenGithubRepository(githubRepository.url);
              onClose();
            }}
          />
        </EnvironmentLabeledSection>
      ) : null}

      {settings.showEnvironmentPullRequest && isGitRepo && onOpenGithubRepository ? (
        <EnvironmentPullRequestSection
          gitCwd={gitCwd}
          enabled={open}
          activeThreadId={activeThreadId}
          projectId={activeProjectId}
          configuredRepositories={githubRepositories}
          showDiffColors={settings.showPullRequestDiffColors}
          onOpenUrl={onOpenGithubRepository}
          onClose={onClose}
        />
      ) : null}

      {settings.showEnvironmentEditor ? (
        <EnvironmentEditorSection
          keybindings={keybindings}
          availableEditors={availableEditors}
          openInTarget={openInTarget}
        />
      ) : null}

      {settings.showEnvironmentPinned && pinnedMessages.length > 0 ? (
        <>
          <EnvironmentSectionDivider />
          <EnvironmentPinnedSection
            pins={pinnedMessages}
            messageTextById={pinnedMessageTextById}
            onJump={onJumpToPinnedMessage}
            onUnpin={onUnpinMessage}
            onRename={onRenamePinnedMessage}
          />
        </>
      ) : null}

      {settings.showEnvironmentNotepad && activeThreadId ? (
        <>
          <EnvironmentSectionDivider />
          <EnvironmentNotesSection
            key={activeThreadId}
            threadId={activeThreadId}
            notes={notes}
            onChange={onNotesChange}
          />
        </>
      ) : null}
      <EnvironmentSubagentsSection threadId={activeThreadId} onClose={onClose} />
    </div>
  );
  return (
    <div
      className={ENVIRONMENT_PANEL_OVERLAY_WRAPPER_CLASS_NAME}
      data-environment-panel
      data-environment-panel-variant={variant}
      inert={!open}
      aria-hidden={!open}
    >
      <div
        className={cn(
          ENVIRONMENT_PANEL_SURFACE_CLASS_NAME,
          ENVIRONMENT_PANEL_MOTION_CLASS,
          "flex max-h-full w-72 flex-col",
          open
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none translate-x-full opacity-0",
        )}
      >
        <div className="min-h-0 overflow-y-auto">{content}</div>
      </div>
    </div>
  );
}
