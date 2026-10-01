import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type { TerminalOpenInput } from "@glade/contracts/terminal/terminal";

const starts = new Map<string, Promise<void>>();

export function prepareTerminalSession(api: NativeApi, input: TerminalOpenInput): void {
  const key = `${input.threadId}:${input.terminalId}`;
  if (starts.has(key)) return;
  const start = api.terminal
    .open(input)
    .then(() => undefined)
    .catch((error: unknown) => {
      console.warn("Terminal startup failed", error);
    });
  starts.set(key, start);
  void start.finally(() => {
    if (starts.get(key) === start) starts.delete(key);
  });
}

export async function awaitTerminalStartup(threadId: string, terminalId: string): Promise<void> {
  await starts.get(`${threadId}:${terminalId}`);
}
