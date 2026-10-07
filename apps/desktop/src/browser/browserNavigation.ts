import type { BrowserNavigateInput } from "@glade/contracts/browser/browserTools";
import type { WebContents } from "electron";
import { BrowserFailure } from "./browserFailure";
import type { BrowserTab } from "./browserTab";
import { browserUrlBlockReason, normalizeNavigationUrl } from "./browserUrlPolicy";

const NAVIGATION_TIMEOUT_MS = 30_000;
const HISTORY_START_MS = 150;
const HISTORY_TIMEOUT_MS = 10_000;
// Chromium reports a navigation replaced by a redirect or a client-side route as aborted.
const ERR_ABORTED = -3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function waitForLoad(webContents: WebContents, timeoutMs: number): Promise<boolean> {
  if (!webContents.isLoading()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (loaded: boolean) => {
      clearTimeout(timer);
      webContents.off("did-stop-loading", onStop);
      resolve(loaded);
    };
    const onStop = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    webContents.on("did-stop-loading", onStop);
  });
}

export async function navigate(
  tab: BrowserTab,
  input: typeof BrowserNavigateInput.Type,
  gladePorts: ReadonlySet<number>,
): Promise<string> {
  const webContents = tab.webContents;
  if (input.url !== undefined) {
    const url = normalizeNavigationUrl(input.url);
    const blocked = browserUrlBlockReason(url, gladePorts, "page");
    if (blocked) throw new BrowserFailure("blocked_url", blocked);
    const loading = webContents.loadURL(url).then(
      () => true,
      (error: { errno?: number; code?: string; message?: string }) => {
        if (error.errno === ERR_ABORTED) return true;
        throw new BrowserFailure(
          "navigation_failed",
          `Could not open ${url}: ${error.code ?? error.message}`,
        );
      },
    );
    const loaded = await Promise.race([loading, sleep(NAVIGATION_TIMEOUT_MS).then(() => false)]);
    if (!loaded) tab.addNotice(`The page is still loading after ${NAVIGATION_TIMEOUT_MS / 1000}s.`);
    return `Opened ${url}.`;
  }
  const history = webContents.navigationHistory;
  if (input.history === "back" && !history.canGoBack()) {
    throw new BrowserFailure("navigation_failed", "There is no previous page in this tab.");
  }
  if (input.history === "forward" && !history.canGoForward()) {
    throw new BrowserFailure("navigation_failed", "There is no next page in this tab.");
  }
  if (input.history === "back") history.goBack();
  else if (input.history === "forward") history.goForward();
  else if (input.history === "reload") webContents.reload();
  else throw new BrowserFailure("invalid_input", "Pass url or history.");
  await sleep(HISTORY_START_MS);
  if (!(await waitForLoad(webContents, HISTORY_TIMEOUT_MS))) {
    tab.addNotice("The page is still loading.");
  }
  return input.history === "reload" ? "Reloaded." : `Went ${input.history}.`;
}
