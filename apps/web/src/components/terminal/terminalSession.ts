import { type NativeApi } from "@glade/contracts/ipc/ipc";
import { describeErrorMessage } from "@glade/shared/text/errorMessages";

import { toastManager } from "../ui/toast";
import { awaitTerminalStartup } from "./terminalStartup";

interface TerminalSessionTarget {
  readonly api: NativeApi | undefined;
  readonly threadId: string;
  readonly terminalId: string;
}

async function closeOnServer({ api, threadId, terminalId }: TerminalSessionTarget): Promise<void> {
  if (!api) throw new Error("The server connection is unavailable.");
  await awaitTerminalStartup(threadId, terminalId);
  await api.terminal.close({ threadId, terminalId, deleteHistory: true });
}

// Closing is optimistic: the view and the local runtime go at once, like a native terminal, and the
// server tears the process tree down in the background. The runtime goes first so a late server
// reply cannot touch a replacement. The registry is imported lazily to keep xterm out of the main
// bundle; once a terminal exists it is loaded and the import settles in a microtask.
export function closeTerminalSession(target: TerminalSessionTarget): void {
  import("./terminalRuntimeRegistry")
    .then(({ terminalRuntimeRegistry }) => {
      terminalRuntimeRegistry.disposeTerminal(target.threadId, target.terminalId);
      return closeOnServer(target);
    })
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Unable to close terminal",
        description: describeErrorMessage(error, "The terminal process may still be running."),
      });
    });
}
