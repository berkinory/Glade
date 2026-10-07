import type { BrowserPickedElement, BrowserPickTheme } from "@glade/contracts/browser/browserView";
import type { BrowserTab } from "../browserTab";
import type { CdpSession } from "./cdpSession";
import { readPickDetails } from "./pickDetails";
import { readPickTarget } from "./pickLabel";
import { PickOverlay, type OverlayBox } from "./pickOverlay";
import { captureZoom } from "./screenshot";

// Chromium's own highlight stays invisible; Glade's overlay draws the hovered element instead.
const CLEAR = { r: 0, g: 0, b: 0, a: 0 };
const HIGHLIGHT = { showInfo: false, contentColor: CLEAR, borderColor: CLEAR };

// Chromium's own inspect mode highlights what the user hovers and reports the clicked node, so no
// page script is injected. Out-of-process iframes run their own inspector and are not pickable.
function waitForPick(tab: BrowserTab, signal: AbortSignal): Promise<number | null> {
  return new Promise((resolve) => {
    const onEscape = (event: Electron.Event, input: Electron.Input) => {
      if (input.type !== "keyDown" || input.key !== "Escape") return;
      event.preventDefault();
      finish(null);
    };
    const stopListening = tab.cdp.on((method, params, sessionId) => {
      if (method === "Overlay.inspectNodeRequested" && sessionId === undefined) {
        finish(typeof params.backendNodeId === "number" ? params.backendNodeId : null);
      }
      if (method === "Glade.detached") finish(null);
    });
    const onAbort = () => finish(null);
    function finish(backendNodeId: number | null) {
      stopListening();
      signal.removeEventListener("abort", onAbort);
      tab.webContents.off("before-input-event", onEscape);
      resolve(backendNodeId);
    }
    signal.addEventListener("abort", onAbort);
    tab.webContents.on("before-input-event", onEscape);
    if (signal.aborted) finish(null);
  });
}

async function nodeBox(cdp: CdpSession, node: { nodeId?: number; backendNodeId?: number }) {
  const { model } = await cdp.send<{ model: { border: readonly number[] } }>(
    "DOM.getBoxModel",
    node,
  );
  const xs = [model.border[0]!, model.border[2]!, model.border[4]!, model.border[6]!];
  const ys = [model.border[1]!, model.border[3]!, model.border[5]!, model.border[7]!];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y } satisfies OverlayBox;
}

// Follows Chromium's hover target with the overlay; stale answers for an earlier node are dropped.
function trackHover(tab: BrowserTab, overlay: PickOverlay): () => void {
  let latest = 0;
  const stopListening = tab.cdp.on((method, params, sessionId) => {
    if (method !== "Overlay.nodeHighlightRequested" || sessionId !== undefined) return;
    const nodeId = Number(params.nodeId);
    const request = ++latest;
    void Promise.all([nodeBox(tab.cdp, { nodeId }), readPickTarget(tab.cdp, { nodeId })])
      .then(([box, target]) => (request === latest ? overlay.show(box, target.label) : undefined))
      .catch(() => (request === latest ? overlay.hide() : undefined));
  });
  // Answers still in flight must not show the overlay again once the pick ends.
  return () => {
    stopListening();
    latest = -1;
  };
}

async function describePicked(
  tab: BrowserTab,
  backendNodeId: number,
  isolatedWorld: number | null,
) {
  const { role, name, label } = await readPickTarget(tab.cdp, { backendNodeId });
  const ref = tab.refs.refFor({ backendNodeId, sessionId: undefined }, { role, name });
  const details = await readPickDetails(tab.cdp, backendNodeId, isolatedWorld, name).catch(
    () => null,
  );
  const screenshot = await captureZoom(tab.cdp, tab.refs, tab.webContents, null, { ref })
    .then(({ data }) => ({ data, mimeType: "image/jpeg" as const }))
    .catch(() => null);
  return { ref, role, name, label, details, screenshot };
}

// Resolves with the clicked element as a ref in the tab's agent ref table, or null when the pick
// is aborted, Escape is pressed in the page, or the debugger goes away.
export async function pickElement(
  tab: BrowserTab,
  theme: BrowserPickTheme,
  signal: AbortSignal,
): Promise<BrowserPickedElement | null> {
  const { cdp } = tab;
  await cdp.ensureAttached();
  await cdp.send("DOM.enable");
  await cdp.send("DOM.getDocument", { depth: 0 });
  await cdp.send("Overlay.enable");
  const overlay = await PickOverlay.install(cdp, theme);
  const stopHover = trackHover(tab, overlay);
  // Also ends the wait when entering inspect mode fails, so no listener outlives this call.
  const waiting = new AbortController();
  const forwardAbort = () => waiting.abort();
  signal.addEventListener("abort", forwardAbort);
  if (signal.aborted) waiting.abort();
  const picked = waitForPick(tab, waiting.signal);
  let backendNodeId: number | null = null;
  const stopPicking = tab.startPicking();
  try {
    await cdp.send("Overlay.setInspectMode", { mode: "searchForNode", highlightConfig: HIGHLIGHT });
    backendNodeId = await picked;
  } finally {
    stopHover();
    stopPicking();
    waiting.abort();
    signal.removeEventListener("abort", forwardAbort);
    // Leaves inspect mode and hides the overlay before the element screenshot so neither is captured.
    await cdp.send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} }).catch(() => {});
    if (backendNodeId === null) await overlay.remove();
    else await overlay.hide();
    await cdp.send("Overlay.disable").catch(() => {});
    await cdp.send("DOM.disable").catch(() => {});
  }
  if (backendNodeId === null) return null;
  const id = backendNodeId;
  const element = await cdp
    .exclusive(() => describePicked(tab, id, overlay.world()))
    .catch((error: unknown) => {
      void overlay.remove();
      throw error;
    });
  void nodeBox(cdp, { backendNodeId: id })
    .catch(() => null)
    .then((box) => overlay.confirm(box));
  const page = tab.page();
  return { tabId: tab.id, url: page.url, title: page.title, ...element };
}
