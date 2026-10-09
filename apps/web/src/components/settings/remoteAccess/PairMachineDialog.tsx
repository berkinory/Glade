import { useEffect, useId, useState } from "react";
import { ipcErrorMessage } from "~/lib/ipcErrorMessage";
import { cn } from "~/lib/utils";
import { PROJECT_DIALOG_FIELD_CONTROL_CLASS_NAME } from "../../CreateGitHubProjectFields";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  dialogFieldLabelClassName,
} from "../../ui/dialog";
import { Input } from "../../ui/input";

function looksLikePairingLink(value: string): boolean {
  const url = URL.parse(value);
  return url !== null && /^https?:$/u.test(url.protocol) && url.hash.includes("token=");
}

// Pairs this app with another machine's Glade. The link comes from Pair a device on that machine;
// the desktop redeems it and keeps the session, so the link is spent once this succeeds.
export function PairMachineDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPair: (link: string) => Promise<void>;
}) {
  const fieldId = useId();
  const [link, setLink] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setLink("");
    setPending(false);
    setError(null);
  }, [props.open]);

  const submit = async () => {
    const value = link.trim();
    if (!looksLikePairingLink(value)) {
      setError("Paste the whole link from Pair a device, starting with http.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await props.onPair(value);
      props.onOpenChange(false);
    } catch (cause) {
      setError(ipcErrorMessage(cause, "Could not pair with that machine."));
      setPending(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Pair with a machine</DialogTitle>
          <DialogDescription>
            On the other machine, open Settings → Remote access, choose Pair a device and copy the
            link. Its projects and chats appear here and stay on that machine.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-2 px-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label
              htmlFor={`${fieldId}-link`}
              className={cn("block", dialogFieldLabelClassName, "text-ui text-foreground")}
            >
              Pairing link
            </label>
            <Input
              id={`${fieldId}-link`}
              className={cn(PROJECT_DIALOG_FIELD_CONTROL_CLASS_NAME, "mt-2 font-mono")}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="https://machine.tailnet.ts.net/pair#token=…"
              value={link}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setLink(event.target.value);
                setError(null);
              }}
            />
          </form>
          {error ? (
            <p role="alert" className="text-ui-xs text-destructive">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter className="px-5 pb-5">
          <Button
            variant="ghost"
            shape="capsule"
            className="px-4 text-ui-lg sm:text-ui-lg"
            onClick={() => props.onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="prominent"
            className="px-4 text-ui-lg transition-opacity hover:scale-100 sm:text-ui-lg"
            onClick={() => void submit()}
            disabled={pending || link.trim().length === 0}
          >
            {pending ? "Pairing…" : "Pair"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
