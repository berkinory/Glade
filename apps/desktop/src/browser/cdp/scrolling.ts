import type { BrowserScrollInput } from "@glade/contracts/browser/browserTools";
import type { ActionOutcome } from "../actionSettle";
import type { CdpSession } from "./cdpSession";
import { callOn, clickPoint, mouse } from "./pointer";
import { rethrowStaleNode, type RefTable } from "./refs";

interface Position {
  readonly top: number;
  readonly left: number;
  readonly maxTop: number;
  readonly maxLeft: number;
  readonly clientHeight: number;
  readonly clientWidth: number;
}

// The element a wheel over `this` scrolls: itself or its nearest scrollable ancestor, else the
// document. Read before and after to say how far it moved.
const POSITION = `function () {
  const scrolls = (el) => {
    const style = getComputedStyle(el);
    return (["auto", "scroll", "overlay"].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 1)
      || (["auto", "scroll", "overlay"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1);
  };
  let el = this && this.nodeType === 1 ? this : null;
  while (el && el !== document.body && el !== document.documentElement && !scrolls(el)) el = el.parentElement;
  if (!el || el === document.body || el === document.documentElement) el = document.scrollingElement || document.documentElement;
  return { top: el.scrollTop, left: el.scrollLeft, maxTop: el.scrollHeight - el.clientHeight, maxLeft: el.scrollWidth - el.clientWidth, clientHeight: el.clientHeight, clientWidth: el.clientWidth };
}`;

// Wheel scrolling is animated; the position is read once it stops moving, which also lets content
// that loads on scroll start within the action's wait.
const SCROLL_POLL_MS = 50;
const SCROLL_SETTLE_CAP_MS = 1_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const samePosition = (a: Position, b: Position) => a.top === b.top && a.left === b.left;

const pixels = (value: number) => Math.round(value).toLocaleString("en-US");

function where(position: Position, vertical: boolean): string {
  const offset = vertical ? position.top : position.left;
  const max = vertical ? position.maxTop : position.maxLeft;
  const percent = max > 0 ? Math.round((offset / max) * 100) : 0;
  return `${pixels(offset)} of ${pixels(max)}px (${percent}%)`;
}

// Scrolls the page, or the scroll container under ref, with a real wheel event, then reports the
// new position and what appeared (infinite feeds, virtualized lists).
export async function scroll(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserScrollInput.Type,
): Promise<string | ActionOutcome> {
  const target = input.ref ? refs.resolve(input.ref) : null;
  const read = () =>
    target
      ? callOn<Position>(cdp, target, POSITION).catch(rethrowStaleNode(input.ref!))
      : cdp
          .send<{ result: { value: Position } }>("Runtime.evaluate", {
            expression: `(${POSITION}).call(null)`,
            returnByValue: true,
          })
          .then(({ result }) => result.value);
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
  const before = await read();
  const direction = input.direction ?? "down";
  const vertical = direction === "up" || direction === "down";
  const amount =
    input.amount ??
    Math.max(100, Math.round((vertical ? before.clientHeight : before.clientWidth) * 0.8));
  const sign = direction === "up" || direction === "left" ? -1 : 1;
  await mouse(cdp, {
    type: "mouseWheel",
    ...origin,
    deltaX: vertical ? 0 : sign * amount,
    deltaY: vertical ? sign * amount : 0,
  });
  const deadline = Date.now() + SCROLL_SETTLE_CAP_MS;
  // A position that never left the start is accepted after a few polls: nothing is moving.
  let last = before;
  for (let polls = 1; Date.now() < deadline; polls += 1) {
    await sleep(SCROLL_POLL_MS);
    const now = await read();
    if (samePosition(now, last) && (polls >= 3 || !samePosition(now, before))) break;
    last = now;
  }
  const inside = input.ref ? ` inside ${refs.describe(input.ref)}` : "";
  return {
    line: `Scrolled ${direction} ${amount}px${inside}.`,
    reportsNewItems: true,
    afterSettle: async ({ newItems, newTexts }) => {
      const after = await read();
      const moved = vertical ? after.top !== before.top : after.left !== before.left;
      const edge = sign < 0 ? "start" : "end";
      const position = moved
        ? ` Now at ${where(after, vertical)}.`
        : ` It did not move; it is already at the ${edge}.`;
      if (newItems === 0) return { text: position };
      return {
        text: `${position} ${newItems} new item${newItems === 1 ? "" : "s"} appeared${newItems > newTexts.length ? "; the first are listed" : ""}.`,
        content: newTexts.map((text) => `- ${JSON.stringify(text)}`).join("\n"),
      };
    },
  };
}
