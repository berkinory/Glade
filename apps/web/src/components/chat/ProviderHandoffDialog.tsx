import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
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
            Continue this chat with{" "}
            {props.provider ? PROVIDER_DISPLAY_NAMES[props.provider] : "the selected provider"}
            {props.model ? ` using ${props.model}` : ""}. Glade prepares context with the selected
            model. Your conversation, draft and working environment stay here. The provider changes
            when you send your next message.
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
            {props.busy ? "Switching…" : "Prepare transition"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
