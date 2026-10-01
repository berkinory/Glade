import { isElectron } from "./env";
import { getNavigatorPlatform, isMacPlatform } from "./lib/utils";
import { rankProviderDiscoveryItems } from "~/lib/providerDiscovery";
import {
  settingRowAnchorId,
  SETTINGS_NAV_ITEMS,
  type SettingsSectionId,
} from "./settingsNavigation";

export interface SettingsSearchEntry {
  id: string;
  section: SettingsSectionId;
  title: string;
  keywords: string;
  target?: string | null;

  applies?: (context: SettingsSearchContext) => boolean;
}

export interface SettingsSearchContext {
  readonly computerBackendIsVisibleDesktop: boolean;
}

const DEFAULT_SETTINGS_SEARCH_CONTEXT: SettingsSearchContext = {
  computerBackendIsVisibleDesktop: false,
};

export function settingsSearchEntryTarget(entry: SettingsSearchEntry): string | null {
  return entry.target === undefined ? settingRowAnchorId(entry.title) : entry.target;
}

const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: "general:default-provider",
    section: "general",
    title: "Default provider",
    target: "setting-default-provider",
    keywords: "Choose the provider used for new chats. agent codex claude",
  },
  {
    id: "general:new-threads",
    section: "general",
    title: "New chats",
    target: "setting-new-threads",
    keywords:
      "New threads Pick the default workspace mode for newly created draft threads. local worktree environment",
  },
  {
    id: "general:delete-worktree-on-archive",
    section: "worktrees",
    title: "Delete worktree on archive",
    target: "setting-archiveDeletesOrphanedWorktree",
    keywords:
      "After Archive's Undo period, remove a clean worktree only when its task has stopped and no other task uses it. Keep its branch for recovery. worktree archive cleanup disk space remove delete",
  },
  {
    id: "general:welcome-tour",
    section: "advanced",
    title: "Welcome tour",
    target: "setting-welcome-tour",
    keywords:
      "Replay the first-run setup: feature tour, provider selection, appearance, and first project. onboarding welcome wizard getting started setup",
  },
  {
    id: "general:project-order",
    section: "general",
    title: "Project order",
    target: "setting-project-order",
    keywords: "Controls how projects are arranged in the main sidebar. sort updated manual",
  },
  {
    id: "general:environment-default-open",
    section: "general",
    title: "Open by default",
    target: "setting-environmentPanelDefaultOpen",
    keywords:
      "Open the chat Environment panel automatically on normal threads. default closed open environment panel preference",
  },
  {
    id: "general:environment-usage",
    section: "general",
    title: "Usage",
    target: "setting-showEnvironmentUsage",
    keywords: "Show the provider usage row in the chat Environment panel.",
  },
  {
    id: "general:environment-repository",
    section: "general",
    title: "Repository",
    target: "setting-showEnvironmentRepository",
    keywords: "Show the GitHub repository link in the chat Environment panel. git changes worktree",
  },
  {
    id: "general:environment-pull-request",
    section: "general",
    title: "Pull request",
    target: "setting-showEnvironmentPullRequest",
    keywords:
      "Show the open pull request CI checks and review comments in the chat Environment panel. pr fix github",
  },
  {
    id: "general:environment-editor",
    section: "general",
    title: "Editor",
    target: "setting-showEnvironmentEditor",
    keywords: "Show the Open in editor picker in the chat Environment panel.",
  },
  {
    id: "general:environment-pinned",
    section: "general",
    title: "Pinned messages",
    target: "setting-showEnvironmentPinned",
    keywords: "Show the pinned messages in the Environment panel.",
  },
  {
    id: "general:environment-notepad",
    section: "general",
    title: "Notepad",
    target: "setting-showEnvironmentNotepad",
    keywords: "Show the per-thread notepad in the Environment panel.",
  },

  {
    id: "appearance:theme",
    section: "appearance",
    title: "Theme",
    target: "setting-theme",
    keywords: "Choose how Glade looks across the app. dark light system color",
  },
  {
    id: "appearance:app-icon",
    section: "appearance",
    title: "App icon",
    applies: () => isElectron,
    keywords: "Choose the icon Glade uses in the dock or taskbar desktop application logo.",
    target: "setting-app-icon",
  },
  {
    id: "appearance:custom-title-bar",
    section: "appearance",
    title: "Use custom title bar",
    applies: () => isElectron && !isMacPlatform(getNavigatorPlatform()),
    keywords:
      "frameless window system title bar Windows Linux caption controls minimize maximize close chrome",
    target: "setting-use-custom-title-bar",
  },
  {
    id: "appearance:system-ui-font",
    section: "appearance",
    title: "Use system font",
    target: "setting-use-system-ui-font",
    keywords: "Use system UI font Use the operating system interface font throughout Glade.",
  },
  {
    id: "appearance:ui-density",
    section: "appearance",
    title: "UI density",
    target: "setting-ui-density",
    keywords:
      "Control spacing in the sidebar, composer, chat gutters, and settings rows without changing font size. compact comfortable",
  },
  {
    id: "appearance:chat-width",
    section: "appearance",
    title: "Chat width",
    target: "setting-chat-width",
    keywords:
      "Control how wide the chat column grows so tables and wide content get more room. standard wide full",
  },
  {
    id: "appearance:base-font-size",
    section: "appearance",
    title: "App font size",
    target: "setting-base-font-size",
    keywords:
      "Base font size Adjust the app text base in pixels. Chat and UI typography scale proportionally. font",
  },
  {
    id: "appearance:terminal-font-size",
    section: "appearance",
    title: "Terminal font size",
    target: "setting-terminal-font-size",
    keywords: "Adjust terminal text independently from the app and chat font size.",
  },
  {
    id: "appearance:terminal-font",
    section: "appearance",
    title: "Terminal font",
    target: "setting-terminal-font",
    keywords:
      "Type any monospace font installed on this device e.g. Fira Code. system monospace family",
  },
  {
    id: "appearance:font-smoothing",
    section: "appearance",
    title: "Font smoothing",
    applies: () => isMacPlatform(getNavigatorPlatform()),
    keywords: "Use macOS-style antialiasing for lighter, crisper text rendering.",
    target: "setting-enableNativeFontSmoothing",
  },
  {
    id: "appearance:caret-style",
    section: "appearance",
    title: "Composer cursor",
    target: "setting-caret-style",
    keywords: "Caret style Choose a line or block cursor when editing files.",
  },
  {
    id: "appearance:time-format",
    section: "appearance",
    title: "Time format",
    target: "setting-time-format",
    keywords:
      "System default follows your browser or OS clock preference. timestamp 12-hour 24-hour locale",
  },

  {
    id: "notifications:activity-toasts",
    section: "notifications",
    title: "In-app notifications",
    target: "setting-activity-toasts",
    keywords:
      "Activity toasts Show an in-app toast when a chat or managed terminal agent finishes or needs input. alerts",
  },
  {
    id: "notifications:desktop-notifications",
    section: "notifications",
    title: "Desktop notifications",
    target: "setting-desktop-notifications",
    keywords:
      "Show an OS notification when a chat or managed terminal agent finishes or needs input while the app is in the background. alerts toast permission allow denied blocked system settings",
  },

  {
    id: "computer:status",
    section: "computer",
    title: "Computer status",
    keywords:
      "Whether agents can see and control this computer's desktop right now. desktop backend availability health kwin hyprland nested wayland linux mac macos screen recording accessibility computer use control status set up install plugin repair",

    target: null,
  },
  {
    id: "computer:open-automatically",
    section: "computer",
    title: "Automatic preview",
    target: "setting-automatic-preview",
    keywords:
      "Open the live preview when an agent first uses the desktop in a chat. auto open computer use",
    applies: () => true,
  },
  {
    id: "computer:how-agents-use-the-desktop",
    section: "computer",
    title: "Computer control",
    target: "setting-computer-control",
    keywords:
      "Let the agent use the desktop in any chat. Approval gates and Stop still apply. enable toggle permission desktop agent computer use control",
  },
  {
    id: "computer:cursor-colors",
    section: "computer",
    title: "Cursor colors",
    target: "setting-cursor-colors",
    keywords:
      "The agent pointer's colors: stock monochrome by default, or custom fill and rim. agent cursor arrow pointer color hex custom",
  },
  {
    id: "computer:always-allowed",
    section: "computer",
    title: "Always allowed",
    keywords:
      "Durable per-app always-allow grants from computer approvals, with expiry and revoke. always allow approval grant revoke app bundle consent computer use",
    target: null,
  },

  {
    id: "behavior:follow-up-behavior",
    section: "behavior",
    title: "Follow-up behavior",
    target: "setting-follow-up-behavior",
    keywords:
      "Choose whether messages sent during an active turn wait in the queue or steer the current run. Ctrl Cmd Enter opposite send",
  },
  {
    id: "behavior:streaming",
    section: "behavior",
    title: "Streaming",
    target: "setting-enableAssistantStreaming",
    keywords: "Show token-by-token output while a response is in progress. streaming",
  },
  {
    id: "behavior:effort-slider",
    section: "behavior",
    title: "Show effort control",
    target: "setting-composerEffortSlider",
    keywords:
      "Effort slider Show reasoning effort as a slider in the composer model menu once a chat has started. fast mode reasoning thinking level picker",
  },
  {
    id: "behavior:diff-line-wrapping",
    section: "files",
    title: "Diff line wrapping",
    target: "setting-diffWordWrap",
    keywords: "Set the default wrap state when the diff panel opens. word wrap",
  },
  {
    id: "behavior:delete-confirmation",
    section: "behavior",
    title: "Confirm before deleting a chat",
    target: "setting-confirmThreadDelete",
    keywords:
      "Delete confirmation Ask before deleting a thread and its chat history. safety confirm",
  },
  {
    id: "behavior:archive-confirmation",
    section: "behavior",
    title: "Confirm before archiving a chat",
    target: "setting-confirmThreadArchive",
    keywords: "Archive confirmation Ask before archiving a thread. safety confirm",
  },
  {
    id: "behavior:terminal-close-confirmation",
    section: "behavior",
    title: "Confirm before closing a terminal",
    target: "setting-confirmTerminalTabClose",
    keywords:
      "Terminal close confirmation Ask before closing a terminal tab and clearing its history. safety confirm",
  },

  {
    id: "shortcuts:keyboard-shortcuts",
    section: "shortcuts",
    title: "Keyboard shortcuts",
    keywords:
      "Every keyboard shortcut available in Glade, grouped by context. keybindings hotkeys key combo cmd ctrl reference",
    target: null,
  },

  {
    id: "worktrees:managed-worktrees",
    section: "worktrees",
    title: "Managed worktrees",
    keywords: "Review and clean up the worktrees created by Glade. git branch remove",
    target: "setting-managed-worktrees",
  },

  {
    id: "archived:archived-threads",
    section: "archived",
    title: "Archived chats",
    keywords: "Archived threads View and restore archived threads. unarchive history",
    target: null,
  },

  {
    id: "models:git-writing-model",
    section: "worktrees",
    title: "Git generation model",
    target: "setting-git-writing-model",
    keywords: "Git writing model Used for generated commit messages, PR titles, and branch names.",
  },

  {
    id: "providers:automatic-cli-update-checks",
    section: "providers",
    title: "Automatic CLI update checks",
    target: "setting-automatic-cli-update-checks",
    keywords:
      "Check Codex Claude and other provider CLIs for newer versions in the background. updates upgrade disable nags",
  },
  {
    id: "providers:configuration",
    section: "providers",
    title: "Providers",
    target: "setting-providers",
    keywords:
      "Agent providers Enable disable providers CLI availability setup sign-in visibility picker order versions updates tools binary overrides path install CODEX_HOME artifacts",
  },

  {
    id: "skills:skills",
    section: "skills",
    title: "Skills",
    keywords:
      "Every skill found across providers, with toggles to control availability. Agent skills",
    target: null,
  },

  {
    id: "usage:usage",
    section: "usage",
    title: "Usage & limits",
    keywords:
      "Usage and billing Remaining quota and credits for each signed-in provider. limits credits",
    target: null,
  },

  {
    id: "advanced:keybindings",
    section: "shortcuts",
    title: "Open shortcuts file",
    target: "setting-shortcuts-file",
    keywords:
      "Open the persisted keybindings.json file to edit advanced bindings directly. shortcuts",
  },
  {
    id: "advanced:recovery-tools",
    section: "advanced",
    title: "Recovery tools",
    target: "setting-recovery-tools",
    keywords:
      "Rebuild local project indexes without clearing existing chats when the local state gets out of sync.",
  },
  {
    id: "advanced:version",
    section: "advanced",
    title: "Version",
    target: "setting-version",
    keywords: "Current application version. about",
  },
  {
    id: "advanced:release-history",
    section: "advanced",
    title: "Release history",
    target: "setting-release-history",
    keywords:
      "A running log of every update, newest first. changelog what's new about release notes",
  },
  {
    id: "files:visibility",
    section: "files",
    title: "Hide ignored files",
    target: "setting-hideIgnoredFiles",
    keywords: "Explorer gitignored files folders visibility",
  },
  {
    id: "files:colors",
    section: "files",
    title: "Pull request diff colors",
    target: "setting-showPullRequestDiffColors",
    keywords: "Review additions deletions green red",
  },
  {
    id: "advanced:reset",
    section: "advanced",
    title: "Restore defaults",
    target: "setting-restore-defaults",
    keywords: "reset preferences theme provider settings",
  },
  {
    id: "computer:preview-size",
    section: "computer",
    title: "Preview size",
    target: "setting-preview-size",
    keywords: "compact large computer preview",
  },
  {
    id: "mcp:servers",
    section: "mcp",
    title: "MCP servers",
    target: null,
    keywords: "tools connections authentication provider project chat",
  },
  {
    id: "plugins:plugins",
    section: "plugins",
    title: "Plugins",
    target: null,
    keywords: "Agent plugins installed enabled loaded provider extensions project chat",
  },
  {
    id: "profile:activity",
    section: "profile",
    title: "Activity",
    target: null,
    keywords: "profile local stats streaks",
  },
] as const;

const SETTINGS_SECTION_LABEL_BY_ID = new Map<SettingsSectionId, string>(
  SETTINGS_NAV_ITEMS.map((item) => [item.id, item.label]),
);

export function settingsSectionLabel(section: SettingsSectionId): string {
  return SETTINGS_SECTION_LABEL_BY_ID.get(section) ?? section;
}

export function rankSettingsSearchEntries(
  query: string,
  limit: number,
  context: SettingsSearchContext | undefined = DEFAULT_SETTINGS_SEARCH_CONTEXT,
): readonly SettingsSearchEntry[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const resolvedContext = context ?? DEFAULT_SETTINGS_SEARCH_CONTEXT;
  const available = SETTINGS_SEARCH_ENTRIES.filter(
    (entry) => entry.applies?.(resolvedContext) ?? true,
  );
  const ranked = rankProviderDiscoveryItems(available, trimmed, (entry) => [
    { value: entry.title },
    { value: entry.keywords, weight: 200 },
    { value: settingsSectionLabel(entry.section), weight: 400 },
  ]);
  return ranked.slice(0, limit);
}
