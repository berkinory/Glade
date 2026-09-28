import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@glade/contracts";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export function ProviderHandoffDialog(props: {
  provider: ProviderKind | null;
  model: string | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={props.provider !== null} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md" showCloseButton={!props.busy}>
        <DialogHeader>
          <DialogTitle>Switch provider?</DialogTitle>
          <DialogDescription>
            This creates a new task with{" "}
            {props.provider ? PROVIDER_DISPLAY_NAMES[props.provider] : "the selected provider"}
            {props.model ? ` using ${props.model}` : ""}. Glade carries over the conversation and
            working environment. The original task stays available, and the new provider receives
            the conversation context with your first message.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={props.busy}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={props.busy} onClick={props.onConfirm}>
            {props.busy ? "Switching…" : "Create new task"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
