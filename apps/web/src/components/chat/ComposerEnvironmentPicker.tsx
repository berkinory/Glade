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
  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger
        disabled={disabled}
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
            label={environmentPresentation.shortLabel}
            trailing={<EnvironmentRowChevron />}
          />
        ) : (
          <>
            {envGlyph("size-3.5")}
            {environmentPresentation.shortLabel}
            <ChevronDownIcon className="size-3 opacity-60" />
          </>
        )}
      </MenuTrigger>
      <ComposerPickerMenuPopup
        data-composer-environment-menu="true"
        align="start"
        side={isPanel ? "bottom" : "top"}
        sideOffset={6}
        className="w-60 min-w-60"
      >
        <MenuGroup>
          <MenuGroupLabel>Work in</MenuGroupLabel>
          {environmentPresentation.mode === "local" ? (
            <WorkInMenuItem
              icon={<LaptopIcon className={ENV_MENU_ICON_CLASS_NAME} />}
              label={environmentPresentation.localOptionLabel}
              selected
            />
          ) : (
            <WorkInMenuItem
              icon={<LaptopIcon className={ENV_MENU_ICON_CLASS_NAME} />}
              label={environmentPresentation.localOptionLabel}
              onSelect={() => onEnvModeChange("local")}
            />
          )}
          {canSwitchToWorktree ? (
            <WorkInMenuItem
              icon={<GitForkIcon className={ENV_MENU_ICON_CLASS_NAME} />}
              label="New worktree"
              onSelect={() => onEnvModeChange("worktree")}
            />
          ) : null}
          {environmentPresentation.mode === "worktree" && !canHandoffToLocal ? (
            <WorkInMenuItem
              icon={<GitForkIcon className={ENV_MENU_ICON_CLASS_NAME} />}
              label={environmentPresentation.worktreeOptionLabel}
              selected
            />
          ) : null}
          {canHandoffToLocal && onHandoffToLocal ? (
            <WorkInMenuItem
              icon={<ArrowLeftRightIcon className={ENV_MENU_ICON_CLASS_NAME} />}
              label="Hand off to local"
              disabled={handoffBusy}
              onSelect={() => onHandoffToLocal()}
            />
          ) : null}
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
