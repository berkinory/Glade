import type { BrowserWaitCondition, BrowserWaitInput } from "@glade/contracts/browser/browserTools";
import { BrowserFailure } from "./browserFailure";
import type { BrowserTab } from "./browserTab";
import { callOn } from "./cdp/pointer";
import { DialogInterrupt } from "./pageDialogs";

const DEFAULT_TIMEOUT_MS = 10_000;
const POLL_MS = 150;
// One poll's reads; a page that stops answering for longer is the tab's own timeout.
const POLL_TIMEOUT_MS = 5_000;

// For each needle, the text of the element that visibly shows it in the main document, or null:
// the deepest element whose text contains it must render (checkVisibility with opacity and
// visibility), have a box on the page and sit outside aria-hidden. Hidden, collapsed and
// off-screen-trick text never counts.
const VISIBLE_TEXT = `(needles) => {
  const norm = (text) => (text || "").replace(/\\s+/g, " ").toLowerCase();
  const body = document.body;
  if (!body) return needles.map(() => null);
  const rendered = norm(body.innerText);
  return needles.map((raw) => {
    const needle = norm(raw).trim();
    if (!rendered.includes(needle)) return null;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (el) => norm(el.textContent).includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      const deeper = Array.from(el.children).some((child) => norm(child.textContent).includes(needle));
      if (deeper) continue;
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
      if (el.closest("[aria-hidden=true]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && norm(el.innerText).includes(needle)) {
        return el.innerText.replace(/\\s+/g, " ").trim().slice(0, 300);
      }
    }
    return null;
  });
}`;
const SHOWN = `function () {
  return this.isConnected && (!this.checkVisibility || this.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
}`;

type Kind = keyof BrowserWaitCondition;

function only(condition: BrowserWaitCondition): { kind: Kind; value: string } {
  const set = (Object.keys(condition) as Kind[]).filter((key) => condition[key] !== undefined);
  if (set.length !== 1) {
    throw new BrowserFailure(
      "invalid_input",
      "Each condition takes exactly one of text, textGone, url or gone.",
    );
  }
  return { kind: set[0]!, value: condition[set[0]!]! };
}

// A URL condition matches as a substring, or with * as a wildcard over the whole URL.
function urlMatcher(pattern: string): (url: string) => boolean {
  if (!pattern.includes("*")) return (url) => url.includes(pattern);
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${source}$`, "u");
  return (url) => regex.test(url);
}

const describe = ({ kind, value }: { kind: Kind; value: string }) =>
  `${kind} ${JSON.stringify(value)}`;

// Polls until one condition holds and says which, or fails after the timeout. Each poll is its
// own short tab operation, so the user and panel calls are never locked out while it waits.
export async function waitForConditions(
  tab: BrowserTab,
  input: typeof BrowserWaitInput.Type,
): Promise<{ readonly text: string; readonly content?: string }> {
  const conditions = input.conditions.map(only);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const urls = new Map(
    conditions.filter((c) => c.kind === "url").map((c) => [c.value, urlMatcher(c.value)]),
  );
  const needles = conditions
    .filter((c) => c.kind === "text" || c.kind === "textGone")
    .map((c) => c.value);
  const started = Date.now();
  const check = async () => {
    const visible = needles.length
      ? await tab.cdp
          .send<{ result: { value?: Array<string | null> } }>("Runtime.evaluate", {
            expression: `(${VISIBLE_TEXT})(${JSON.stringify(needles)})`,
            returnByValue: true,
          })
          .then(({ result }) => result.value ?? [])
      : [];
    for (const condition of conditions) {
      const index = needles.indexOf(condition.value);
      const shown = visible[index];
      if (condition.kind === "text" && typeof shown === "string") return { ...condition, shown };
      if (condition.kind === "textGone" && shown === null) return condition;
      if (condition.kind === "url" && urls.get(condition.value)!(tab.webContents.getURL())) {
        return condition;
      }
      if (condition.kind === "gone") {
        // A ref whose document went away, or a node that left it, is gone.
        const present = await Promise.resolve()
          .then(() => callOn<boolean>(tab.cdp, tab.refs.resolve(condition.value), SHOWN))
          .catch(() => false);
        if (!present) return condition;
      }
    }
    return null;
  };
  for (;;) {
    let matched: { kind: Kind; value: string; shown?: string } | null;
    try {
      matched = await tab.run(check, { passive: true, timeoutMs: POLL_TIMEOUT_MS });
    } catch (error) {
      if (!(error instanceof DialogInterrupt)) throw error;
      return {
        text: `Stopped waiting: the page opened ${error.dialog.type === "alert" ? "an" : "a"} ${error.dialog.type} dialog. Answer it with browser_dialog.`,
        content: error.dialog.message,
      };
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (matched) {
      const where = matched.kind === "url" ? ` The URL is ${tab.webContents.getURL()}.` : "";
      const text = `Matched ${describe(matched)} after ${elapsed} s.${where}`;
      // The element's whole text, so a toast that vanishes soon has already been read.
      return matched.shown ? { text: `${text} It reads:`, content: matched.shown } : { text };
    }
    if (Date.now() - started >= timeoutMs) {
      throw new BrowserFailure(
        "timeout",
        `None of the conditions held within ${timeoutMs / 1000} s: ${conditions.map(describe).join(", ")}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
