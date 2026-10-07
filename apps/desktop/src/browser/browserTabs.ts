import type { BrowserTabsChanged } from "@glade/contracts/browser/browserHost";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { session, WebContentsView, type DownloadItem, type WebContents } from "electron";
import * as FS from "node:fs";
import * as Path from "node:path";
import { BrowserFailure } from "./browserFailure";
import { BROWSER_PARTITION, BROWSER_WEB_PREFERENCES, BrowserTab } from "./browserTab";
import { browserUrlBlockReason } from "./browserUrlPolicy";

// Hidden views still lay out at these bounds, so pages render a desktop viewport before the panel
// ever shows them.
const DEFAULT_BOUNDS = { x: 0, y: 0, width: 1280, height: 800 };
const CHANGE_DEBOUNCE_MS = 100;

function downloadTarget(workspaceDir: string, suggested: string): string {
  const directory = Path.join(workspaceDir, ".glade", "downloads");
  FS.mkdirSync(directory, { recursive: true });
  const ignore = Path.join(directory, ".gitignore");
  if (!FS.existsSync(ignore)) FS.writeFileSync(ignore, "*\n");
  const base = Path.basename(suggested).replace(/[\u0000-\u001f<>:"/\\|?*]/gu, "_") || "download";
  const { name, ext } = Path.parse(base);
  let candidate = Path.join(directory, base);
  for (let index = 1; FS.existsSync(candidate); index += 1) {
    candidate = Path.join(directory, `${name} (${index})${ext}`);
  }
  return candidate;
}

// Owns every agent browser tab. Tabs belong to exactly one thread; callers pass the thread from
// the authenticated server request and can only reach that thread's tabs.
export class BrowserTabs {
  private readonly tabs = new Map<string, BrowserTab>();
  private readonly activeByThread = new Map<ThreadId, string>();
  private nextId = 1;
  private changeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      readonly gladePorts: () => ReadonlySet<number>;
      readonly onChanged: (tabs: BrowserTabsChanged["tabs"]) => void;
    },
  ) {
    const browserSession = session.fromPartition(BROWSER_PARTITION);
    browserSession.on("will-download", (_event, item, webContents) =>
      this.handleDownload(item, webContents),
    );
    // Covers redirects, subframes and fetches too, so no page can reach Glade's own server.
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: browserUrlBlockReason(details.url, this.options.gladePorts()) !== null });
    });
  }

  // A WebContents has no renderer until its first load, and CDP commands sent before that fail with
  // "target closed"; about:blank gives the debugger a live target to attach to.
  async open(threadId: ThreadId, downloadDir: string | null): Promise<BrowserTab> {
    const view = new WebContentsView({ webPreferences: BROWSER_WEB_PREFERENCES });
    const tab = this.adopt(view, threadId, downloadDir);
    await view.webContents.loadURL("about:blank");
    return tab;
  }

  resolve(threadId: ThreadId, tabId: string | undefined): BrowserTab {
    const id = tabId ?? this.activeByThread.get(threadId);
    const tab = id === undefined ? undefined : this.tabs.get(id);
    if (tab && tab.threadId === threadId) return tab;
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

  list(threadId: ThreadId): BrowserTab[] {
    return [...this.tabs.values()].filter((tab) => tab.threadId === threadId);
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
    const tab = this.resolve(threadId, tabId);
    this.forget(tab);
    tab.destroy();
  }

  // Sends the full list again, for a backend that just connected and has none.
  announce(): void {
    this.changed();
  }

  closeAll(): void {
    for (const tab of this.tabs.values()) tab.destroy();
  }

  private adopt(view: WebContentsView, threadId: ThreadId, downloadDir: string | null): BrowserTab {
    const tab = new BrowserTab(`t${this.nextId++}`, threadId, view, downloadDir);
    view.setBounds(DEFAULT_BOUNDS);
    this.tabs.set(tab.id, tab);
    this.activeByThread.set(threadId, tab.id);
    const webContents = view.webContents;
    const changed = () => this.changed();
    webContents.on("did-start-loading", changed);
    webContents.on("did-stop-loading", changed);
    webContents.on("did-navigate", changed);
    webContents.on("did-navigate-in-page", changed);
    webContents.on("page-title-updated", changed);
    webContents.once("destroyed", () => this.forget(tab));
    webContents.setWindowOpenHandler(({ url }) => {
      if (browserUrlBlockReason(url, this.options.gladePorts())) return { action: "deny" };
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
    this.changed();
    return tab;
  }

  private forget(tab: BrowserTab): void {
    if (!this.tabs.delete(tab.id)) return;
    if (this.activeByThread.get(tab.threadId) === tab.id) {
      const next = this.list(tab.threadId).at(-1);
      if (next) this.activeByThread.set(tab.threadId, next.id);
      else this.activeByThread.delete(tab.threadId);
    }
    this.changed();
  }

  private handleDownload(item: DownloadItem, webContents: WebContents): void {
    const tab = [...this.tabs.values()].find((candidate) => candidate.webContents === webContents);
    if (!tab?.downloadDir) {
      item.cancel();
      tab?.addNotice(
        `Canceled the download of ${item.getFilename()}: this thread has no workspace folder.`,
      );
      return;
    }
    const target = downloadTarget(tab.downloadDir, item.getFilename());
    item.setSavePath(target);
    item.once("done", (_event, state) => {
      tab.addNotice(
        state === "completed"
          ? `Downloaded ${target}.`
          : `The download of ${item.getFilename()} ${state}.`,
      );
    });
  }

  private changed(): void {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.options.onChanged(
        [...this.tabs.values()].map((tab) => ({
          tabId: tab.id,
          threadId: tab.threadId,
          url: tab.webContents.getURL(),
          title: tab.webContents.getTitle(),
          loading: tab.webContents.isLoading(),
          canGoBack: tab.webContents.navigationHistory.canGoBack(),
          canGoForward: tab.webContents.navigationHistory.canGoForward(),
          active: this.activeByThread.get(tab.threadId) === tab.id,
        })),
      );
    }, CHANGE_DEBOUNCE_MS);
  }
}
