import type { BrowserPageDialog, BrowserTextResult } from "@glade/contracts/browser/browserHost";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { WebContentsView } from "electron";
import { BrowserFailure } from "./browserFailure";
import { PageBuffers } from "./cdp/buffers";
import { CdpSession } from "./cdp/cdpSession";
import { RefTable } from "./cdp/refs";
import type { ScreenshotFrame } from "./cdp/screenshotFrame";
import { PageDialogs } from "./pageDialogs";

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
// A dialog opening this soon after the user's input in the tab is the user's to answer.
const USER_DIALOG_WINDOW_MS = 2_000;
const MAX_NOTICES = 20;

export class BrowserTab {
  readonly cdp: CdpSession;
  readonly refs = new RefTable();
  readonly buffers: PageBuffers;
  readonly dialogs: PageDialogs;
  private notices: string[] = [];
  private lastHumanInputAt = 0;
  private agentActing = false;
  private picking = false;
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
  ) {
    const webContents = view.webContents;
    this.cdp = new CdpSession(webContents);
    this.buffers = new PageBuffers(this.cdp);
    this.dialogs = new PageDialogs(webContents, {
      audience: () =>
        !this.agentActing && Date.now() - this.lastHumanInputAt < USER_DIALOG_WINDOW_MS
          ? "user"
          : "agent",
      onChange,
    });
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
    const notices = this.notices;
    this.notices = [];
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
  run<T>(
    operation: () => Promise<T>,
    options: { readonly byUser?: boolean; readonly timeoutMs?: number | undefined } = {},
  ): Promise<T> {
    return this.cdp
      .exclusive(async () => {
        await this.cdp.ensureAttached();
        if (!options.byUser) await this.waitForHumanQuiet();
        this.agentActing = !options.byUser;
        const interruption = this.dialogs.interruption();
        // Once a dialog wins the race, the abandoned operation may still fail later.
        const work = operation();
        work.catch(() => undefined);
        try {
          return await Promise.race([work, interruption.promise]);
        } finally {
          interruption.release();
        }
      }, options.timeoutMs)
      .finally(() => {
        this.agentActing = false;
      });
  }

  destroy(): void {
    this.cdp.detach();
    if (!this.webContents.isDestroyed()) this.webContents.close();
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
