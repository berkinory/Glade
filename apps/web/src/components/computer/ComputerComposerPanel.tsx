import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useStore } from "~/store";
import { ComposerStackedPanel } from "../chat/ComposerStackedPanel";
import { ComputerActivityPreview } from "./ComputerActivityPreview";
import { selectComputerActivity } from "./ComputerActivityPreview.logic";

// The composer row for the running Computer Use task with Stop, shown only while a turn uses the
// computer.
export function ComputerComposerPanel(props: { threadId: ThreadId; attachedToPrevious: boolean }) {
  const activity = useStore(selectComputerActivity(props.threadId));
  if (activity === null) return null;
  return (
    <ComposerStackedPanel attachedToPrevious={props.attachedToPrevious}>
      <ComputerActivityPreview threadId={props.threadId} activity={activity} />
    </ComposerStackedPanel>
  );
}
