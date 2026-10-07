import type { BrowserPageDialog, BrowserTextResult } from "@glade/contracts/browser/browserHost";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { WebContentsView } from "electron";
import { BrowserDownloads } from "./browserDownloads";
import { BrowserFailure, withTimeout } from "./browserFailure";
import { PageBuffers } from "./cdp/buffers";
import { CdpSession } from "./cdp/cdpSession";
import { RefTable } from "./cdp/refs";
import type { ScreenshotFrame } from "./cdp/screenshotFrame";
import { PageAnnouncements } from "./pageAnnouncements";
import { PageDialogs } from "./pageDialogs";
import { PagePrints } from "./pagePrints";

export const BROWSER_PARTITION = "persist:glade-browser";
export const BROWSER_WEB_PREFERENCES = {
  partition: BROWSER_PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  // Agent tabs are usually not on screen; throttled timers and paused compositing would stall
  // loads, snapshots and screenshots.
  backgroundThrottling: false,
  // Fallback only: PageDialogs takes over page dialogs. Without it a window-less view would block
  // the main process on a native modal.
  disableDialogs: true,
} as const;

const HUMAN_INPUT_TYPES = new Set(["mouseDown", "mouseWheel", "keyDown", "rawKeyDown", "char"]);
// Agent calls arriving this soon after the user's last input wait until the user pauses this
// long, but never longer than the cap.
const HUMAN_QUIET_MS = 1_500;
const HUMAN_MAX_WAIT_MS = 2_000;
// A dialog or print opening this soon after the user's input in the tab is the user's.
const USER_DIALOG_WINDOW_MS = 2_000;
const MAX_NOTICES = 20;
// A restored tab's first load may take this long before agent calls go ahead anyway.
const RESTORE_LOAD_MS = 5_000;

// What a tab keeps across a suspension: refs keep counting so an old ref never names a new
// element, and the downloads list survives.
export interface CarriedTabState {
  readonly refs: RefTable;
  readonly downloads: BrowserDownloads;
}

export class BrowserTab {
  readonly cdp: CdpSession;
  readonly refs: RefTable;
  readonly downloads: BrowserDownloads;
  readonly buffers: PageBuffers;
  readonly dialogs: PageDialogs;
  readonly prints: PagePrints;
  readonly announcements: PageAnnouncements;
  private notices: string[] = [];
  private shownInPanel = false;
  private agentCallAt = 0;
  private previousAgentCallAt = 0;
  private lastHumanInputAt = 0;
  private agentActing = false;
  // The user is acting through the panel (navigating from its address bar, not page input).
  private userActing = false;
  private picking = false;
  private operations = 0;
  private lastUsedAt = Date.now();
  // A restored tab's reload; operations wait for it (bounded) so they see the page.
  private ready: Promise<unknown> = Promise.resolve();
  // The vendor of a security check the user was asked to complete; cleared by navigation.
  private challenge: string | null = null;
  // Coordinates in click, hover and drag refer to this tab's latest screenshot.
  private screenshot: ScreenshotFrame | null = null;

  constructor(
    readonly id: string,
    readonly threadId: ThreadId,
    readonly view: WebContentsView,
    readonly downloadDir: string | null,
    private readonly onChange: () => void,
    carried?: CarriedTabState,
  ) {
    this.refs = carried?.refs ?? new RefTable();
    this.downloads = carried?.downloads ?? new BrowserDownloads();
    const webContents = view.webContents;
    this.cdp = new CdpSession(webContents);
    this.buffers = new PageBuffers(this.cdp);
    this.dialogs = new PageDialogs(webContents, {
      audience: () => (this.userJustActed() ? "user" : "agent"),
      onChange,
    });
    this.prints = new PagePrints(webContents, this.cdp, {
      downloadDir,
      audience: () => (this.shownInPanel && this.userJustActed() ? "user" : "agent"),
      notify: (text) => this.addNotice(text),
    });
    this.announcements = new PageAnnouncements(this.cdp);
    webContents.on("did-navigate", () => this.noteChallenge(null));
    webContents.on("will-prevent-unload", () =>
      this.addNotice("The page asked to confirm leaving; it was allowed to leave."),
    );
    // Refs die with their frame's document. Same-document updates (Page.navigatedWithinDocument,
    // DOM changes) keep them.
    this.cdp.on((method, params, sessionId) => {
      if (method === "Glade.detached") this.refs.invalidate();
      else if (method === "Target.detachedFromTarget") this.refs.dropSession(params.sessionId);
      else if (method === "Page.frameDetached") this.refs.dropFrame(params.frameId);
      else if (method === "Page.frameNavigated") {
        if (sessionId === undefined && !params.frame.parentId) this.refs.invalidate();
        else this.refs.dropFrame(params.frame.id);
      }
    });
    // CDP input arrives through the same pipeline, so only input outside agent operations counts.
    webContents.on("input-event", (_event, input) => {
      if (!this.agentActing && HUMAN_INPUT_TYPES.has(input.type)) {
        this.lastHumanInputAt = Date.now();
        this.lastUsedAt = this.lastHumanInputAt;
      }
    });
  }

  get webContents() {
    return this.view.webContents;
  }

  page() {
    return { tabId: this.id, url: this.webContents.getURL(), title: this.webContents.getTitle() };
  }

  // Marks the start of an agent tool call on this tab.
  noteAgentCall(): void {
    this.previousAgentCallAt = this.agentCallAt;
    this.agentCallAt = Date.now();
  }

  // When the agent's call before the current one started; 0 before its second call.
  previousAgentCall(): number {
    return this.previousAgentCallAt;
  }

  // Set by the panel's view surface while this tab's view is on screen.
  setShownInPanel(shown: boolean): void {
    this.shownInPanel = shown;
    this.lastUsedAt = Date.now();
  }

  // Loads the page a suspended tab showed into this fresh view.
  restore(url: string): void {
    const loading = this.webContents.loadURL(url || "about:blank");
    this.ready = withTimeout(loading, RESTORE_LOAD_MS, "Reload").catch(() => undefined);
  }

  lastUsed(): number {
    return this.lastUsedAt;
  }

  // Whether destroying the view now would lose nothing the agent or user is in the middle of.
  canSuspend(): boolean {
    return (
      !this.shownInPanel &&
      !this.picking &&
      this.operations === 0 &&
      this.dialogs.current() === null &&
      !this.downloads.inProgress() &&
      !this.prints.busy()
    );
  }

  takeNotices(): string[] {
    const notices = this.notices;
    this.notices = [];
    return notices;
  }

  recordScreenshot(frame: ScreenshotFrame): void {
    this.screenshot = frame;
  }

  lastScreenshot(): ScreenshotFrame | null {
    return this.screenshot;
  }

  noteChallenge(vendor: string | null): void {
    if (vendor === this.challenge) return;
    this.challenge = vendor;
    this.onChange();
  }

  // The panel's notice asking the user to complete a security check the agent must not touch.
  challengeNotice(): BrowserPageDialog | null {
    if (!this.challenge) return null;
    return {
      type: "challenge",
      message: `This page shows a ${this.challenge} security check, which the agent does not solve. Please complete it here; press OK to hide this notice.`,
      audience: "user",
    };
  }

  addNotice(text: string): void {
    this.notices.push(text);
    if (this.notices.length > MAX_NOTICES) this.notices.shift();
  }

  result(text: string, content?: string): BrowserTextResult {
    const notices = this.takeNotices();
    return { page: this.page(), text, ...(content === undefined ? {} : { content }), notices };
  }

  // Marks the tab while the user picks an element in it; agent input waits for the next call.
  startPicking(): () => void {
    this.picking = true;
    return () => {
      this.picking = false;
    };
  }

  assertNotPicking(): void {
    if (this.picking) {
      throw new BrowserFailure(
        "user_picking",
        "The user is picking an element in this tab. Try again once they are done.",
      );
    }
  }

  // Runs one operation on this tab: serialized, attached, for agent calls after a short pause for
  // a human who is using the tab, and cut short by a page dialog (DialogInterrupt).
  // `passive` marks an agent read that repeats while the user may be working in the tab (a wait):
  // it neither waits for them to pause nor counts as agent input.
  run<T>(
    operation: () => Promise<T>,
    options: {
      readonly byUser?: boolean;
      readonly passive?: boolean;
      readonly timeoutMs?: number | undefined;
    } = {},
  ): Promise<T> {
    const agent = !options.byUser && !options.passive;
    this.operations += 1;
    this.lastUsedAt = Date.now();
    return this.ready
      .then(() =>
        this.cdp.exclusive(async () => {
          await this.cdp.ensureAttached();
          if (agent) await this.waitForHumanQuiet();
          this.agentActing = agent;
          this.userActing = options.byUser === true;
          const interruption = this.dialogs.interruption();
          // Once a dialog wins the race, the abandoned operation may still fail later.
          const work = operation();
          work.catch(() => undefined);
          try {
            return await Promise.race([work, interruption.promise]);
          } finally {
            interruption.release();
            this.userActing = false;
          }
        }, options.timeoutMs),
      )
      .finally(() => {
        this.agentActing = false;
        this.operations -= 1;
        this.lastUsedAt = Date.now();
      });
  }

  destroy(): void {
    this.cdp.detach();
    if (!this.webContents.isDestroyed()) this.webContents.close();
  }

  private userJustActed(): boolean {
    if (this.userActing) return true;
    return !this.agentActing && Date.now() - this.lastHumanInputAt < USER_DIALOG_WINDOW_MS;
  }

  private async waitForHumanQuiet(): Promise<void> {
    if (Date.now() - this.lastHumanInputAt >= HUMAN_QUIET_MS) return;
    const started = Date.now();
    while (Date.now() - this.lastHumanInputAt < HUMAN_QUIET_MS) {
      if (Date.now() - started >= HUMAN_MAX_WAIT_MS) {
        this.addNotice("The user is using this tab right now; Glade waited 2 s and then acted.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.addNotice("The user was just using this tab; Glade waited for a pause before acting.");
  }
}
