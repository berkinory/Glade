import * as OS from "node:os";
import * as Path from "node:path";

import type { IndexedElement } from "../../computer/windowSnapshots.ts";

export interface DialogTarget {
  // What Go to Folder receives: the folder to save into, or the file to open (which selects it).
  readonly goTo: string;
  // The name typed into a Save panel's name field; null keeps the name the panel suggests.
  readonly name: string | null;
  // The one path the server may stat afterwards to confirm the result.
  readonly file: string | null;
}

// The call's path as an absolute, normalized path, or why it cannot be used. Go to Folder takes a
// single line, so control characters (a newline would submit early) are refused.
export function dialogTarget(input: {
  readonly action: "save" | "open";
  readonly path: string;
  readonly file_name?: string | undefined;
}): DialogTarget | string {
  if (/\p{Cc}/u.test(input.path) || /\p{Cc}/u.test(input.file_name ?? "")) {
    return "path and file_name cannot contain control characters.";
  }
  const expanded =
    input.path === "~" || input.path.startsWith("~/")
      ? Path.join(OS.homedir(), input.path.slice(1))
      : input.path;
  if (!Path.isAbsolute(expanded)) return "path must be absolute (or start with ~/).";
  const folder = Path.normalize(expanded);
  const name = input.file_name?.trim() || null;
  if (name !== null && (name.includes("/") || name === "." || name === "..")) {
    return "file_name is a name inside path, not a path; put the folder in path.";
  }
  if (input.action === "open") {
    const file = name === null ? folder : Path.join(folder, name);
    return { goTo: file, name: null, file };
  }
  return { goTo: folder, name, file: name === null ? null : Path.join(folder, name) };
}

export interface PanelControls {
  readonly nameField: IndexedElement | null;
  readonly formatPopup: IndexedElement | null;
  readonly confirm: IndexedElement | null;
  readonly goToField: IndexedElement | null;
  // A nested sheet asking before replacing an existing file.
  readonly replacePrompt: {
    readonly text: string;
    readonly replace: IndexedElement;
    readonly cancel: IndexedElement | null;
  } | null;
}

const CONFIRM = /^(save|open|choose|export|import|insert|select)$/i;
const CANCEL = /^cancel$/i;
const LISTS = new Set(["AXBrowser", "AXList", "AXOutline", "AXTable", "AXRow", "AXCell"]);

// The Open or Save panel shown in a window (an attached sheet, or the window itself for apps
// that open a standalone Open window), found by its structure: Go to Folder and the replace
// prompt are sheets nested in it, and the panel holds a Cancel button and a Save/Open-style
// button (hidden while a nested sheet is up). Labels are AppKit's English titles; in other
// languages the model drives the panel by index instead.
export function panelControls(elements: ReadonlyArray<IndexedElement>): PanelControls | null {
  const byCua = new Map(elements.map((entry) => [entry.element.element_index, entry]));
  const ownerSheet = (entry: IndexedElement) => {
    let parent = entry.element.parent_index;
    while (parent !== undefined && parent !== null) {
      const next = byCua.get(parent);
      if (!next) return null;
      if (next.element.role === "AXSheet") return next;
      parent = next.element.parent_index;
    }
    return null;
  };
  const insideList = (entry: IndexedElement) => {
    let parent = entry.element.parent_index;
    while (parent !== undefined && parent !== null) {
      const next = byCua.get(parent);
      if (!next) return false;
      if (LISTS.has(next.element.role)) return true;
      parent = next.element.parent_index;
    }
    return false;
  };
  const label = (entry: IndexedElement) => (entry.element.label ?? "").trim();
  const value = (entry: IndexedElement) =>
    typeof entry.element.value === "string" ? entry.element.value : "";
  const is = (role: string, pattern?: RegExp) => (entry: IndexedElement) =>
    entry.element.role === role && (!pattern || pattern.test(label(entry)));

  let goToField: IndexedElement | null = null;
  let replacePrompt: PanelControls["replacePrompt"] = null;
  const nestedSheets = new Set<IndexedElement>();
  for (const sheet of elements.filter(is("AXSheet"))) {
    const members = elements.filter((entry) => ownerSheet(entry) === sheet);
    const field = members.find(
      (entry) => entry.element.role === "AXTextField" && /^[/~]/.test(value(entry)),
    );
    const replace = members.find(is("AXButton", /^replace$/i));
    if (field) {
      goToField = field;
      nestedSheets.add(sheet);
    } else if (replace) {
      nestedSheets.add(sheet);
      replacePrompt = {
        text: members
          .filter(is("AXStaticText"))
          .map((entry) => value(entry) || label(entry))
          .join(" "),
        replace,
        cancel: members.find(is("AXButton", CANCEL)) ?? null,
      };
    }
  }
  const outsideNested = (entry: IndexedElement) => {
    const sheet = ownerSheet(entry);
    return sheet === null || !nestedSheets.has(sheet);
  };
  const confirm =
    elements.findLast((entry) => is("AXButton", CONFIRM)(entry) && outsideNested(entry)) ?? null;
  if (!confirm && !goToField && !replacePrompt) return null;
  const panel = confirm ? ownerSheet(confirm) : undefined;
  const inPanel = (entry: IndexedElement) => panel !== undefined && ownerSheet(entry) === panel;
  if (confirm && !elements.some((entry) => is("AXButton", CANCEL)(entry) && inPanel(entry))) {
    return goToField || replacePrompt
      ? { nameField: null, formatPopup: null, confirm: null, goToField, replacePrompt }
      : null;
  }
  const nameField =
    elements.find(
      (entry) =>
        entry.element.role === "AXTextField" &&
        inPanel(entry) &&
        !insideList(entry) &&
        !elements.some((other) => other.element.parent_index === entry.element.element_index) &&
        value(entry) !== "",
    ) ?? null;
  const formatPopup =
    elements.find(
      (entry) =>
        entry.element.role === "AXPopUpButton" &&
        inPanel(entry) &&
        label(entry) !== "" &&
        label(entry) === value(entry),
    ) ?? null;
  return { nameField, formatPopup, confirm, goToField, replacePrompt };
}

// A format menu item that fits the requested extension: AppKit lists many as "Name (.ext)";
// TextEdit's two defaults carry no extension in their titles.
const FORMAT_NAMES: Record<string, RegExp> = {
  rtf: /^rich text document$/i,
  rtfd: /^rich text document with attachments$/i,
  txt: /^plain text|unicode \(utf-8\)$/i,
  pdf: /^pdf$/i,
};

export function formatItem(titles: ReadonlyArray<string>, fileName: string): string | null {
  const extension = Path.extname(fileName).slice(1).toLowerCase();
  if (!extension) return null;
  return (
    titles.find((title) => title.toLowerCase().includes(`(.${extension})`)) ??
    titles.find((title) => FORMAT_NAMES[extension]?.test(title)) ??
    null
  );
}
