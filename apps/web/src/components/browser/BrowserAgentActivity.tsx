import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useStore } from "~/store";
import { interruptThreadTurn } from "../chat/chatTaskActions";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { selectBrowserAgentActivity } from "./BrowserAgentActivity.logic";

export function BrowserAgentActivity(props: { threadId: ThreadId }) {
  const action = useStore(selectBrowserAgentActivity(props.threadId));
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
    <DisclosureRegion open={action !== null}>
      <div className="flex items-center gap-2 border-b border-[var(--app-surface-divider)] px-3 py-1 text-ui-sm text-muted-foreground">
        <Spinner className="size-3" aria-hidden />
        <span className="min-w-0 flex-1 truncate" aria-live="polite">
          {action ? `Agent is ${action.charAt(0).toLowerCase()}${action.slice(1)}` : null}
        </span>
        <Button variant="ghost" size="xs" onClick={stop}>
          Stop
        </Button>
      </div>
    </DisclosureRegion>
  );
}
