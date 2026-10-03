import { McpSettingsPanel } from "~/components/settings/McpSettingsPanel";
import { PluginsSettingsPanel } from "~/components/settings/PluginsSettingsPanel";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { AdvancedSettingsPanel } from "~/components/settings/AdvancedSettingsPanel";
import { AppIconPicker } from "~/components/settings/AppIconPicker";
import { ComputerSettingsPanel } from "~/components/settings/ComputerSettingsPanel";
import {
  ArchivedSettingsPanel,
  WorktreesSettingsPanel,
} from "~/components/settings/ConversationStorageSettingsPanels";
import { NotificationsSettingsPanel } from "~/components/settings/DesktopSettingsPanels";
import { ModelsSettingsPanel } from "~/components/settings/ModelsSettingsPanel";
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
  type AppSettings,
  type EditorCaretStyle,
  type FollowUpBehavior,
  type UiDensity,
} from "../appSettings";
import { APP_VERSION } from "../branding";
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
  SettingsSelectControl,
  type SettingsSegmentedOption,
} from "../components/settings/SettingControls";
import {
  SettingsRow,
  SettingsSection,
  SettingsSectionShell,
} from "../components/settings/SettingsPanelPrimitives";
import { SkillsSettingsPanel } from "../components/settings/SkillsSettingsPanel";
import { ThemeModePicker } from "../components/settings/ThemeModePicker";
import { SidebarHeaderNavigationControls } from "../components/SidebarHeaderNavigationControls";
import { ThemePackEditor } from "../components/ThemePackEditor";
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
import { SelectItem } from "../components/ui/select";
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
} from "../settingsNavigation";
import { SETTINGS_PAGE_BACKGROUND_CLASS_NAME } from "../settingsPanelStyles";
import { SettingsGeneralPanel } from "./-settingsGeneralPanel";

const EDITOR_CARET_STYLE_OPTIONS = [
  { value: "line", label: "Line" },
  { value: "block", label: "Block" },
] as const satisfies readonly SettingsSegmentedOption<EditorCaretStyle>[];

const UI_DENSITY_OPTIONS = [
  {
    value: "compact",
    label: "Compact",
    description: "Tighter spacing in the sidebar, composer, and settings rows.",
  },
  {
    value: "comfortable",
    label: "Comfortable",
    description: "Balanced spacing for everyday use.",
  },
  {
    value: "spacious",
    label: "Spacious",
    description: "More breathing room across the main workspace surfaces.",
  },
] as const satisfies ReadonlyArray<{
  value: UiDensity;
  label: string;
  description: string;
}>;

const CHAT_WIDTH_OPTIONS = [
  {
    value: "standard",
    label: "Standard",
    description: "Keeps the chat column at the default reading width (46rem).",
  },
  {
    value: "wide",
    label: "Wide",
    description: "Gives tables and wide content more room (72rem).",
  },
  {
    value: "full",
    label: "Full",
    description: "Lets the chat column use the full window width.",
  },
] as const satisfies ReadonlyArray<{
  value: ChatWidthMode;
  label: string;
  description: string;
}>;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const FOLLOW_UP_BEHAVIOR_OPTIONS = [
  { value: "queue", label: "Queue" },
  { value: "steer", label: "Steer" },
] as const satisfies ReadonlyArray<{ value: FollowUpBehavior; label: string }>;

type BooleanSettingKey = {
  [Key in keyof AppSettings]-?: AppSettings[Key] extends boolean ? Key : never;
}[keyof AppSettings];

function SettingsRouteView() {
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSection = normalizeSettingsSection(routeSearch.section);
  const settingsTarget = typeof routeSearch.target === "string" ? routeSearch.target : null;
  const activeSectionItem = SETTINGS_NAV_ITEMS.find((item) => item.id === activeSection)!;

  const { resetAllThemes, resolvedTheme, theme, setTheme, systemUiFont, setSystemUiFont } =
    useTheme();
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
      actionProps: {
        "aria-label": "Restart Glade",
        children: "Restart",
        onClick: () => {
          void window.desktopBridge?.customTitleBar?.relaunch();
        },
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
      "Restore default settings?\nThis resets Glade preferences, theme customizations, and provider preferences.",
    );
    if (!confirmed) return;

    if (customTitleBarPreferenceDirty) {
      const state = await persistCustomTitleBarPreference(defaults.useCustomTitleBar);
      if (state === null) return;
      if (state.restartRequired) showCustomTitleBarRestartToast();
    }

    setTheme("system");
    resetAllThemes();
    setSystemUiFont(true);
    await resetSettings();
    setResetEpoch((current) => current + 1);
  }

  const renderBooleanSettingRow = (config: {
    settingKey: BooleanSettingKey;
    title: string;
    description?: string;
    resetLabel: string;
    ariaLabel: string;
  }) => {
    const { settingKey, title, description, resetLabel, ariaLabel } = config;
    const isChanged = settings[settingKey] !== defaults[settingKey];
    return (
      <SettingsRow
        id={`setting-${settingKey}`}
        title={title}
        description={description}
        resetAction={
          isChanged ? (
            <SettingResetButton
              label={resetLabel}
              onClick={() =>
                updateSettings({ [settingKey]: defaults[settingKey] } as Partial<AppSettings>)
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings[settingKey]}
            onCheckedChange={(checked) =>
              updateSettings({ [settingKey]: Boolean(checked) } as Partial<AppSettings>)
            }
            aria-label={ariaLabel}
          />
        }
      />
    );
  };

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

        <div className="space-y-3">
          {(resolvedTheme === "dark"
            ? (["dark", "light"] as const)
            : (["light", "dark"] as const)
          ).map((variant) => (
            <ThemePackEditor
              key={variant}
              variant={variant}
              isActive={resolvedTheme === variant}
              mode={theme}
            />
          ))}
        </div>
      </SettingsSectionShell>

      {isElectron ? (
        <SettingsSection title="App">
          <SettingsRow
            title="App icon"
            description="Choose the icon Glade uses in the dock or taskbar."
            resetAction={
              settings.desktopAppIcon !== defaults.desktopAppIcon ? (
                <SettingResetButton
                  label="app icon"
                  onClick={() => updateSettings({ desktopAppIcon: defaults.desktopAppIcon })}
                />
              ) : null
            }
            control={
              <AppIconPicker
                platform={platform}
                value={settings.desktopAppIcon}
                onValueChange={async (desktopAppIcon) => {
                  if (desktopAppIcon !== settings.desktopAppIcon) {
                    updateSettings({ desktopAppIcon });
                  }
                  await window.desktopBridge?.setAppIcon(desktopAppIcon);
                }}
              />
            }
          />
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

      <SettingsSection title="Interface typography and layout">
        <SettingsRow
          id="setting-use-system-ui-font"
          title="Use system font"
          description="Ignore the theme's custom UI font and render the interface with the native system font (SF Pro on macOS)."
          resetAction={
            !systemUiFont ? (
              <SettingResetButton label="system UI font" onClick={() => setSystemUiFont(true)} />
            ) : null
          }
          control={
            <Switch
              checked={systemUiFont}
              onCheckedChange={(checked) => setSystemUiFont(Boolean(checked))}
              aria-label="Use system font"
            />
          }
        />

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
          description="Control how wide the chat column grows. Wide and Full give tables and wide content more room."
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

      <SettingsSection title="Composer">
        <SettingsRow
          id="setting-caret-style"
          title="Composer cursor"
          description="Choose the cursor shape when writing a message."
          resetAction={
            settings.editorCaretStyle !== defaults.editorCaretStyle ? (
              <SettingResetButton
                label="composer cursor"
                onClick={() => updateSettings({ editorCaretStyle: DEFAULT_EDITOR_CARET_STYLE })}
              />
            ) : null
          }
          control={
            <SettingsSegmentedControl
              value={settings.editorCaretStyle}
              onValueChange={(editorCaretStyle) => updateSettings({ editorCaretStyle })}
              ariaLabel="Composer cursor"
              options={EDITOR_CARET_STYLE_OPTIONS}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Time">
        <SettingsRow
          id="setting-time-format"
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== defaults.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: defaults.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value !== "locale" && value !== "12-hour" && value !== "24-hour") {
                  return;
                }
                updateSettings({
                  timestampFormat: value,
                });
              }}
              ariaLabel="Timestamp format"
              triggerClassName="w-full sm:w-40"
              valueContent={TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}
            >
              <SelectItem hideIndicator value="locale">
                {TIMESTAMP_FORMAT_LABELS.locale}
              </SelectItem>
              <SelectItem hideIndicator value="12-hour">
                {TIMESTAMP_FORMAT_LABELS["12-hour"]}
              </SelectItem>
              <SelectItem hideIndicator value="24-hour">
                {TIMESTAMP_FORMAT_LABELS["24-hour"]}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>
    </div>
  );

  const renderBehaviorPanel = () => (
    <div className="space-y-6">
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
          settingKey: "voiceSendOnEnter",
          title: "Send dictation with Enter",
          description:
            "Enter finishes recording and sends after transcription. When off, Enter only adds the transcript to your draft.",
          resetLabel: "send dictation with Enter",
          ariaLabel: "Send dictation with Enter",
        })}

        {renderBooleanSettingRow({
          settingKey: "composerEffortSlider",
          title: "Show effort control",
          description: "Adjust reasoning effort when choosing a model for a chat.",
          resetLabel: "effort control",
          ariaLabel: "Show effort control",
        })}
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

  const renderFilesPanel = () => (
    <div className="space-y-6">
      <SettingsSection title="File visibility">
        {renderBooleanSettingRow({
          settingKey: "hideIgnoredFiles",
          title: "Hide ignored files",
          description: "Hide gitignored files and folders from the Explorer tree.",
          resetLabel: "hide ignored files",
          ariaLabel: "Hide ignored files",
        })}
      </SettingsSection>
      <SettingsSection title="Diff display">
        {renderBooleanSettingRow({
          settingKey: "showPullRequestDiffColors",
          title: "Pull request diff colors",
          description: "Show additions in green and deletions in red in pull request summaries.",
          resetLabel: "pull request diff colors",
          ariaLabel: "Show pull request diff colors",
        })}

        {renderBooleanSettingRow({
          settingKey: "diffWordWrap",
          title: "Diff line wrapping",
          description: "Wrap long lines in Source Control diffs.",
          resetLabel: "diff line wrapping",
          ariaLabel: "Wrap diff lines by default",
        })}
      </SettingsSection>
    </div>
  );

  const renderRouteOwnedPanel = () => {
    switch (activeSection) {
      case "general":
        return <SettingsGeneralPanel renderBooleanSettingRow={renderBooleanSettingRow} />;
      case "appearance":
        return renderAppearancePanel();
      case "files":
        return renderFilesPanel();
      case "behavior":
        return renderBehaviorPanel();
      case "shortcuts":
        return <KeyboardShortcutsSettingsPanel />;
      case "profile":
        return <ProfileSettingsPanel />;
      case "mcp":
        return <McpSettingsPanel />;
      case "plugins":
        return <PluginsSettingsPanel />;
      case "skills":
        return <SkillsSettingsPanel />;
      case "usage":
        return <ProviderUsageSettingsPanel />;
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
                <div className="mb-8">
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
                <ComputerSettingsPanel
                  active={activeSection === "computer"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                />
                <ArchivedSettingsPanel active={activeSection === "archived"} />
                <ModelsSettingsPanel
                  active={activeSection === "worktrees"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                />
                {activeSection === "worktrees" ? (
                  <div className="mt-6 space-y-6">
                    <SettingsSection title="Worktree cleanup">
                      {renderBooleanSettingRow({
                        settingKey: "archiveDeletesOrphanedWorktree",
                        title: "Delete worktree on archive",
                        description:
                          "After Archive's Undo period, remove a clean worktree only if the task has stopped and no other task uses it. Its branch remains available for recovery.",
                        resetLabel: "delete worktree on archive",
                        ariaLabel: "Delete worktree on archive",
                      })}
                    </SettingsSection>
                    <SettingsSectionShell title="Managed worktrees" id="setting-managed-worktrees">
                      <WorktreesSettingsPanel active />
                    </SettingsSectionShell>
                  </div>
                ) : null}
                <ProvidersSettingsPanel
                  active={activeSection === "providers"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                  updateSettingsAndWait={updateSettingsAndWait}
                  resetEpoch={resetEpoch}
                />
                <AdvancedSettingsPanel
                  active={activeSection === "advanced"}
                  onOpenReleaseHistory={() => setReleaseHistoryOpen(true)}
                  onRestoreDefaults={() => void restoreDefaults()}
                />
              </div>
            </div>
          </div>
        </div>

        <ReleaseHistoryDialog
          open={releaseHistoryOpen}
          onOpenChange={setReleaseHistoryOpen}
          defaultExpandedVersion={APP_VERSION}
        />
      </RouteInsetSurface>
    </div>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
