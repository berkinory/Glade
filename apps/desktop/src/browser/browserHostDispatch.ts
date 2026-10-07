import {
  BROWSER_HOST_METHODS,
  type BrowserHostMethod,
  type BrowserHostParams,
  type BrowserHostResult,
} from "@glade/contracts/browser/browserHost";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Option, Schema } from "effect";
import { BrowserFailure } from "./browserFailure";
import { navigate, settleAfterAction } from "./browserNavigation";
import type { BrowserTab } from "./browserTab";
import type { BrowserTabs } from "./browserTabs";
import { click, hover, press, scroll, selectOptions, typeText } from "./cdp/actions";
import { armDialogAnswer } from "./cdp/dialogs";
import { uploadFiles } from "./cdp/fileChooser";
import { readPageText } from "./cdp/pageText";
import { captureScreenshot } from "./cdp/screenshot";
import { findElements, takeSnapshot } from "./cdp/snapshot";

type Handlers = {
  readonly [M in BrowserHostMethod]: (params: BrowserHostParams<M>) => Promise<BrowserHostResult>;
};

export function createBrowserHostDispatch(
  tabs: BrowserTabs,
  gladePorts: () => ReadonlySet<number>,
): (method: string, params: unknown) => Promise<BrowserHostResult> {
  const text = async (tab: BrowserTab, operation: () => Promise<string>) =>
    tab.result(await tab.run(operation));
  const withSettle = (tab: BrowserTab, operation: () => Promise<string>) => async () => {
    const message = await operation();
    await settleAfterAction(tab);
    return message;
  };
  const tabFor = (params: { readonly threadId: ThreadId; readonly tabId?: string | undefined }) =>
    tabs.resolve(params.threadId, params.tabId);

  const handlers: Handlers = {
    "browser.tabs": async (params) => {
      if (params.action === "open") {
        const tab = await tabs.open(params.threadId, params.workspaceDir);
        if (!params.url) return tab.result(`Opened ${tab.id}.`);
        return text(tab, () => navigate(tab, params, gladePorts()));
      }
      if (params.action === "close") tabs.close(params.threadId, params.tabId);
      if (params.action === "select") {
        if (!params.tabId) throw new BrowserFailure("invalid_input", "select needs tabId.");
        tabs.select(params.threadId, params.tabId);
      }
      const active = tabs.activeId(params.threadId);
      const lines = tabs.list(params.threadId).map((tab) => {
        const page = tab.page();
        return `${tab.id === active ? "*" : " "} ${tab.id} ${JSON.stringify(page.title)} ${page.url}`;
      });
      const listing = lines.length > 0 ? lines.join("\n") : "No tabs.";
      return active
        ? tabs.resolve(params.threadId, active).result(listing)
        : { page: null, text: listing, notices: [] };
    },
    "browser.navigate": async (params) => {
      const tab =
        params.tabId === undefined && tabs.activeId(params.threadId) === undefined
          ? await tabs.open(params.threadId, params.workspaceDir)
          : tabFor(params);
      return text(tab, () => navigate(tab, params, gladePorts()));
    },
    "browser.snapshot": async (params) => {
      const tab = tabFor(params);
      return text(tab, () => takeSnapshot(tab.cdp, tab.refs, params));
    },
    "browser.find": async (params) => {
      const tab = tabFor(params);
      return text(tab, () => findElements(tab.cdp, tab.refs, params));
    },
    "browser.getText": async (params) => {
      const tab = tabFor(params);
      return text(tab, () => readPageText(tab.cdp, params.maxChars));
    },
    "browser.click": async (params) => {
      const tab = tabFor(params);
      return text(
        tab,
        withSettle(tab, () => click(tab.cdp, tab.refs, params)),
      );
    },
    "browser.hover": async (params) => {
      const tab = tabFor(params);
      return text(tab, () => hover(tab.cdp, tab.refs, params.ref));
    },
    "browser.type": async (params) => {
      const tab = tabFor(params);
      const type = () => typeText(tab.cdp, tab.refs, params);
      return text(tab, params.submit ? withSettle(tab, type) : type);
    },
    "browser.press": async (params) => {
      const tab = tabFor(params);
      return text(
        tab,
        withSettle(tab, () => press(tab.cdp, params)),
      );
    },
    "browser.select": async (params) => {
      const tab = tabFor(params);
      return text(tab, () => selectOptions(tab.cdp, tab.refs, params));
    },
    "browser.scroll": async (params) => {
      const tab = tabFor(params);
      return text(tab, () => scroll(tab.cdp, tab.refs, params));
    },
    "browser.screenshot": async (params) => {
      const tab = tabFor(params);
      const image = await tab.run(() =>
        captureScreenshot(tab.cdp, tab.refs, tab.webContents, params),
      );
      const { notices } = tab.result("");
      return { page: tab.page(), image: { ...image, mimeType: "image/jpeg" }, notices };
    },
    "browser.dialog": async (params) => {
      const tab = tabFor(params);
      return text(tab, () => armDialogAnswer(tab.cdp, params.accept, params.text));
    },
    "browser.upload": async (params) => {
      const tab = tabFor(params);
      return text(tab, () => uploadFiles(tab.cdp, tab.refs, params));
    },
    "browser.console": async (params) => {
      const tab = tabFor(params);
      return text(tab, async () => tab.buffers.readConsole(params));
    },
    "browser.network": async (params) => {
      const tab = tabFor(params);
      return text(tab, () => tab.buffers.readNetwork(params));
    },
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
