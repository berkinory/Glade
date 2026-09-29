import type { ThreadId } from "@glade/contracts";
import { dockTerminalScopeId } from "@glade/shared/terminalThreads";

export function dockTerminalThreadId(hostThreadId: ThreadId): ThreadId {
  return dockTerminalScopeId(hostThreadId) as ThreadId;
}
