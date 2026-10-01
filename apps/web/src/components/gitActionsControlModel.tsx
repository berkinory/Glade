import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { GitStatusResult } from "@glade/contracts/git/git";
import { InfoIcon } from "~/lib/icons";
import { GIT_ACTION_ICON_CLASS, GitActionGlyph } from "./gitActionGlyphs";
import type { GitActionMenuItem, GitGlyphName, GitQuickAction } from "./GitActionsControl.logic";
import { MenuItem } from "./ui/menu";

export interface GitActionsControlProps {
  gitCwd: string | null;
  activeThreadId: ThreadId | null;
  hideQuickActionLabel?: boolean;

  variant?: "header" | "panel";

  visibleWhen?: "always" | "pull-available";
  // Lets a parent capture "run commit & push for this instance's repo" so a global keyboard shortcut
  // can trigger it without duplicating the action logic. Called with `null` on unmount/dependency
  // change so a stale trigger never lingers.
  onRegisterCommitAndPushTrigger?: ((trigger: (() => void) | null) => void) | undefined;
}

export interface CreatePrDialogState {
  statusOverride: GitStatusResult | null;
  statusOverrideSource: GitStatusResult | null;
  isDefaultBranchOverride: boolean | null;
}

export interface GitPickerMenuItem {
  id: "push" | "pr" | "sync" | "commit" | "commit_push" | "create_branch";
  label: string;
  disabled: boolean;
  disabledReason: string | null;
  icon: GitGlyphName;
  onSelect: () => void;
}

export function encodeBranchForCompareUrl(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function resolveGitQuickActionGlyph(quickAction: GitQuickAction): GitGlyphName | null {
  if (quickAction.kind === "open_pr") return "pr";
  if (quickAction.kind === "run_pull") return "sync";
  if (quickAction.kind === "create_branch") return "branch";
  if (quickAction.kind === "run_action") {
    return quickAction.action === "commit" ? "commit" : "push";
  }
  if (quickAction.label === "Commit") return "commit";
  return null;
}

export function GitQuickActionIcon({ quickAction }: { quickAction: GitQuickAction }) {
  const name = resolveGitQuickActionGlyph(quickAction);
  if (name) return <GitActionGlyph name={name} />;
  return <InfoIcon className={GIT_ACTION_ICON_CLASS} />;
}

export function findRunnableCommitPushMenuItem(
  items: GitActionMenuItem[],
): GitActionMenuItem | null {
  return (
    items.find((item) => (item.id === "commit_push" || item.id === "push") && !item.disabled) ??
    null
  );
}

export function GitPickerMenuRow({ item }: { item: GitPickerMenuItem }) {
  return (
    <MenuItem disabled={item.disabled} onClick={item.onSelect}>
      <span className="inline-flex shrink-0 items-center [&>svg]:size-3.5">
        <GitActionGlyph name={item.icon} />
      </span>
      <span>{item.label}</span>
    </MenuItem>
  );
}
