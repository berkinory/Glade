import {
  SettingsIcon,
  PaletteIcon,
  BellIcon,
  KeyboardIcon,
  User02Icon,
  FilterHorizontalIcon,
  WorkflowCircle04Icon,
  Archive04Icon,
  PuzzleIcon,
  Book02Icon,
  LimitationIcon,
  CursorInWindowIcon,
  CloudServerIcon,
} from "~/lib/icons";
import type { IconComponent } from "~/lib/iconComponent";
const SETTINGS_SECTION_IDS = [
  "general",
  "appearance",
  "notifications",
  "shortcuts",
  "profile",
  "connections",
  "archived",
  "behavior",
  "git",
  "providers",
  "skills",
  "computer",
  "usage",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "app" | "agents";

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
  { id: "agents", label: "Agents" },
] as const;

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "general",
    group: "app",
    label: "General",
    description: "Arrange the sidebar, check for updates, and manage settings files.",
    icon: SettingsIcon,
  },
  {
    id: "appearance",
    group: "app",
    label: "Appearance",
    description: "Customize the theme, typography, density, and editor cursor.",
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
    id: "connections",
    group: "app",
    label: "Connections",
    description:
      "Run chats on other machines over SSH, and use Glade from your phone or another computer.",
    icon: CloudServerIcon,
    desktopOnly: true,
  },
  {
    id: "archived",
    group: "app",
    label: "Archived chats",
    description: "Find and restore archived chats.",
    icon: Archive04Icon,
  },
  {
    id: "behavior",
    group: "agents",
    label: "Chat",
    description:
      "Choose where new chats work, how they respond, the Environment panel, and confirmations.",
    icon: FilterHorizontalIcon,
  },
  {
    id: "git",
    group: "agents",
    label: "Git & files",
    description:
      "Configure Git generation, choose how files and diffs appear, and clean up worktrees.",
    icon: WorkflowCircle04Icon,
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
  if (value === "models" || value === "worktrees" || value === "files") return "git";
  if (value === "ssh" || value === "remote") return "connections";
  return SETTINGS_SECTION_IDS.find((candidate) => candidate === value) ?? "general";
}
