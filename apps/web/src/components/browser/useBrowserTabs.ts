import type { BrowserTabsChanged } from "@glade/contracts/browser/browserHost";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useState } from "react";
import { readNativeApi } from "~/nativeApi";

export type BrowserTab = BrowserTabsChanged["tabs"][number];

// The thread's tabs straight from the server subscription; null until the first list arrives or
// without a thread.
export function useBrowserTabs(threadId: ThreadId | null): readonly BrowserTab[] | null {
  const [state, setState] = useState<{
    threadId: ThreadId;
    tabs: readonly BrowserTab[];
  } | null>(null);
  useEffect(() => {
    const api = readNativeApi();
    if (!api || !threadId) return;
    return api.browser.onTabs({ threadId }, ({ tabs }) => setState({ threadId, tabs }));
  }, [threadId]);
  return threadId && state?.threadId === threadId ? state.tabs : null;
}
