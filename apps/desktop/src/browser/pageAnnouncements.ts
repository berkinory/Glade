import type { CdpSession } from "./cdp/cdpSession";

const WORLD = "glade-announce";
const BINDING = "__gladeAnnounce";
const MAX_KEPT = 20;

// Runs in an isolated world of every same-process frame, so page scripts can neither see nor
// change it. Watches live regions (role status, alert or log, aria-live polite or assertive) and
// toast-like elements (by class or id) and reports their visible text when it appears or changes,
// and when it goes away. Text that is hidden, aria-hidden or too long to be a message is ignored.
const WATCH = `(() => {
  const send = globalThis.${BINDING};
  if (typeof send !== "function" || globalThis.__gladeAnnouncing) return;
  globalThis.__gladeAnnouncing = true;
  const LIVE = "[role=status],[role=alert],[role=log],[aria-live=polite],[aria-live=assertive]";
  const TOAST = /toast|snackbar|notification|flash|alert/i;
  const doc = Math.random().toString(36).slice(2);
  let next = 1;
  const shown = new Map();
  const pending = new Set();
  let timer = 0;
  const toastLike = (el) => TOAST.test(el.getAttribute("class") || "") || TOAST.test(el.id || "");
  const watched = (el) => el.matches(LIVE) || toastLike(el);
  const textOf = (el) => {
    if (!el.isConnected || el.closest("[aria-hidden=true]")) return "";
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return "";
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return "";
    const text = (el.innerText || "").replace(/\\s+/g, " ").trim();
    return text.length > 500 ? "" : text;
  };
  const report = (message) => { try { send(JSON.stringify(message)); } catch {} };
  const flush = () => {
    timer = 0;
    for (const el of pending) {
      const text = textOf(el);
      const before = shown.get(el);
      if (text === (before ? before.text : "")) continue;
      if (before) { shown.delete(el); report({ gone: before.id }); }
      if (text) {
        const id = doc + ":" + next++;
        shown.set(el, { id, text });
        report({ id, text });
      }
    }
    pending.clear();
    for (const [el, info] of shown) {
      if (!el.isConnected) { shown.delete(el); report({ gone: info.id }); }
    }
  };
  const consider = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return;
    const region = el.closest(LIVE);
    if (region && region.getAttribute("aria-live") !== "off") pending.add(region);
    for (let up = el; up; up = up.parentElement) if (toastLike(up)) { pending.add(up); break; }
  };
  new MutationObserver((records) => {
    for (const record of records) {
      consider(record.target);
      const added = record.type === "attributes" ? [record.target] : record.addedNodes;
      for (const node of added) {
        if (node.nodeType !== 1) continue;
        if (watched(node)) pending.add(node);
        for (const inner of node.querySelectorAll(LIVE)) pending.add(inner);
      }
    }
    if (!timer && (pending.size > 0 || shown.size > 0)) timer = setTimeout(flush, 50);
  }).observe(document, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden", "open"],
  });
})()`;

interface Announcement {
  readonly key: string;
  readonly text: string;
  readonly at: number;
  goneAt: number | null;
  reported: boolean;
}

const normalized = (text: string) => text.replace(/\s+/gu, " ").trim().toLowerCase();
const clock = (at: number) => new Date(at).toTimeString().slice(0, 8);
const when = (item: Announcement) =>
  item.goneAt === null ? `seen at ${clock(item.at)}` : `seen at ${clock(item.at)}, now gone`;

// Short-lived page messages (toasts, status lines) a tab showed, so a result can report one that
// came and went between two calls. Text comes from the page and is only ever page content.
export class PageAnnouncements {
  private readonly items: Announcement[] = [];

  constructor(cdp: CdpSession) {
    cdp.onAttach(async () => {
      await cdp.send("Runtime.addBinding", { name: BINDING, executionContextName: WORLD });
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: WATCH,
        worldName: WORLD,
        runImmediately: true,
      });
    });
    cdp.on((method, params) => {
      if (method === "Runtime.bindingCalled" && params.name === BINDING)
        this.receive(params.payload);
    });
  }

  // Messages the agent has not been shown yet, one line each, or "" when there are none.
  drain(): string {
    const fresh = this.items.filter((item) => !item.reported);
    for (const item of fresh) item.reported = true;
    return fresh
      .map((item) => `Announced: ${JSON.stringify(item.text)} (${when(item)})`)
      .join("\n");
  }

  // The latest message shown since `since` whose text contains `needle`, gone or not.
  seen(needle: string, since: number): { readonly text: string; readonly when: string } | null {
    const target = normalized(needle);
    const item = this.items.findLast(
      (candidate) => candidate.at >= since && normalized(candidate.text).includes(target),
    );
    if (!item) return null;
    item.reported = true;
    return { text: item.text, when: when(item) };
  }

  private receive(payload: string): void {
    let message: { id?: unknown; text?: unknown; gone?: unknown };
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof message.gone === "string") {
      const item = this.items.find((candidate) => candidate.key === message.gone);
      if (item && item.goneAt === null) item.goneAt = Date.now();
      return;
    }
    if (typeof message.id !== "string" || typeof message.text !== "string") return;
    this.items.push({
      key: message.id,
      text: message.text.slice(0, 300),
      at: Date.now(),
      goneAt: null,
      reported: false,
    });
    if (this.items.length > MAX_KEPT) this.items.shift();
  }
}
