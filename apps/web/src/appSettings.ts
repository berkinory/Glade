import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Option, Schema, SchemaTransformation } from "effect";
import {
  type AssistantDeliveryMode,
  type ProviderStartOptions,
} from "@glade/contracts/provider/sessionPolicy";
import { DesktopAppIcon } from "@glade/contracts/ipc/ipc";
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  GIT_TEXT_GENERATION_PROVIDERS,
  type GitTextGenerationProvider,
} from "@glade/contracts/provider/model";
import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_SERVER_SETTINGS_VIEW,
  type ServerSettingsView,
  type ServerSettingsPatch,
} from "@glade/contracts/settings/settings";
import { TrimmedNonEmptyString, ProviderKind } from "@glade/contracts/core/baseSchemas";
import {
  getDefaultModel,
  getModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@glade/shared/provider/model";

import { useLocalStorage } from "./hooks/useLocalStorage";
import { EnvMode } from "./components/BranchToolbar.logic";
import { formatProviderModelOptionName, type ProviderModelOption } from "./providerModelOptions";
import {
  DEFAULT_PROVIDER_ORDER,
  normalizeHiddenProviders,
  normalizeProviderOrder,
} from "./providerOrdering";
import { ensureNativeApi } from "./nativeApi";
import { providerDiscoveryQueryKeys } from "./lib/providerDiscoveryReactQuery";
import {
  invalidateProviderUsageQueries,
  reconcileServerProviderStatuses,
  serverQueryKeys,
  serverSettingsQueryOptions,
} from "./lib/serverReactQuery";
import {
  DEFAULT_UI_DENSITY,
  UI_DENSITY_MODES,
  normalizeUiDensity as normalizeUiDensityValue,
} from "./lib/appDensity";
import {
  DEFAULT_CHAT_WIDTH,
  CHAT_WIDTH_MODES,
  normalizeChatWidthMode as normalizeChatWidthModeValue,
} from "./lib/chatWidth";

const APP_SETTINGS_STORAGE_KEY = "glade:app-settings:v1";
const SERVER_SETTINGS_MIGRATION_STORAGE_KEY = "glade:server-settings-migrated:v1";
export const MIN_CHAT_FONT_SIZE_PX = 11;
export const MAX_CHAT_FONT_SIZE_PX = 18;
export const DEFAULT_CHAT_FONT_SIZE_PX = 13;
export const MIN_TERMINAL_FONT_SIZE_PX = 10;
export const MAX_TERMINAL_FONT_SIZE_PX = 22;
const DEFAULT_TERMINAL_FONT_SIZE_PX = 12;

const DEFAULT_TERMINAL_FONT_FAMILY = "";

export const TERMINAL_FONT_FAMILY_SUGGESTIONS: ReadonlyArray<string> = [
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "SF Mono",
  "Menlo",
  "Source Code Pro",
  "IBM Plex Mono",
  "Hack",
  "Roboto Mono",
  "Ubuntu Mono",
  "Consolas",
];

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";
export const EditorCaretStyle = Schema.Literals(["line", "block"]);
export type EditorCaretStyle = typeof EditorCaretStyle.Type;
export const DEFAULT_EDITOR_CARET_STYLE: EditorCaretStyle = "line";
export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "manual";
export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export const ComputerPreviewSize = Schema.Literals(["compact", "large"]);
export type ComputerPreviewSize = typeof ComputerPreviewSize.Type;
const DEFAULT_COMPUTER_PREVIEW_SIZE: ComputerPreviewSize = "compact";
export const AgentCursorColorMode = Schema.Literals(["stock", "custom"]);
export type AgentCursorColorMode = typeof AgentCursorColorMode.Type;
export const DEFAULT_AGENT_CURSOR_COLOR_MODE: AgentCursorColorMode = "stock";

export const SidebarLayout = Schema.Literals(["classic", "rail"]);
export type SidebarLayout = typeof SidebarLayout.Type;
const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = "classic";
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";
export const FollowUpBehavior = Schema.Literals(["queue", "steer"]);
export type FollowUpBehavior = typeof FollowUpBehavior.Type;
const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = "queue";
export const UiDensity = Schema.Literals(UI_DENSITY_MODES);
export type UiDensity = typeof UiDensity.Type;
export { DEFAULT_UI_DENSITY };
const ChatWidthMode = Schema.Literals(CHAT_WIDTH_MODES);
type ChatWidthMode = typeof ChatWidthMode.Type;
export { DEFAULT_CHAT_WIDTH };

function getDefaultNativeFontSmoothing(platform = globalThis.navigator?.platform ?? "") {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const withDefaults =
  <
    S extends Schema.Top & Schema.WithoutConstructorDefault,
    D extends S["~type.make.in"] & S["Encoded"],
  >(
    fallback: () => D,
  ) =>
  (schema: S) =>
    schema.pipe(
      Schema.withConstructorDefault(() => Option.some(fallback())),
      Schema.withDecodingDefault(() => fallback()),
    );

const PersistedProviderKind = Schema.String.pipe(
  Schema.decodeTo(
    ProviderKind,
    SchemaTransformation.transform({
      decode: (provider) => (Schema.is(ProviderKind)(provider) ? provider : "codex"),
      encode: (provider) => provider,
    }),
  ),
);

function resolvePersistedProviderListEntry(provider: string): ProviderKind | undefined {
  return Schema.is(ProviderKind)(provider) ? provider : undefined;
}

const PersistedProviderKindList = Schema.Array(Schema.String).pipe(
  Schema.decodeTo(
    Schema.Array(ProviderKind),
    SchemaTransformation.transform({
      decode: (providers): ReadonlyArray<ProviderKind> =>
        providers.flatMap((provider) => {
          const resolved = resolvePersistedProviderListEntry(provider);
          return resolved === undefined ? [] : [resolved];
        }),
      encode: (providers) => providers as ReadonlyArray<string>,
    }),
  ),
);

const PersistedHiddenModels = Schema.Array(
  Schema.Struct({
    provider: Schema.String,
    slug: Schema.String,
  }),
).pipe(
  Schema.decodeTo(
    Schema.Array(
      Schema.Struct({
        provider: ProviderKind,
        slug: Schema.String,
      }),
    ),
    SchemaTransformation.transform({
      decode: (entries): ReadonlyArray<{ provider: ProviderKind; slug: string }> =>
        entries.flatMap((entry) => {
          const resolved = resolvePersistedProviderListEntry(entry.provider);
          return resolved === undefined ? [] : [{ provider: resolved, slug: entry.slug }];
        }),
      encode: (entries) => entries,
    }),
  ),
);

const AppSettingsSchema = Schema.Struct({
  claudeBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  claudeEnableArtifacts: Schema.Boolean.pipe(withDefaults(() => false)),

  onboardingCompletedAt: Schema.NullOr(Schema.String).pipe(withDefaults((): string | null => null)),
  uiDensity: UiDensity.pipe(withDefaults(() => DEFAULT_UI_DENSITY)),
  chatWidth: ChatWidthMode.pipe(withDefaults(() => DEFAULT_CHAT_WIDTH)),
  chatFontSizePx: Schema.Number.pipe(withDefaults(() => DEFAULT_CHAT_FONT_SIZE_PX)),
  chatCodeFontFamily: Schema.String.check(Schema.isMaxLength(256)).pipe(withDefaults(() => "")),
  terminalFontSizePx: Schema.Number.pipe(withDefaults(() => DEFAULT_TERMINAL_FONT_SIZE_PX)),
  terminalFontFamily: Schema.String.check(Schema.isMaxLength(256)).pipe(
    withDefaults(() => DEFAULT_TERMINAL_FONT_FAMILY),
  ),
  codexBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  defaultThreadEnvMode: EnvMode.pipe(withDefaults(() => "local" as const satisfies EnvMode)),
  confirmThreadDelete: Schema.Boolean.pipe(withDefaults(() => true)),

  archiveDeletesOrphanedWorktree: Schema.Boolean.pipe(withDefaults(() => false)),

  resumeChatsAfterQuit: Schema.Boolean.pipe(withDefaults(() => true)),
  confirmThreadArchive: Schema.Boolean.pipe(withDefaults(() => false)),
  confirmTerminalTabClose: Schema.Boolean.pipe(withDefaults(() => true)),
  diffWordWrap: Schema.Boolean.pipe(withDefaults(() => false)),
  editorCaretStyle: EditorCaretStyle.pipe(withDefaults(() => DEFAULT_EDITOR_CARET_STYLE)),
  showPullRequestDiffColors: Schema.Boolean.pipe(withDefaults(() => true)),

  showChatsSection: Schema.Boolean.pipe(withDefaults(() => true)),

  sidebarLayout: SidebarLayout.pipe(withDefaults(() => DEFAULT_SIDEBAR_LAYOUT)),

  railShortcuts: Schema.Array(Schema.String.check(Schema.isMaxLength(512))).pipe(
    withDefaults(() => []),
  ),

  showAutomationRunThreads: Schema.Boolean.pipe(withDefaults(() => true)),

  environmentPanelDefaultOpen: Schema.Boolean.pipe(withDefaults(() => false)),
  showEnvironmentUsage: Schema.Boolean.pipe(withDefaults(() => true)),
  showEnvironmentRepository: Schema.Boolean.pipe(withDefaults(() => true)),
  showEnvironmentPullRequest: Schema.Boolean.pipe(withDefaults(() => true)),
  showEnvironmentEditor: Schema.Boolean.pipe(withDefaults(() => true)),
  showEnvironmentPinned: Schema.Boolean.pipe(withDefaults(() => true)),
  showEnvironmentInstructions: Schema.Boolean.pipe(withDefaults(() => false)),
  showEnvironmentNotepad: Schema.Boolean.pipe(withDefaults(() => false)),
  followUpBehavior: FollowUpBehavior.pipe(withDefaults(() => DEFAULT_FOLLOW_UP_BEHAVIOR)),
  enableAssistantStreaming: Schema.Boolean.pipe(withDefaults(() => true)),

  composerEffortSlider: Schema.Boolean.pipe(withDefaults(() => true)),
  autoOpenDevicePane: Schema.Boolean.pipe(withDefaults(() => true)),
  enableProviderUpdateChecks: Schema.Boolean.pipe(withDefaults(() => true)),
  enableNativeFontSmoothing: Schema.Boolean.pipe(withDefaults(getDefaultNativeFontSmoothing)),
  desktopAppIcon: DesktopAppIcon.pipe(withDefaults(() => "default" as const)),

  useCustomTitleBar: Schema.Boolean.pipe(withDefaults(() => true)),
  enableTaskCompletionToasts: Schema.Boolean.pipe(withDefaults(() => true)),
  enableSystemTaskCompletionNotifications: Schema.Boolean.pipe(withDefaults(() => true)),

  autoOpenComputerPane: Schema.Boolean.pipe(withDefaults(() => true)),

  computerPreviewSize: ComputerPreviewSize.pipe(withDefaults(() => DEFAULT_COMPUTER_PREVIEW_SIZE)),

  computerControlEnabled: Schema.Boolean.pipe(withDefaults(() => false)),

  agentCursorColorMode: AgentCursorColorMode.pipe(
    withDefaults(() => DEFAULT_AGENT_CURSOR_COLOR_MODE),
  ),
  agentCursorFillColor: Schema.String.check(Schema.isMaxLength(7)).pipe(withDefaults(() => "")),
  agentCursorRimColor: Schema.String.check(Schema.isMaxLength(7)).pipe(withDefaults(() => "")),

  allowComputerControlInNewChats: Schema.optionalKey(Schema.Boolean),
  // One-shot composer hint that suggests Medium effort for faster desktop actions. Set when the user
  // applies or dismisses it, so the hint never asks twice.
  dismissedComputerControlEffortHint: Schema.Boolean.pipe(withDefaults(() => false)),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    withDefaults(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    withDefaults(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER),
  ),
  timestampFormat: TimestampFormat.pipe(withDefaults(() => DEFAULT_TIMESTAMP_FORMAT)),
  textGenerationProvider: PersistedProviderKind.pipe(withDefaults(() => "codex" as const)),
  textGenerationModel: Schema.optional(TrimmedNonEmptyString),
  uiFontFamily: Schema.String.check(Schema.isMaxLength(256)).pipe(withDefaults(() => "")),
  defaultProvider: PersistedProviderKind.pipe(withDefaults(() => "codex" as const)),
  // Local-only UI preference: providers explicitly hidden from the composer picker. The active/locked
  // provider for a thread is always shown regardless, so users never get stuck on a thread whose
  // provider they later chose to hide.
  hiddenProviders: PersistedProviderKindList.pipe(withDefaults(() => [])),

  disabledProviders: PersistedProviderKindList.pipe(withDefaults(() => [])),

  providerOrder: PersistedProviderKindList.pipe(withDefaults(() => [...DEFAULT_PROVIDER_ORDER])),

  hiddenModels: PersistedHiddenModels.pipe(withDefaults(() => [])),
});
export type AppSettings = typeof AppSettingsSchema.Type;

// The settings values and mutation used by a mounted settings panel. The route owns the
// subscription so extracted workflow panels do not create duplicate local-storage/server-settings
// subscriptions.
export type AppSettingsBinding = {
  readonly settings: AppSettings;
  readonly defaults: AppSettings;
  readonly updateSettings: (patch: Partial<AppSettings>) => void;
};

export function isGitTextGenerationSettingsDirty(
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return (
    (settings.textGenerationProvider ?? "codex") !== (defaults.textGenerationProvider ?? "codex") ||
    (settings.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL) !==
      (defaults.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL)
  );
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableServerSettingsPatch = Mutable<ServerSettingsPatch>;
type MutableServerSettingsProvidersPatch = Mutable<NonNullable<ServerSettingsPatch["providers"]>>;

export interface AppModelOption extends ProviderModelOption {
  provider: ProviderKind;
  isSelectedHint: boolean;
}

const DEFAULT_APP_SETTINGS = AppSettingsSchema.makeUnsafe({});
let serverSettingsMigrationInFlight = false;

export function normalizeChatFontSizePx(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CHAT_FONT_SIZE_PX;
  }

  return Math.min(MAX_CHAT_FONT_SIZE_PX, Math.max(MIN_CHAT_FONT_SIZE_PX, Math.round(value)));
}

export function normalizeTerminalFontSizePx(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_FONT_SIZE_PX;
  }

  return Math.min(
    MAX_TERMINAL_FONT_SIZE_PX,
    Math.max(MIN_TERMINAL_FONT_SIZE_PX, Math.round(value)),
  );
}

export function normalizeCursorHexColor(value: string | null | undefined): string {
  const candidate = (value ?? "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : "";
}

// Stock mode resolves to null no matter what colors are stored, so switching back to stock never
// leaves a stale override in the pushed payload. A channel with no valid color is omitted, not sent
// empty, because the driver treats an omitted channel as stock.
export function resolveAgentCursorColors(
  settings: Pick<
    AppSettings,
    "agentCursorColorMode" | "agentCursorFillColor" | "agentCursorRimColor"
  >,
): { fill?: string; rim?: string } | null {
  if ((settings.agentCursorColorMode ?? DEFAULT_AGENT_CURSOR_COLOR_MODE) !== "custom") return null;
  const fill = normalizeCursorHexColor(settings.agentCursorFillColor);
  const rim = normalizeCursorHexColor(settings.agentCursorRimColor);
  if (!fill && !rim) return null;
  return { ...(fill ? { fill } : {}), ...(rim ? { rim } : {}) };
}

export function normalizeTerminalFontFamily(value: string | null | undefined): string {
  return (value ?? "").replace(/[;{}<>\n\r]/g, "").slice(0, 256);
}

export function resolveTerminalFontFamilyStack(value: string | null | undefined): string | null {
  const normalized = normalizeTerminalFontFamily(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const hasGenericFallback = /\b(?:monospace|serif|sans-serif|system-ui|ui-monospace)\b/.test(
    normalized,
  );

  if (normalized.includes(",")) {
    return hasGenericFallback ? normalized : `${normalized}, monospace`;
  }

  const isQuoted = /^(["']).*\1$/.test(normalized);
  const family = !isQuoted && /\s/.test(normalized) ? `"${normalized}"` : normalized;
  return hasGenericFallback ? family : `${family}, monospace`;
}

function normalizeProviderBinaryPathOverride(
  provider: ProviderKind,
  value: string | null | undefined,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === DEFAULT_SERVER_SETTINGS.providers[provider].binaryPath) {
    return "";
  }
  return trimmed;
}

function normalizeAppSettings(settings: AppSettings): AppSettings {
  const {
    allowComputerControlInNewChats: legacyAllowComputerControlInNewChats,
    ...currentSettings
  } = settings;
  return {
    ...currentSettings,
    computerControlEnabled:
      settings.computerControlEnabled || legacyAllowComputerControlInNewChats === true,
    claudeBinaryPath: normalizeProviderBinaryPathOverride("claudeAgent", settings.claudeBinaryPath),
    codexBinaryPath: normalizeProviderBinaryPathOverride("codex", settings.codexBinaryPath),
    uiDensity: normalizeUiDensityValue(settings.uiDensity),
    chatWidth: normalizeChatWidthModeValue(settings.chatWidth),
    agentCursorFillColor: normalizeCursorHexColor(settings.agentCursorFillColor),
    agentCursorRimColor: normalizeCursorHexColor(settings.agentCursorRimColor),
    chatFontSizePx: normalizeChatFontSizePx(settings.chatFontSizePx),
    terminalFontSizePx: normalizeTerminalFontSizePx(settings.terminalFontSizePx),
    terminalFontFamily: normalizeTerminalFontFamily(settings.terminalFontFamily),
    hiddenProviders: normalizeHiddenProviders(settings.hiddenProviders),
    disabledProviders: normalizeHiddenProviders(settings.disabledProviders),
    providerOrder: normalizeProviderOrder(settings.providerOrder),
    hiddenModels: [],
  };
}

function getServerDisabledProviders(
  settings: Pick<ServerSettingsView, "providers">,
): ProviderKind[] {
  return DEFAULT_PROVIDER_ORDER.filter((provider) => !settings.providers[provider].enabled);
}

export function didProviderEnablementChange(
  previous: Pick<ServerSettingsView, "providers"> | undefined,
  next: Pick<ServerSettingsView, "providers">,
): boolean {
  return (
    previous === undefined ||
    DEFAULT_PROVIDER_ORDER.some(
      (provider) => previous.providers[provider].enabled !== next.providers[provider].enabled,
    )
  );
}

export function didProviderCommandDiscoverySettingsChange(
  previous: Pick<ServerSettingsView, "providers"> | undefined,
  next: Pick<ServerSettingsView, "providers">,
): boolean {
  return (
    previous !== undefined &&
    previous.providers.claudeAgent.enableArtifacts !== next.providers.claudeAgent.enableArtifacts
  );
}

function serverSettingsToAppSettings(settings: ServerSettingsView): Partial<AppSettings> {
  return {
    claudeBinaryPath: settings.providers.claudeAgent.binaryPath,
    claudeEnableArtifacts: settings.providers.claudeAgent.enableArtifacts,
    codexBinaryPath: settings.providers.codex.binaryPath,
    codexHomePath: settings.providers.codex.homePath,
    defaultThreadEnvMode: settings.defaultThreadEnvMode,
    enableAssistantStreaming: settings.enableAssistantStreaming,
    enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
    disabledProviders: getServerDisabledProviders(settings),
    textGenerationProvider: settings.textGenerationModelSelection.provider,
    textGenerationModel: settings.textGenerationModelSelection.model,
    onboardingCompletedAt: settings.onboardingCompletedAt ?? null,
  };
}

function resolveTextGenerationProvider(input: {
  readonly provider?: ProviderKind | null;
  readonly model?: string | null;
}): ProviderKind {
  if (input.provider) {
    return input.provider;
  }
  return "codex";
}

function hasOwn<Key extends keyof AppSettings>(patch: Partial<AppSettings>, key: Key): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function touchesProviderDiscoverySettings(patch: Partial<AppSettings>): boolean {
  return hasOwn(patch, "claudeEnableArtifacts") || hasOwn(patch, "disabledProviders");
}

function serverSettingValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function pruneProviderPatchAgainstCurrentSettings(
  providers: MutableServerSettingsProvidersPatch,
  currentSettings: Pick<ServerSettingsView, "providers">,
): void {
  for (const provider of DEFAULT_PROVIDER_ORDER) {
    const providerPatch = providers[provider];
    if (!providerPatch) continue;

    const patchRecord = providerPatch as Record<string, unknown>;
    const currentRecord = currentSettings.providers[provider] as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patchRecord)) {
      const matchesCurrent = serverSettingValuesEqual(value, currentRecord[key]);
      if (matchesCurrent) {
        delete patchRecord[key];
      }
    }
    if (Object.keys(patchRecord).length === 0) {
      delete providers[provider];
    }
  }
}

function appSettingsPatchToServerSettingsPatch(
  patch: Partial<AppSettings>,
  currentSettings?: Pick<ServerSettingsView, "providers">,
): ServerSettingsPatch {
  const providers: MutableServerSettingsProvidersPatch = {};
  const serverPatch: MutableServerSettingsPatch = {};

  if (hasOwn(patch, "enableAssistantStreaming")) {
    serverPatch.enableAssistantStreaming = Boolean(patch.enableAssistantStreaming);
  }
  if (hasOwn(patch, "enableProviderUpdateChecks")) {
    serverPatch.enableProviderUpdateChecks = Boolean(patch.enableProviderUpdateChecks);
  }
  if (patch.defaultThreadEnvMode === "local" || patch.defaultThreadEnvMode === "worktree") {
    serverPatch.defaultThreadEnvMode = patch.defaultThreadEnvMode;
  }
  if (hasOwn(patch, "onboardingCompletedAt")) {
    serverPatch.onboardingCompletedAt = patch.onboardingCompletedAt ?? null;
  }
  if (hasOwn(patch, "textGenerationModel") || hasOwn(patch, "textGenerationProvider")) {
    const model = patch.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
    serverPatch.textGenerationModelSelection = {
      provider: resolveTextGenerationProvider({
        ...(patch.textGenerationProvider !== undefined
          ? { provider: patch.textGenerationProvider }
          : {}),
        model,
      }),
      model,
    };
  }
  if (hasOwn(patch, "codexBinaryPath") || hasOwn(patch, "codexHomePath")) {
    providers.codex = {
      ...(hasOwn(patch, "codexBinaryPath") ? { binaryPath: patch.codexBinaryPath ?? "" } : {}),
      ...(hasOwn(patch, "codexHomePath") ? { homePath: patch.codexHomePath ?? "" } : {}),
    };
  }
  if (hasOwn(patch, "claudeBinaryPath") || hasOwn(patch, "claudeEnableArtifacts")) {
    providers.claudeAgent = {
      ...(hasOwn(patch, "claudeBinaryPath") ? { binaryPath: patch.claudeBinaryPath ?? "" } : {}),
      ...(hasOwn(patch, "claudeEnableArtifacts")
        ? { enableArtifacts: Boolean(patch.claudeEnableArtifacts) }
        : {}),
    };
  }
  if (hasOwn(patch, "disabledProviders")) {
    const disabledProviders = new Set(normalizeHiddenProviders(patch.disabledProviders ?? []));
    for (const provider of DEFAULT_PROVIDER_ORDER) {
      const enabled = !disabledProviders.has(provider);
      if (currentSettings?.providers[provider].enabled === enabled) {
        continue;
      }
      providers[provider] = {
        ...providers[provider],
        enabled,
      };
    }
  }

  if (currentSettings) {
    pruneProviderPatchAgainstCurrentSettings(providers, currentSettings);
  }
  if (Object.keys(providers).length > 0) {
    serverPatch.providers = providers;
  }
  return serverPatch;
}

function isServerSettingsPatchEmpty(patch: ServerSettingsPatch): boolean {
  return Object.keys(patch).length === 0;
}

function buildInitialServerSettingsMigrationPatch(settings: AppSettings): ServerSettingsPatch {
  const patch: Partial<Mutable<AppSettings>> = {};
  const normalizedSettings = normalizeAppSettings(settings);
  const defaults = DEFAULT_APP_SETTINGS;

  for (const key of [
    "claudeBinaryPath",
    "claudeEnableArtifacts",
    "codexBinaryPath",
    "codexHomePath",
    "defaultThreadEnvMode",
    "enableAssistantStreaming",
    "enableProviderUpdateChecks",
    "textGenerationModel",
    "textGenerationProvider",
  ] as const) {
    if (normalizedSettings[key] !== defaults[key]) {
      patch[key] = normalizedSettings[key] as never;
    }
  }

  return appSettingsPatchToServerSettingsPatch(patch);
}

function normalizeStoredAppSettings(settings: AppSettings): AppSettings {
  return {
    ...normalizeAppSettings(settings),

    disabledProviders: [],
  };
}

function applyLocalAppSettingsPatch(
  settings: AppSettings,
  patch: Partial<AppSettings>,
): AppSettings {
  const { disabledProviders: _disabledProviders, ...localPatch } = patch;
  return normalizeStoredAppSettings({
    ...settings,
    ...localPatch,
  });
}

export function getAppModelOptions(
  provider: ProviderKind,
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getModelOptions(provider).map(({ slug, name }) => ({
    provider,
    slug,
    name,
    isSelectedHint: false,
  }));
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      provider,
      slug: normalizedSelectedModel,
      name: formatProviderModelOptionName({ provider, slug: normalizedSelectedModel }),
      isSelectedHint: true,
    });
  }

  return options;
}

function mapCatalogModelOptionsToAppModelOptions(
  provider: GitTextGenerationProvider,
  options: ReadonlyArray<ProviderModelOption & { isSelectedHint?: boolean }>,
): AppModelOption[] {
  return options.map((option) => ({
    ...option,
    provider,
    isSelectedHint: option.isSelectedHint ?? false,
  }));
}

export function getGitTextGenerationModelOptions(
  settings: Pick<AppSettings, "textGenerationModel" | "textGenerationProvider">,
  discoveredOptionsByProvider?: Partial<
    Record<
      GitTextGenerationProvider,
      ReadonlyArray<ProviderModelOption & { isSelectedHint?: boolean }>
    >
  >,
): AppModelOption[] {
  const options = GIT_TEXT_GENERATION_PROVIDERS.flatMap((provider) => {
    const discovered = discoveredOptionsByProvider?.[provider];
    if (discovered !== undefined) {
      return mapCatalogModelOptionsToAppModelOptions(provider, discovered);
    }
    return getAppModelOptions(provider);
  });
  const deduped: AppModelOption[] = [];
  const seen = new Set<string>();

  for (const option of options) {
    const key = `${option.provider}:${option.slug}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(option);
  }

  const selectedModel = settings.textGenerationModel?.trim();
  const selectedProvider =
    settings.textGenerationProvider ??
    resolveTextGenerationProvider(selectedModel !== undefined ? { model: selectedModel } : {});
  if (selectedModel && !seen.has(`${selectedProvider}:${selectedModel}`)) {
    deduped.push({
      provider: selectedProvider,
      slug: selectedModel,
      name: formatProviderModelOptionName({ provider: selectedProvider, slug: selectedModel }),
      isSelectedHint: true,
    });
  }

  return deduped;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  selectedModel: string | null | undefined,
): string {
  const options = getAppModelOptions(provider, selectedModel);
  return (
    resolveSelectableModel(provider, selectedModel, options) ?? getDefaultModel(provider) ?? ""
  );
}

export function getProviderStartOptions(
  settings: Pick<AppSettings, "claudeBinaryPath" | "codexBinaryPath" | "codexHomePath">,
): ProviderStartOptions | undefined {
  const claudeBinaryPath = normalizeProviderBinaryPathOverride(
    "claudeAgent",
    settings.claudeBinaryPath,
  );
  const codexBinaryPath = normalizeProviderBinaryPathOverride("codex", settings.codexBinaryPath);
  const providerOptions: ProviderStartOptions = {
    ...(codexBinaryPath || settings.codexHomePath
      ? {
          codex: {
            ...(codexBinaryPath ? { binaryPath: codexBinaryPath } : {}),
            ...(settings.codexHomePath ? { homePath: settings.codexHomePath } : {}),
          },
        }
      : {}),
    ...(claudeBinaryPath
      ? {
          claudeAgent: {
            binaryPath: claudeBinaryPath,
          },
        }
      : {}),
  };

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
}

export function resolveAssistantDeliveryMode(
  settings: Pick<AppSettings, "enableAssistantStreaming">,
): AssistantDeliveryMode {
  return settings.enableAssistantStreaming ? "streaming" : "buffered";
}

export function resolveFollowUpDispatchMode(input: {
  behavior: FollowUpBehavior;
  hasLiveTurn: boolean;
  useOppositeBehavior?: boolean;
}): FollowUpBehavior {
  if (!input.hasLiveTurn) {
    return "queue";
  }
  if (!input.useOppositeBehavior) {
    return input.behavior;
  }
  return input.behavior === "queue" ? "steer" : "queue";
}

export function getCustomBinaryPathForProvider(
  settings: Pick<AppSettings, "claudeBinaryPath" | "codexBinaryPath">,
  provider: ProviderKind,
): string {
  switch (provider) {
    case "codex":
      return normalizeProviderBinaryPathOverride(provider, settings.codexBinaryPath);
    case "claudeAgent":
      return normalizeProviderBinaryPathOverride(provider, settings.claudeBinaryPath);
  }
}

export function useAppSettings() {
  const queryClient = useQueryClient();
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const [localSettings, setSettings] = useLocalStorage(
    APP_SETTINGS_STORAGE_KEY,
    DEFAULT_APP_SETTINGS,
    AppSettingsSchema,
  );
  const normalizedStoredSettingsRef = useRef(false);
  const serverSettingsMutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const defaults = normalizeAppSettings({
    ...DEFAULT_APP_SETTINGS,
    ...serverSettingsToAppSettings(DEFAULT_SERVER_SETTINGS_VIEW),
  });

  const normalizedLocalSettings = normalizeStoredAppSettings(localSettings);
  const settings = normalizeAppSettings({
    ...normalizedLocalSettings,
    ...(serverSettingsQuery.data ? serverSettingsToAppSettings(serverSettingsQuery.data) : {}),
  });

  useEffect(() => {
    if (normalizedStoredSettingsRef.current) {
      return;
    }
    normalizedStoredSettingsRef.current = true;

    setSettings((previous) => normalizeStoredAppSettings(previous));
  }, [setSettings]);

  useEffect(() => {
    if (!serverSettingsQuery.data || serverSettingsMigrationInFlight) {
      return;
    }
    if (globalThis.localStorage?.getItem(SERVER_SETTINGS_MIGRATION_STORAGE_KEY) === "1") {
      return;
    }

    const migrationPatch = buildInitialServerSettingsMigrationPatch(localSettings);
    if (isServerSettingsPatchEmpty(migrationPatch)) {
      globalThis.localStorage?.setItem(SERVER_SETTINGS_MIGRATION_STORAGE_KEY, "1");
      return;
    }

    serverSettingsMigrationInFlight = true;
    void ensureNativeApi()
      .server.updateSettings(migrationPatch)
      .then((nextSettings) => {
        queryClient.setQueryData(serverQueryKeys.settings(), nextSettings);
        globalThis.localStorage?.setItem(SERVER_SETTINGS_MIGRATION_STORAGE_KEY, "1");
      })
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
      })
      .finally(() => {
        serverSettingsMigrationInFlight = false;
      });
  }, [localSettings, queryClient, serverSettingsQuery.data]);

  const refreshProvidersAfterEnablementChange = async () => {
    const api = ensureNativeApi();
    await api.server
      .refreshProviders()
      .then((result) => reconcileServerProviderStatuses(queryClient, result.providers))
      .catch(() => queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() }));
    await queryClient
      .invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all })
      .catch(() => undefined);
    await invalidateProviderUsageQueries(queryClient).catch(() => undefined);
  };

  const enqueueServerSettingsMutation = <Result>(
    mutation: () => Promise<Result>,
  ): Promise<Result> => {
    const queued = serverSettingsMutationQueueRef.current.then(
      () => mutation(),
      () => mutation(),
    );
    serverSettingsMutationQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };

  const updateSettingsAndWait = async (patch: Partial<AppSettings>): Promise<void> => {
    setSettings((prev) => applyLocalAppSettingsPatch(prev, patch));
    await enqueueServerSettingsMutation(async () => {
      const currentServerSettings =
        queryClient.getQueryData<ServerSettingsView>(serverQueryKeys.settings()) ??
        serverSettingsQuery.data;
      const serverPatch = appSettingsPatchToServerSettingsPatch(patch, currentServerSettings);
      if (isServerSettingsPatchEmpty(serverPatch)) {
        return;
      }

      const api = ensureNativeApi();
      try {
        const nextSettings = await api.server.updateSettings(serverPatch);
        queryClient.setQueryData(serverQueryKeys.settings(), nextSettings);
        if (hasOwn(patch, "disabledProviders")) {
          await refreshProvidersAfterEnablementChange();
        } else if (touchesProviderDiscoverySettings(patch)) {
          await queryClient
            .invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all })
            .catch(() => undefined);
        }
      } catch {
        await queryClient
          .invalidateQueries({ queryKey: serverQueryKeys.settings() })
          .catch(() => undefined);
        if (touchesProviderDiscoverySettings(patch)) {
          await queryClient
            .invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all })
            .catch(() => undefined);
        }
      }
    });
  };

  const updateSettings = (patch: Partial<AppSettings>): void => {
    void updateSettingsAndWait(patch);
  };

  const resetSettings = async (): Promise<void> => {
    const { onboardingCompletedAt: _keepOnboardingCompletedAt, ...resettableDefaults } = defaults;
    setSettings((prev) => ({
      ...DEFAULT_APP_SETTINGS,
      onboardingCompletedAt: prev.onboardingCompletedAt,
    }));
    await enqueueServerSettingsMutation(async () => {
      const currentServerSettings =
        queryClient.getQueryData<ServerSettingsView>(serverQueryKeys.settings()) ??
        serverSettingsQuery.data;
      const serverPatch = appSettingsPatchToServerSettingsPatch(
        resettableDefaults,
        currentServerSettings,
      );
      const providerSettingsChanged = Boolean(
        serverPatch.providers && Object.keys(serverPatch.providers).length > 0,
      );
      if (isServerSettingsPatchEmpty(serverPatch)) {
        return;
      }
      try {
        const nextSettings = await ensureNativeApi().server.updateSettings(serverPatch);
        queryClient.setQueryData(serverQueryKeys.settings(), nextSettings);
        if (providerSettingsChanged) {
          await refreshProvidersAfterEnablementChange();
        }
      } catch {
        await queryClient
          .invalidateQueries({ queryKey: serverQueryKeys.settings() })
          .catch(() => undefined);
        if (providerSettingsChanged) {
          await queryClient
            .invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all })
            .catch(() => undefined);
        }
      }
    });
  };

  return {
    settings,
    serverSettings: serverSettingsQuery.data,
    updateSettings,
    updateSettingsAndWait,
    resetSettings,
    defaults,
  } as const;
}
