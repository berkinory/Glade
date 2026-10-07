import type {
  BrowserClickInput,
  BrowserPressInput,
  BrowserScrollInput,
  BrowserSelectInput,
  BrowserTypeInput,
} from "@glade/contracts/browser/browserTools";
import { BrowserFailure } from "../browserFailure";
import type { CdpSession } from "./cdpSession";
import {
  characterKey,
  modifierKey,
  modifierMask,
  parseKeyChord,
  type KeyDefinition,
} from "./keyboard";
import { rethrowStaleNode, type RefTable, type RefTarget } from "./refs";

type Quad = readonly number[];
interface BoxModel {
  readonly model: { readonly content: Quad; readonly border: Quad };
}

const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const;
// Short text goes key by key so pages see real keydown/keypress/input; longer text is inserted at
// once, which frameworks still observe as an input event.
const KEYSTROKE_LIMIT = 64;

const SELECT_CONTENTS = `function () {
  if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) { this.select(); return; }
  const range = document.createRange();
  range.selectNodeContents(this);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}`;

const SELECT_OPTIONS = `function (values) {
  if (!(this instanceof HTMLSelectElement)) return { error: "The ref is not a <select>; click it and choose the option instead." };
  const wanted = new Set(values);
  const matched = Array.from(this.options).filter((o) => wanted.has(o.value) || wanted.has(o.label) || wanted.has(o.text.trim()));
  if (matched.length === 0) return { error: "No option matched " + values.join(", ") + "." };
  const chosen = this.multiple ? matched : matched.slice(0, 1);
  for (const option of this.options) option.selected = chosen.includes(option);
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { selected: chosen.map((o) => o.label || o.value) };
}`;

// Box models of nodes in an out-of-process iframe are relative to that frame; input goes to the
// root session, so add each owning iframe's content origin up to the main frame.
async function frameOffset(cdp: CdpSession, sessionId: string | undefined) {
  let x = 0;
  let y = 0;
  for (let current = sessionId; current !== undefined; ) {
    const child = cdp.childTarget(current);
    if (!child) break;
    const owner = await cdp.send<{ backendNodeId: number }>(
      "DOM.getFrameOwner",
      { frameId: child.targetId },
      child.parentSessionId,
    );
    await cdp.send(
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId: owner.backendNodeId },
      child.parentSessionId,
    );
    const box = await cdp.send<BoxModel>(
      "DOM.getBoxModel",
      { backendNodeId: owner.backendNodeId },
      child.parentSessionId,
    );
    x += box.model.content[0]!;
    y += box.model.content[1]!;
    current = child.parentSessionId;
  }
  return { x, y };
}

// Scrolls the ref into view and returns its border box in main-frame viewport CSS pixels.
export async function elementBounds(cdp: CdpSession, refs: RefTable, ref: string) {
  const target = refs.resolve(ref);
  const node = { backendNodeId: target.backendNodeId };
  try {
    await cdp.send("DOM.scrollIntoViewIfNeeded", node, target.sessionId);
    const offset = await frameOffset(cdp, target.sessionId);
    const { model } = await cdp.send<BoxModel>("DOM.getBoxModel", node, target.sessionId);
    const xs = [0, 2, 4, 6].map((index) => model.border[index]! + offset.x);
    const ys = [1, 3, 5, 7].map((index) => model.border[index]! + offset.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  } catch (error) {
    if (error instanceof Error && /Could not compute box model/iu.test(error.message)) {
      throw new BrowserFailure(
        "not_visible",
        `Ref ${ref} has no visible box; it may be hidden or collapsed.`,
      );
    }
    return rethrowStaleNode(ref)(error);
  }
}

async function locate(cdp: CdpSession, refs: RefTable, ref: string) {
  const box = await elementBounds(cdp, refs, ref);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const mouse = (cdp: CdpSession, event: Record<string, unknown>) =>
  cdp.send("Input.dispatchMouseEvent", event);

async function key(cdp: CdpSession, definition: KeyDefinition, modifiers: number) {
  const text = modifiers & ~8 ? undefined : definition.text;
  const base = {
    key: definition.key,
    code: definition.code,
    windowsVirtualKeyCode: definition.keyCode,
    modifiers,
  };
  await cdp.send("Input.dispatchKeyEvent", {
    ...base,
    type: text ? "keyDown" : "rawKeyDown",
    ...(text ? { text, unmodifiedText: text } : {}),
  });
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

async function callOn<T>(cdp: CdpSession, target: RefTarget, fn: string, args: unknown[] = []) {
  const { object } = await cdp.send<{ object: { objectId: string } }>(
    "DOM.resolveNode",
    { backendNodeId: target.backendNodeId },
    target.sessionId,
  );
  const { result, exceptionDetails } = await cdp.send<{
    result: { value?: T };
    exceptionDetails?: { text: string };
  }>(
    "Runtime.callFunctionOn",
    {
      objectId: object.objectId,
      functionDeclaration: fn,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    },
    target.sessionId,
  );
  if (exceptionDetails) throw new BrowserFailure("invalid_input", exceptionDetails.text);
  return result.value as T;
}

export async function click(
  cdp: CdpSession,
  refs: RefTable,
  input: Pick<typeof BrowserClickInput.Type, "ref" | "button" | "modifiers" | "count">,
): Promise<string> {
  const { x, y } = await locate(cdp, refs, input.ref);
  const button = input.button ?? "left";
  const modifiers = modifierMask(input.modifiers ?? []);
  await mouse(cdp, { type: "mouseMoved", x, y, modifiers });
  for (let clickCount = 1; clickCount <= (input.count ?? 1); clickCount += 1) {
    await mouse(cdp, {
      type: "mousePressed",
      x,
      y,
      button,
      buttons: BUTTON_BITS[button],
      clickCount,
      modifiers,
    });
    await mouse(cdp, { type: "mouseReleased", x, y, button, buttons: 0, clickCount, modifiers });
  }
  const verb =
    input.count === 2 ? "Double-clicked" : input.count === 3 ? "Triple-clicked" : "Clicked";
  return `${verb} ${refs.describe(input.ref)}.`;
}

export async function hover(cdp: CdpSession, refs: RefTable, ref: string): Promise<string> {
  const { x, y } = await locate(cdp, refs, ref);
  await mouse(cdp, { type: "mouseMoved", x, y });
  return `Hovered ${refs.describe(ref)}.`;
}

export async function typeText(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserTypeInput.Type,
): Promise<string> {
  if (input.ref) {
    const target = refs.resolve(input.ref);
    await cdp
      .send("DOM.focus", { backendNodeId: target.backendNodeId }, target.sessionId)
      .catch(async () => click(cdp, refs, { ref: input.ref! }))
      .catch(rethrowStaleNode(input.ref));
    await callOn(cdp, target, SELECT_CONTENTS).catch(rethrowStaleNode(input.ref));
    if (input.text.length === 0) await key(cdp, parseKeyChord("Backspace").key, 0);
  }
  if (input.text.length <= KEYSTROKE_LIMIT) {
    for (const char of input.text) await key(cdp, characterKey(char), 0);
  } else {
    await cdp.send("Input.insertText", { text: input.text });
  }
  if (input.submit) await key(cdp, characterKey("\n"), 0);
  const where = input.ref ? ` into ${refs.describe(input.ref)}` : "";
  return `Typed ${input.text.length} characters${where}${input.submit ? " and pressed Enter" : ""}.`;
}

export async function press(
  cdp: CdpSession,
  input: typeof BrowserPressInput.Type,
): Promise<string> {
  const chord = parseKeyChord(input.key);
  for (let index = 0; index < (input.repeat ?? 1); index += 1) {
    let held = 0;
    for (const modifier of chord.modifiers) {
      held |= modifierMask([modifier]);
      await cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: modifierKey(modifier).key,
        code: modifierKey(modifier).code,
        windowsVirtualKeyCode: modifierKey(modifier).keyCode,
        modifiers: held,
      });
    }
    await key(cdp, chord.key, chord.modifierMask);
    for (const modifier of chord.modifiers.toReversed()) {
      held &= ~modifierMask([modifier]);
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: modifierKey(modifier).key,
        code: modifierKey(modifier).code,
        windowsVirtualKeyCode: modifierKey(modifier).keyCode,
        modifiers: held,
      });
    }
  }
  return `Pressed ${input.key}${(input.repeat ?? 1) > 1 ? ` ×${input.repeat}` : ""}.`;
}

export async function selectOptions(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserSelectInput.Type,
): Promise<string> {
  const target = refs.resolve(input.ref);
  const result = await callOn<{ error?: string; selected?: string[] }>(
    cdp,
    target,
    SELECT_OPTIONS,
    [input.values],
  ).catch(rethrowStaleNode(input.ref));
  if (result.error) throw new BrowserFailure("invalid_input", result.error);
  return `Selected ${result.selected!.map((label) => JSON.stringify(label)).join(", ")} in ${refs.describe(input.ref)}.`;
}

export async function scroll(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserScrollInput.Type,
): Promise<string> {
  let origin: { x: number; y: number };
  if (input.ref) {
    origin = await locate(cdp, refs, input.ref);
    if (!input.direction) return `Scrolled ${refs.describe(input.ref)} into view.`;
  } else {
    const { cssLayoutViewport: viewport } = await cdp.send<{
      cssLayoutViewport: { clientWidth: number; clientHeight: number };
    }>("Page.getLayoutMetrics");
    origin = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
  }
  const direction = input.direction ?? "down";
  const vertical = direction === "up" || direction === "down";
  const amount = input.amount ?? Math.round((vertical ? origin.y : origin.x) * 1.6);
  const sign = direction === "up" || direction === "left" ? -1 : 1;
  await mouse(cdp, {
    type: "mouseWheel",
    ...origin,
    deltaX: vertical ? 0 : sign * amount,
    deltaY: vertical ? sign * amount : 0,
  });
  return `Scrolled ${direction} ${amount}px${input.ref ? ` inside ${refs.describe(input.ref)}` : ""}.`;
}
