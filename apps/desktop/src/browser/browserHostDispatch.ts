import {
  BROWSER_HOST_METHODS,
  type BrowserHostMethod,
  type BrowserHostParams,
  type BrowserHostResult,
} from "@glade/contracts/browser/browserHost";
import type { BrowserNavigateInput } from "@glade/contracts/browser/browserTools";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Option, Schema } from "effect";
import type { BrowserPageDialog } from "@glade/contracts/browser/browserHost";
import { actAndSettle, type ActionOutcome, type SettleOptions } from "./actionSettle";
import { BrowserFailure } from "./browserFailure";
import { navigate } from "./browserNavigation";
import type { BrowserTab } from "./browserTab";
import type { BrowserTabs } from "./browserTabs";
import { click, drag, hover, press } from "./cdp/actions";
import type { PageRead } from "./cdp/buffers";
import { visibleChallenge } from "./cdp/challenge";
import { withOptionCommit } from "./cdp/combobox";
import { uploadFiles } from "./cdp/fileChooser";
import { fillFields, selectOptions, typeText } from "./cdp/forms";
import { readPageText } from "./cdp/pageText";
import { scroll } from "./cdp/scrolling";
import { captureScreenshot } from "./cdp/screenshot";
import { findElements, takeSnapshot } from "./cdp/snapshot/snapshot";
import { DialogInterrupt } from "./pageDialogs";
import { waitForConditions } from "./pageWait";

// Each stays below the server's timeout for the same call: navigation waits up to 30 s for the
// load, and actions up to 5 s for a navigation they start plus the DOM settling.
const NAVIGATION_TIMEOUT_MS = 35_000;
const ACTION_TIMEOUT_MS = 17_000;
const FILL_TIMEOUT_MS = 28_000;
// An upload's own requests may take this long before the result is read.
const UPLOAD_REQUESTS_CAP_MS = 5_000;
// Tools that keep working while a page dialog waits for an answer: they do not touch the page.
const DIALOG_SAFE_METHODS = new Set<BrowserHostMethod>([
  "browser.tabs",
  "browser.navigate",
  "browser.dialog",
  "browser.console",
  "browser.network",
  "browser.closeThread",
]);

type Handlers = {
  readonly [M in BrowserHostMethod]: (params: BrowserHostParams<M>) => Promise<BrowserHostResult>;
};
type Actor = "user" | undefined;

const article = (type: BrowserPageDialog["type"]) => (type === "alert" ? "An" : "A");
const quoted = (text: string) =>
  JSON.stringify(text.length > 200 ? `${text.slice(0, 199)}…` : text);

function dialogBlock(dialog: BrowserPageDialog): BrowserFailure {
  return new BrowserFailure(
    "dialog_open",
    dialog.audience === "user"
      ? `The user has ${article(dialog.type).toLowerCase()} ${dialog.type} dialog open on this tab; wait for them to answer it, or use another tab.`
      : `${article(dialog.type)} ${dialog.type} dialog is open on this tab: ${quoted(dialog.message)}. Answer it with browser_dialog (accept true or false) before using this tab.`,
  );
}

// Records a visible security check on the tab (which shows the user a notice in the panel) and
// tells the model to hand over instead of touching it.
async function challengeLine(tab: BrowserTab): Promise<string> {
  const vendor = await visibleChallenge(tab.cdp).catch(() => null);
  tab.noteChallenge(vendor);
  return vendor
    ? `Challenge: a ${vendor} security check is on screen. Do not try to solve or get around it; ask the user to complete it in the browser panel, then continue (browser_wait can wait for the page behind it).`
    : "";
}

const joined = (...parts: string[]) => parts.filter(Boolean).join("\n");

export function createBrowserHostDispatch(
  tabs: BrowserTabs,
  gladePorts: () => ReadonlySet<number>,
): (method: string, params: unknown) => Promise<BrowserHostResult> {
  // Panel calls answer without draining the notices the agent has not seen yet.
  const reply = (
    tab: BrowserTab,
    message: string,
    actor: Actor,
    content?: string,
  ): BrowserHostResult =>
    actor === "user"
      ? { page: tab.page(), text: message, notices: [] }
      : tab.result(message, content);
  const run = <T>(tab: BrowserTab, operation: () => Promise<T>, actor: Actor, timeoutMs?: number) =>
    tab.run(operation, { byUser: actor === "user", timeoutMs }).catch((error: unknown) => {
      if (error instanceof DialogInterrupt) throw dialogBlock(error.dialog);
      throw error;
    });
  // Page-derived output goes in `content`, which the gateway marks as untrusted.
  const read = async (tab: BrowserTab, operation: () => Promise<PageRead>, actor?: Actor) => {
    const { content, note } = await run(tab, operation, actor);
    return reply(tab, note, actor, content);
  };
  const readText = (tab: BrowserTab, operation: () => Promise<string>) =>
    read(tab, async () => ({ content: await operation(), note: "" }));
  const text = async (
    tab: BrowserTab,
    operation: () => Promise<string>,
    actor?: Actor,
    timeoutMs?: number,
  ) => reply(tab, await run(tab, operation, actor, timeoutMs), actor);
  // Input actions wait for what they cause; one that opens a dialog reports it as its outcome.
  const act = async (
    tab: BrowserTab,
    operation: () => Promise<string | ActionOutcome>,
    actor?: Actor,
    timeoutMs = ACTION_TIMEOUT_MS,
    settle?: SettleOptions,
  ): Promise<BrowserHostResult> => {
    if (actor !== "user") tab.assertNotPicking();
    try {
      const report = await tab.run(
        async () => {
          const settled = await actAndSettle(tab, operation, settle);
          return { ...settled, text: joined(settled.text, await challengeLine(tab)) };
        },
        { byUser: actor === "user", timeoutMs },
      );
      return reply(tab, report.text, actor, report.content);
    } catch (error) {
      if (!(error instanceof DialogInterrupt)) throw error;
      const { dialog } = error;
      return reply(
        tab,
        `The action opened ${article(dialog.type).toLowerCase()} ${dialog.type} dialog; the page is paused until browser_dialog answers it.`,
        actor,
        dialog.message,
      );
    }
  };
  const navigated = (
    tab: BrowserTab,
    params: typeof BrowserNavigateInput.Type & { readonly actor?: Actor },
  ) => text(tab, () => navigate(tab, params, gladePorts()), params.actor, NAVIGATION_TIMEOUT_MS);
  const tabFor = (
    method: BrowserHostMethod,
    params: {
      readonly threadId: ThreadId;
      readonly tabId?: string | undefined;
      readonly actor?: Actor;
    },
  ) => {
    const tab = tabs.resolve(params.threadId, params.tabId);
    const dialog = tab.dialogs.current();
    if (dialog && params.actor !== "user") {
      const userOwned = dialog.audience === "user";
      if (!DIALOG_SAFE_METHODS.has(method) || (userOwned && method !== "browser.tabs")) {
        throw dialogBlock(dialog);
      }
    }
    return tab;
  };

  const handlers: Handlers = {
    "browser.tabs": async (params) => {
      if (params.action === "open") {
        const tab = await tabs.open(params.threadId, params.workspaceDir);
        if (!params.url) return reply(tab, `Opened ${tab.id}.`, params.actor);
        return navigated(tab, params);
      }
      if (params.action === "close") tabs.close(params.threadId, params.tabId);
      if (params.action === "select") {
        if (!params.tabId) throw new BrowserFailure("invalid_input", "select needs tabId.");
        tabs.select(params.threadId, params.tabId);
      }
      const active = tabs.activeId(params.threadId);
      const lines = tabs.list(params.threadId).map((tab) => {
        const page = tab.page();
        const dialog = tab.dialogs.current() ? " (dialog open)" : "";
        return `${tab.id === active ? "*" : " "} ${tab.id} ${JSON.stringify(page.title)} ${page.url}${dialog}`;
      });
      if (lines.length === 0) return { page: null, text: "No tabs.", notices: [] };
      // Titles come from the pages, so the listing is page content.
      return reply(tabs.resolve(params.threadId, active), "", params.actor, lines.join("\n"));
    },
    "browser.navigate": async (params) => {
      const tab =
        params.tabId === undefined && tabs.activeId(params.threadId) === undefined
          ? await tabs.open(params.threadId, params.workspaceDir)
          : tabFor("browser.navigate", params);
      return navigated(tab, params);
    },
    "browser.snapshot": async (params) => {
      const tab = tabFor("browser.snapshot", params);
      return read(tab, async () => {
        const snapshot = await takeSnapshot(tab.cdp, tab.refs, params);
        return { ...snapshot, note: joined(snapshot.note, await challengeLine(tab)) };
      });
    },
    "browser.find": async (params) => {
      const tab = tabFor("browser.find", params);
      return readText(tab, async () => {
        // webContents.isLoading() stays true for a favicon or a beacon; the document is what counts.
        const { result } = await tab.cdp.send<{ result: { value?: string } }>("Runtime.evaluate", {
          expression: "document.readyState",
          returnByValue: true,
        });
        return findElements(tab.cdp, tab.refs, params, result.value !== "complete");
      });
    },
    "browser.getText": async (params) => {
      const tab = tabFor("browser.getText", params);
      return readText(tab, () => readPageText(tab.cdp, tab.refs, params));
    },
    "browser.click": async (params) => {
      const tab = tabFor("browser.click", params);
      return act(
        tab,
        () =>
          withOptionCommit(tab.cdp, tab.refs, params.ref, () =>
            click(tab.cdp, tab.refs, tab.lastScreenshot(), params),
          ),
        params.actor,
      );
    },
    "browser.hover": async (params) => {
      const tab = tabFor("browser.hover", params);
      return act(tab, () => hover(tab.cdp, tab.refs, tab.lastScreenshot(), params), params.actor);
    },
    "browser.drag": async (params) => {
      const tab = tabFor("browser.drag", params);
      return act(tab, () => drag(tab.cdp, tab.refs, tab.lastScreenshot(), params), params.actor);
    },
    "browser.type": async (params) => {
      const tab = tabFor("browser.type", params);
      return act(tab, () => typeText(tab.cdp, tab.refs, params), params.actor);
    },
    "browser.fill": async (params) => {
      const tab = tabFor("browser.fill", params);
      return act(tab, () => fillFields(tab.cdp, tab.refs, params), params.actor, FILL_TIMEOUT_MS);
    },
    "browser.press": async (params) => {
      const tab = tabFor("browser.press", params);
      return act(tab, () => press(tab.cdp, params), params.actor);
    },
    "browser.select": async (params) => {
      const tab = tabFor("browser.select", params);
      return act(tab, () => selectOptions(tab.cdp, tab.refs, params), params.actor);
    },
    "browser.scroll": async (params) => {
      const tab = tabFor("browser.scroll", params);
      return act(tab, () => scroll(tab.cdp, tab.refs, params), params.actor);
    },
    "browser.wait": async (params) => {
      const tab = tabFor("browser.wait", params);
      const { text, content } = await waitForConditions(tab, params);
      // Read passively too: the user may be completing a security check in this tab right now.
      const challenge = await tab.run(() => challengeLine(tab), { passive: true });
      return reply(tab, joined(text, challenge), params.actor, content);
    },
    "browser.screenshot": async (params) => {
      const tab = tabFor("browser.screenshot", params);
      const { frame, ...image } = await run(
        tab,
        () => captureScreenshot(tab.cdp, tab.refs, tab.webContents, params),
        params.actor,
      );
      // Only screenshots the agent saw define its coordinates.
      if (params.actor !== "user") tab.recordScreenshot(frame);
      const { notices } = tab.result("");
      return { page: tab.page(), image: { ...image, mimeType: "image/jpeg" }, notices };
    },
    "browser.dialog": async (params) => {
      const tab = tabFor("browser.dialog", params);
      const actor = params.actor ?? "agent";
      // The panel's OK on a security-check notice only hides it; there is no page dialog.
      if (actor === "user" && !tab.dialogs.current() && tab.challengeNotice()) {
        tab.noteChallenge(null);
        tab.addNotice("The user dismissed the security check notice in the browser panel.");
        return reply(tab, "Dismissed the security check notice.", params.actor);
      }
      const dialog = tab.dialogs.answer(params.accept, actor);
      if (actor === "user" && dialog.audience === "agent") {
        tab.addNotice(
          `The user answered the page's ${dialog.type} dialog with ${params.accept ? "OK" : "Cancel"}.`,
        );
      }
      return reply(
        tab,
        `${params.accept ? "Accepted" : "Dismissed"} the ${dialog.type} dialog.`,
        params.actor,
      );
    },
    "browser.upload": async (params) => {
      const tab = tabFor("browser.upload", params);
      return act(
        tab,
        () => uploadFiles(tab.cdp, tab.refs, params),
        params.actor,
        ACTION_TIMEOUT_MS,
        { requestsCapMs: UPLOAD_REQUESTS_CAP_MS },
      );
    },
    "browser.console": async (params) => {
      const tab = tabFor("browser.console", params);
      return read(tab, async () => tab.buffers.readConsole(params), params.actor);
    },
    "browser.network": async (params) => {
      const tab = tabFor("browser.network", params);
      return read(tab, () => tab.buffers.readNetwork(params), params.actor);
    },
    "browser.closeThread": async (params) => ({
      page: null,
      text: `Closed ${tabs.closeThread(params.threadId)} tabs.`,
      notices: [],
    }),
  };

  return async (method, rawParams) => {
    if (!Object.hasOwn(BROWSER_HOST_METHODS, method)) {
      throw new BrowserFailure("invalid_input", `Unknown browser host method ${method}.`);
    }
    const key = method as BrowserHostMethod;
    const params = Schema.decodeUnknownOption(BROWSER_HOST_METHODS[key])(rawParams);
    if (Option.isNone(params)) {
      throw new BrowserFailure("invalid_input", `Invalid ${method} parameters.`);
    }
    // The handler table is keyed by the same method, so the decoded params match its handler.
    return (handlers[key] as (params: unknown) => Promise<BrowserHostResult>)(params.value);
  };
}
