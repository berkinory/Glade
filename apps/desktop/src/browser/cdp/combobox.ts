import type { ActionOutcome } from "../actionSettle";
import type { CdpSession } from "./cdpSession";
import { callOn, elementTarget } from "./pointer";
import type { RefTable, RefTarget } from "./refs";
import { elementIds } from "./remoteElements";

const MAX_LISTED = 10;
const OPTION_WAIT_MS = 1_500;
const OPTION_POLL_MS = 100;
const MAX_ECHO = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const normalized = (text: string) => text.replace(/\s+/gu, " ").trim().toLowerCase();
export const echo = (text: string) =>
  JSON.stringify(text.length > MAX_ECHO ? `${text.slice(0, MAX_ECHO - 1)}…` : text);

// A text field that offers suggestions as you type.
export const COMBO_LIKE = `function () {
  const attr = (name) => (this.getAttribute(name) || "").toLowerCase();
  if (attr("role") === "combobox") return true;
  if (attr("aria-autocomplete") && attr("aria-autocomplete") !== "none") return true;
  if (this instanceof HTMLInputElement && (this.list || ["listbox", "true"].includes(attr("aria-haspopup")))) return true;
  return !!(this.closest && this.closest("[role=combobox]"));
}`;

// Visible options that belong to `this`: inside it when it is a listbox, else in the listbox its
// combobox controls or owns; only a widget that names no listbox (a portaled list without
// aria-controls) takes any visible option outside a native <select>. Returns an array carrying the full count as `total`.
const VISIBLE_OPTIONS = `function (max) {
  const doc = this.ownerDocument;
  const visible = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0;
  };
  const byIds = (el, name) => (el && el.getAttribute(name) || "").split(/\\s+/).filter(Boolean).map((id) => doc.getElementById(id)).filter(Boolean);
  const host = (this.closest && this.closest("[role=combobox]")) || this;
  const roots = this.getAttribute("role") === "listbox" ? [this]
    : [...new Set([...byIds(this, "aria-controls"), ...byIds(this, "aria-owns"), ...byIds(host, "aria-controls"), ...byIds(host, "aria-owns")])];
  let options = roots.flatMap((root) => root.matches("[role=option]") ? [root] : [...root.querySelectorAll("[role=option]")]).filter(visible);
  if (roots.length === 0) {
    options = [...doc.querySelectorAll("[role=option]")].filter((o) => !o.closest("select, datalist") && visible(o));
  }
  const listed = options.slice(0, max);
  listed.total = options.length;
  return listed;
}`;

const OPTION_INFO = `function () {
  return { total: this.total, info: this.map((o) => ({
    name: (o.getAttribute("aria-label") || o.innerText || o.textContent || "").replace(/\\s+/g, " ").trim(),
    selected: o.getAttribute("aria-selected") === "true",
  })) };
}`;

export interface ListedOption {
  readonly target: RefTarget;
  readonly name: string;
  readonly selected: boolean;
}

// The visible options of `target` (see VISIBLE_OPTIONS) with their frame targets.
export async function visibleOptions(
  cdp: CdpSession,
  target: RefTarget,
  max: number,
): Promise<{ readonly options: ListedOption[]; readonly total: number }> {
  const { object } = await cdp.send<{ object: { objectId: string } }>(
    "DOM.resolveNode",
    { backendNodeId: target.backendNodeId },
    target.sessionId,
  );
  const list = await cdp.send<{ result: { objectId: string } }>(
    "Runtime.callFunctionOn",
    {
      objectId: object.objectId,
      functionDeclaration: VISIBLE_OPTIONS,
      arguments: [{ value: max }],
    },
    target.sessionId,
  );
  const arrayId = list.result.objectId;
  const [{ result: summary }, ids] = await Promise.all([
    cdp.send<{ result: { value: { total: number; info: { name: string; selected: boolean }[] } } }>(
      "Runtime.callFunctionOn",
      { objectId: arrayId, functionDeclaration: OPTION_INFO, returnByValue: true },
      target.sessionId,
    ),
    elementIds(cdp, target.sessionId, arrayId),
  ]);
  const options: ListedOption[] = [];
  summary.value.info.forEach((info, index) => {
    const backendNodeId = ids[index];
    if (backendNodeId === null || backendNodeId === undefined) return;
    options.push({
      target: { backendNodeId, sessionId: target.sessionId, frameId: target.frameId },
      ...info,
    });
  });
  return { options, total: summary.value.total };
}

// Polls until options show and stop changing in number, or the wait ends.
export async function waitForOptions(cdp: CdpSession, target: RefTarget, waitMs: number) {
  const deadline = Date.now() + waitMs;
  let last = await visibleOptions(cdp, target, MAX_LISTED);
  while (Date.now() < deadline) {
    await sleep(OPTION_POLL_MS);
    const next = await visibleOptions(cdp, target, MAX_LISTED);
    if (next.total > 0 && next.total === last.total) return next;
    last = next;
  }
  return last;
}

// `- option "Lisbon, Ohio" [ref=e31] selected`, one line per option, for the model to pick from.
export function renderOptions(
  refs: RefTable,
  listed: { readonly options: readonly ListedOption[]; readonly total: number },
): string {
  const lines = listed.options.map((option) => {
    const ref = refs.refFor(option.target, { role: "option", name: option.name });
    return `- option ${echo(option.name)} [ref=${ref}]${option.selected ? " selected" : ""}`;
  });
  if (listed.total > listed.options.length) {
    lines.push(`- … ${listed.total - listed.options.length} more options`);
  }
  return lines.join("\n");
}

// After typing: suggestions the field (or the page, when options appeared) now offers.
export async function optionsAfterTyping(
  cdp: CdpSession,
  refs: RefTable,
  target: RefTarget,
  comboLike: boolean,
  optionsAdded: number,
): Promise<{ readonly text: string; readonly content?: string }> {
  if (!comboLike && optionsAdded === 0) return { text: "" };
  const listed = comboLike
    ? await waitForOptions(cdp, target, OPTION_WAIT_MS)
    : await visibleOptions(cdp, target, MAX_LISTED);
  if (listed.total === 0) {
    return { text: comboLike ? " No suggestions are showing." : "" };
  }
  return {
    text: ` ${listed.total} option${listed.total === 1 ? " is" : "s are"} showing; click one to choose it, then check the field.`,
    content: renderOptions(refs, listed),
  };
}

// The combobox an option belongs to: the element that controls or owns its listbox, or the
// focused combobox-like field.
const OWNER_COMBOBOX = `function () {
  const doc = this.ownerDocument;
  const listbox = this.closest("[role=listbox]");
  if (listbox && listbox.id) {
    const id = CSS.escape(listbox.id);
    const owner = doc.querySelector("[aria-controls~=" + id + "], [aria-owns~=" + id + "]");
    if (owner) return owner;
  }
  const active = doc.activeElement;
  if (!active || active === doc.body) return null;
  return active.getAttribute("role") === "combobox" || active.getAttribute("aria-autocomplete") || active.closest("[role=combobox]") ? active : null;
}`;
const IS_OPTION = `function () { return !!this.closest("[role=option]"); }`;
const OPTION_LABEL = `function () {
  const o = this.closest("[role=option]") || this;
  return (o.getAttribute("aria-label") || o.innerText || o.textContent || "").replace(/\\s+/g, " ").trim();
}`;
const OPTION_SELECTED = `function () {
  const o = this.closest("[role=option]") || this;
  return o.isConnected ? o.getAttribute("aria-selected") === "true" : null;
}`;
// What a combobox shows: its input's value, or its own text for a button-like one.
export const SHOWN_VALUE = `function () {
  const input = this.matches("input, textarea") ? this : this.querySelector("input:not([type=hidden]), textarea");
  return input ? input.value : (this.innerText || this.textContent || "").replace(/\\s+/g, " ").trim();
}`;

export interface OptionCommit {
  readonly combobox: RefTarget | null;
  readonly label: string;
  readonly before: string | null;
}

// Read before clicking an option, so the result can say whether the choice was taken.
export async function optionContext(
  cdp: CdpSession,
  target: RefTarget,
): Promise<OptionCommit | null> {
  if (!(await callOn<boolean>(cdp, target, IS_OPTION).catch(() => false))) return null;
  const label = await callOn<string>(cdp, target, OPTION_LABEL);
  const combobox = await elementTarget(cdp, target, OWNER_COMBOBOX).catch(() => null);
  const before = combobox
    ? await callOn<string>(cdp, combobox, SHOWN_VALUE).catch(() => null)
    : null;
  return { combobox, label, before };
}

// Commit evidence after the page settled: the combobox shows the option (and changed), or the
// option is marked selected.
export async function optionCommitted(
  cdp: CdpSession,
  refs: RefTable,
  option: RefTarget,
  commit: OptionCommit,
): Promise<string> {
  const selected = await callOn<boolean | null>(cdp, option, OPTION_SELECTED).catch(() => null);
  if (!commit.combobox) {
    if (selected === null) return "";
    return selected ? " The option is now selected." : " The option is not marked selected.";
  }
  const shown = await callOn<string>(cdp, commit.combobox, SHOWN_VALUE).catch(() => null);
  if (shown === null) return "";
  const name = refs.describe(refs.refFor(commit.combobox));
  const now = normalized(shown);
  const label = normalized(commit.label);
  const matches = now.length > 0 && (label.includes(now) || now.includes(label));
  const changed = commit.before === null || normalized(commit.before) !== now;
  if (matches && (changed || selected === true)) return ` ${name} now reads ${echo(shown)}.`;
  return ` ${name} still reads ${echo(shown)}; the choice was not taken.`;
}

// A click on an option reports whether its combobox took the choice.
export async function withOptionCommit(
  cdp: CdpSession,
  refs: RefTable,
  ref: string | undefined,
  click: () => Promise<string>,
): Promise<string | ActionOutcome> {
  const option = ref === undefined ? undefined : refs.resolve(ref);
  const commit = option ? await optionContext(cdp, option).catch(() => null) : null;
  const line = await click();
  if (!option || !commit) return line;
  return {
    line,
    afterSettle: async () => ({ text: await optionCommitted(cdp, refs, option, commit) }),
  };
}
