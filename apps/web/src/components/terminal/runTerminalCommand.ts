import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type { TerminalSessionSnapshot } from "@glade/contracts/terminal/terminal";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  deriveTerminalCommandIdentity,
  type TerminalCliKind,
} from "@glade/shared/threads/terminalThreads";

import { terminalRuntimeEnv } from "~/lib/terminalRuntimeEnv";

const COMMAND_TERMINAL_COLS = 120;
const COMMAND_TERMINAL_ROWS = 30;

export interface TerminalCommandMetadata {
  cliKind: TerminalCliKind | null;
  label: string;
}

export async function runTerminalCommand(input: {
  api: NativeApi;
  threadId: ThreadId;
  terminalId: string;
  cwd: string;
  command: string;
}): Promise<{
  snapshot: TerminalSessionSnapshot;
  metadata: TerminalCommandMetadata | null;
}> {
  const runtimeEnv = terminalRuntimeEnv({ cwd: input.cwd });
  const terminalCommandIdentity = deriveTerminalCommandIdentity(input.command);
  const snapshot = await input.api.terminal.open({
    threadId: input.threadId,
    terminalId: input.terminalId,
    cwd: input.cwd,
    env: runtimeEnv,
    cols: COMMAND_TERMINAL_COLS,
    rows: COMMAND_TERMINAL_ROWS,
  });
  await input.api.terminal.write({
    threadId: input.threadId,
    terminalId: input.terminalId,
    data: `${input.command}\r`,
  });

  return {
    snapshot,
    metadata: terminalCommandIdentity
      ? {
          cliKind: terminalCommandIdentity.cliKind,
          label: terminalCommandIdentity.title,
        }
      : null,
  };
}
