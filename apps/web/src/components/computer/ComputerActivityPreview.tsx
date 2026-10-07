import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { interruptThreadTurn } from "../chat/chatTaskActions";
import {
  ComposerStackedPanelRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "../chat/ComposerStackedPanelContent";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { ComputerKillSwitchHint } from "./ComputerKillSwitchKbd";

// Stop interrupts the turn; the server cancels in-flight Cua calls and the rest of that turn.
export function ComputerActivityPreview(props: { threadId: ThreadId; activity: string }) {
  const stop = () => {
    interruptThreadTurn(props.threadId).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not stop the agent",
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };
  return (
    <ComposerStackedPanelRow compact>
      <ComposerStackedPanelRowMain>
        <Spinner className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate" aria-live="polite">
          <ComposerStackedPanelRowLabel>{props.activity}</ComposerStackedPanelRowLabel>
        </span>
      </ComposerStackedPanelRowMain>
      <ComputerKillSwitchHint />
      <Button variant="subtle" size="chip" onClick={stop}>
        Stop
      </Button>
    </ComposerStackedPanelRow>
  );
}
