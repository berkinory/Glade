import type { BrowserTabsChanged } from "@glade/contracts/browser/browserHost";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { session, WebContentsView, type DownloadItem, type WebContents } from "electron";
import * as FS from "node:fs";
import { downloadTarget } from "./browserDownloads";
import { BrowserFailure } from "./browserFailure";
import {
  BROWSER_PARTITION,
  BROWSER_WEB_PREFERENCES,
  BrowserTab,
  type CarriedTabState,
} from "./browserTab";
import type { BrowserViewParking } from "./browserViewParking";
import type { ContentBlocker } from "./contentBlocker";
import { browserUrlBlockReason } from "./browserUrlPolicy";

// Hidden views still lay out at these bounds, so pages render a desktop viewport before the panel
// ever shows them.
const DEFAULT_BOUNDS = { x: 0, y: 0, width: 1280, height: 800 };
const CHANGE_DEBOUNCE_MS = 100;
const ERR_BLOCKED_BY_CLIENT = -20;
// Like Chrome's tab discarding: a tab nobody touched for this long, or beyond the per-thread cap
// of live tabs (least recently used first), gives up its renderer until it is used again.
const SUSPEND_IDLE_MS = 10 * 60_000;
const SUSPEND_SWEEP_MS = 60_000;
const MAX_LIVE_TABS_PER_THREAD = 8;

// A tab whose view and debugger were released. It keeps its place, page and ref numbering, and
// comes back on the next agent call or when the user selects it.
interface SuspendedTab extends CarriedTabState {
  readonly id: string;
  readonly threadId: ThreadId;
  readonly downloadDir: string | null;
  readonly url: string;
  readonly title: string;
  readonly notices: readonly string[];
}

type TabEntry = BrowserTab | SuspendedTab;

export interface BrowserTabListing {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly suspended: boolean;
  readonly dialogOpen: boolean;
  readonly downloads: readonly string[];
}

const isLive = (entry: TabEntry): entry is BrowserTab => entry instanceof BrowserTab;

// Owns every agent browser tab. Tabs belong to exactly one thread; callers pass the thread from
// the authenticated server request and can only reach that thread's tabs.
export class BrowserTabs {
  private readonly tabs = new Map<string, TabEntry>();
  private readonly activeByThread = new Map<ThreadId, string>();
  private nextId = 1;
  private changeTimer: NodeJS.Timeout | null = null;
  private readonly sweepTimer = setInterval(() => this.sweep(), SUSPEND_SWEEP_MS);

  constructor(
    private readonly options: {
      readonly gladePorts: () => ReadonlySet<number>;
      readonly onChanged: (tabs: BrowserTabsChanged["tabs"]) => void;
      readonly blocker: ContentBlocker;
      readonly parking: BrowserViewParking;
    },
  ) {
    const browserSession = session.fromPartition(BROWSER_PARTITION);
    const { blocker } = options;
    browserSession.on("will-download", (_event, item, webContents) =>
      this.handleDownload(item, webContents),
    );
    // Electron keeps one listener per webRequest event and session; registering a second one
    // silently replaces the first. Glade's URL policy and the content blocker therefore share
    // these: the policy runs first and its cancel is final, then the blocker decides. Covers
    // redirects, popups, subframes, fetches and service workers, so no page can reach Glade's own
    // server or a blocked address.
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const kind =
        details.resourceType === "mainFrame"
          ? "page"
          : details.resourceType === "subFrame"
            ? "frame"
            : "resource";
      if (browserUrlBlockReason(details.url, this.options.gladePorts(), kind) !== null) {
        callback({ cancel: true });
        return;
      }
      blocker.onBeforeRequest(details, callback);
    });
    browserSession.webRequest.onHeadersReceived((details, callback) =>
      blocker.onHeadersReceived(details, callback),
    );
  }

  // A WebContents has no renderer until its first load, and CDP commands sent before that fail with
  // "target closed"; about:blank gives the debugger a live target to attach to.
  async open(threadId: ThreadId, downloadDir: string | null): Promise<BrowserTab> {
    const view = new WebContentsView({ webPreferences: BROWSER_WEB_PREFERENCES });
    const tab = this.adopt(view, threadId, downloadDir);
    await view.webContents.loadURL("about:blank");
    return tab;
  }

  // A suspended tab is restored: its page reloads and the refs taken before are stale.
  resolve(threadId: ThreadId, tabId: string | undefined): BrowserTab {
    const entry = this.entry(threadId, tabId);
    return isLive(entry) ? entry : this.restore(entry);
  }

  listing(threadId: ThreadId): BrowserTabListing[] {
    return this.entries(threadId).map((entry) => {
      const live = isLive(entry);
      return {
        id: entry.id,
        ...(live ? entry.page() : { url: entry.url, title: entry.title }),
        suspended: !live,
        dialogOpen: live && entry.dialogs.current() !== null,
        downloads: entry.downloads.lines(),
      };
    });
  }

  activeId(threadId: ThreadId): string | undefined {
    return this.activeByThread.get(threadId);
  }

  select(threadId: ThreadId, tabId: string): BrowserTab {
    const tab = this.resolve(threadId, tabId);
    this.activeByThread.set(threadId, tab.id);
    this.changed();
    return tab;
  }

  close(threadId: ThreadId, tabId: string | undefined): void {
    this.discard(this.entry(threadId, tabId));
  }

  closeThread(threadId: ThreadId): number {
    const closing = this.entries(threadId);
    for (const entry of closing) this.discard(entry);
    return closing.length;
  }

  // Sends the full list again, for a backend that just connected and has none.
  announce(): void {
    this.changed();
  }

  closeAll(): void {
    clearInterval(this.sweepTimer);
    for (const entry of this.tabs.values()) if (isLive(entry)) this.release(entry);
  }

  private entry(threadId: ThreadId, tabId: string | undefined): TabEntry {
    const id = tabId ?? this.activeByThread.get(threadId);
    const entry = id === undefined ? undefined : this.tabs.get(id);
    if (entry && entry.threadId === threadId) return entry;
    if (tabId !== undefined) {
      throw new BrowserFailure(
        "tab_not_found",
        `Tab ${tabId} does not exist in this thread. List tabs with browser_tabs.`,
      );
    }
    throw new BrowserFailure(
      "no_tab",
      "This thread has no browser tab. Open one with browser_tabs or browser_navigate.",
    );
  }

  private entries(threadId: ThreadId): TabEntry[] {
    return [...this.tabs.values()].filter((entry) => entry.threadId === threadId);
  }

  private discard(entry: TabEntry): void {
    this.forget(entry);
    if (isLive(entry)) this.release(entry);
  }

  private sweep(): void {
    const idleSince = Date.now() - SUSPEND_IDLE_MS;
    for (const entry of [...this.tabs.values()]) {
      if (isLive(entry) && entry.lastUsed() < idleSince && entry.canSuspend()) this.suspend(entry);
    }
  }

  private enforceLiveCap(threadId: ThreadId, keep: BrowserTab): void {
    const candidates = this.entries(threadId)
      .filter(isLive)
      .toSorted((a, b) => a.lastUsed() - b.lastUsed());
    let excess = candidates.length - MAX_LIVE_TABS_PER_THREAD;
    for (const tab of candidates) {
      if (excess <= 0) return;
      if (tab === keep || !tab.canSuspend()) continue;
      this.suspend(tab);
      excess -= 1;
    }
  }

  // The entry replaces the tab in place before the view goes, so its `destroyed` event does not
  // forget it.
  private suspend(tab: BrowserTab): void {
    const { url, title } = tab.page();
    this.tabs.set(tab.id, {
      id: tab.id,
      threadId: tab.threadId,
      downloadDir: tab.downloadDir,
      url,
      title,
      refs: tab.refs,
      downloads: tab.downloads,
      notices: tab.takeNotices(),
    });
    this.release(tab);
    this.changed();
  }

  private restore(entry: SuspendedTab): BrowserTab {
    const view = new WebContentsView({ webPreferences: BROWSER_WEB_PREFERENCES });
    const tab = this.adopt(view, entry.threadId, entry.downloadDir, entry);
    entry.refs.invalidate();
    for (const notice of entry.notices) tab.addNotice(notice);
    tab.addNotice(
      `This tab had been suspended while idle; Glade reloaded ${entry.url || "it"}, so refs from before no longer work. Take a new snapshot.`,
    );
    tab.restore(entry.url);
    return tab;
  }

  // `restored` keeps the suspended tab's id, place and state; it does not become the active tab.
  private adopt(
    view: WebContentsView,
    threadId: ThreadId,
    downloadDir: string | null,
    restored?: SuspendedTab,
  ): BrowserTab {
    const tab = new BrowserTab(
      restored?.id ?? `t${this.nextId++}`,
      threadId,
      view,
      downloadDir,
      () => this.changed(),
      restored,
    );
    view.setBounds(DEFAULT_BOUNDS);
    this.options.parking.park(view);
    this.tabs.set(tab.id, tab);
    if (!restored) this.activeByThread.set(threadId, tab.id);
    const webContents = view.webContents;
    const changed = () => this.changed();
    webContents.on("did-start-loading", changed);
    webContents.on("did-stop-loading", changed);
    webContents.on("did-navigate", changed);
    webContents.on("did-navigate-in-page", changed);
    webContents.on("page-title-updated", changed);
    webContents.once("destroyed", () => this.forget(tab));
    // A redirect or a page script can still aim a tab at a blocked address; the request is
    // canceled and the tab shows an empty error page, which the result should explain.
    webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
      if (isMainFrame && code === ERR_BLOCKED_BY_CLIENT) {
        tab.addNotice(`Glade's browser blocked loading ${url}.`);
      }
    });
    webContents.setWindowOpenHandler(({ url }) => {
      if (browserUrlBlockReason(url, this.options.gladePorts(), "page")) return { action: "deny" };
      return {
        action: "allow",
        overrideBrowserWindowOptions: { webPreferences: BROWSER_WEB_PREFERENCES },
        createWindow: (options) => {
          // Electron passes the guest it already created; adopting it keeps window.opener, which
          // sign-in popups need to report back to the page that opened them.
          const guest = (options as { readonly webContents?: WebContents }).webContents;
          const popup = this.adopt(
            new WebContentsView({
              webPreferences: options.webPreferences ?? BROWSER_WEB_PREFERENCES,
              ...(guest ? { webContents: guest } : {}),
            }),
            threadId,
            downloadDir,
          );
          tab.addNotice(`The page opened ${popup.id} (${url}); it is now the active tab.`);
          return popup.webContents;
        },
      };
    });
    this.enforceLiveCap(threadId, tab);
    this.changed();
    return tab;
  }

  private release(tab: BrowserTab): void {
    this.options.parking.unpark(tab.view);
    tab.destroy();
  }

  private forget(entry: TabEntry): void {
    if (this.tabs.get(entry.id) !== entry) return;
    this.tabs.delete(entry.id);
    if (this.activeByThread.get(entry.threadId) === entry.id) {
      const next = this.entries(entry.threadId).at(-1);
      if (next) this.activeByThread.set(entry.threadId, next.id);
      else this.activeByThread.delete(entry.threadId);
    }
    this.changed();
  }

  private handleDownload(item: DownloadItem, webContents: WebContents): void {
    const tab = [...this.tabs.values()]
      .filter(isLive)
      .find((candidate) => candidate.webContents === webContents);
    if (!tab?.downloadDir) {
      item.cancel();
      tab?.addNotice(
        `Canceled the download of ${item.getFilename()}: this thread has no workspace folder.`,
      );
      return;
    }
    let target: string;
    try {
      target = downloadTarget(tab.downloadDir, item.getFilename());
    } catch (error) {
      item.cancel();
      tab.addNotice(
        `Canceled the download of ${item.getFilename()}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    item.setSavePath(target);
    item.once("done", (_event, state) => {
      if (state !== "completed") FS.rmSync(target, { force: true });
    });
    tab.downloads.track(item, target, (text) => tab.addNotice(text));
  }

  private changed(): void {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.options.onChanged(
        [...this.tabs.values()].map((entry) => {
          const active = this.activeByThread.get(entry.threadId) === entry.id;
          const base = { tabId: entry.id, threadId: entry.threadId, active };
          if (!isLive(entry)) {
            return {
              ...base,
              url: entry.url,
              title: entry.title,
              loading: false,
              canGoBack: false,
              canGoForward: false,
              dialog: null,
              site: this.options.blocker.siteState(entry.url),
            };
          }
          const { webContents } = entry;
          return {
            ...base,
            url: webContents.getURL(),
            title: webContents.getTitle(),
            loading: webContents.isLoading(),
            canGoBack: webContents.navigationHistory.canGoBack(),
            canGoForward: webContents.navigationHistory.canGoForward(),
            dialog: entry.dialogs.current() ?? entry.challengeNotice(),
            site: this.options.blocker.siteState(webContents.getURL()),
          };
        }),
      );
    }, CHANGE_DEBOUNCE_MS);
  }
}
