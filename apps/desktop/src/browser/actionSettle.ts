import type { BrowserTab } from "./browserTab";
import { waitForLoad } from "./browserNavigation";

// After an input action: a navigation it causes starts within this window...
const NAVIGATION_START_MS = 100;
// ...and gets this long to load; otherwise the DOM must go quiet for QUIET_MS, capped.
const NAVIGATION_LOAD_MS = 5_000;
const QUIET_MS = 100;
const QUIET_CAP_MS = 3_000;
const WATCH_SETUP_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Installed before the action so mutations it causes synchronously are counted too. Counts added
// elements that look interactive; settles once nothing changed for `quietMs`.
const WATCH = `(() => {
  const key = Symbol.for("glade.settle");
  window[key]?.stop();
  const selector = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=radio],[role=switch],[tabindex],[contenteditable=""],[contenteditable=true],[onclick]';
  let added = 0;
  let last = performance.now();
  const observer = new MutationObserver((records) => {
    last = performance.now();
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches(selector)) added += 1;
      added += node.querySelectorAll(selector).length;
    }
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const stop = () => { observer.disconnect(); delete window[key]; };
  window[key] = {
    stop,
    settle: (quietMs, capMs) => new Promise((resolve) => {
      const started = performance.now();
      last = Math.max(last, started);
      const tick = () => {
        const now = performance.now();
        if (now - last >= quietMs || now - started >= capMs) { stop(); resolve(added); }
        else setTimeout(tick, 20);
      };
      tick();
    }),
  };
})()`;

async function evaluate<T>(tab: BrowserTab, expression: string, timeoutMs: number) {
  const evaluation = tab.cdp
    .send<{ result: { value?: T } }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    .then(({ result }) => result.value)
    .catch(() => undefined);
  // A busy page may not answer at all; the action already happened, so stop waiting.
  return Promise.race([evaluation, sleep(timeoutMs).then(() => undefined)]);
}

// Runs an input action and waits the way a user would before looking again: for a navigation it
// starts, or for the DOM to stop changing. Never waits for network idle. Returns the action's line
// plus what changed.
export async function actAndSettle(
  tab: BrowserTab,
  action: () => Promise<string>,
): Promise<string> {
  const { webContents } = tab;
  const before = tab.page();
  let started: () => void = () => undefined;
  const navigationStarted = new Promise<true>((resolve) => {
    started = () => resolve(true);
  });
  const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) started();
  };
  webContents.on("did-start-navigation", onNavigation);
  let line: string;
  let added: number | undefined;
  try {
    await evaluate(tab, WATCH, WATCH_SETUP_MS);
    line = await action();
    const navigating = await Promise.race([
      navigationStarted,
      sleep(NAVIGATION_START_MS).then(() => false),
    ]);
    if (navigating) {
      if (!(await waitForLoad(webContents, NAVIGATION_LOAD_MS))) {
        tab.addNotice("The page is still loading.");
      }
    } else {
      added = await evaluate<number>(
        tab,
        `window[Symbol.for("glade.settle")]?.settle(${QUIET_MS}, ${QUIET_CAP_MS})`,
        QUIET_CAP_MS + 500,
      );
    }
  } finally {
    webContents.off("did-start-navigation", onNavigation);
  }
  const after = tab.page();
  const changes: string[] = [];
  if (after.url !== before.url) changes.push(`URL is now ${after.url}`);
  if (after.title !== before.title) changes.push(`title is now ${JSON.stringify(after.title)}`);
  if (added) changes.push(`${added} new interactive element${added === 1 ? "" : "s"} appeared`);
  return changes.length > 0 ? `${line} Then ${changes.join("; ")}.` : line;
}
