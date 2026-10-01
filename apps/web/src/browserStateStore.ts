import { isRecord } from "@glade/shared/transport/payloadValues";
import type { ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { sanitizeStringKeyedRecord } from "./persistedRecord";

const BROWSER_STATE_STORAGE_KEY = "glade:browser-state:v1";
const BROWSER_HISTORY_LIMIT = 12;
const EMPTY_BROWSER_HISTORY: BrowserHistoryEntry[] = [];

interface StringStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  tabId: string;
}

interface BrowserStateStore {
  threadStatesByThreadId: Record<string, ThreadBrowserState | undefined>;
  recentHistoryByThreadId: Record<string, BrowserHistoryEntry[] | undefined>;
  floatingRequestedByThreadId: Record<string, true | undefined>;
  upsertThreadState: (state: ThreadBrowserState) => void;
  removeThreadState: (threadId: ThreadId) => void;
  requestFloating: (threadId: ThreadId) => void;
  dismissFloating: (threadId: ThreadId) => void;
}

function normalizeHistoryUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed === "about:blank" ? "" : trimmed;
}

function upsertRecentHistoryEntry(
  entries: BrowserHistoryEntry[] | undefined,
  nextEntry: BrowserHistoryEntry,
): BrowserHistoryEntry[] {
  const normalizedUrl = normalizeHistoryUrl(nextEntry.url);
  if (normalizedUrl.length === 0) {
    return entries ?? [];
  }

  const nextEntries = (entries ?? []).filter(
    (entry) => normalizeHistoryUrl(entry.url) !== normalizedUrl,
  );
  nextEntries.unshift({
    ...nextEntry,
    url: normalizedUrl,
  });
  return nextEntries.slice(0, BROWSER_HISTORY_LIMIT);
}

function sameBrowserHistoryEntries(
  previousEntries: BrowserHistoryEntry[] | undefined,
  nextEntries: BrowserHistoryEntry[],
): boolean {
  if (previousEntries === nextEntries) {
    return true;
  }

  if (previousEntries == null || previousEntries.length !== nextEntries.length) {
    return false;
  }

  return previousEntries.every((entry, index) => {
    const nextEntry = nextEntries[index];
    if (!nextEntry) {
      return false;
    }
    return (
      entry.url === nextEntry.url &&
      entry.title === nextEntry.title &&
      entry.tabId === nextEntry.tabId
    );
  });
}

function sanitizeBrowserHistoryEntry(rawEntry: unknown): BrowserHistoryEntry | null {
  if (!isRecord(rawEntry)) {
    return null;
  }
  const { url, title, tabId } = rawEntry;
  if (typeof url !== "string" || typeof title !== "string" || typeof tabId !== "string") {
    return null;
  }
  return { url, title, tabId };
}

// Drops malformed persisted history so a corrupt entry can never reach the upsert path (which
// dereferences `entry.url`) or render as a broken tab.
function sanitizeRecentHistoryByThreadId(value: unknown): Record<string, BrowserHistoryEntry[]> {
  return sanitizeStringKeyedRecord(value, (rawEntries) => {
    if (!Array.isArray(rawEntries)) {
      return null;
    }
    const entries = rawEntries
      .map(sanitizeBrowserHistoryEntry)
      .filter((entry): entry is BrowserHistoryEntry => entry !== null)
      .slice(0, BROWSER_HISTORY_LIMIT);

    return entries.length > 0 ? entries : null;
  });
}

function createDedupedBrowserStateStorage(resolveStorage: () => StringStorage): StringStorage {
  const lastWrittenValueByName = new Map<string, string>();

  return {
    getItem: (name) => resolveStorage().getItem(name),
    setItem: (name, value) => {
      const previousValue = lastWrittenValueByName.get(name) ?? resolveStorage().getItem(name);
      if (previousValue === value) {
        lastWrittenValueByName.set(name, value);
        return;
      }
      lastWrittenValueByName.set(name, value);
      resolveStorage().setItem(name, value);
    },
    removeItem: (name) => {
      lastWrittenValueByName.delete(name);
      resolveStorage().removeItem(name);
    },
  };
}

const browserStateStorage = createDedupedBrowserStateStorage(() => localStorage);

export const useBrowserStateStore = create<BrowserStateStore>()(
  persist(
    (set) => ({
      threadStatesByThreadId: {},
      recentHistoryByThreadId: {},
      floatingRequestedByThreadId: {},
      requestFloating: (threadId) =>
        set((current) =>
          current.floatingRequestedByThreadId[threadId]
            ? current
            : {
                floatingRequestedByThreadId: {
                  ...current.floatingRequestedByThreadId,
                  [threadId]: true,
                },
              },
        ),
      dismissFloating: (threadId) =>
        set((current) => {
          if (!current.floatingRequestedByThreadId[threadId]) return current;
          const floatingRequestedByThreadId = { ...current.floatingRequestedByThreadId };
          delete floatingRequestedByThreadId[threadId];
          return { floatingRequestedByThreadId };
        }),
      upsertThreadState: (state) =>
        set((current) => {
          const previousState = current.threadStatesByThreadId[state.threadId];
          // Main pushes state before some invoke Promises resolve. A delayed response can therefore arrive
          // after a newer onState snapshot; it must never roll browser chrome (or the renderer binding
          // inputs) back to an older tab/runtime generation.
          if (previousState && previousState.version >= state.version) {
            return current;
          }
          const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
          const orderedTabs = activeTab
            ? [activeTab, ...state.tabs.filter((tab) => tab.id !== activeTab.id)]
            : state.tabs;
          const previousHistory =
            current.recentHistoryByThreadId[state.threadId] ?? EMPTY_BROWSER_HISTORY;
          const nextHistory = orderedTabs.reduce(
            (entries, tab) =>
              upsertRecentHistoryEntry(entries, {
                url: tab.lastCommittedUrl ?? tab.url,
                title: tab.title,
                tabId: tab.id,
              }),
            previousHistory,
          );
          const historyChanged = !sameBrowserHistoryEntries(previousHistory, nextHistory);

          return {
            threadStatesByThreadId: {
              ...current.threadStatesByThreadId,
              [state.threadId]: state,
            },
            recentHistoryByThreadId: historyChanged
              ? {
                  ...current.recentHistoryByThreadId,
                  [state.threadId]: nextHistory,
                }
              : current.recentHistoryByThreadId,
          };
        }),
      removeThreadState: (threadId) =>
        set((current) => {
          if (!Object.hasOwn(current.threadStatesByThreadId, threadId)) {
            return current;
          }
          const nextThreadStatesByThreadId = {
            ...current.threadStatesByThreadId,
          };
          const nextRecentHistoryByThreadId = {
            ...current.recentHistoryByThreadId,
          };
          delete nextThreadStatesByThreadId[threadId];
          delete nextRecentHistoryByThreadId[threadId];
          return {
            threadStatesByThreadId: nextThreadStatesByThreadId,
            recentHistoryByThreadId: nextRecentHistoryByThreadId,
          };
        }),
    }),
    {
      name: BROWSER_STATE_STORAGE_KEY,
      storage: createJSONStorage(() => browserStateStorage),
      partialize: (state) => ({
        recentHistoryByThreadId: state.recentHistoryByThreadId,
      }),
      merge: (persisted, current) => ({
        ...current,
        recentHistoryByThreadId: sanitizeRecentHistoryByThreadId(
          (persisted as { recentHistoryByThreadId?: unknown } | undefined)?.recentHistoryByThreadId,
        ),
      }),
    },
  ),
);

export function selectThreadBrowserState(
  threadId: ThreadId,
): (store: BrowserStateStore) => ThreadBrowserState | undefined {
  return (store) => store.threadStatesByThreadId[threadId];
}

export function selectThreadBrowserHistory(
  threadId: ThreadId,
): (store: BrowserStateStore) => BrowserHistoryEntry[] {
  return (store) => store.recentHistoryByThreadId[threadId] ?? EMPTY_BROWSER_HISTORY;
}

export function selectFloatingBrowserRequested(
  threadId: ThreadId,
): (store: BrowserStateStore) => boolean {
  return (store) => store.floatingRequestedByThreadId[threadId] === true;
}
