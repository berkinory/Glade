import type {
  BrowserClickInput,
  BrowserDragInput,
  BrowserPressInput,
  BrowserTarget,
} from "@glade/contracts/browser/browserTools";
import { BrowserFailure } from "../browserFailure";
import type { CdpSession } from "./cdpSession";
import { dragBetween } from "./drag";
import { formatChord } from "./keyChords";
import {
  editingCommands,
  keyChords,
  keyDefinition,
  keyModifiers,
  modifierKey,
  modifierMask,
  pressKey,
} from "./keyboard";
import { callOn, mouse, resolveTarget } from "./pointer";
import type { RefTable } from "./refs";
import type { ScreenshotFrame } from "./screenshotFrame";

const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const;

// null for anything that is not a checkbox, radio or switch, or a label of one.
const TOGGLE_STATE = `function () {
  const el = this instanceof HTMLLabelElement && this.control ? this.control : this;
  const role = el.getAttribute && el.getAttribute("role");
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return el.checked;
  if (role === "checkbox" || role === "radio" || role === "switch") return el.getAttribute("aria-checked") === "true";
  return null;
}`;
const IS_RADIO = `function () {
  const el = this instanceof HTMLLabelElement && this.control ? this.control : this;
  return (el instanceof HTMLInputElement && el.type === "radio") || el.getAttribute("role") === "radio";
}`;
const SCRIPT_CLICK = `function () { (this instanceof HTMLLabelElement && this.control ? this.control : this).click(); }`;

const toggleWord = (checked: boolean) => (checked ? "checked" : "unchecked");

export async function click(
  cdp: CdpSession,
  refs: RefTable,
  screenshot: ScreenshotFrame | null,
  input: Omit<typeof BrowserClickInput.Type, "tabId">,
): Promise<string> {
  const { x, y, label, ref, via } = await resolveTarget(cdp, refs, screenshot, input);
  const target = ref === undefined ? undefined : refs.resolve(ref);
  const state = () =>
    target ? callOn<boolean | null>(cdp, target, TOGGLE_STATE).catch(() => null) : null;
  const before = await state();
  const button = input.button ?? "left";
  const modifiers = modifierMask(keyModifiers(input.modifiers));
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
  const done = via ? `${verb} ${label} through ${via}.` : `${verb} ${label}.`;
  if (!target || before === null) return done;
  // A page that ignores the click or flips the state back leaves the toggle where it was.
  const after = await state();
  if (after === null) return done;
  if (after !== before) return `${done} It is now ${toggleWord(after)}.`;
  // A click that landed on a related element may not reach the control's own handling. Only then,
  // and only when the state provably did not change after a single plain click, the control is
  // clicked once from script; a toggle that did change is never clicked again.
  const plain = (input.count ?? 1) === 1 && button === "left" && modifiers === 0;
  const settledRadio = before && (await callOn<boolean>(cdp, target, IS_RADIO).catch(() => true));
  if (via && plain && !settledRadio) {
    await callOn(cdp, target, SCRIPT_CLICK).catch(() => undefined);
    const scripted = await state();
    if (scripted !== null && scripted !== before) {
      return `${done} That did not change it, so Glade clicked the control from script; it is now ${toggleWord(scripted)}.`;
    }
  }
  return `${done} It is still ${toggleWord(after)}; the click did not change it.`;
}

// The mouse stays where it ends, so a menu opened by hovering stays open for the next call.
export async function hover(
  cdp: CdpSession,
  refs: RefTable,
  screenshot: ScreenshotFrame | null,
  input: typeof BrowserTarget.Type,
): Promise<string> {
  const { x, y, label } = await resolveTarget(cdp, refs, screenshot, input);
  await mouse(cdp, { type: "mouseMoved", x, y });
  return `Hovered ${label}.`;
}

export async function drag(
  cdp: CdpSession,
  refs: RefTable,
  screenshot: ScreenshotFrame | null,
  input: typeof BrowserDragInput.Type,
): Promise<string> {
  // Bringing `to` into view can scroll `from` away, so `to` is resolved again afterwards.
  if (input.to.ref !== undefined) await resolveTarget(cdp, refs, screenshot, input.to);
  const from = await resolveTarget(cdp, refs, screenshot, input.from);
  const to = await resolveTarget(cdp, refs, screenshot, input.to);
  await dragBetween(cdp, from, to);
  return `Dragged ${from.label} to ${to.label}.`;
}

// Each press is a whole chord: modifiers down in order, the key, modifiers up in reverse.
const MAX_PRESSES = 200;

export async function press(
  cdp: CdpSession,
  input: typeof BrowserPressInput.Type,
): Promise<string> {
  const chords = keyChords(input.key);
  const repeat = input.repeat ?? 1;
  if (chords.length * repeat > MAX_PRESSES) {
    throw new BrowserFailure("invalid_input", `At most ${MAX_PRESSES} key presses per call.`);
  }
  const modifier = (
    name: (typeof chords)[number]["modifiers"][number],
    type: string,
    held: number,
  ) =>
    cdp.send("Input.dispatchKeyEvent", {
      type,
      key: modifierKey(name).key,
      code: modifierKey(name).code,
      windowsVirtualKeyCode: modifierKey(name).keyCode,
      modifiers: held,
    });
  for (let index = 0; index < repeat; index += 1) {
    for (const chord of chords) {
      let held = 0;
      for (const name of chord.modifiers) {
        held |= modifierMask([name]);
        await modifier(name, "rawKeyDown", held);
      }
      await pressKey(
        cdp,
        keyDefinition(chord.key),
        modifierMask(chord.modifiers),
        editingCommands(chord),
      );
      for (const name of chord.modifiers.toReversed()) {
        held &= ~modifierMask([name]);
        await modifier(name, "keyUp", held);
      }
    }
  }
  return `Pressed ${chords.map(formatChord).join(" ")}${repeat > 1 ? ` ×${repeat}` : ""}.`;
}
