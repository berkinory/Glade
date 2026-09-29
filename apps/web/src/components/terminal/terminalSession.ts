import { type NativeApi } from "@glade/contracts";

async function disposeTerminalRuntime(threadId: string, terminalId: string): Promise<void> {
  try {
    const { terminalRuntimeRegistry } = await import("./terminalRuntimeRegistry");
    terminalRuntimeRegistry.disposeTerminal(threadId, terminalId);
  } catch (error) {
    // A failed chunk fetch must not strand the server-side terminal: fall through to the close call
    // below, which is the half that actually frees the PTY and its history.
    console.error("Failed to dispose terminal runtime", { threadId, terminalId, error });
  }
}

export function disposeAndCloseTerminalSession(input: {
  api: NativeApi | undefined;
  threadId: string;
  terminalId: string;
  clearHistoryBeforeClose?: boolean;
  processAlreadyExited?: boolean;
}): void {
  const { api, threadId, terminalId } = input;

  const fallbackExitWrite = () => {
    if (input.processAlreadyExited) {
      return Promise.resolve();
    }
    return api?.terminal.write({ threadId, terminalId, data: "exit\n" }).catch(() => undefined);
  };

  void (async () => {
    await disposeTerminalRuntime(threadId, terminalId);

    if (api && "close" in api.terminal && typeof api.terminal.close === "function") {
      try {
        if (input.clearHistoryBeforeClose) {
          await api.terminal.clear({ threadId, terminalId }).catch(() => undefined);
        }
        await api.terminal.close({ threadId, terminalId, deleteHistory: true });
      } catch {
        await fallbackExitWrite();
      }
      return;
    }

    await fallbackExitWrite();
  })();
}
