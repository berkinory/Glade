import type { BrowserPageDialog } from "@glade/contracts/browser/browserHost";
import type { WebContents } from "electron";
import { BrowserFailure } from "./browserFailure";

interface RunDialogInfo {
  readonly dialogType: "alert" | "confirm" | "prompt";
  readonly messageText: string;
}
type DialogCallback = (accept: boolean, text: string) => void;

const MAX_MESSAGE_CHARS = 2_000;

// Rejects an operation that was running when a dialog opened. The page is paused until the dialog
// is answered, so CDP calls into it would hang.
export class DialogInterrupt extends Error {
  constructor(readonly dialog: BrowserPageDialog) {
    super("A page dialog opened.");
  }
}

// Holds a page's alert or confirm until the agent or the user answers it.
//
// Electron routes page dialogs through the WebContents' internal `-run-dialog` event, whose
// built-in handler would show a native message box (blocking the whole main process for a view
// without a window) or, with `disableDialogs`, dismiss it at once. Replacing that handler lets
// the dialog wait without blocking anything. If a future Electron renames the event, its own
// handler stays in charge and `disableDialogs` keeps dismissing, the earlier behavior.
export class PageDialogs {
  private pending: { readonly dialog: BrowserPageDialog; readonly answer: DialogCallback } | null =
    null;
  private readonly interrupts = new Set<(error: DialogInterrupt) => void>();

  constructor(
    webContents: WebContents,
    private readonly options: {
      // Who should answer a dialog that opens now.
      readonly audience: () => BrowserPageDialog["audience"];
      readonly onChange: () => void;
    },
  ) {
    // Internal Electron events are not in the typed WebContents API.
    const events = webContents as unknown as NodeJS.EventEmitter;
    events.removeAllListeners("-run-dialog");
    events.on("-run-dialog", (info: RunDialogInfo, callback: DialogCallback) =>
      this.open(info, callback),
    );
    // Chromium cancels open dialogs when the page navigates or closes.
    events.on("-cancel-dialogs", () => this.settle());
  }

  current(): BrowserPageDialog | null {
    return this.pending?.dialog ?? null;
  }

  // Resolves the open dialog. Only the user answers a dialog their own input caused.
  answer(accept: boolean, actor: "user" | "agent"): BrowserPageDialog {
    const pending = this.pending;
    if (!pending) throw new BrowserFailure("invalid_input", "No dialog is open on this tab.");
    if (pending.dialog.audience === "user" && actor !== "user") {
      throw new BrowserFailure(
        "dialog_open",
        "This dialog came from the user's own click in the browser panel; only the user answers it.",
      );
    }
    this.settle();
    pending.answer(accept, "");
    return pending.dialog;
  }

  // A promise that rejects when a dialog opens; `release` stops listening.
  interruption(): { readonly promise: Promise<never>; readonly release: () => void } {
    let reject: (error: DialogInterrupt) => void = () => undefined;
    const promise = new Promise<never>((_, fail) => {
      reject = fail;
    });
    this.interrupts.add(reject);
    return { promise, release: () => this.interrupts.delete(reject) };
  }

  private open(info: RunDialogInfo, callback: DialogCallback): void {
    // Electron's renderer throws on prompt() before it gets here; never leave one hanging.
    if (info.dialogType === "prompt") return callback(false, "");
    // A page cannot open a second dialog while one is open, but a stale one is never kept.
    if (this.pending) this.pending.answer(false, "");
    const dialog: BrowserPageDialog = {
      type: info.dialogType === "alert" ? "alert" : "confirm",
      message: info.messageText.slice(0, MAX_MESSAGE_CHARS),
      audience: this.options.audience(),
    };
    this.pending = { dialog, answer: callback };
    for (const reject of this.interrupts) reject(new DialogInterrupt(dialog));
    this.interrupts.clear();
    this.options.onChange();
  }

  private settle(): void {
    if (!this.pending) return;
    this.pending = null;
    this.options.onChange();
  }
}
