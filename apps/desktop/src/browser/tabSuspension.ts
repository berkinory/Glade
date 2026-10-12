export interface LiveTabUse {
  readonly id: string;
  readonly lastUsed: number;
  // Its thread's browser panel is on screen in a visible window.
  readonly onScreen: boolean;
  // Destroying its view would lose nothing the agent or user is in the middle of.
  readonly suspendable: boolean;
}

// Every live tab is a renderer process that keeps running while hidden.
const MAX_LIVE_TABS = 4;
const IDLE_MS = 10 * 60_000;
const OFF_SCREEN_IDLE_MS = 5 * 60_000;

// Like Chrome's tab discarding: tabs left idle give up their renderer, sooner when nobody can see
// their thread, and beyond the live-tab cap the least recently used ones do too. `keep`, a tab
// that just opened or came back, is never chosen.
export function tabsToSuspend(
  tabs: readonly LiveTabUse[],
  now: number,
  keep?: string,
): ReadonlySet<string> {
  const chosen = new Set<string>();
  const candidates = tabs.filter((tab) => tab.suspendable && tab.id !== keep);
  for (const tab of candidates) {
    if (now - tab.lastUsed > (tab.onScreen ? IDLE_MS : OFF_SCREEN_IDLE_MS)) chosen.add(tab.id);
  }
  let excess = tabs.length - chosen.size - MAX_LIVE_TABS;
  for (const tab of candidates.toSorted((a, b) => a.lastUsed - b.lastUsed)) {
    if (excess <= 0) break;
    if (chosen.has(tab.id)) continue;
    chosen.add(tab.id);
    excess -= 1;
  }
  return chosen;
}
