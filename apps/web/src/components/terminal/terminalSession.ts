import { type NativeApi } from "@glade/contracts/ipc/ipc";
import { describeErrorMessage } from "@glade/shared/text/errorMessages";

import { toastManager } from "../ui/toast";
import { awaitTerminalStartup } from "./terminalStartup";

interface TerminalSessionTarget {
  readonly api: NativeApi | undefined;
  readonly threadId: string;
  readonly terminalId: string;
}

const closesInFlight = new Map<string, Promise<boolean>>();

async function closeOnServer({ api, threadId, terminalId }: TerminalSessionTarget): Promise<void> {
  if (!api) throw new Error("The server connection is unavailable.");
  await awaitTerminalStartup(threadId, terminalId);
  await api.terminal.close({ threadId, terminalId, deleteHistory: true });
}

// The server close is the authority for an explicit close. Callers keep the tile, the xterm
// instance and the history until it succeeds, so a failed close leaves a usable terminal.
export function closeTerminalSession(target: TerminalSessionTarget): Promise<boolean> {
  const key = `${target.threadId}:${target.terminalId}`;
  const inFlight = closesInFlight.get(key);
  if (inFlight) return inFlight;
  const close = import("./terminalRuntimeRegistry")
    .then(({ terminalRuntimeRegistry }) =>
      terminalRuntimeRegistry.disposeTerminalAfter(target.threadId, target.terminalId, () =>
        closeOnServer(target),
      ),
    )
    .then(
      () => true,
      (error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Unable to close terminal",
          description: describeErrorMessage(error, "The terminal is still open."),
        });
        return false;
      },
    )
    .finally(() => {
      if (closesInFlight.get(key) === close) closesInFlight.delete(key);
    });
  closesInFlight.set(key, close);
  return close;
}

// For sessions whose view is already gone: an exited process or an unmounted surface. The local
// runtime goes first so a late server reply cannot touch a replacement.
export function releaseTerminalSession(target: TerminalSessionTarget): void {
  const { threadId, terminalId } = target;
  void (async () => {
    try {
      const { terminalRuntimeRegistry } = await import("./terminalRuntimeRegistry");
      terminalRuntimeRegistry.disposeTerminal(threadId, terminalId);
    } catch (error) {
      console.error("Failed to dispose terminal runtime", { threadId, terminalId, error });
    }
    await closeOnServer(target).catch((error: unknown) => {
      console.warn("Failed to close terminal session", { threadId, terminalId, error });
    });
  })();
}
