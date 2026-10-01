import type { ThreadId } from "@glade/contracts/core/baseSchemas";

import { findLeafPaneById } from "../../splitView.logic";
import type { PaneId, SplitView } from "../../splitViewModel";

interface SplitBrowserPanelOpenRequestInput {
  readonly splitView: SplitView;
  readonly requestedThreadId: ThreadId;
  readonly rememberFloatingBrowser: (threadId: ThreadId) => void;
  readonly showFloatingBrowser: (paneId: PaneId) => void;
}

export function routeSplitBrowserPanelOpenRequest(input: SplitBrowserPanelOpenRequestInput): void {
  input.rememberFloatingBrowser(input.requestedThreadId);
  const focusedPane = findLeafPaneById(input.splitView.root, input.splitView.focusedPaneId);
  if (!focusedPane || focusedPane.threadId !== input.requestedThreadId) {
    return;
  }

  input.showFloatingBrowser(focusedPane.id);
}
