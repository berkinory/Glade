import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { PROVIDER_DESCRIPTORS as VISIBLE_PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import type { ReactNode } from "react";

import { useAppSettings, type AppSettings } from "../appSettings";
import { ProviderOptionLabel } from "../components/ProviderIcon";
import {
  SettingResetButton,
  SettingsSelectControl,
  SettingsSegmentedControl,
} from "../components/settings/SettingControls";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { SelectItem } from "../components/ui/select";
import { CentralIcon } from "../lib/central-icons";
import { WorktreeIcon } from "../lib/icons";
import { SETTINGS_TARGETS } from "../settingsNavigation";

const PROVIDER_SELECT_OPTIONS = VISIBLE_PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.kind);

const SIDEBAR_PROJECT_SORT_ORDER_LABELS = {
  updated_at: "Recently active",
  manual: "Manual order",
} as const;

function isProviderSelectOption(value: string): value is ProviderKind {
  return PROVIDER_SELECT_OPTIONS.includes(value as ProviderKind);
}

type BooleanSettingKey = {
  [Key in keyof AppSettings]-?: AppSettings[Key] extends boolean ? Key : never;
}[keyof AppSettings];

export function SettingsGeneralPanel(props: {
  renderBooleanSettingRow: (config: {
    settingKey: BooleanSettingKey;
    title: string;
    description?: string;
    resetLabel: string;
    ariaLabel: string;
  }) => ReactNode;
}) {
  const { settings, defaults, updateSettings } = useAppSettings();
  const { renderBooleanSettingRow } = props;
  return (
    <div className="space-y-6">
      <SettingsSection title="New chats">
        <SettingsRow
          id="setting-default-provider"
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
          id="setting-new-threads"
          title="New chats"
          description="Choose where new chats work."
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
            <SettingsSegmentedControl
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => updateSettings({ defaultThreadEnvMode: value })}
              ariaLabel="New chat workspace"
              options={[
                {
                  value: "local",
                  label: (
                    <>
                      <CentralIcon name="macbook-air" className="size-3.5" />
                      Local
                    </>
                  ),
                },
                {
                  value: "worktree",
                  label: (
                    <>
                      <WorktreeIcon className="size-3.5" />
                      New worktree
                    </>
                  ),
                },
              ]}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Sidebar organization">
        <SettingsRow
          id="setting-project-order"
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
                if (value !== "updated_at" && value !== "manual") {
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
              <SelectItem hideIndicator value="manual">
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS.manual}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <div
        id={SETTINGS_TARGETS.environmentPanel}
        className="space-y-4 rounded-lg border border-border p-3"
      >
        <SettingsSection title="Environment panel">
          {renderBooleanSettingRow({
            settingKey: "environmentPanelDefaultOpen",
            title: "Open by default",
            description: "Opening or closing the panel also updates this preference.",
            resetLabel: "environment panel default open",
            ariaLabel: "Open the Environment panel by default on chats",
          })}
        </SettingsSection>

        <SettingsSection title="Panel contents">
          {renderBooleanSettingRow({
            settingKey: "showEnvironmentUsage",
            title: "Usage",
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
              "Show the pull request link for the current branch in the chat Environment panel.",
            resetLabel: "pull request section",
            ariaLabel: "Show the Pull request section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentEditor",
            title: "Editor",
            resetLabel: "editor section",
            ariaLabel: "Show the Editor section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentPinned",
            title: "Pinned messages",
            resetLabel: "pinned messages section",
            ariaLabel: "Show the Pinned messages section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentNotepad",
            title: "Notepad",
            resetLabel: "notepad section",
            ariaLabel: "Show the Notepad section in the Environment panel",
          })}
        </SettingsSection>
      </div>
    </div>
  );
}
