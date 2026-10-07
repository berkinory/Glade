import type { WebContents } from "electron";
import * as FS from "node:fs";
import { downloadTarget } from "./browserDownloads";
import { withTimeout } from "./browserFailure";
import type { CdpSession } from "./cdp/cdpSession";

const BINDING = "__gladePrint";
const PRINT_TIMEOUT_MS = 15_000;

// Electron has no hook for a page's window.print(): it opens Chromium's print dialog, which blocks
// the renderer (and every CDP call into it) until someone answers. Each frame's print is replaced
// at document start by one that fires beforeprint and afterprint around a call to a CDP binding,
// so the page continues at once and the host decides what printing means. The binding is taken off
// the global before page scripts run.
const WRAP_PRINT = `(() => {
  const send = globalThis.${BINDING};
  if (typeof send !== "function") return;
  try { delete globalThis.${BINDING}; } catch {}
  const print = function print() {
    window.dispatchEvent(new Event("beforeprint"));
    send("");
    window.dispatchEvent(new Event("afterprint"));
  };
  Object.defineProperty(window, "print", { value: print, writable: true, configurable: true, enumerable: true });
})()`;

const pdfName = (title: string) =>
  `${title.trim().slice(0, 80) || "page"}.pdf`.replace(/[\u0000-\u001f<>:"/\\|?*]/gu, "_");

// Prints a page asks for. One the user asked for in the panel opens the normal print dialog; any
// other is saved as a PDF in the workspace downloads folder and reported in the tab's notices.
export class PagePrints {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly webContents: WebContents,
    cdp: CdpSession,
    private readonly options: {
      readonly downloadDir: string | null;
      readonly audience: () => "user" | "agent";
      readonly notify: (text: string) => void;
    },
  ) {
    cdp.onAttach(async () => {
      await cdp.send("Runtime.addBinding", { name: BINDING });
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: WRAP_PRINT,
        runImmediately: true,
      });
    });
    cdp.on((method, params) => {
      if (method === "Runtime.bindingCalled" && params.name === BINDING) this.print();
    });
  }

  busy(): boolean {
    return this.pending.size > 0;
  }

  // Waits up to `capMs` for prints in progress, so a quick one lands in the action's result.
  async settle(capMs: number): Promise<void> {
    if (this.pending.size === 0) return;
    await withTimeout(Promise.all(this.pending), capMs, "Print").catch(() => undefined);
  }

  private print(): void {
    if (this.options.audience() === "user") {
      this.webContents.print({ silent: false }, () => undefined);
      return;
    }
    const job = this.saveAsPdf().finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  private async saveAsPdf(): Promise<void> {
    const { downloadDir, notify } = this.options;
    if (!downloadDir) {
      notify(
        "The page asked to print; nothing was saved because this thread has no workspace folder.",
      );
      return;
    }
    let target: string | null = null;
    try {
      target = downloadTarget(downloadDir, pdfName(this.webContents.getTitle()));
      const data = await withTimeout(
        this.webContents.printToPDF({ printBackground: true }),
        PRINT_TIMEOUT_MS,
        "Print",
      );
      await FS.promises.writeFile(target, data);
      notify(`Printed to PDF: ${target}`);
    } catch (error) {
      if (target) FS.rmSync(target, { force: true });
      notify(
        `The page asked to print; saving a PDF failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
