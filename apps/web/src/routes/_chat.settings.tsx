import { GitForkIcon, LaptopIcon, RefreshCwIcon } from "~/lib/icons";
import { ComputerSettings } from "~/components/computer/ComputerSettings";
import { SshHostsSettingsPanel } from "~/components/settings/SshHostsSettingsPanel";
import { RemoteAccessSettingsPanel } from "~/components/settings/remoteAccess/RemoteAccessSettingsPanel";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { type ComponentProps, useEffect, useMemo, useState } from "react";

import { AboutSettingsSections } from "~/components/settings/AboutSettingsSections";
import { BooleanSettingRow } from "~/components/settings/BooleanSettingRow";
import { GitAndFilesSettingsPanel } from "~/components/settings/GitAndFilesSettingsPanel";
import { ArchivedSettingsPanel } from "~/components/settings/ConversationStorageSettingsPanels";
import { NotificationsSettingsPanel } from "~/components/settings/DesktopSettingsPanels";
import { ProvidersSettingsPanel } from "~/components/settings/ProvidersSettingsPanel";
import {
  DEFAULT_CHAT_WIDTH,
  DEFAULT_EDITOR_CARET_STYLE,
  DEFAULT_UI_DENSITY,
  MAX_CHAT_FONT_SIZE_PX,
  MAX_TERMINAL_FONT_SIZE_PX,
  MIN_CHAT_FONT_SIZE_PX,
  MIN_TERMINAL_FONT_SIZE_PX,
  normalizeChatFontSizePx,
  normalizeTerminalFontFamily,
  normalizeTerminalFontSizePx,
  TERMINAL_FONT_FAMILY_SUGGESTIONS,
  useAppSettings,
  type EditorCaretStyle,
  type FollowUpBehavior,
  type UiDensity,
} from "../appSettings";
import {
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "../components/chat/chatHeaderControls";
import {
  CHAT_CONTENT_CARD_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import ReleaseHistoryDialog from "../components/ReleaseHistoryDialog";
import { RouteInsetSurface } from "../components/RouteInsetSurface";
import { KeyboardShortcutsSettingsPanel } from "../components/settings/KeyboardShortcutsSettingsPanel";
import { ProfileSettingsPanel } from "../components/settings/ProfileSettingsPanel";
import { ProviderUsageSettingsPanel } from "../components/settings/ProviderUsageSettingsPanel";
import {
  SettingResetButton,
  SettingsSegmentedControl,
  type SettingsSegmentedOption,
} from "../components/settings/SettingControls";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSectionShell,
} from "../components/settings/SettingsPanelPrimitives";
import { SkillsSettingsPanel } from "../components/settings/skills/SkillsSettingsPanel";
import { ConnectorsSettingsPanel } from "../components/settings/connectors/ConnectorsSettingsPanel";
import { MachinePicker } from "../components/settings/machine/MachinePicker";
import { useSettingsMachine } from "../components/settings/machine/settingsMachine";
import { HostProvidersPanel } from "../components/settings/machine/HostProvidersPanel";
import { ThemeModePicker } from "../components/settings/ThemeModePicker";
import { SidebarHeaderNavigationControls } from "../components/SidebarHeaderNavigationControls";
import { KeepAwakeSettingsRow } from "../components/settings/KeepAwakeSettingsRow";
import { ThemeFontSettings } from "../components/settings/ThemeFontSettings";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../components/ui/autocomplete";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { toastManager } from "../components/ui/toast";
import { isElectron } from "../env";
import { useDesktopCustomTitleBarState } from "../hooks/useDesktopCustomTitleBar";
import { useDesktopTopBarTrafficLightGutterClassName } from "../hooks/useDesktopTopBarGutter";
import { useTheme } from "../hooks/useTheme";
import { isUiDensity } from "../lib/appDensity";
import { isChatWidthMode, type ChatWidthMode } from "../lib/chatWidth";
import {
  cn,
  getNavigatorPlatform,
  isLinuxPlatform,
  isMacPlatform,
  isWindowsPlatform,
} from "../lib/utils";
import { ensureNativeApi, readNativeApi } from "../nativeApi";
import {
  normalizeSettingsSection,
  settingRowAnchorId,
  SETTINGS_NAV_ITEMS,
  SETTINGS_TARGETS,
  type SettingsSectionId,
} from "../settingsNavigation";
import { SETTINGS_PAGE_BACKGROUND_CLASS_NAME } from "../settingsPanelStyles";
import { SettingsGeneralPanel } from "./-settingsGeneralPanel";

const EDITOR_CARET_STYLE_OPTIONS = [
  { value: "line", label: "Line" },
  { value: "block", label: "Block" },
] as const satisfies readonly SettingsSegmentedOption<EditorCaretStyle>[];

const UI_DENSITY_OPTIONS = [
  {
    value: "comfortable",
    label: "Default",
    description: "Balanced spacing for everyday use.",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Tighter spacing in the sidebar, composer, and settings rows.",
  },
] as const satisfies ReadonlyArray<{
  value: UiDensity;
  label: string;
  description: string;
}>;

const CHAT_WIDTH_OPTIONS = [
  {
    value: "standard",
    label: "Default",
    description: "Keeps the chat column at the default reading width (46rem).",
  },
  {
    value: "wide",
    label: "Wide",
    description: "Gives tables and wide content more room (72rem).",
  },
] as const satisfies ReadonlyArray<{
  value: ChatWidthMode;
  label: string;
  description: string;
}>;

const FOLLOW_UP_BEHAVIOR_OPTIONS = [
  { value: "queue", label: "Queue" },
  { value: "steer", label: "Steer" },
] as const satisfies ReadonlyArray<{ value: FollowUpBehavior; label: string }>;

// Sections that show one machine's agents, picked in the header.
const MACHINE_SECTIONS: ReadonlySet<SettingsSectionId> = new Set(["providers", "skills", "mcp"]);

function SettingsRouteView() {
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSection = normalizeSettingsSection(routeSearch.section);
  const machine = useSettingsMachine();
  const settingsTarget = typeof routeSearch.target === "string" ? routeSearch.target : null;
  const activeSectionItem = SETTINGS_NAV_ITEMS.find((item) => item.id === activeSection)!;

  const { resetAllThemes, theme, setTheme } = useTheme();
  const { settings, defaults, updateSettings, updateSettingsAndWait, resetSettings } =
    useAppSettings();
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [resetEpoch, setResetEpoch] = useState(0);
  const platform = getNavigatorPlatform();
  const shouldShowFontSmoothing = isMacPlatform(platform);
  const supportsCustomTitleBarSetting =
    isElectron && (isWindowsPlatform(platform) || isLinuxPlatform(platform));
  const customTitleBarState = useDesktopCustomTitleBarState();
  const customTitleBarRestartRequired =
    customTitleBarState.supported && settings.useCustomTitleBar !== customTitleBarState.active;
  const customTitleBarPreferenceDirty =
    supportsCustomTitleBarSetting &&
    (settings.useCustomTitleBar !== defaults.useCustomTitleBar ||
      (customTitleBarState.supported &&
        customTitleBarState.preference !== defaults.useCustomTitleBar));

  function showCustomTitleBarRestartToast(): void {
    toastManager.add({
      type: "warning",
      title: "Restart to apply title bar",
      description: "The window frame updates the next time Glade launches.",
      data: {
        actions: [
          {
            label: "Restart",
            icon: RefreshCwIcon,
            onClick: () => {
              void window.desktopBridge?.customTitleBar?.relaunch();
            },
          },
        ],
      },
    });
  }

  async function persistCustomTitleBarPreference(
    enabled: boolean,
  ): Promise<{ readonly restartRequired: boolean } | null> {
    try {
      const bridge = window.desktopBridge?.customTitleBar;
      if (!bridge) throw new Error("Desktop title bar bridge is unavailable.");
      const state = await bridge.setPreference(enabled);
      if (!state.supported || state.preference !== enabled) {
        throw new Error("Desktop title bar preference was not persisted.");
      }
      return state;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not update title bar",
        description: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async function applyCustomTitleBarPreference(enabled: boolean): Promise<void> {
    const previous = settings.useCustomTitleBar;
    updateSettings({ useCustomTitleBar: enabled });
    const state = await persistCustomTitleBarPreference(enabled);
    if (state === null) {
      updateSettings({ useCustomTitleBar: previous });
      return;
    }
    if (state.restartRequired) showCustomTitleBarRestartToast();
  }

  const visibleTerminalFontFamilySuggestions = useMemo(() => {
    const query = settings.terminalFontFamily.trim().toLowerCase();
    if (!query) return TERMINAL_FONT_FAMILY_SUGGESTIONS;
    return TERMINAL_FONT_FAMILY_SUGGESTIONS.filter((suggestion) =>
      suggestion.toLowerCase().includes(query),
    );
  }, [settings.terminalFontFamily]);

  useEffect(() => {
    if (!settingsTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(settingsTarget);
      if (!element) return;
      element.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      element.setAttribute("tabindex", "-1");
      element.focus({ preventScroll: true });
      element.classList.add("ring-2", "ring-primary", "rounded-lg");
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const element = document.getElementById(settingsTarget);
      element?.classList.remove("ring-2", "ring-primary", "rounded-lg");
      element?.removeAttribute("tabindex");
    };
  }, [activeSection, settingsTarget]);

  async function restoreDefaults() {
    const api = readNativeApi();
    const confirmed = await (api ?? ensureNativeApi()).dialogs.confirm(
      "Restore default settings?\nThis resets Glade preferences, appearance settings, and provider preferences.",
    );
    if (!confirmed) return;

    if (customTitleBarPreferenceDirty) {
      const state = await persistCustomTitleBarPreference(defaults.useCustomTitleBar);
      if (state === null) return;
      if (state.restartRequired) showCustomTitleBarRestartToast();
    }

    resetAllThemes();
    await resetSettings();
    setResetEpoch((current) => current + 1);
  }

  const binding = { settings, defaults, updateSettings };
  const renderBooleanSettingRow = (
    config: Omit<ComponentProps<typeof BooleanSettingRow>, "binding">,
  ) => <BooleanSettingRow binding={binding} {...config} />;

  const renderAppearancePanel = () => (
    <div className="space-y-6">
      <SettingsSectionShell
        title="Theme"
        action={
          theme !== "system" ? (
            <SettingResetButton label="theme" onClick={() => setTheme("system")} />
          ) : null
        }
      >
        <div id={settingRowAnchorId("Theme")} className="scroll-mt-24 pb-1.5">
          <ThemeModePicker value={theme} onValueChange={setTheme} ariaLabel="Theme preference" />
        </div>
      </SettingsSectionShell>

      {isElectron && supportsCustomTitleBarSetting ? (
        <SettingsSection title="App">
          {supportsCustomTitleBarSetting ? (
            <SettingsRow
              title="Use custom title bar"
              description={
                customTitleBarRestartRequired
                  ? "Restart Glade to apply. Some Linux window managers work better with the system title bar."
                  : "Replace the system title bar with Glade's frameless chrome and window controls. Restart required to apply."
              }
              status={customTitleBarRestartRequired ? "Restart required" : undefined}
              resetAction={
                settings.useCustomTitleBar !== defaults.useCustomTitleBar ? (
                  <SettingResetButton
                    label="custom title bar"
                    onClick={() => {
                      void applyCustomTitleBarPreference(defaults.useCustomTitleBar);
                    }}
                  />
                ) : null
              }
              control={
                <div className="flex items-center gap-2">
                  {customTitleBarRestartRequired ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        void window.desktopBridge?.customTitleBar?.relaunch();
                      }}
                    >
                      Restart
                    </Button>
                  ) : null}
                  <Switch
                    checked={settings.useCustomTitleBar}
                    onCheckedChange={(checked) => {
                      void applyCustomTitleBarPreference(Boolean(checked));
                    }}
                    aria-label="Use custom title bar"
                  />
                </div>
              }
            />
          ) : null}
        </SettingsSection>
      ) : null}

      <SettingsSection title="Layout">
        <SettingsRow
          id="setting-ui-density"
          title="UI density"
          description="Control spacing in the sidebar, composer, chat gutters, and settings rows without changing font size."
          resetAction={
            settings.uiDensity !== defaults.uiDensity ? (
              <SettingResetButton
                label="UI density"
                onClick={() =>
                  updateSettings({
                    uiDensity: DEFAULT_UI_DENSITY,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSegmentedControl
              value={settings.uiDensity}
              onValueChange={(value) => {
                if (!isUiDensity(value)) {
                  return;
                }
                updateSettings({ uiDensity: value });
              }}
              ariaLabel="UI density"
              options={UI_DENSITY_OPTIONS}
            />
          }
        />

        <SettingsRow
          id="setting-chat-width"
          title="Chat width"
          description="Control how wide the chat column grows. Wide gives tables and wide content more room."
          resetAction={
            settings.chatWidth !== defaults.chatWidth ? (
              <SettingResetButton
                label="chat width"
                onClick={() =>
                  updateSettings({
                    chatWidth: DEFAULT_CHAT_WIDTH,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSegmentedControl
              value={settings.chatWidth}
              onValueChange={(value) => {
                if (!isChatWidthMode(value)) {
                  return;
                }
                updateSettings({ chatWidth: value });
              }}
              ariaLabel="Chat width"
              options={CHAT_WIDTH_OPTIONS}
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Fonts">
        <ThemeFontSettings />
        <SettingsRow
          id="setting-base-font-size"
          title="App font size"
          description="Adjust the app text base in pixels. Chat and UI typography scale proportionally from this value."
          resetAction={
            settings.chatFontSizePx !== defaults.chatFontSizePx ? (
              <SettingResetButton
                label="app font size"
                onClick={() =>
                  updateSettings({
                    chatFontSizePx: defaults.chatFontSizePx,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Input
                type="number"
                size="sm"
                min={MIN_CHAT_FONT_SIZE_PX}
                max={MAX_CHAT_FONT_SIZE_PX}
                step={1}
                inputMode="numeric"
                variant="soft"
                className="w-full text-right sm:w-20"
                value={String(settings.chatFontSizePx)}
                onChange={(event) => {
                  const nextValue = event.target.value.trim();
                  if (nextValue.length === 0) return;
                  updateSettings({
                    chatFontSizePx: normalizeChatFontSizePx(Number(nextValue)),
                  });
                }}
                aria-label="App font size in pixels"
              />
              <span className="text-ui leading-snug text-muted-foreground">px</span>
            </div>
          }
        />

        {shouldShowFontSmoothing
          ? renderBooleanSettingRow({
              settingKey: "enableNativeFontSmoothing",
              title: "Font smoothing",
              description: "Use macOS-style antialiasing for lighter, crisper text rendering.",
              resetLabel: "font smoothing",
              ariaLabel: "Enable font smoothing",
            })
          : null}
      </SettingsSection>
      <SettingsSection title="Terminal typography">
        <SettingsRow
          id="setting-terminal-font-size"
          title="Terminal font size"
          description="Adjust terminal text independently from the app and chat font size."
          resetAction={
            settings.terminalFontSizePx !== defaults.terminalFontSizePx ? (
              <SettingResetButton
                label="terminal font size"
                onClick={() =>
                  updateSettings({
                    terminalFontSizePx: defaults.terminalFontSizePx,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Input
                type="number"
                size="sm"
                min={MIN_TERMINAL_FONT_SIZE_PX}
                max={MAX_TERMINAL_FONT_SIZE_PX}
                step={1}
                inputMode="numeric"
                variant="soft"
                className="w-full text-right sm:w-20"
                value={String(settings.terminalFontSizePx)}
                onChange={(event) => {
                  const nextValue = event.target.value.trim();
                  if (nextValue.length === 0) return;
                  updateSettings({
                    terminalFontSizePx: normalizeTerminalFontSizePx(Number(nextValue)),
                  });
                }}
                aria-label="Terminal font size in pixels"
              />
              <span className="text-ui leading-snug text-muted-foreground">px</span>
            </div>
          }
        />

        <SettingsRow
          id="setting-terminal-font"
          title="Terminal font"
          description="Type any monospace font installed on this device (e.g. Fira Code). Leave empty for the default. Fonts that aren't installed fall back to the system monospace."
          resetAction={
            settings.terminalFontFamily !== defaults.terminalFontFamily ? (
              <SettingResetButton
                label="terminal font"
                onClick={() =>
                  updateSettings({
                    terminalFontFamily: defaults.terminalFontFamily,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center justify-end sm:w-auto">
              <Autocomplete
                items={visibleTerminalFontFamilySuggestions}
                mode="none"
                openOnInputClick
                value={settings.terminalFontFamily}
                onValueChange={(value) => {
                  updateSettings({
                    terminalFontFamily: normalizeTerminalFontFamily(value),
                  });
                }}
              >
                <AutocompleteInput
                  size="sm"
                  variant="soft"
                  showTrigger
                  showClear={settings.terminalFontFamily.length > 0}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Default (JetBrains Mono)"
                  className="w-full sm:w-56"
                  aria-label="Terminal font family"
                />
                <AutocompletePopup className="w-56 min-w-56 font-system-ui">
                  <AutocompleteList>
                    {visibleTerminalFontFamilySuggestions.map((suggestion, index) => (
                      <AutocompleteItem
                        key={suggestion}
                        index={index}
                        value={suggestion}
                        className="font-normal text-[var(--color-text-foreground)]"
                        onClick={() => {
                          updateSettings({
                            terminalFontFamily: normalizeTerminalFontFamily(suggestion),
                          });
                        }}
                      >
                        {suggestion}
                      </AutocompleteItem>
                    ))}
                    <AutocompleteEmpty>No matching suggested fonts.</AutocompleteEmpty>
                  </AutocompleteList>
                </AutocompletePopup>
              </Autocomplete>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title="Editor">
        <SettingsRow
          id="setting-caret-style"
          title="Editor cursor"
          description="Choose the cursor shape when writing a message."
          resetAction={
            settings.editorCaretStyle !== defaults.editorCaretStyle ? (
              <SettingResetButton
                label="editor cursor"
                onClick={() => updateSettings({ editorCaretStyle: DEFAULT_EDITOR_CARET_STYLE })}
              />
            ) : null
          }
          control={
            <SettingsSegmentedControl
              value={settings.editorCaretStyle}
              onValueChange={(editorCaretStyle) => updateSettings({ editorCaretStyle })}
              ariaLabel="Editor cursor"
              options={EDITOR_CARET_STYLE_OPTIONS}
            />
          }
        />
      </SettingsSection>
    </div>
  );

  const renderBehaviorPanel = () => (
    <div className="space-y-6">
      <SettingsSection title="New chats">
        <SettingsRow
          id="setting-new-threads"
          title="Workspace"
          description="Choose where new chats work."
          resetAction={
            settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? (
              <SettingResetButton
                label="new chats"
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
              onValueChange={(value) =>
                updateSettings({
                  defaultThreadEnvMode: value,
                })
              }
              ariaLabel="New chat workspace"
              options={[
                {
                  value: "local",
                  label: (
                    <>
                      <LaptopIcon className="size-3.5" />
                      Local
                    </>
                  ),
                },
                {
                  value: "worktree",
                  label: (
                    <>
                      <GitForkIcon className="size-3.5" />
                      New worktree
                    </>
                  ),
                },
              ]}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Conversation">
        <SettingsRow
          id="setting-follow-up-behavior"
          title="Follow-up behavior"
          description="Queue waits for the current response; Steer redirects it. Ctrl/Cmd+Enter uses the opposite action."
          resetAction={
            settings.followUpBehavior !== defaults.followUpBehavior ? (
              <SettingResetButton
                label="follow-up behavior"
                onClick={() =>
                  updateSettings({
                    followUpBehavior: defaults.followUpBehavior,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSegmentedControl
              value={settings.followUpBehavior}
              onValueChange={(value) => updateSettings({ followUpBehavior: value })}
              ariaLabel="Follow-up behavior"
              options={FOLLOW_UP_BEHAVIOR_OPTIONS}
            />
          }
        />

        {renderBooleanSettingRow({
          settingKey: "enableAssistantStreaming",
          title: "Streaming",
          description: "Show token-by-token output while a response is in progress.",
          resetLabel: "streaming",
          ariaLabel: "Stream assistant messages",
        })}

        {renderBooleanSettingRow({
          settingKey: "autoContinueAtUsageLimit",
          title: "Continue after usage limits",
          description:
            "When a usage limit stops a chat, continue it automatically once the limit resets.",
          resetLabel: "continue after usage limits",
          ariaLabel: "Continue automatically after usage limits reset",
        })}

        {renderBooleanSettingRow({
          settingKey: "voiceSendOnEnter",
          title: "Send dictation with Enter",
          description:
            "Enter finishes recording and sends after transcription. When off, Enter only adds the transcript to your draft.",
          resetLabel: "send dictation with Enter",
          ariaLabel: "Send dictation with Enter",
        })}
      </SettingsSection>

      <SettingsSectionShell title="Environment panel" id={SETTINGS_TARGETS.environmentPanel}>
        <SettingsCard>
          {renderBooleanSettingRow({
            settingKey: "environmentPanelDefaultOpen",
            title: "Open by default",
            description: "Opening or closing the panel also updates this preference.",
            resetLabel: "environment panel default open",
            ariaLabel: "Open the Environment panel by default on chats",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentUsage",
            title: "Show usage",
            resetLabel: "usage section",
            ariaLabel: "Show the Usage section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentRepository",
            title: "Show repository",
            description:
              "Link to the GitHub repository. Git changes and branch controls always show.",
            resetLabel: "repository section",
            ariaLabel: "Show the Repository section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentPullRequest",
            title: "Show pull request",
            description: "Link to the pull request for the current branch.",
            resetLabel: "pull request section",
            ariaLabel: "Show the Pull request section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentEditor",
            title: "Show editor",
            resetLabel: "editor section",
            ariaLabel: "Show the Editor section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentPinned",
            title: "Show pinned messages",
            resetLabel: "pinned messages section",
            ariaLabel: "Show the Pinned messages section in the Environment panel",
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentNotepad",
            title: "Show notepad",
            resetLabel: "notepad section",
            ariaLabel: "Show the Notepad section in the Environment panel",
          })}
        </SettingsCard>
      </SettingsSectionShell>

      <SettingsSection title="Power">
        <KeepAwakeSettingsRow />
      </SettingsSection>

      <SettingsSection title="Confirmations">
        {renderBooleanSettingRow({
          settingKey: "confirmThreadDelete",
          title: "Confirm before deleting a chat",
          description: "Deleting a chat removes its history.",
          resetLabel: "delete confirmation",
          ariaLabel: "Confirm before deleting a chat",
        })}

        {renderBooleanSettingRow({
          settingKey: "confirmThreadArchive",
          title: "Confirm before archiving a chat",
          description: "Archived chats can be restored from Archived chats.",
          resetLabel: "archive confirmation",
          ariaLabel: "Confirm before archiving a chat",
        })}

        {renderBooleanSettingRow({
          settingKey: "confirmTerminalTabClose",
          title: "Confirm before closing a terminal",
          description: "Ask before closing a terminal tab and clearing its history.",
          resetLabel: "terminal close confirmation",
          ariaLabel: "Confirm terminal tab close",
        })}
      </SettingsSection>
    </div>
  );

  const renderRouteOwnedPanel = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-6">
            <SettingsGeneralPanel />
            <AboutSettingsSections
              onOpenReleaseHistory={() => setReleaseHistoryOpen(true)}
              onRestoreDefaults={() => void restoreDefaults()}
            />
          </div>
        );
      case "appearance":
        return renderAppearancePanel();
      case "git":
        return <GitAndFilesSettingsPanel {...binding} />;
      case "behavior":
        return renderBehaviorPanel();
      case "shortcuts":
        return <KeyboardShortcutsSettingsPanel />;
      case "profile":
        return <ProfileSettingsPanel />;
      case "skills":
        return <SkillsSettingsPanel />;
      case "mcp":
        return <ConnectorsSettingsPanel />;
      case "usage":
        return <ProviderUsageSettingsPanel />;
      case "computer":
        return <ComputerSettings />;
      case "ssh":
        return <SshHostsSettingsPanel />;
      case "remote":
        return <RemoteAccessSettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
        SETTINGS_PAGE_BACKGROUND_CLASS_NAME,
        CHAT_CONTENT_CARD_CLASS_NAME,
      )}
    >
      <RouteInsetSurface surfaceClassName={SETTINGS_PAGE_BACKGROUND_CLASS_NAME}>
        {/* Keep settings navigation available with the sidebar collapsed. Preserve the Windows drag region
   without covering its caption controls. */}
        <div
          className={cn(
            "drag-region absolute inset-x-0 top-0 z-10 flex items-center",
            CHAT_SURFACE_HEADER_PADDING_X_CLASS,
            CHAT_SURFACE_HEADER_HEIGHT_CLASS,
            desktopTopBarTrafficLightGutterClassName,
          )}
        >
          <div className="pointer-events-auto">
            <SidebarHeaderNavigationControls />
          </div>
        </div>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <div
              className={cn(
                "mx-auto w-full px-6 py-8",
                activeSection === "profile" ? "max-w-3xl" : "max-w-2xl",
              )}
            >
              {
                <div className="mb-8 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-xl font-medium tracking-tight text-foreground">
                      {activeSectionItem.label}
                      {activeSectionItem.badge ? (
                        <Badge
                          variant="outline"
                          className="rounded-full px-2 font-normal tracking-normal text-muted-foreground"
                        >
                          {activeSectionItem.badge}
                        </Badge>
                      ) : null}
                    </h1>
                    <p className="mt-1.5 text-ui leading-relaxed text-muted-foreground">
                      {activeSectionItem.description}
                    </p>
                  </div>
                  {MACHINE_SECTIONS.has(activeSection) ? <MachinePicker /> : null}
                </div>
              }

              {renderRouteOwnedPanel()}

              <div className="contents">
                <NotificationsSettingsPanel
                  active={activeSection === "notifications"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                />
                <ArchivedSettingsPanel active={activeSection === "archived"} />
                {activeSection === "providers" && machine.remote ? (
                  <HostProvidersPanel machine={machine} />
                ) : null}
                <ProvidersSettingsPanel
                  active={activeSection === "providers" && machine.remote === null}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                  updateSettingsAndWait={updateSettingsAndWait}
                  resetEpoch={resetEpoch}
                />
              </div>
            </div>
          </div>
        </div>

        <ReleaseHistoryDialog open={releaseHistoryOpen} onOpenChange={setReleaseHistoryOpen} />
      </RouteInsetSurface>
    </div>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
