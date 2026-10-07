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
  // truncated): against a filtered read, everything it left out would look new or gone. The menu
  // bar is left out: menus are run by path, and every opened menu would flood the list.
  readonly added: ReadonlyArray<IndexedElement>;
  readonly removed: ReadonlyArray<IndexedElement>;
  readonly changed: ReadonlyArray<IndexedElement>;
  readonly comparable: boolean;
  // Attached sheets (Save panels, alerts) that appeared or went away since the last read that
  // was not filtered by a query; sheets sit near the root, so depth-limited reads still see them.
  readonly sheetsOpened: ReadonlyArray<IndexedElement>;
  readonly sheetsClosed: ReadonlyArray<IndexedElement>;
}

// How much of the window a snapshot lists: all of it, everything near the root (cut by Cua's time
// budget or a depth limit), or only what a query matched.
type SnapshotCoverage = "complete" | "partial" | "filtered";

export interface WindowSnapshots {
  // Records a Cua snapshot of the window and returns its elements under Glade's indexes plus what
  // changed since the previous one.
  readonly record: (
    threadId: string,
    window: WindowKey,
    elements: ReadonlyArray<CuaElement>,
    coverage: SnapshotCoverage,
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
  // Glade indexes of the latest snapshot inside the app's menu bar.
  menuBar: Set<number>;
  sheets: Map<number, CuaElement>;
}

// Long-lived windows (chat apps, feeds) keep producing new identities; past this many the table
// forgets old ones, which only means a returning element gets a fresh index.
const MAX_IDENTITIES = 20_000;

// macOS AX roles, then the AT-SPI role names Cua reports on Linux.
const TEXT_INPUT_ROLES = new Set([
  "AXTextArea",
  "AXTextField",
  "AXSearchField",
  "AXSecureTextField",
  "AXComboBox",
  "text",
  "entry",
  "password text",
  "combo box",
]);

const windowKey = (window: WindowKey) => `${window.pid}:${window.windowId}`;

// Cua numbers elements per snapshot in walk order, so its indexes shift whenever anything above
// an element appears or disappears. Glade's identity is the parent's Glade index, role and label
// plus the position among identical siblings; values, enabled and selected state are not part of
// it. Text inputs often report their contents as their label (TextEdit does), and the window
// root's label is its title, which apps change as a document is edited, so neither label is part
// of it; otherwise typing would re-index the field or the whole window. Parents precede children
// in Cua's macOS walk, so a parent's index is known when its children are reached. Cua on Linux
// lists many elements without a parent (or after it), so there the depth stands in for the
// parent, and only a macOS window root drops its label: otherwise any two parentless elements of
// a role, or two text fields, would share an identity whenever a query read lists one of them.
function assignIndexes(table: WindowTable, elements: ReadonlyArray<CuaElement>) {
  const byCuaIndex = new Map<number, number>();
  const seen = new Map<string, number>();
  return elements.map((element): IndexedElement => {
    const parent =
      element.parent_index === undefined || element.parent_index === null
        ? -1
        : (byCuaIndex.get(element.parent_index) ?? -2);
    const label =
      (parent === -1 && element.role === "AXWindow") || TEXT_INPUT_ROLES.has(element.role)
        ? ""
        : (element.label ?? "").slice(0, 200);
    const place = parent >= 0 ? `${parent}` : `${parent}@${element.depth ?? ""}`;
    const base = `${place}/${element.role}:${label}`;
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

// Parents precede children in Cua's walk, so one pass finds every menu-bar descendant.
function menuBarIndexes(indexed: ReadonlyArray<IndexedElement>) {
  const cuaInside = new Set<number>();
  const inside = new Set<number>();
  for (const { index, element } of indexed) {
    const parent = element.parent_index;
    if (
      element.role === "AXMenuBar" ||
      (parent !== undefined && parent !== null && cuaInside.has(parent))
    ) {
      cuaInside.add(element.element_index);
      inside.add(index);
    }
  }
  return inside;
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
      table = {
        indexes: new Map(),
        next: 0,
        latest: new Map(),
        latestComplete: false,
        menuBar: new Set(),
        sheets: new Map(),
      };
      windows.set(key, table);
    }
    return table;
  };

  return {
    record: (threadId, window, elements, coverage) => {
      const existed = threads.get(threadId)?.has(windowKey(window)) ?? false;
      const table = tableFor(threadId, window);
      if (table.indexes.size > MAX_IDENTITIES) table.indexes.clear();
      const previous = table.latest;
      const previousMenuBar = table.menuBar;
      const indexed = assignIndexes(table, elements);
      const menuBar = menuBarIndexes(indexed);
      const current = new Set(indexed.map((entry) => entry.index));
      const complete = coverage === "complete";
      const comparable = complete && table.latestComplete;
      const sheets = new Map(
        indexed
          .filter((entry) => entry.element.role === "AXSheet")
          .map((entry) => [entry.index, entry.element]),
      );
      const outside = indexed.filter((entry) => !menuBar.has(entry.index));
      const diff: SnapshotDiff | null = existed
        ? {
            added: comparable ? outside.filter((entry) => !previous.has(entry.index)) : [],
            changed: outside.filter((entry) => {
              const before = previous.get(entry.index);
              return before !== undefined && !sameState(before, entry.element);
            }),
            removed: comparable
              ? [...previous.entries()]
                  .filter(([index]) => !current.has(index) && !previousMenuBar.has(index))
                  .map(([index, element]) => ({ index, element }))
              : [],
            comparable,
            sheetsOpened:
              coverage === "filtered"
                ? []
                : [...sheets.entries()]
                    .filter(([index]) => !table.sheets.has(index))
                    .map(([index, element]) => ({ index, element })),
            sheetsClosed:
              coverage === "filtered"
                ? []
                : [...table.sheets.entries()]
                    .filter(([index]) => !sheets.has(index))
                    .map(([index, element]) => ({ index, element })),
          }
        : null;
      table.latest = new Map(indexed.map((entry) => [entry.index, entry.element]));
      table.latestComplete = complete;
      table.menuBar = menuBar;
      if (coverage !== "filtered") table.sheets = sheets;
      else for (const [index, element] of sheets) table.sheets.set(index, element);
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
