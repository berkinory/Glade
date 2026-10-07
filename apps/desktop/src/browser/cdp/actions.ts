import type {
  BrowserClickInput,
  BrowserPressInput,
  BrowserScrollInput,
} from "@glade/contracts/browser/browserTools";
import type { CdpSession } from "./cdpSession";
import { modifierKey, modifierMask, parseKeyChord, pressKey } from "./keyboard";
import { callOn, clickPoint, mouse } from "./pointer";
import type { RefTable } from "./refs";

const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const;

// null for anything that is not a checkbox, radio or switch.
const TOGGLE_STATE = `function () {
  const role = this.getAttribute && this.getAttribute("role");
  if (this instanceof HTMLInputElement && (this.type === "checkbox" || this.type === "radio")) return this.checked;
  if (role === "checkbox" || role === "radio" || role === "switch") return this.getAttribute("aria-checked") === "true";
  return null;
}`;

export async function click(
  cdp: CdpSession,
  refs: RefTable,
  input: Pick<typeof BrowserClickInput.Type, "ref" | "button" | "modifiers" | "count">,
): Promise<string> {
  const { x, y } = await clickPoint(cdp, refs, input.ref);
  const target = refs.resolve(input.ref);
  const before = await callOn<boolean | null>(cdp, target, TOGGLE_STATE).catch(() => null);
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
  const done = `${verb} ${refs.describe(input.ref)}.`;
  if (before === null) return done;
  // A page that ignores the click or flips the state back leaves the toggle where it was.
  const after = await callOn<boolean | null>(cdp, target, TOGGLE_STATE).catch(() => null);
  if (after === null) return done;
  return after === before
    ? `${done} It is still ${after ? "checked" : "unchecked"}; the click did not change it.`
    : `${done} It is now ${after ? "checked" : "unchecked"}.`;
}

export async function hover(cdp: CdpSession, refs: RefTable, ref: string): Promise<string> {
  const { x, y } = await clickPoint(cdp, refs, ref);
  await mouse(cdp, { type: "mouseMoved", x, y });
  return `Hovered ${refs.describe(ref)}.`;
}

export async function press(
  cdp: CdpSession,
  input: typeof BrowserPressInput.Type,
): Promise<string> {
  const chord = parseKeyChord(input.key);
  const modifier = (name: (typeof chord.modifiers)[number], type: string, held: number) =>
    cdp.send("Input.dispatchKeyEvent", {
      type,
      key: modifierKey(name).key,
      code: modifierKey(name).code,
      windowsVirtualKeyCode: modifierKey(name).keyCode,
      modifiers: held,
    });
  for (let index = 0; index < (input.repeat ?? 1); index += 1) {
    let held = 0;
    for (const name of chord.modifiers) {
      held |= modifierMask([name]);
      await modifier(name, "rawKeyDown", held);
    }
    await pressKey(cdp, chord.key, chord.modifierMask);
    for (const name of chord.modifiers.toReversed()) {
      held &= ~modifierMask([name]);
      await modifier(name, "keyUp", held);
    }
  }
  return `Pressed ${input.key}${(input.repeat ?? 1) > 1 ? ` ×${input.repeat}` : ""}.`;
}

export async function scroll(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserScrollInput.Type,
): Promise<string> {
  let origin: { x: number; y: number };
  if (input.ref) {
    origin = await clickPoint(cdp, refs, input.ref);
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
