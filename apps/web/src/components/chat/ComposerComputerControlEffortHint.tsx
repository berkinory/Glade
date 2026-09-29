import { MonitorIcon, XIcon } from "~/lib/icons";
import { IconButton } from "../ui/icon-button";
import {
  COMPUTER_CONTROL_HINT_ACTION_LABEL,
  COMPUTER_CONTROL_HINT_MESSAGE,
} from "./composerComputerControlHint";
import { COMPOSER_INLINE_ACTION_PILL_CLASS_NAME } from "./composerPickerStyles";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  ComposerStackedPanelRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import { COMPOSER_STACKED_PANEL_ICON_CLASS_NAME } from "./composerStackedPanelStyles";

interface ComposerComputerControlEffortHintProps {
  onApply: () => void;
  onDismiss: () => void;
  attachedToPrevious?: boolean;
}

export function ComposerComputerControlEffortHint({
  onApply,
  onDismiss,
  attachedToPrevious: attachedToPreviousProp,
}: ComposerComputerControlEffortHintProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  return (
    <ComposerStackedPanel
      attachedToPrevious={attachedToPrevious}
      data-testid="composer-computer-control-effort-hint"
    >
      <ComposerStackedPanelRow>
        <ComposerStackedPanelRowMain>
          <MonitorIcon aria-hidden="true" className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
          <ComposerStackedPanelRowLabel>
            {COMPUTER_CONTROL_HINT_MESSAGE}
          </ComposerStackedPanelRowLabel>
        </ComposerStackedPanelRowMain>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={COMPOSER_INLINE_ACTION_PILL_CLASS_NAME}
            onClick={onApply}
          >
            {COMPUTER_CONTROL_HINT_ACTION_LABEL}
          </button>
          <IconButton variant="ghost" size="icon-chip" label="Dismiss tip" onClick={onDismiss}>
            <XIcon />
          </IconButton>
        </div>
      </ComposerStackedPanelRow>
    </ComposerStackedPanel>
  );
}
