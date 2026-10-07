import type { CuaElement } from "./cuaResults.ts";

interface WindowKey {
  readonly pid: number;
  readonly windowId: number;
}

// An element as the model sees it: Glade's index, stable across snapshots of the same window.
export interface IndexedElement {
  readonly index: number;
  readonly element: CuaElement;
}

export interface SnapshotDiff {
  // Added and removed are empty unless both snapshots covered the whole window (no query, not
  // truncated): against a filtered read, everything it left out would look new or gone.
  readonly added: ReadonlyArray<IndexedElement>;
  readonly removed: ReadonlyArray<IndexedElement>;
  readonly changed: ReadonlyArray<IndexedElement>;
  readonly comparable: boolean;
}

export interface WindowSnapshots {
  // Records a Cua snapshot of the window and returns its elements under Glade's indexes plus what
  // changed since the previous one. `complete` says the snapshot lists the whole window.
  readonly record: (
    threadId: string,
    window: WindowKey,
    elements: ReadonlyArray<CuaElement>,
    complete: boolean,
  ) => { readonly elements: ReadonlyArray<IndexedElement>; readonly diff: SnapshotDiff | null };
  readonly has: (threadId: string, window: WindowKey) => boolean;
  // The current Cua token for a Glade index, or null when the latest snapshot does not list it.
  readonly token: (threadId: string, window: WindowKey, index: number) => string | null;
  readonly clearThread: (threadId: string) => void;
}

interface WindowTable {
  // identity → Glade index. Indexes are never reused within a window, so an index the model kept
  // from an older snapshot either still means the same element or is refused as unknown.
  readonly indexes: Map<string, number>;
  next: number;
  // Glade index → element of the latest snapshot. Cua stales every token of a window once a newer
  // snapshot of it exists, so only the latest one is actionable.
  latest: Map<number, CuaElement>;
  latestComplete: boolean;
}

// Long-lived windows (chat apps, feeds) keep producing new identities; past this many the table
// forgets old ones, which only means a returning element gets a fresh index.
const MAX_IDENTITIES = 20_000;

const TEXT_INPUT_ROLES = new Set([
  "AXTextArea",
  "AXTextField",
  "AXSearchField",
  "AXSecureTextField",
  "AXComboBox",
]);

const windowKey = (window: WindowKey) => `${window.pid}:${window.windowId}`;

// Cua numbers elements per snapshot in walk order, so its indexes shift whenever anything above
// an element appears or disappears. Glade's identity is the parent's Glade index, role and label
// plus the position among identical siblings; values, enabled and selected state are not part of
// it. Text inputs often report their contents as their label (TextEdit does), and the root's
// label is the window title, which apps change as a document is edited, so neither label is
// part of it; otherwise typing would re-index the field or the whole window. Parents precede children in Cua's walk, so a parent's index is
// known when its children are reached.
function assignIndexes(table: WindowTable, elements: ReadonlyArray<CuaElement>) {
  const byCuaIndex = new Map<number, number>();
  const seen = new Map<string, number>();
  return elements.map((element): IndexedElement => {
    const parent =
      element.parent_index === undefined || element.parent_index === null
        ? -1
        : (byCuaIndex.get(element.parent_index) ?? -2);
    const label =
      parent === -1 || TEXT_INPUT_ROLES.has(element.role)
        ? ""
        : (element.label ?? "").slice(0, 200);
    const base = `${parent}/${element.role}:${label}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    const identity = `${base}#${nth}`;
    let index = table.indexes.get(identity);
    if (index === undefined) {
      index = table.next;
      table.next += 1;
      table.indexes.set(identity, index);
    }
    byCuaIndex.set(element.element_index, index);
    return { index, element };
  });
}

const sameState = (left: CuaElement, right: CuaElement) =>
  left.label === right.label &&
  JSON.stringify(left.value ?? null) === JSON.stringify(right.value ?? null) &&
  left.enabled === right.enabled &&
  left.selected === right.selected;

export function makeWindowSnapshots(): WindowSnapshots {
  const threads = new Map<string, Map<string, WindowTable>>();
  const tableFor = (threadId: string, window: WindowKey) => {
    let windows = threads.get(threadId);
    if (!windows) {
      windows = new Map();
      threads.set(threadId, windows);
    }
    const key = windowKey(window);
    let table = windows.get(key);
    if (!table) {
      table = { indexes: new Map(), next: 0, latest: new Map(), latestComplete: false };
      windows.set(key, table);
    }
    return table;
  };

  return {
    record: (threadId, window, elements, complete) => {
      const existed = threads.get(threadId)?.has(windowKey(window)) ?? false;
      const table = tableFor(threadId, window);
      if (table.indexes.size > MAX_IDENTITIES) table.indexes.clear();
      const previous = table.latest;
      const indexed = assignIndexes(table, elements);
      const current = new Set(indexed.map((entry) => entry.index));
      const comparable = complete && table.latestComplete;
      const diff: SnapshotDiff | null = existed
        ? {
            added: comparable ? indexed.filter((entry) => !previous.has(entry.index)) : [],
            changed: indexed.filter((entry) => {
              const before = previous.get(entry.index);
              return before !== undefined && !sameState(before, entry.element);
            }),
            removed: comparable
              ? [...previous.entries()]
                  .filter(([index]) => !current.has(index))
                  .map(([index, element]) => ({ index, element }))
              : [],
            comparable,
          }
        : null;
      table.latest = new Map(indexed.map((entry) => [entry.index, entry.element]));
      table.latestComplete = complete;
      return { elements: indexed, diff };
    },
    has: (threadId, window) => threads.get(threadId)?.has(windowKey(window)) ?? false,
    token: (threadId, window, index) =>
      threads.get(threadId)?.get(windowKey(window))?.latest.get(index)?.element_token ?? null,
    clearThread: (threadId) => {
      threads.delete(threadId);
    },
  };
}
