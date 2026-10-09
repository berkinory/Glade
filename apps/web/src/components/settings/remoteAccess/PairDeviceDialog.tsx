import type { RemoteAccessPairing } from "@glade/contracts/transport/ws/remoteAccessRpc";
import { DateTime } from "effect";
import { useEffect, useState } from "react";

import { CheckmarkCircle02Icon, Copy01Icon } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { toastManager } from "../../ui/toast";
import { PairingQrCode } from "./PairingQrCode";
import { formatCountdown, routeHost } from "./remoteAccess.logic";

const CLOSE_AFTER_PAIRED_MS = 1_400;

type PairingState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly pairing: RemoteAccessPairing }
  | { readonly kind: "failed"; readonly message: string };

// Shows a one-time QR code. The code is spent the moment a device uses it, which the device list
// reports by dropping its pending id; that is when this dialog says the device is paired.
export function PairDeviceDialog(props: {
  readonly open: boolean;
  readonly pendingPairingIds: ReadonlyArray<string>;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<PairingState>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  // The device list learns about a new code a moment after it is created; until the code has shown
  // up there, its absence does not mean it was used.
  const [listedId, setListedId] = useState<string | null>(null);
  const { open, onOpenChange } = props;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ kind: "loading" });
    ensureNativeApi()
      .remoteAccess.createPairing()
      .then((pairing) => {
        if (!cancelled) setState({ kind: "ready", pairing });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: "failed",
            message: error instanceof Error ? error.message : "Could not create a pairing code.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  const pairing = state.kind === "ready" ? state.pairing : null;
  const listed = pairing !== null && props.pendingPairingIds.includes(pairing.id);
  if (listed && listedId !== pairing.id) setListedId(pairing.id);
  const paired = pairing !== null && listedId === pairing.id && !listed;
  const remainingMs = pairing ? DateTime.toEpochMillis(pairing.expiresAt) - now : 0;
  const expired = pairing !== null && !paired && remainingMs <= 0;

  useEffect(() => {
    if (!paired) return;
    const timer = window.setTimeout(() => onOpenChange(false), CLOSE_AFTER_PAIRED_MS);
    return () => window.clearTimeout(timer);
  }, [paired, onOpenChange]);

  const copyLink = (url: string) =>
    void navigator.clipboard
      .writeText(url)
      .then(() => toastManager.add({ type: "success", title: "Pairing link copied" }))
      .catch(() => toastManager.add({ type: "error", title: "Could not copy the link" }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Pair a device</DialogTitle>
          <DialogDescription>
            Scan the code with your phone's camera, or open the link on another computer. It works
            once.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col items-center gap-4 px-5 pb-6">
          {state.kind === "failed" ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p role="alert" className="text-ui-sm text-destructive">
                {state.message}
              </p>
              <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                Try again
              </Button>
            </div>
          ) : paired ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckmarkCircle02Icon aria-hidden className="size-10 text-success" />
              <p className="text-ui-lg font-medium">Device paired</p>
            </div>
          ) : pairing === null ? (
            <div className="size-52 animate-pulse rounded-xl bg-muted" aria-label="Creating code" />
          ) : expired ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-ui-sm text-muted-foreground">This code expired.</p>
              <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                New code
              </Button>
            </div>
          ) : (
            <>
              <PairingQrCode value={pairing.url} label="Pairing code" />
              <p className="text-center text-ui-sm text-muted-foreground tabular-nums">
                Opens {routeHost(pairing.url)} · expires in {formatCountdown(remainingMs)}
              </p>
              <Button size="sm" variant="outline" onClick={() => copyLink(pairing.url)}>
                <Copy01Icon aria-hidden />
                Copy link
              </Button>
            </>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
