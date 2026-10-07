import type { BrowserTextResult } from "@glade/contracts/browser/browserHost";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { WebContentsView } from "electron";
import { PageBuffers } from "./cdp/buffers";
import { CdpSession } from "./cdp/cdpSession";
import { watchDialogs } from "./cdp/dialogs";
import { RefTable } from "./cdp/refs";

export const BROWSER_PARTITION = "persist:glade-browser";
export const BROWSER_WEB_PREFERENCES = {
  partition: BROWSER_PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  // Agent tabs are usually not on screen; throttled timers and paused compositing would stall
  // loads, snapshots and screenshots.
  backgroundThrottling: false,
  // See watchDialogs: a window-less view would otherwise block the main process on a native modal.
  disableDialogs: true,
} as const;

const HUMAN_INPUT_TYPES = new Set(["mouseDown", "mouseWheel", "keyDown", "rawKeyDown", "char"]);
const HUMAN_QUIET_MS = 1_000;
const HUMAN_MAX_WAIT_MS = 3_000;
const MAX_NOTICES = 20;

export class BrowserTab {
  readonly cdp: CdpSession;
  readonly refs = new RefTable();
  readonly buffers: PageBuffers;
  private notices: string[] = [];
  private lastHumanInputAt = 0;
  private agentActing = false;

  constructor(
    readonly id: string,
    readonly threadId: ThreadId,
    readonly view: WebContentsView,
    readonly downloadDir: string | null,
  ) {
    const webContents = view.webContents;
    this.cdp = new CdpSession(webContents);
    watchDialogs(this.cdp, (notice) => this.addNotice(notice));
    this.buffers = new PageBuffers(this.cdp);
    this.cdp.on((method, params, sessionId) => {
      const mainFrameCommit =
        method === "Page.frameNavigated" && sessionId === undefined && !params.frame.parentId;
      if (mainFrameCommit || method === "Glade.detached") this.refs.invalidate();
    });
    // CDP input arrives through the same pipeline, so only input outside agent operations counts.
    webContents.on("input-event", (_event, input) => {
      if (!this.agentActing && HUMAN_INPUT_TYPES.has(input.type))
        this.lastHumanInputAt = Date.now();
    });
  }

  get webContents() {
    return this.view.webContents;
  }

  page() {
    return { tabId: this.id, url: this.webContents.getURL(), title: this.webContents.getTitle() };
  }

  addNotice(text: string): void {
    this.notices.push(text);
    if (this.notices.length > MAX_NOTICES) this.notices.shift();
  }

  result(text: string): BrowserTextResult {
    const notices = this.notices;
    this.notices = [];
    return { page: this.page(), text, notices };
  }

  // Runs one tool operation on this tab: serialized, attached, and after a short pause for a human
  // who is using the tab.
  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.cdp.exclusive(async () => {
      await this.cdp.ensureAttached();
      await this.waitForHumanQuiet();
      this.agentActing = true;
      try {
        return await operation();
      } finally {
        this.agentActing = false;
      }
    });
  }

  destroy(): void {
    this.cdp.detach();
    if (!this.webContents.isDestroyed()) this.webContents.close();
  }

  private async waitForHumanQuiet(): Promise<void> {
    const started = Date.now();
    while (Date.now() - this.lastHumanInputAt < HUMAN_QUIET_MS) {
      if (Date.now() - started >= HUMAN_MAX_WAIT_MS) {
        this.addNotice("The user is interacting with this tab; acted anyway.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
