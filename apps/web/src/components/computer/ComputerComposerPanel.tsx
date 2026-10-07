import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { CursorInWindowIcon, XIcon } from "~/lib/icons";
import { useStore } from "~/store";
import { ComposerStackedPanel } from "../chat/ComposerStackedPanel";
import {
  ComposerStackedPanelRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "../chat/ComposerStackedPanelContent";
import { COMPOSER_STACKED_PANEL_ICON_CLASS_NAME } from "../chat/composerStackedPanelStyles";
import { IconButton } from "../ui/icon-button";
import { ComputerActivityPreview } from "./ComputerActivityPreview";
import { ComputerKillSwitchHint } from "./ComputerKillSwitchKbd";
import { selectComputerActivity } from "./ComputerActivityPreview.logic";
import { setComputerUseMode, useThreadComputerUse } from "./computerUseState";

const MODE_LABEL = {
  once: "Computer Use is on for the next message",
  on: "Computer Use is on for this chat",
} as const;

// One composer row for Computer Use: the running task with Stop while the turn uses the computer,
// otherwise the thread's mode when it is not off.
export function ComputerComposerPanel(props: { threadId: ThreadId; attachedToPrevious: boolean }) {
  const { mode } = useThreadComputerUse(props.threadId);
  const activity = useStore(selectComputerActivity(props.threadId));
  if (activity === null && mode === "off") return null;
  return (
    <ComposerStackedPanel attachedToPrevious={props.attachedToPrevious}>
      {activity !== null ? (
        <ComputerActivityPreview threadId={props.threadId} activity={activity} />
      ) : mode !== "off" ? (
        <ComposerStackedPanelRow compact>
          <ComposerStackedPanelRowMain>
            <CursorInWindowIcon aria-hidden className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
            <ComposerStackedPanelRowLabel>{MODE_LABEL[mode]}</ComposerStackedPanelRowLabel>
          </ComposerStackedPanelRowMain>
          <ComputerKillSwitchHint />
          <IconButton
            variant="ghost"
            size="icon-chip"
            label="Turn off Computer Use"
            onClick={() => void setComputerUseMode(props.threadId, "off")}
          >
            <XIcon />
          </IconButton>
        </ComposerStackedPanelRow>
      ) : null}
    </ComposerStackedPanel>
  );
}
