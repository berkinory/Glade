import type { CuaElement } from "../../computer/cuaResults.ts";

// Models write menu paths as arrays or as one string with arrows ("File ▸ Save As…").
const SEPARATOR = /\s*(?:▸|›|→|->|>)\s*/;

// A shortcut suffix the model copied from a rendered menu: "Save ⌘S", "Bold\t⌘B".
const SHORTCUT = /\s+[⌘⌥⇧⌃][^\s]*$/u;

export function menuSegments(path: string | ReadonlyArray<string>): string[] {
  const parts = typeof path === "string" ? path.split(SEPARATOR) : path;
  return parts.map((part) => part.replace(SHORTCUT, "").trim()).filter((part) => part.length > 0);
}

// Titles compare without case, surrounding space or a trailing ellipsis.
const menuKey = (title: string) =>
  title
    .replace(SHORTCUT, "")
    .trim()
    .replace(/(?:…|\.\.\.)$/, "")
    .trim()
    .toLowerCase();

// Cua matches labels exactly apart from "..." for "…". The cheapest second try flips the
// ellipsis, which native menus add to commands that open a dialog ("Save…" on an untitled
// document, "Save" once it has a file).
export function ellipsisVariant(segment: string): string | null {
  const stripped = segment.replace(/\s*(?:…|\.\.\.)$/, "");
  if (stripped === segment) return `${segment}...`;
  return stripped.length > 0 ? stripped : null;
}

// The titles at one level of the app's menu bar as the window's accessibility tree lists them,
// following `resolved` (the titles of the levels above, matched like requested segments). Closed menus can omit items that the
// app adds only while the menu is open.
export function menuTitles(
  elements: ReadonlyArray<CuaElement>,
  resolved: ReadonlyArray<string>,
): string[] | null {
  const children = new Map<number, CuaElement[]>();
  for (const element of elements) {
    if (element.parent_index === undefined || element.parent_index === null) continue;
    const list = children.get(element.parent_index) ?? [];
    list.push(element);
    children.set(element.parent_index, list);
  }
  const below = (element: CuaElement, roles: ReadonlyArray<string>) =>
    (children.get(element.element_index) ?? []).filter((child) => roles.includes(child.role));
  // A menu bar item or menu item holds its entries one AXMenu below.
  const entries = (element: CuaElement) =>
    below(element, ["AXMenu"]).flatMap((menu) => below(menu, ["AXMenuItem"]));
  const bar = elements.find((element) => element.role === "AXMenuBar");
  const parentless = (role: string) =>
    elements.filter(
      (element) =>
        element.role === role &&
        (element.parent_index === undefined || element.parent_index === null),
    );
  // Cua on Linux lists the menu bar's menus as parentless "menu" elements, and on Windows as
  // parentless "MenuItem" elements, without the items of closed menus, so there only the menu
  // bar level is known.
  let level = bar
    ? below(bar, ["AXMenuBarItem"])
    : [...parentless("menu"), ...parentless("MenuItem")];
  for (const title of resolved) {
    const key = menuKey(title);
    const next = level.find((item) => menuKey(item.label ?? "") === key);
    if (!next) return null;
    level = entries(next);
  }
  const titles = level.flatMap((item) => (item.label ? [item.label] : []));
  return titles.length > 0 ? titles : null;
}

// The one title that matches a requested segment; null when none or several do.
export function matchMenuTitle(segment: string, titles: ReadonlyArray<string>) {
  const key = menuKey(segment);
  const exact = titles.filter((title) => menuKey(title) === key);
  return exact.length === 1 ? exact[0]! : null;
}
