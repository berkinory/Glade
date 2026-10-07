import type { BrowserPickedElement } from "@glade/contracts/browser/browserView";
import type { BrowserTab } from "../browserTab";
import { captureScreenshot } from "./screenshot";

const HIGHLIGHT = {
  showInfo: true,
  showAccessibilityInfo: true,
  contentColor: { r: 59, g: 130, b: 246, a: 0.25 },
  borderColor: { r: 59, g: 130, b: 246, a: 0.9 },
};

interface AxNode {
  readonly ignored?: boolean;
  readonly role?: { readonly value?: unknown };
  readonly name?: { readonly value?: unknown };
}

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

async function describePicked(tab: BrowserTab, backendNodeId: number) {
  const { nodes } = await tab.cdp.send<{ nodes: readonly AxNode[] }>(
    "Accessibility.getPartialAXTree",
    { backendNodeId, fetchRelatives: false },
  );
  const node = nodes.find((candidate) => !candidate.ignored) ?? nodes[0];
  const role = String(node?.role?.value ?? "") || "generic";
  const name = String(node?.name?.value ?? "");
  const ref = tab.refs.refFor({ backendNodeId, sessionId: undefined }, { role, name });
  const screenshot = await captureScreenshot(tab.cdp, tab.refs, tab.webContents, { ref })
    .then(({ data }) => ({ data, mimeType: "image/jpeg" as const }))
    .catch(() => null);
  return { ref, role, name, screenshot };
}

// Resolves with the clicked element as a ref in the tab's agent ref table, or null when the pick
// is aborted, Escape is pressed in the page, or the debugger goes away.
export async function pickElement(
  tab: BrowserTab,
  signal: AbortSignal,
): Promise<BrowserPickedElement | null> {
  const { cdp } = tab;
  await cdp.ensureAttached();
  await cdp.send("DOM.enable");
  await cdp.send("Overlay.enable");
  // Also ends the wait when entering inspect mode fails, so no listener outlives this call.
  const waiting = new AbortController();
  const forwardAbort = () => waiting.abort();
  signal.addEventListener("abort", forwardAbort);
  if (signal.aborted) waiting.abort();
  const picked = waitForPick(tab, waiting.signal);
  let backendNodeId: number | null = null;
  try {
    await cdp.send("Overlay.setInspectMode", { mode: "searchForNode", highlightConfig: HIGHLIGHT });
    backendNodeId = await picked;
  } finally {
    waiting.abort();
    signal.removeEventListener("abort", forwardAbort);
    // Leaves inspect mode before the element screenshot so the highlight is not captured.
    await cdp.send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} }).catch(() => {});
    await cdp.send("Overlay.disable").catch(() => {});
    await cdp.send("DOM.disable").catch(() => {});
  }
  if (backendNodeId === null) return null;
  const id = backendNodeId;
  const element = await cdp.exclusive(() => describePicked(tab, id));
  const page = tab.page();
  return { tabId: tab.id, url: page.url, ...element };
}
