import {
  SettingsIcon,
  PaletteIcon,
  BellIcon,
  KeyboardIcon,
  User02Icon,
  BriefcaseBusinessIcon,
  FilterHorizontalIcon,
  WorkflowCircle04Icon,
  Archive04Icon,
  PuzzleIcon,
  BlocksIcon,
  Book02Icon,
  LimitationIcon,
  CursorInWindowIcon,
  ServerStack01Icon,
} from "~/lib/icons";
import type { IconComponent } from "~/lib/iconComponent";
const SETTINGS_SECTION_IDS = [
  "general",
  "profile",
  "appearance",
  "notifications",
  "behavior",
  "shortcuts",
  "worktrees",
  "archived",
  "files",
  "providers",
  "skills",
  "mcp",
  "plugins",
  "computer",
  "usage",
  "advanced",
  "ssh",
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

  icon: IconComponent;

  badge?: string;
  // Shown only in the desktop app.
  desktopOnly?: boolean;
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
    icon: SettingsIcon,
  },
  {
    id: "appearance",
    group: "app",
    label: "Appearance",
    description: "Customize the theme, typography, density, and time format.",
    icon: PaletteIcon,
  },
  {
    id: "notifications",
    group: "app",
    label: "Notifications",
    description: "Choose how Glade tells you when work finishes or needs attention.",
    icon: BellIcon,
  },
  {
    id: "shortcuts",
    group: "app",
    label: "Keyboard shortcuts",
    description: "Capture, customize, and add shortcuts for every Glade command.",
    icon: KeyboardIcon,
  },
  {
    id: "profile",
    group: "app",
    label: "Activity",
    description: "Your local activity, streaks, and a shareable stats card.",
    icon: User02Icon,
  },
  {
    id: "ssh",
    group: "app",
    label: "SSH hosts",
    description:
      "Run chats on other machines over SSH. Their projects sit in the sidebar with yours.",
    icon: ServerStack01Icon,
    desktopOnly: true,
  },
  {
    id: "advanced",
    group: "app",
    label: "Advanced",
    description: "Manage connections, updates, and app defaults.",
    icon: BriefcaseBusinessIcon,
  },
  {
    id: "behavior",
    group: "workspace",
    label: "Chat",
    description: "Choose how chats respond and when to ask for confirmation.",
    icon: FilterHorizontalIcon,
  },
  {
    id: "files",
    group: "workspace",
    label: "Files & diffs",
    description: "Choose which files appear and how diffs are displayed.",
    icon: WorkflowCircle04Icon,
  },
  {
    id: "worktrees",
    group: "workspace",
    label: "Git & worktrees",
    description: "Configure Git generation and clean up worktrees created by Glade.",
    icon: WorkflowCircle04Icon,
  },
  {
    id: "archived",
    group: "workspace",
    label: "Archived chats",
    description: "Find and restore archived chats.",
    icon: Archive04Icon,
  },
  {
    id: "providers",
    group: "agents",
    label: "Providers",
    description: "Choose visible coding agents and manage their installed CLI tools.",
    icon: PuzzleIcon,
  },
  {
    id: "skills",
    group: "agents",
    label: "Skills",
    description: "Review reusable workflows discovered across all configured providers.",
    icon: Book02Icon,
  },
  {
    id: "mcp",
    group: "agents",
    label: "MCP servers",
    description: "Manage native tools, connections and authentication.",
    icon: PuzzleIcon,
  },
  {
    id: "plugins",
    group: "agents",
    label: "Plugins",
    description: "Manage native installed plugins and session loading.",
    icon: BlocksIcon,
  },
  {
    id: "computer",
    group: "agents",
    label: "Browser & Computer Use",
    description:
      "The built-in browser's blocker, the Computer Use driver, permissions and app access.",
    icon: CursorInWindowIcon,
    desktopOnly: true,
  },
  {
    id: "usage",
    group: "agents",
    label: "Usage & limits",
    description: "See remaining quota and credits for every signed-in provider.",
    icon: LimitationIcon,
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
