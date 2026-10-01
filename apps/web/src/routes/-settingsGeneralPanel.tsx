import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { PROVIDER_DESCRIPTORS as VISIBLE_PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import type { ReactNode } from "react";

import { useAppSettings, type AppSettings, type SidebarLayout } from "../appSettings";
import { ProviderOptionLabel } from "../components/ProviderIcon";
import {
  SettingResetButton,
  SettingsSegmentedControl,
  SettingsSelectControl,
  type SettingsSegmentedOption,
} from "../components/settings/SettingControls";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { Button } from "../components/ui/button";
import { SelectItem } from "../components/ui/select";
import { ResetIcon } from "../lib/icons";
import { useOnboardingDialogStore } from "../onboarding/onboardingDialogStore";
import { SETTINGS_TARGETS } from "../settingsNavigation";

const SIDEBAR_LAYOUT_OPTIONS = [
  { value: "classic", label: "Classic" },
  { value: "rail", label: "Rail" },
] as const satisfies readonly SettingsSegmentedOption<SidebarLayout>[];

const PROVIDER_SELECT_OPTIONS = VISIBLE_PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.kind);

const SIDEBAR_PROJECT_SORT_ORDER_LABELS = {
  updated_at: "Recently active",
  created_at: "Recently added",
  manual: "Manual order",
} as const;

const SIDEBAR_THREAD_SORT_ORDER_LABELS = {
  updated_at: "Recently active",
  created_at: "Newest first",
} as const;

function isProviderSelectOption(value: string): value is ProviderKind {
  return PROVIDER_SELECT_OPTIONS.includes(value as ProviderKind);
}

type BooleanSettingKey = {
  [Key in keyof AppSettings]-?: AppSettings[Key] extends boolean ? Key : never;
}[keyof AppSettings];

export function SettingsGeneralPanel(props: {
  onRestoreDefaults: () => void;
  renderBooleanSettingRow: (config: {
    settingKey: BooleanSettingKey;
    title: string;
    description: string;
    resetLabel: string;
    ariaLabel: string;
  }) => ReactNode;
}) {
  const { settings, defaults, updateSettings } = useAppSettings();
  const { onRestoreDefaults, renderBooleanSettingRow } = props;
  return (
    <div className="space-y-6">
      <SettingsSection title="Core defaults">
        <SettingsRow
          title="Default provider"
          description="Provider used for new chats until you pick a model. New chats then reuse your most recent model and options."
          resetAction={
            settings.defaultProvider !== defaults.defaultProvider ? (
              <SettingResetButton
                label="default provider"
                onClick={() => updateSettings({ defaultProvider: defaults.defaultProvider })}
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.defaultProvider}
              onValueChange={(value) => {
                if (!isProviderSelectOption(value)) return;
                updateSettings({ defaultProvider: value });
              }}
              ariaLabel="Default provider"
              valueContent={
                <ProviderOptionLabel
                  provider={settings.defaultProvider}
                  label={PROVIDER_DISPLAY_NAMES[settings.defaultProvider]}
                />
              }
            >
              {PROVIDER_SELECT_OPTIONS.map((provider) => (
                <SelectItem hideIndicator key={provider} value={provider}>
                  <ProviderOptionLabel
                    provider={provider}
                    label={PROVIDER_DISPLAY_NAMES[provider]}
                  />
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />

        <SettingsRow
          title="New threads"
          description="Pick the default workspace mode for newly created draft threads."
          resetAction={
            settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: defaults.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value !== "local" && value !== "worktree") return;
                updateSettings({
                  defaultThreadEnvMode: value,
                });
              }}
              ariaLabel="Default thread mode"
              valueContent={settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
            >
              <SelectItem hideIndicator value="local">
                Local
              </SelectItem>
              <SelectItem hideIndicator value="worktree">
                New worktree
              </SelectItem>
            </SettingsSelectControl>
          }
        />

        {renderBooleanSettingRow({
          settingKey: "archiveDeletesOrphanedWorktree",
          title: "Delete worktree on archive",
          description:
            "After Archive's Undo period, remove a clean worktree only if the task has stopped and no other task uses it. Its branch remains available for recovery.",
          resetLabel: "delete worktree on archive",
          ariaLabel: "Delete worktree on archive",
        })}

        <SettingsRow
          title="Welcome tour"
          description="Replay the first-run setup: feature tour, provider selection, appearance, and first project."
          control={
            <Button
              variant="outline"
              onClick={() => useOnboardingDialogStore.getState().openDialog()}
            >
              Open welcome tour
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title="Sidebar organization">
        {
          <SettingsRow
            title="Sidebar layout"
            description="Classic keeps the single sidebar. Rail adds fixed icon tabs on the left, with projects and threads in a panel beside them."
            resetAction={
              settings.sidebarLayout !== defaults.sidebarLayout ? (
                <SettingResetButton
                  label="sidebar layout"
                  onClick={() => updateSettings({ sidebarLayout: defaults.sidebarLayout })}
                />
              ) : null
            }
            control={
              <SettingsSegmentedControl
                value={settings.sidebarLayout}
                onValueChange={(value) => updateSettings({ sidebarLayout: value })}
                ariaLabel="Sidebar layout"
                options={SIDEBAR_LAYOUT_OPTIONS}
              />
            }
          />
        }

        <SettingsRow
          title="Project order"
          description="Controls how projects are arranged in the main sidebar."
          resetAction={
            settings.sidebarProjectSortOrder !== defaults.sidebarProjectSortOrder ? (
              <SettingResetButton
                label="project order"
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: defaults.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (value !== "updated_at" && value !== "created_at" && value !== "manual") {
                  return;
                }
                updateSettings({ sidebarProjectSortOrder: value });
              }}
              ariaLabel="Project sort order"
              valueContent={SIDEBAR_PROJECT_SORT_ORDER_LABELS[settings.sidebarProjectSortOrder]}
            >
              <SelectItem hideIndicator value="updated_at">
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS.updated_at}
              </SelectItem>
              <SelectItem hideIndicator value="created_at">
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS.created_at}
              </SelectItem>
              <SelectItem hideIndicator value="manual">
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS.manual}
              </SelectItem>
            </SettingsSelectControl>
          }
        />

        <SettingsRow
          title="Thread order"
          description="Controls how threads are arranged inside each project in the main sidebar."
          resetAction={
            settings.sidebarThreadSortOrder !== defaults.sidebarThreadSortOrder ? (
              <SettingResetButton
                label="thread order"
                onClick={() =>
                  updateSettings({
                    sidebarThreadSortOrder: defaults.sidebarThreadSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sidebarThreadSortOrder}
              onValueChange={(value) => {
                if (value !== "updated_at" && value !== "created_at") {
                  return;
                }
                updateSettings({ sidebarThreadSortOrder: value });
              }}
              ariaLabel="Thread sort order"
              valueContent={SIDEBAR_THREAD_SORT_ORDER_LABELS[settings.sidebarThreadSortOrder]}
            >
              <SelectItem hideIndicator value="updated_at">
                {SIDEBAR_THREAD_SORT_ORDER_LABELS.updated_at}
              </SelectItem>
              <SelectItem hideIndicator value="created_at">
                {SIDEBAR_THREAD_SORT_ORDER_LABELS.created_at}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSection title="Sidebar sections">
        {renderBooleanSettingRow({
          settingKey: "showChatsSection",
          title: "Chats",
          description:
            "Show the standalone Chats list in the sidebar footer (chats not tied to a project).",
          resetLabel: "chats section",
          ariaLabel: "Show the Chats section in the sidebar",
        })}
      </SettingsSection>

      <div id={SETTINGS_TARGETS.environmentPanel} className="space-y-6">
        <SettingsSection title="Environment panel">
          {renderBooleanSettingRow({
            settingKey: "environmentPanelDefaultOpen",
            title: "Open by default",
            description:
              "Open the chat Environment panel automatically on normal threads. When off, the panel stays closed until you open it. Your last open/close also updates this preference.",
            resetLabel: "environment panel default open",
            ariaLabel: "Open the Environment panel by default on normal threads",
          })}
        </SettingsSection>

        <SettingsSection title="Code and status">
          {renderBooleanSettingRow({
            settingKey: "showEnvironmentUsage",
            title: "Usage",
            description: "Show the provider usage row in the chat Environment panel.",
            resetLabel: "usage section",
            ariaLabel: "Show the Usage section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentRepository",
            title: "Repository",
            description:
              "Show the GitHub repository link in the chat Environment panel. The git block (Changes, Worktree, branch, Commit and Push) always stays visible.",
            resetLabel: "repository section",
            ariaLabel: "Show the Repository section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentPullRequest",
            title: "Pull request",
            description:
              "Show the open pull request (CI checks and review comments) for the current branch in the chat Environment panel.",
            resetLabel: "pull request section",
            ariaLabel: "Show the Pull request section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentEditor",
            title: "Editor",
            description: "Show the Open in editor picker in the chat Environment panel.",
            resetLabel: "editor section",
            ariaLabel: "Show the Editor section in the Environment panel",
          })}
        </SettingsSection>

        <SettingsSection title="Context and notes">
          {renderBooleanSettingRow({
            settingKey: "showEnvironmentPinned",
            title: "Pinned messages",
            description: "Show the pinned-messages checklist in the Environment panel.",
            resetLabel: "pinned messages section",
            ariaLabel: "Show the Pinned messages section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentInstructions",
            title: "Project instructions",
            description: "Show project-level instructions in the Environment panel.",
            resetLabel: "project instructions section",
            ariaLabel: "Show the Project instructions section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentNotepad",
            title: "Notepad",
            description: "Show the per-thread notepad in the Environment panel.",
            resetLabel: "notepad section",
            ariaLabel: "Show the Notepad section in the Environment panel",
          })}
        </SettingsSection>
      </div>

      <SettingsSection title="Reset settings">
        <SettingsRow
          title="Restore defaults"
          description="Reset Glade preferences, theme customizations, and provider preferences."
          control={
            <Button size="sm" variant="outline" onClick={() => onRestoreDefaults()}>
              <ResetIcon className="size-3.5" />
              Restore defaults
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
