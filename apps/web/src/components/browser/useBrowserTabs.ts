import type { BrowserTabsChanged } from "@glade/contracts/browser/browserHost";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useState } from "react";
import { readNativeApi } from "~/nativeApi";

export type BrowserTab = BrowserTabsChanged["tabs"][number];

// The thread's tabs straight from the server subscription; null until the first list arrives.
export function useBrowserTabs(threadId: ThreadId): readonly BrowserTab[] | null {
  const [state, setState] = useState<{
    threadId: ThreadId;
    tabs: readonly BrowserTab[];
  } | null>(null);
  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    return api.browser.onTabs({ threadId }, ({ tabs }) => setState({ threadId, tabs }));
  }, [threadId]);
  return state?.threadId === threadId ? state.tabs : null;
}
