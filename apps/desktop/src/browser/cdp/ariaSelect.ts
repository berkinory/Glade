import type { ActionOutcome } from "../actionSettle";
import { BrowserFailure } from "../browserFailure";
import { click } from "./actions";
import type { CdpSession } from "./cdpSession";
import {
  echo,
  normalized,
  SHOWN_VALUE,
  visibleOptions,
  waitForOptions,
  type ListedOption,
} from "./combobox";
import { parseKeyChord, pressKey } from "./keyboard";
import { callOn } from "./pointer";
import { rethrowStaleNode, type RefTable, type RefTarget } from "./refs";

const OPEN_WAIT_MS = 1_500;
const BETWEEN_CLICKS_MS = 150;
const MAX_CHOICES = 200;

// "listbox" (options always shown), "combobox" (opens a list), or null for anything else.
const WIDGET_KIND = `function () {
  const role = (this.getAttribute("role") || "").toLowerCase();
  if (role === "listbox") return { kind: "listbox", multiple: this.getAttribute("aria-multiselectable") === "true" };
  const popup = (this.getAttribute("aria-haspopup") || "").toLowerCase();
  if (role === "combobox" || popup === "listbox" || popup === "true" || this.closest("[role=combobox]")) return { kind: "combobox", multiple: false };
  return null;
}`;
const FOCUS = `function () { this.focus(); }`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Exact label first, then a label that contains the wanted text when only one does.
function pick(options: readonly ListedOption[], wanted: string): ListedOption | undefined {
  const value = normalized(wanted);
  const exact = options.find((option) => normalized(option.name) === value);
  if (exact) return exact;
  const partial = options.filter((option) => normalized(option.name).includes(value));
  return partial.length === 1 ? partial[0] : undefined;
}

async function openList(cdp: CdpSession, refs: RefTable, ref: string, target: RefTarget) {
  const shown = await visibleOptions(cdp, target, MAX_CHOICES);
  if (shown.total > 0) return { listed: shown, opened: false };
  await click(cdp, refs, null, { ref });
  let listed = await waitForOptions(cdp, target, OPEN_WAIT_MS);
  if (listed.total === 0) {
    // Many comboboxes open from the keyboard only.
    await callOn(cdp, target, FOCUS).catch(() => undefined);
    await pressKey(cdp, parseKeyChord("ArrowDown").key, 0);
    listed = await waitForOptions(cdp, target, OPEN_WAIT_MS);
  }
  if (listed.total > listed.options.length) {
    listed = await visibleOptions(cdp, target, MAX_CHOICES);
  }
  return { listed, opened: true };
}

// browser_select for ARIA widgets: opens the list if needed, clicks the options whose labels
// match, and after the page settled reads back what the widget shows.
export async function selectCustom(
  cdp: CdpSession,
  refs: RefTable,
  ref: string,
  values: readonly string[],
): Promise<ActionOutcome> {
  const target = refs.resolve(ref);
  const widget = await callOn<{ kind: "listbox" | "combobox"; multiple: boolean } | null>(
    cdp,
    target,
    WIDGET_KIND,
  ).catch(rethrowStaleNode(ref));
  if (!widget) {
    throw new BrowserFailure(
      "invalid_input",
      `${refs.describe(ref)} is not a <select>, listbox or combobox; click it and choose the option instead.`,
    );
  }
  const { listed, opened } = await openList(cdp, refs, ref, target);
  if (listed.total === 0) {
    throw new BrowserFailure(
      "invalid_input",
      `${refs.describe(ref)} showed no options. If it filters as you type, use browser_type and click an option.`,
    );
  }
  const wanted = widget.multiple ? values : values.slice(0, 1);
  const chosen: ListedOption[] = [];
  for (const value of wanted) {
    const option = pick(listed.options, value);
    if (!option) {
      if (opened) await pressKey(cdp, parseKeyChord("Escape").key, 0);
      const labels = listed.options.slice(0, 10).map((o) => echo(o.name));
      throw new BrowserFailure(
        "invalid_input",
        `No option matched ${echo(value)}. Options: ${labels.join(", ")}${listed.total > 10 ? ", …" : ""}.`,
      );
    }
    chosen.push(option);
  }
  for (const [index, option] of chosen.entries()) {
    if (index > 0) await sleep(BETWEEN_CLICKS_MS);
    const optionRef = refs.refFor(option.target, { role: "option", name: option.name });
    await click(cdp, refs, null, { ref: optionRef });
  }
  const names = chosen.map((option) => echo(option.name)).join(", ");
  return {
    line: `Selected ${names} in ${refs.describe(ref)}.`,
    afterSettle: async () => ({ text: await readBack(cdp, target, widget.kind, chosen) }),
  };
}

async function readBack(
  cdp: CdpSession,
  target: RefTarget,
  kind: "listbox" | "combobox",
  chosen: readonly ListedOption[],
): Promise<string> {
  if (kind === "combobox") {
    const shown = await callOn<string>(cdp, target, SHOWN_VALUE);
    const now = normalized(shown);
    const label = normalized(chosen[0]!.name);
    return now && (now.includes(label) || label.includes(now))
      ? ` It now shows ${echo(shown)}.`
      : ` It still shows ${echo(shown)}; the choice was not taken.`;
  }
  const { options } = await visibleOptions(cdp, target, MAX_CHOICES);
  const missing = chosen.filter(
    (option) =>
      !options.some((o) => o.target.backendNodeId === option.target.backendNodeId && o.selected),
  );
  return missing.length === 0
    ? " The options are now selected."
    : ` ${missing.map((o) => echo(o.name)).join(", ")} is not marked selected.`;
}
