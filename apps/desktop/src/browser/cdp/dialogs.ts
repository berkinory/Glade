import type { CdpSession } from "./cdpSession";

// Browser views run with `disableDialogs`: for a view without a window Electron would otherwise
// show a blocking native modal that freezes the main process. Chromium still reports each dialog
// over CDP before Electron dismisses it, so the model learns what the page asked.
export function watchDialogs(cdp: CdpSession, report: (notice: string) => void): void {
  cdp.on((method, params) => {
    if (method !== "Page.javascriptDialogOpening") return;
    const message = JSON.stringify(String(params.message).slice(0, 500));
    report(
      params.type === "beforeunload"
        ? "The page asked to confirm leaving; it was allowed to leave."
        : `The page showed a ${params.type} dialog ${message}; it was dismissed. To accept it, call browser_dialog first and repeat the action.`,
    );
  });
}

// One-shot answer for the next alert/confirm/prompt in the main frame. Dismissing is the default,
// so dismiss only clears an earlier answer. The override restores the originals once used, and a
// navigation discards it with the document.
const ARM = `(accept, text) => {
  const key = Symbol.for("glade.dialogAnswer");
  const saved = window[key] ?? { alert: window.alert, confirm: window.confirm, prompt: window.prompt };
  const restore = () => { Object.assign(window, saved); delete window[key]; };
  restore();
  if (!accept) return;
  window[key] = saved;
  window.alert = () => { restore(); };
  window.confirm = () => { restore(); return true; };
  window.prompt = (_message, defaultValue) => { restore(); return text ?? defaultValue ?? ""; };
}`;

export async function armDialogAnswer(
  cdp: CdpSession,
  accept: boolean,
  text: string | undefined,
): Promise<string> {
  await cdp.send("Runtime.evaluate", {
    expression: `(${ARM})(${JSON.stringify(accept)}, ${JSON.stringify(text ?? null)})`,
  });
  return accept
    ? `The next dialog on this page will be accepted${text === undefined ? "" : ` with ${JSON.stringify(text)}`}. Now repeat the action that opens it.`
    : "Dialogs on this page will be dismissed.";
}
