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
import { CloudServerIcon, Link01Icon } from "~/lib/icons";
import { Spinner } from "../../ui/spinner";
import { DialogFact } from "../DialogFact";

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
          <DialogDescription>Use another computer's Glade from here.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="mt-2 space-y-4 px-5">
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
          <ul className="flex flex-col gap-2.5">
            <DialogFact icon={<Link01Icon aria-hidden />}>
              On the other machine, open Settings → Remote access, choose Pair a device and copy the
              link.
            </DialogFact>
            <DialogFact icon={<CloudServerIcon aria-hidden />}>
              Its projects, chats, agents and skills appear here and stay on that machine.
            </DialogFact>
          </ul>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || link.trim().length === 0}>
            {pending ? <Spinner className="size-4" /> : null}
            Pair
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
