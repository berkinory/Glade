const SETTINGS_SECTION_IDS = [
  "general",
  "profile",
  "appearance",
  "notifications",
  "behavior",
  "computer",
  "shortcuts",
  "worktrees",
  "archived",
  "files",
  "providers",
  "skills",
  "mcp",
  "plugins",
  "usage",
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "app" | "workspace" | "agents";

export const SETTINGS_TARGETS = {
  providerUpdates: "provider-updates",
  environmentPanel: "environment-panel",
} as const;

export type SettingsNavItem = {
  id: SettingsSectionId;
  group: SettingsNavGroupId;
  label: string;
  description: string;

  icon: string;

  badge?: string;
};

export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  id: SettingsNavGroupId;
  label: string;
}> = [
  { id: "app", label: "App" },
  { id: "workspace", label: "Workspace" },
  { id: "agents", label: "Agents" },
] as const;

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "general",
    group: "app",
    label: "General",
    description: "Choose defaults for new chats, navigation, and the Environment panel.",
    icon: "settings-gear-4",
  },
  {
    id: "appearance",
    group: "app",
    label: "Appearance",
    description: "Customize the theme, typography, density, and time format.",
    icon: "color-palette",
  },
  {
    id: "notifications",
    group: "app",
    label: "Notifications",
    description: "Choose how Glade tells you when work finishes or needs attention.",
    icon: "bell",
  },
  {
    id: "shortcuts",
    group: "app",
    label: "Keyboard shortcuts",
    description: "Capture, customize, and add shortcuts for every Glade command.",
    icon: "shortcut",
  },
  {
    id: "profile",
    group: "app",
    label: "Activity",
    description: "Your local activity, streaks, and a shareable stats card.",
    icon: "user",
  },
  {
    id: "advanced",
    group: "app",
    label: "Advanced",
    description: "Manage connections, recovery, updates, and app defaults.",
    icon: "toolbox",
  },
  {
    id: "behavior",
    group: "workspace",
    label: "Chat",
    description: "Choose how chats respond and when to ask for confirmation.",
    icon: "settings-slider-hor",
  },
  {
    id: "files",
    group: "workspace",
    label: "Files & diffs",
    description: "Choose which files appear and how diffs are displayed.",
    icon: "branch-simple",
  },
  {
    id: "worktrees",
    group: "workspace",
    label: "Git & worktrees",
    description: "Configure Git generation and clean up worktrees created by Glade.",
    icon: "branch-simple",
  },
  {
    id: "archived",
    group: "workspace",
    label: "Archived chats",
    description: "Find and restore archived chats.",
    icon: "archive",
  },
  {
    id: "providers",
    group: "agents",
    label: "Providers",
    description: "Choose visible coding agents and manage their installed CLI tools.",
    icon: "puzzle",
  },
  {
    id: "skills",
    group: "agents",
    label: "Skills",
    description: "Review reusable workflows discovered across all configured providers.",
    icon: "building-blocks",
  },
  {
    id: "mcp",
    group: "agents",
    label: "MCP servers",
    description: "Manage native tools, connections and authentication.",
    icon: "puzzle",
  },
  {
    id: "plugins",
    group: "agents",
    label: "Plugins",
    description: "Manage native installed plugins and session loading.",
    icon: "building-blocks",
  },
  {
    id: "computer",
    group: "agents",
    label: "Computer use",
    description: "Let agents see and control this computer's desktop, and check backend status.",
    icon: "computer-use",
  },
  {
    id: "usage",
    group: "agents",
    label: "Usage & limits",
    description: "See remaining quota and credits for every signed-in provider.",
    icon: "gauge",
  },
];

export function settingRowAnchorId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `setting-${slug}`;
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  if (typeof value !== "string") {
    return "general";
  }
  if (value === "models") return "worktrees";
  return SETTINGS_SECTION_IDS.find((candidate) => candidate === value) ?? "general";
}
