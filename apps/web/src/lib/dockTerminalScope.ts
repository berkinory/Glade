// FILE: dockTerminalScope.ts
// Purpose: Identify historical isolated dock terminal scopes during cleanup.
// Layer: Terminal scope helpers
// Exports: dock terminal scope prefix + id factory shared by the dock pane and cleanup.

import type { ThreadId } from "@glade/contracts";
import { dockTerminalScopeId } from "@glade/shared/terminalThreads";

// Older builds stored right-dock sessions under a synthetic scope. Keep the ID
// factory for cleanup so those sessions do not survive a deleted host thread.

export function dockTerminalThreadId(hostThreadId: ThreadId): ThreadId {
  return dockTerminalScopeId(hostThreadId) as ThreadId;
}
