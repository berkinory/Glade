import type {
  BrowserFillInput,
  BrowserSelectInput,
  BrowserTypeInput,
} from "@glade/contracts/browser/browserTools";
import type { ActionOutcome } from "../actionSettle";
import { BrowserFailure } from "../browserFailure";
import { click } from "./actions";
import { selectCustom } from "./ariaSelect";
import type { CdpSession } from "./cdpSession";
import { COMBO_LIKE, echo, optionsAfterTyping } from "./combobox";
import { characterKey, parseKeyChord, pressKey } from "./keyboard";
import { callOn } from "./pointer";
import { rethrowStaleNode, type RefTable } from "./refs";
import { typedMismatch } from "./typedValue";

// Short text goes key by key so pages see real keydown/keypress/input; longer text is inserted at
// once, which frameworks still observe as an input event.
const KEYSTROKE_LIMIT = 64;
// A custom select picked inside browser_fill gets this long to show its choice.
const FILL_SELECT_SETTLE_MS = 300;

interface FieldInfo {
  readonly kind: "select" | "toggle" | "native" | "text" | "other";
  readonly password: boolean;
  readonly checked: boolean | null;
  readonly value: string;
  // -1 when the field has no maxlength.
  readonly maxLength: number;
  readonly comboLike: boolean;
}

// Inputs whose value has a fixed format (dates, colors, ranges) take it through the native value
// setter; keystrokes into their segmented editors land unpredictably.
const DESCRIBE_FIELD = `function () {
  const native = ["date", "time", "datetime-local", "month", "week", "color", "range"];
  const role = this.getAttribute && this.getAttribute("role");
  const type = this instanceof HTMLInputElement ? this.type : "";
  const toggle = type === "checkbox" || type === "radio" || role === "checkbox" || role === "radio" || role === "switch";
  const checked = toggle ? (this instanceof HTMLInputElement ? this.checked : this.getAttribute("aria-checked") === "true") : null;
  const kind = this instanceof HTMLSelectElement ? "select"
    : toggle ? "toggle"
    : native.includes(type) ? "native"
    : this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement || this.isContentEditable ? "text"
    : "other";
  const value = this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement || this instanceof HTMLSelectElement ? this.value : (this.innerText || "");
  const maxLength = this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement ? this.maxLength : -1;
  return { kind, password: type === "password", checked, value, maxLength, comboLike: (${COMBO_LIKE}).call(this) };
}`;

const SET_NATIVE_VALUE = `function (value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(this, value);
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return this.value;
}`;

const SELECT_CONTENTS = `function () {
  if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) { this.select(); return; }
  const range = document.createRange();
  range.selectNodeContents(this);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}`;

// Matches an option by exact value, or by label or text compared without case and extra spaces.
const SELECT_OPTIONS = `function (values) {
  if (!(this instanceof HTMLSelectElement)) return { custom: true };
  const norm = (text) => String(text).replace(/\\s+/g, " ").trim().toLowerCase();
  const wanted = values.map(norm);
  const matched = Array.from(this.options).filter((o) => values.includes(o.value) || wanted.includes(norm(o.label)) || wanted.includes(norm(o.text)));
  if (matched.length === 0) {
    const labels = Array.from(this.options).slice(0, 10).map((o) => JSON.stringify(o.label || o.value)).join(", ");
    return { error: "No option matched " + values.join(", ") + ". Options: " + labels + (this.options.length > 10 ? ", …" : "") + "." };
  }
  const chosen = this.multiple ? matched : matched.slice(0, 1);
  for (const option of this.options) option.selected = chosen.includes(option);
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { selected: chosen.map((o) => o.label || o.value) };
}`;

async function describeField(cdp: CdpSession, refs: RefTable, ref: string): Promise<FieldInfo> {
  return callOn<FieldInfo>(cdp, refs.resolve(ref), DESCRIBE_FIELD).catch(rethrowStaleNode(ref));
}

async function typeKeys(cdp: CdpSession, text: string): Promise<void> {
  if (text.length <= KEYSTROKE_LIMIT) {
    for (const char of text) await pressKey(cdp, characterKey(char), 0);
  } else {
    await cdp.send("Input.insertText", { text });
  }
}

async function setNative(cdp: CdpSession, refs: RefTable, ref: string, text: string) {
  const value = await callOn<string>(cdp, refs.resolve(ref), SET_NATIVE_VALUE, [{ value: text }]);
  if (value !== text) {
    throw new BrowserFailure(
      "invalid_input",
      `${refs.describe(ref)} did not accept ${echo(text)}; date and time inputs take forms like 2026-10-07, 14:30 or 2026-10-07T14:30.`,
    );
  }
}

// Replaces the field's content; returns the read-back note.
async function replaceText(cdp: CdpSession, refs: RefTable, ref: string, text: string) {
  const target = refs.resolve(ref);
  const field = await describeField(cdp, refs, ref);
  if (field.kind === "native") {
    await setNative(cdp, refs, ref, text);
    return { field, note: "" };
  }
  const enter = async (atOnce: boolean) => {
    await callOn(cdp, target, SELECT_CONTENTS).catch(rethrowStaleNode(ref));
    if (text.length === 0) await pressKey(cdp, parseKeyChord("Backspace").key, 0);
    if (atOnce && text.length > 0) await cdp.send("Input.insertText", { text });
    else await typeKeys(cdp, text);
  };
  await cdp
    .send("DOM.focus", { backendNodeId: target.backendNodeId }, target.sessionId)
    .catch(async () => click(cdp, refs, null, { ref }))
    .catch(rethrowStaleNode(ref));
  await enter(false);
  if (field.kind !== "text") return { field, note: "" };
  const read = async () => (await describeField(cdp, refs, ref)).value;
  // Typeahead fields need their keystrokes; refilling them at once would hide the suggestions.
  const note = await typedMismatch(text, await read(), {
    password: field.password,
    maxLength: field.maxLength,
    refill: field.comboLike
      ? null
      : async () => {
          await enter(true);
          return read();
        },
  });
  return { field, note };
}

export async function typeText(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserTypeInput.Type,
): Promise<ActionOutcome> {
  let note = "";
  let comboLike = false;
  if (input.ref) {
    const typed = await replaceText(cdp, refs, input.ref, input.text);
    note = typed.note;
    comboLike = typed.field.comboLike;
  } else await typeKeys(cdp, input.text);
  if (input.submit) await pressKey(cdp, characterKey("\n"), 0);
  const where = input.ref ? ` into ${refs.describe(input.ref)}` : "";
  const line = `Typed ${input.text.length} characters${where}${input.submit ? " and pressed Enter" : ""}.${note}`;
  const target = input.ref && !input.submit ? refs.resolve(input.ref) : null;
  if (!target) return { line };
  return {
    line,
    afterSettle: ({ optionsAdded }) =>
      optionsAfterTyping(cdp, refs, target, comboLike, optionsAdded),
  };
}

// Null when the ref is not a native <select>.
async function selectNative(
  cdp: CdpSession,
  refs: RefTable,
  ref: string,
  values: readonly string[],
): Promise<string | null> {
  const result = await callOn<{ error?: string; selected?: string[]; custom?: true }>(
    cdp,
    refs.resolve(ref),
    SELECT_OPTIONS,
    [{ value: values }],
  ).catch(rethrowStaleNode(ref));
  if (result.custom) return null;
  if (result.error) throw new BrowserFailure("invalid_input", result.error);
  return `Selected ${result.selected!.map((label) => JSON.stringify(label)).join(", ")} in ${refs.describe(ref)}.`;
}

export async function selectOptions(
  cdp: CdpSession,
  refs: RefTable,
  input: Pick<typeof BrowserSelectInput.Type, "ref" | "values">,
): Promise<string | ActionOutcome> {
  return (
    (await selectNative(cdp, refs, input.ref, input.values)) ??
    selectCustom(cdp, refs, input.ref, input.values)
  );
}

// A custom select inside a fill: picked, given a moment, then read back.
async function selectInFill(cdp: CdpSession, refs: RefTable, ref: string, value: string) {
  const outcome = await selectCustom(cdp, refs, ref, [value]);
  await new Promise((resolve) => setTimeout(resolve, FILL_SELECT_SETTLE_MS));
  const after = await outcome
    .afterSettle?.({ optionsAdded: 0, newItems: 0, newTexts: [] })
    .catch(() => ({ text: "" }));
  return `${outcome.line}${after?.text ?? ""}`;
}

// Fills each field the way its kind needs and reports one line per field. A field that fails
// stops the fill; the lines before it say what was already set.
export async function fillFields(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserFillInput.Type,
): Promise<string> {
  const lines: string[] = [];
  for (const { ref, value } of input.fields) {
    const field = await describeField(cdp, refs, ref);
    const label = refs.describe(ref);
    try {
      if (field.kind === "toggle") {
        const wanted = value === true || value === "true";
        if (field.checked !== wanted) await click(cdp, refs, null, { ref });
        const after = await describeField(cdp, refs, ref);
        lines.push(
          after.checked === wanted
            ? `${label}: ${wanted ? "checked" : "unchecked"}.`
            : `${label}: still ${after.checked ? "checked" : "unchecked"}; the page did not take the change.`,
        );
      } else if (typeof value === "boolean") {
        throw new BrowserFailure("invalid_input", `${label} is not a checkbox; pass text.`);
      } else if (field.kind === "select") {
        lines.push(
          (await selectNative(cdp, refs, ref, [value])) ??
            (await selectInFill(cdp, refs, ref, value)),
        );
      } else if (field.kind === "text" || field.kind === "native") {
        const { note } = await replaceText(cdp, refs, ref, value);
        lines.push(`${label}: ${field.password ? "filled" : `set to ${echo(value)}`}.${note}`);
      } else {
        lines.push(await selectInFill(cdp, refs, ref, value));
      }
    } catch (error) {
      if (lines.length === 0 || !(error instanceof BrowserFailure)) throw error;
      throw new BrowserFailure(
        error.code,
        `${lines.join("\n")}\nStopped at ${label}: ${error.message}`,
      );
    }
  }
  return lines.join("\n");
}
