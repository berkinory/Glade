import type { ThreadId } from "@glade/contracts/core/baseSchemas";

interface DockPaneOpenRequestInput {
  readonly currentThreadId: ThreadId;
  readonly requestedThreadId: ThreadId;
  // Agent-triggered opens must not wait for rAF, which Chromium/Electron suspends for backgrounded
  // windows.
  readonly requestImmediateHydration: () => void;
  readonly openPane: (threadId: ThreadId) => void;
}

// Remember the pane on its owning thread so background agent activity never changes the user's
// current chat: the event carries its own thread, the dock is seeded there, and returning to that
// chat restores the pane. The runtime behind the pane (browser, desktop) stays attached
// server-side, so there is nothing to gain by stealing the current chat to make it visible.
export function routeSingleDockPaneOpenRequest(input: DockPaneOpenRequestInput): void {
  if (input.requestedThreadId === input.currentThreadId) {
    input.requestImmediateHydration();
  }
  input.openPane(input.requestedThreadId);
}
