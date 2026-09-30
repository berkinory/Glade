import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { dockTerminalScopeId } from "@glade/shared/threads/terminalThreads";

export function dockTerminalThreadId(hostThreadId: ThreadId): ThreadId {
  return dockTerminalScopeId(hostThreadId) as ThreadId;
}
