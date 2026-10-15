import type { AppSettingsBinding } from "~/appSettings";
import { BooleanSettingRow } from "./BooleanSettingRow";
import { WorktreesSettingsPanel } from "./ConversationStorageSettingsPanels";
import { GitHubConnectionSettings } from "./GitHubConnectionSettings";
import { ModelsSettingsPanel } from "./ModelsSettingsPanel";
import { SettingsSection, SettingsSectionShell } from "./SettingsPanelPrimitives";
import { WorktreeCleanupPolicyRows } from "./WorktreeCleanupPolicyRows";

export function GitAndFilesSettingsPanel(binding: AppSettingsBinding) {
  return (
    <div className="space-y-6">
      <ModelsSettingsPanel active {...binding} />
      <GitHubConnectionSettings />
      <SettingsSection title="Files">
        <BooleanSettingRow
          binding={binding}
          settingKey="hideIgnoredFiles"
          title="Hide ignored files"
          description="Hide gitignored files and folders from the Explorer tree."
          resetLabel="hide ignored files"
          ariaLabel="Hide ignored files"
        />
      </SettingsSection>
      <SettingsSection title="Diffs">
        <BooleanSettingRow
          binding={binding}
          settingKey="showPullRequestDiffColors"
          title="Pull request diff colors"
          description="Show additions in green and deletions in red in pull request summaries."
          resetLabel="pull request diff colors"
          ariaLabel="Show pull request diff colors"
        />
        <BooleanSettingRow
          binding={binding}
          settingKey="diffWordWrap"
          title="Diff line wrapping"
          description="Wrap long lines in Source Control diffs."
          resetLabel="diff line wrapping"
          ariaLabel="Wrap diff lines by default"
        />
      </SettingsSection>
      <SettingsSection title="Worktree cleanup">
        <BooleanSettingRow
          binding={binding}
          settingKey="archiveDeletesOrphanedWorktree"
          title="Delete worktree on archive"
          description="After Archive's Undo period, remove a clean worktree only if the task has stopped and no other task uses it. Its branch remains available for recovery."
          resetLabel="delete worktree on archive"
          ariaLabel="Delete worktree on archive"
        />
        <WorktreeCleanupPolicyRows />
      </SettingsSection>
      <SettingsSectionShell title="Managed worktrees" id="setting-managed-worktrees">
        <WorktreesSettingsPanel active />
      </SettingsSectionShell>
    </div>
  );
}
