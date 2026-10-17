import { basenameOfPath } from "~/file-icons";
import type { GitBranch } from "@glade/contracts/git/git";
import { workspaceRootsEqual } from "@glade/shared/threads/threadWorkspace";
import {
  CheckIcon,
  ChevronDownIcon,
  ArrowLeftRightIcon,
  GitForkIcon,
  LaptopIcon,
} from "~/lib/icons";
import type { ThreadEnvironmentMode } from "@glade/contracts/orchestration/threadEntities";
import type { ReactNode } from "react";
import type { ThreadEnvironmentPresentation } from "~/lib/threadEnvironment";
import { COMPOSER_TOOLBAR_PICKER_TRIGGER_CLASS_NAME } from "./composerPickerStyles";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "./environment/EnvironmentRow";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuTrigger } from "../ui/menu";
const ENV_MENU_ICON_CLASS_NAME = "size-3.5 text-muted-foreground";
function WorkInMenuItem({
  icon,
  label,
  selected: selectedProp,
  disabled: disabledProp,
  onSelect,
}: {
  icon: ReactNode;
  label: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const selected = selectedProp ?? false;
  const disabled = disabledProp ?? false;
  return (
    <MenuItem
      disabled={disabled}
      {...(onSelect
        ? {
            onClick: onSelect,
          }
        : {})}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? (
        <CheckIcon className="size-3.5 shrink-0 text-[var(--color-text-foreground)]" />
      ) : null}
    </MenuItem>
  );
}
interface ComposerEnvironmentPickerProps {
  workspace?: {
    projectCwd: string;
    path: string | null;
    branches: readonly GitBranch[];
    onSelect: (branch: GitBranch | null) => void;
    onNewWorktree: () => void;
  };
  environmentPresentation: ThreadEnvironmentPresentation;
  onEnvModeChange: (mode: ThreadEnvironmentMode) => void;
  canSwitchToWorktree: boolean;
  canHandoffToLocal?: boolean;
  onHandoffToLocal?: (() => void) | undefined;
  handoffBusy?: boolean | undefined;
  isPanel?: boolean;
  disabled?: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
}
export function ComposerEnvironmentPicker({
  environmentPresentation,
  workspace,
  onEnvModeChange,
  canSwitchToWorktree,
  canHandoffToLocal = false,
  onHandoffToLocal,
  handoffBusy = false,
  isPanel = false,
  disabled = false,
  onOpenChange,
}: ComposerEnvironmentPickerProps) {
  const envGlyph = (className: string) =>
    environmentPresentation.mode === "local" ? (
      <LaptopIcon className={className} />
    ) : (
      <GitForkIcon className={className} />
    );
  const currentPath = workspace?.path;
  const worktrees =
    workspace?.branches.filter(
      (branch) =>
        branch.worktreePath && !workspaceRootsEqual(branch.worktreePath, workspace.projectCwd),
    ) ?? [];
  const workspaceName = workspace?.path ? basenameOfPath(workspace.path) : null;
  const label = workspaceName ?? environmentPresentation.shortLabel;
  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger
        disabled={disabled || handoffBusy}
        aria-label={`Workspace: ${label}`}
        title={workspace?.path ?? "Workspace"}
        render={
          <button
            type="button"
            className={
              isPanel ? ENVIRONMENT_ROW_CLASS_NAME : COMPOSER_TOOLBAR_PICKER_TRIGGER_CLASS_NAME
            }
          />
        }
      >
        {isPanel ? (
          <EnvironmentRowBody
            icon={envGlyph(ENVIRONMENT_ROW_ICON_CLASS_NAME)}
            label="Workspace"
            trailing={
              <>
                <span className="max-w-28 truncate text-muted-foreground">{label}</span>
                <EnvironmentRowChevron />
              </>
            }
          />
        ) : (
          <>
            {envGlyph("size-3.5")}
            {label}
            <ChevronDownIcon className="size-3 opacity-60" />
          </>
        )}
      </MenuTrigger>
      <ComposerPickerMenuPopup
        data-composer-environment-menu="true"
        align="start"
        side={isPanel ? "bottom" : "top"}
        sideOffset={6}
        className="w-64 min-w-64"
      >
        <MenuGroup>
          <MenuGroupLabel>Workspace</MenuGroupLabel>
          <WorkInMenuItem
            icon={<LaptopIcon className={ENV_MENU_ICON_CLASS_NAME} />}
            label={environmentPresentation.localOptionLabel}
            selected={environmentPresentation.mode === "local"}
            onSelect={() => (workspace ? workspace.onSelect(null) : onEnvModeChange("local"))}
          />
          {worktrees.map((branch) => (
            <WorkInMenuItem
              key={branch.worktreePath}
              icon={<GitForkIcon className={ENV_MENU_ICON_CLASS_NAME} />}
              label={
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {branch.worktreePath ? basenameOfPath(branch.worktreePath) : branch.name}
                  </span>
                  <span className="truncate text-ui-xs text-muted-foreground">{branch.name}</span>
                </span>
              }
              selected={Boolean(
                branch.worktreePath &&
                currentPath &&
                workspaceRootsEqual(branch.worktreePath, currentPath),
              )}
              onSelect={() => workspace?.onSelect(branch)}
            />
          ))}
          {currentPath &&
          !worktrees.some(
            (branch) =>
              branch.worktreePath && workspaceRootsEqual(branch.worktreePath, currentPath),
          ) ? (
            <WorkInMenuItem
              icon={<GitForkIcon className={ENV_MENU_ICON_CLASS_NAME} />}
              label={label}
              selected
            />
          ) : null}
          {canSwitchToWorktree || environmentPresentation.workspaceState === "worktree-pending" ? (
            <WorkInMenuItem
              icon={<GitForkIcon className={ENV_MENU_ICON_CLASS_NAME} />}
              label={
                environmentPresentation.workspaceState === "worktree-pending"
                  ? "Configure new worktree…"
                  : "New worktree…"
              }
              selected={environmentPresentation.workspaceState === "worktree-pending"}
              onSelect={() => (workspace ? workspace.onNewWorktree() : onEnvModeChange("worktree"))}
            />
          ) : null}
          {canHandoffToLocal && onHandoffToLocal ? (
            <WorkInMenuItem
              icon={<ArrowLeftRightIcon className={ENV_MENU_ICON_CLASS_NAME} />}
              label="Move changes to project folder"
              disabled={handoffBusy}
              onSelect={() => onHandoffToLocal()}
            />
          ) : null}
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
