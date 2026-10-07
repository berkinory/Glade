import type { KeybindingCommand } from "@glade/contracts/settings/keybindings";
import type { IconComponent } from "~/lib/iconComponent";
import { ComputerTerminal01Icon, Folder03Icon, GitCompareIcon, Globe02Icon } from "~/lib/icons";
import type { WorkspaceSidebarView } from "~/workspaceSidebarStore";

export const WORKSPACE_SIDEBAR_VIEW_META: Record<
  WorkspaceSidebarView,
  { label: string; Icon: IconComponent; command: KeybindingCommand }
> = {
  explorer: { label: "Explorer", Icon: Folder03Icon, command: "explorer.toggle" },
  git: { label: "Source Control", Icon: GitCompareIcon, command: "diff.toggle" },
  terminal: { label: "Terminal", Icon: ComputerTerminal01Icon, command: "terminal.toggle" },
  browser: { label: "Browser", Icon: Globe02Icon, command: "browser.toggle" },
};
