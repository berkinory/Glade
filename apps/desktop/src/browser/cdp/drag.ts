import type { CdpSession } from "./cdpSession";
import { mouse } from "./pointer";

interface Point {
  readonly x: number;
  readonly y: number;
}

const STEPS = 10;
// How long a drag the page started may take to reach the browser as an intercepted drag; a page
// that cancels dragstart never sends one.
const INTERCEPT_WAIT_MS = 500;

const WATCH_DRAGSTART = `(() => {
  const key = Symbol.for("glade.dragstart");
  window[key]?.stop();
  const state = { started: false };
  const onStart = () => { state.started = true; };
  addEventListener("dragstart", onStart, true);
  state.stop = () => { removeEventListener("dragstart", onStart, true); delete window[key]; };
  window[key] = state;
})()`;
const DRAG_STARTED = `window[Symbol.for("glade.dragstart")]?.started === true`;
const STOP_WATCH = `window[Symbol.for("glade.dragstart")]?.stop()`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(cdp: CdpSession, expression: string): Promise<unknown> {
  const { result } = await cdp.send<{ result: { value?: unknown } }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  return result.value;
}

// Presses at `from`, moves in steps and releases at `to`. Chromium never starts an HTML5 drag from
// synthetic mouse events on its own, so drags are intercepted: once the page's dragstart fires,
// the rest of the gesture is replayed as drag events carrying the page's drag data. Pages that
// drag with pointer or mouse events get the plain press, moves and release.
export async function dragBetween(cdp: CdpSession, from: Point, to: Point): Promise<void> {
  let resolveIntercepted: (data: unknown) => void = () => undefined;
  const intercepted = new Promise<unknown>((resolve) => {
    resolveIntercepted = resolve;
  });
  const unsubscribe = cdp.on((method, params) => {
    if (method === "Input.dragIntercepted") resolveIntercepted(params.data);
  });
  let data: unknown = null;
  let current = from;
  let pressed = false;
  let finished = false;
  try {
    await cdp.send("Input.setInterceptDrags", { enabled: true });
    await evaluate(cdp, WATCH_DRAGSTART);
    await mouse(cdp, { type: "mouseMoved", ...from });
    await mouse(cdp, { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 });
    pressed = true;
    let checked = false;
    for (let step = 1; step <= STEPS; step += 1) {
      current = {
        x: from.x + ((to.x - from.x) * step) / STEPS,
        y: from.y + ((to.y - from.y) * step) / STEPS,
      };
      if (data) {
        await cdp.send("Input.dispatchDragEvent", { type: "dragOver", ...current, data });
        continue;
      }
      await mouse(cdp, { type: "mouseMoved", ...current, button: "left", buttons: 1 });
      if (checked || (await evaluate(cdp, DRAG_STARTED)) !== true) continue;
      checked = true;
      data = await Promise.race([intercepted, sleep(INTERCEPT_WAIT_MS).then(() => null)]);
      if (data) await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", ...current, data });
    }
    if (data) await cdp.send("Input.dispatchDragEvent", { type: "drop", ...to, data });
    else
      await mouse(cdp, { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 });
    finished = true;
  } finally {
    // A gesture cut short must not leave the page mid-drag or with the button held.
    if (!finished && data) {
      await cdp
        .send("Input.dispatchDragEvent", { type: "dragCancel", ...current, data })
        .catch(() => undefined);
    } else if (!finished && pressed) {
      await mouse(cdp, {
        type: "mouseReleased",
        ...current,
        button: "left",
        buttons: 0,
        clickCount: 1,
      }).catch(() => undefined);
    }
    unsubscribe();
    await cdp.send("Input.setInterceptDrags", { enabled: false }).catch(() => undefined);
    await evaluate(cdp, STOP_WATCH).catch(() => undefined);
  }
}
