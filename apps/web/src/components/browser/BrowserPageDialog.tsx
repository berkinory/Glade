import type { BrowserPageDialog as PageDialog } from "@glade/contracts/browser/browserHost";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";

// A page's alert or confirm, shown above the page because native views cover web UI. The page
// stays paused until it is answered here or, for the agent's own dialogs, by the agent.
export function BrowserPageDialog(props: {
  dialog: PageDialog | null;
  onAnswer: (accept: boolean) => void;
}) {
  const { dialog } = props;
  return (
    <DisclosureRegion open={dialog !== null}>
      {dialog ? (
        <div
          role="alertdialog"
          aria-label="Page dialog"
          className="flex flex-col gap-1.5 border-b border-[var(--app-surface-divider)] px-3 py-2 text-ui-sm"
        >
          <span className="text-muted-foreground">
            {dialog.audience === "agent" ? "The page asks the agent:" : "The page asks:"}
          </span>
          <span className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words">
            {dialog.message || "(no message)"}
          </span>
          <div className="flex justify-end gap-1.5">
            {dialog.type === "confirm" ? (
              <Button variant="ghost" size="xs" onClick={() => props.onAnswer(false)}>
                Cancel
              </Button>
            ) : null}
            <Button size="xs" autoFocus onClick={() => props.onAnswer(true)}>
              OK
            </Button>
          </div>
        </div>
      ) : null}
    </DisclosureRegion>
  );
}
