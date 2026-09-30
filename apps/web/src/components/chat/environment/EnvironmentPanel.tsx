import type { AutomationDefinition } from "@glade/contracts/automation/automation";
import type { EditorId } from "@glade/contracts/settings/editor";
import type {
  MessageId,
  ProjectId,
  ProviderKind,
  ThreadId,
} from "@glade/contracts/core/baseSchemas";
import type { PinnedMessage } from "@glade/contracts/orchestration/orchestration";
import type { ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

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
import { ArrowUpRightIcon, ChangesIcon, GitHubIcon, SettingsIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { EnvironmentEditorSection } from "./EnvironmentEditorSection";
import {
  EnvironmentAutomationsSection,
  type EnvironmentAutomationPanelItem,
} from "./EnvironmentAutomationsSection";
import { EnvironmentUsageSection } from "./EnvironmentUsageSection";
import { EnvironmentLocalServersSection } from "./EnvironmentLocalServersSection";
import { EnvironmentPullRequestSection } from "./EnvironmentPullRequestSection";
import { EnvironmentNotesSection } from "./EnvironmentNotesSection";
import { EnvironmentPinnedSection } from "./EnvironmentPinnedSection";
import { EnvironmentProjectInstructionsSection } from "./EnvironmentProjectInstructionsSection";
import {
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentLabeledSection,
  EnvironmentPanelTitle,
  EnvironmentRow,
  EnvironmentSectionDivider,
} from "./EnvironmentRow";

export const ENVIRONMENT_DOCKED_CONTENT_INSET_PX = 312;

const ENVIRONMENT_PANEL_OVERLAY_WRAPPER_CLASS_NAME =
  "pointer-events-none absolute inset-y-0 right-0 z-20 flex flex-col items-end gap-3 overflow-y-auto p-3";

export interface EnvironmentPanelProps {
  open: boolean;

  variant: "docked" | "floating";
  gitCwd: string | null;
  openInTarget: string | null;
  githubRepository?: {
    readonly nameWithOwner: string;
    readonly url: string;
  } | null;
  githubRepositories?: ReadonlyArray<{ readonly nameWithOwner: string }>;
  isGitRepo: boolean;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  activeThreadId: ThreadId | null;

  activeProvider: ProviderKind;
  // Whether the active runtime exposes git actions (hides "Commit and Push" otherwise).
  showGitActions: boolean;

  diffOpen: boolean;

  threadAutomations: readonly EnvironmentAutomationPanelItem[];

  diffDisabledReason?: string | null;

  diffTotals: RepoDiffTotals;

  branchToolbar: Omit<BranchToolbarProps, "variant">;

  railBottom?: ReactNode;

  pinnedMessages: readonly PinnedMessage[];

  pinnedMessageTextById: ReadonlyMap<MessageId, string>;

  notes: string;

  activeProjectId: ProjectId | null;

  projectInstructions: string;

  canCopyProjectInstructionsToNotes: boolean;

  onProjectInstructionsChange: (projectId: ProjectId, instructions: string) => void;

  onCopyProjectInstructionsToNotes: () => void;

  onToggleDiff: () => void;

  onOpenAutomation: (definition: AutomationDefinition) => void;

  onOpenGithubRepository?: (url: string) => void;

  onJumpToPinnedMessage: (messageId: MessageId) => void;

  onTogglePinnedMessageDone: (messageId: MessageId) => void;

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
  githubRepository: githubRepositoryProp,
  githubRepositories: githubRepositoriesProp,
  isGitRepo,
  keybindings,
  availableEditors,
  activeThreadId,
  activeProvider,
  showGitActions,
  diffOpen,
  threadAutomations,
  diffDisabledReason: diffDisabledReasonProp,
  diffTotals,
  branchToolbar,
  pinnedMessages,
  pinnedMessageTextById,
  notes,
  activeProjectId,
  projectInstructions,
  canCopyProjectInstructionsToNotes,
  onProjectInstructionsChange,
  onCopyProjectInstructionsToNotes,
  onToggleDiff,
  onOpenAutomation,
  onOpenGithubRepository,
  onJumpToPinnedMessage,
  onTogglePinnedMessageDone,
  onUnpinMessage,
  onRenamePinnedMessage,
  onNotesChange,
  onClose,
  onRegisterCommitAndPushTrigger,
  railBottom,
}: EnvironmentPanelProps) {
  const githubRepository = githubRepositoryProp ?? null;
  const githubRepositories = githubRepositoriesProp ?? [];
  const diffDisabledReason = diffDisabledReasonProp ?? null;
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  const { additions, deletions, hasChanges } = diffTotals;

  // Disable the Changes row only when the diff cannot be opened *and* is not already open (so an open
  // diff stays toggleable closed even when there are no pending changes).
  const changesDisabled = diffDisabledReason !== null && !diffOpen;

  const content = (
    <div className="flex flex-col gap-0.5 p-1.5">
      {threadAutomations.length > 0 ? (
        <>
          <EnvironmentAutomationsSection
            automations={threadAutomations}
            onOpenAutomation={(definition) => {
              onOpenAutomation(definition);
              onClose();
            }}
          />
          <EnvironmentSectionDivider />
        </>
      ) : null}

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
              search: { target: SETTINGS_TARGETS.environmentPanel },
            })
          }
        >
          <SettingsIcon className="size-3.5" />
        </IconButton>
      </div>

      {isGitRepo ? (
        <EnvironmentRow
          icon={<ChangesIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
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
            onToggleDone={onTogglePinnedMessageDone}
            onUnpin={onUnpinMessage}
            onRename={onRenamePinnedMessage}
          />
        </>
      ) : null}

      {settings.showEnvironmentInstructions && activeProjectId ? (
        <>
          <EnvironmentSectionDivider />
          <EnvironmentProjectInstructionsSection
            key={activeProjectId}
            projectId={activeProjectId}
            instructions={projectInstructions}
            threadNotes={notes}
            canCopyToThreadNotes={canCopyProjectInstructionsToNotes}
            onInstructionsChange={onProjectInstructionsChange}
            onCopyToThreadNotes={onCopyProjectInstructionsToNotes}
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
    </div>
  );

  return (
    <div
      className={ENVIRONMENT_PANEL_OVERLAY_WRAPPER_CLASS_NAME}
      data-environment-panel-variant={variant}
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
      {railBottom}
    </div>
  );
}
