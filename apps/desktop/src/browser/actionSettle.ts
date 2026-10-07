import { ActionRequests } from "./actionRequests";
import type { BrowserTab } from "./browserTab";
import { waitForLoad } from "./browserNavigation";

// After an input action: a navigation it causes starts within this window...
const NAVIGATION_START_MS = 100;
// ...and gets this long to load. Otherwise requests the action started within REQUEST_WINDOW_MS
// of its end get REQUESTS_CAP_MS to finish, then the DOM must go quiet for QUIET_MS, capped.
const NAVIGATION_LOAD_MS = 5_000;
const REQUEST_WINDOW_MS = 150;
const REQUESTS_CAP_MS = 1_000;
// A navigation that never commits may be turning into a download, which starts within this
// window; a download the action started gets DOWNLOAD_CAP_MS to finish, so its path lands in this
// result.
const DOWNLOAD_START_MS = 1_500;
const DOWNLOAD_CAP_MS = 3_000;
// A print the action caused is saved as a PDF; one this quick lands in the action's result.
const PRINT_CAP_MS = 5_000;
const QUIET_MS = 100;
const QUIET_CAP_MS = 3_000;
const WATCH_SETUP_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Installed before the action so mutations it causes synchronously are counted too. Counts added
// elements that look interactive (and options among them); settles once nothing changed for
// `quietMs`.
const WATCH = `(() => {
  const key = Symbol.for("glade.settle");
  window[key]?.stop();
  const selector = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=radio],[role=switch],[tabindex],[contenteditable=""],[contenteditable=true],[onclick]';
  let added = 0;
  let options = 0;
  const items = [];
  let last = performance.now();
  const observer = new MutationObserver((records) => {
    last = performance.now();
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (items.length < 500) items.push(node);
      if (node.matches(selector)) added += 1;
      added += node.querySelectorAll(selector).length;
      if (node.matches("[role=option]")) options += 1;
      options += node.querySelectorAll("[role=option]").length;
    }
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const stop = () => { observer.disconnect(); delete window[key]; };
  // Added elements still shown with text, outermost only, each named by its first heading or line.
  const summary = () => {
    const shown = items.filter((node) => node.isConnected && !items.some((other) => other !== node && other.contains(node))
      && (!node.checkVisibility || node.checkVisibility({ opacityProperty: true, visibilityProperty: true })));
    const texts = [];
    let count = 0;
    for (const node of shown) {
      const heading = node.querySelector("h1, h2, h3, h4, h5, h6");
      const line = ((heading || node).innerText || "").split("\\n").map((part) => part.trim()).find(Boolean);
      if (!line) continue;
      count += 1;
      const text = line.length > 80 ? line.slice(0, 79) + "…" : line;
      if (texts.length < 8 && !texts.includes(text)) texts.push(text);
    }
    return { newItems: count, newTexts: texts };
  };
  window[key] = {
    stop,
    settle: (quietMs, capMs) => new Promise((resolve) => {
      const started = performance.now();
      last = Math.max(last, started);
      const tick = () => {
        const now = performance.now();
        if (now - last >= quietMs || now - started >= capMs) { stop(); resolve({ added, options, ...summary() }); }
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

// Glade's own report plus text taken from the page, which the gateway marks as untrusted.
export interface ActionReport {
  readonly text: string;
  readonly content?: string | undefined;
}

// What an action reports right away, plus an optional read once the page settled (a combobox's
// committed value, the options that appeared), appended to its line.
export interface ActionOutcome {
  readonly line: string;
  // The read after settling already says what appeared.
  readonly reportsNewItems?: boolean;
  readonly afterSettle?: (settled: Settled) => Promise<ActionReport>;
}

interface Settled {
  // Options ([role=option]) added to the main document while the action ran.
  readonly optionsAdded: number;
  // Added elements still shown with text, and the first few of their headings or first lines.
  readonly newItems: number;
  readonly newTexts: readonly string[];
}

type Watched = { added: number; options: number; newItems: number; newTexts: string[] };

export interface SettleOptions {
  // How long the action's own requests may take; uploads send more.
  readonly requestsCapMs?: number;
}

// Runs an input action and waits the way a user would before looking again: for a navigation it
// starts, or for the requests it started and then for the DOM to stop changing. Never waits for
// network idle and never pauses the page, which the user shares. Returns the action's line plus
// what changed.
export async function actAndSettle(
  tab: BrowserTab,
  action: () => Promise<string | ActionOutcome>,
  options: SettleOptions = {},
): Promise<ActionReport> {
  const { webContents } = tab;
  const before = tab.page();
  const startedAt = Date.now();
  let started: () => void = () => undefined;
  const navigationStarted = new Promise<true>((resolve) => {
    started = () => resolve(true);
  });
  const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) started();
  };
  let committed = false;
  const onCommit = () => {
    committed = true;
  };
  webContents.on("did-start-navigation", onNavigation);
  webContents.on("did-navigate", onCommit);
  const requests = new ActionRequests(tab.cdp);
  let outcome: ActionOutcome;
  let settled: Watched | undefined;
  try {
    await evaluate(tab, WATCH, WATCH_SETUP_MS);
    const result = await action();
    outcome = typeof result === "string" ? { line: result } : result;
    const actionEnded = Date.now();
    const navigating = await Promise.race([
      navigationStarted,
      sleep(NAVIGATION_START_MS).then(() => false),
    ]);
    if (navigating) {
      requests.close();
      if (!(await waitForLoad(webContents, NAVIGATION_LOAD_MS))) {
        tab.addNotice("The page is still loading.");
      }
      if (!committed) await tab.downloads.started(startedAt, DOWNLOAD_START_MS);
    } else {
      await sleep(Math.max(0, actionEnded + REQUEST_WINDOW_MS - Date.now()));
      await requests.settle(options.requestsCapMs ?? REQUESTS_CAP_MS);
      settled = await evaluate<Watched>(
        tab,
        `window[Symbol.for("glade.settle")]?.settle(${QUIET_MS}, ${QUIET_CAP_MS})`,
        QUIET_CAP_MS + 500,
      );
    }
    await tab.downloads.settle(startedAt, DOWNLOAD_CAP_MS);
    await tab.prints.settle(PRINT_CAP_MS);
  } finally {
    requests.stop();
    webContents.off("did-start-navigation", onNavigation);
    webContents.off("did-navigate", onCommit);
  }
  // The page may have navigated or replaced the element; the action itself already happened.
  const extra: ActionReport = outcome.afterSettle
    ? await outcome
        .afterSettle({
          optionsAdded: settled?.options ?? 0,
          newItems: settled?.newItems ?? 0,
          newTexts: settled?.newTexts ?? [],
        })
        .catch(() => ({ text: "" }))
    : { text: "" };
  const line = `${outcome.line}${extra.text}`;
  const after = tab.page();
  const changes: string[] = [];
  if (after.url !== before.url) changes.push(`URL is now ${after.url}`);
  if (after.title !== before.title) changes.push(`title is now ${JSON.stringify(after.title)}`);
  const added = settled?.added;
  if (added && !outcome.reportsNewItems)
    changes.push(`${added} new interactive element${added === 1 ? "" : "s"} appeared`);
  return {
    text: changes.length > 0 ? `${line} Then ${changes.join("; ")}.` : line,
    content: extra.content,
  };
}
