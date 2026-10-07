import { Schema } from "effect";
import { ThreadId } from "../core/baseSchemas";
import {
  BrowserClickInput,
  BrowserConsoleInput,
  BrowserDialogInput,
  BrowserFindInput,
  BrowserGetTextInput,
  BrowserHoverInput,
  BrowserNavigateInput,
  BrowserNetworkInput,
  BrowserPressInput,
  BrowserScreenshotInput,
  BrowserScrollInput,
  BrowserSelectInput,
  BrowserSnapshotInput,
  BrowserTabsInput,
  BrowserTypeInput,
  BrowserUploadInput,
} from "./browserTools";

export const BROWSER_FAILURE_CODES = [
  "unavailable",
  "no_tab",
  "tab_not_found",
  "stale_ref",
  "not_visible",
  "blocked_url",
  "navigation_failed",
  "upload_failed",
  "timeout",
  "invalid_input",
  "workspace_unavailable",
  "path_outside_workspace",
  "evaluate_disabled",
] as const;
export type BrowserFailureCode = (typeof BROWSER_FAILURE_CODES)[number];

// The server supplies the scope from the caller's gateway session; the desktop never trusts a
// thread id from anywhere else. `workspaceDir` is where downloads of tabs created by this call go.
const scoped = <Fields extends Schema.Struct.Fields>(input: Schema.Struct<Fields>) =>
  Schema.Struct({
    ...input.fields,
    threadId: ThreadId,
    workspaceDir: Schema.NullOr(Schema.String),
  });

export const BROWSER_HOST_METHODS = {
  "browser.tabs": scoped(BrowserTabsInput),
  "browser.navigate": scoped(BrowserNavigateInput),
  "browser.snapshot": scoped(BrowserSnapshotInput),
  "browser.find": scoped(BrowserFindInput),
  "browser.getText": scoped(BrowserGetTextInput),
  "browser.click": scoped(BrowserClickInput),
  "browser.hover": scoped(BrowserHoverInput),
  "browser.type": scoped(BrowserTypeInput),
  "browser.press": scoped(BrowserPressInput),
  "browser.select": scoped(BrowserSelectInput),
  "browser.scroll": scoped(BrowserScrollInput),
  "browser.screenshot": scoped(BrowserScreenshotInput),
  "browser.dialog": scoped(BrowserDialogInput),
  // Paths are absolute and already validated against the thread workspace by the server.
  "browser.upload": scoped(BrowserUploadInput),
  "browser.console": scoped(BrowserConsoleInput),
  "browser.network": scoped(BrowserNetworkInput),
} as const;
export type BrowserHostMethod = keyof typeof BROWSER_HOST_METHODS;
export type BrowserHostParams<M extends BrowserHostMethod> =
  (typeof BROWSER_HOST_METHODS)[M]["Type"];

export const BrowserPage = Schema.Struct({
  tabId: Schema.String,
  url: Schema.String,
  title: Schema.String,
});

export const BrowserTextResult = Schema.Struct({
  page: Schema.NullOr(BrowserPage),
  text: Schema.String,
  notices: Schema.Array(Schema.String),
});
export type BrowserTextResult = typeof BrowserTextResult.Type;

export const BrowserImageResult = Schema.Struct({
  page: BrowserPage,
  image: Schema.Struct({
    data: Schema.String,
    mimeType: Schema.Literal("image/jpeg"),
    width: Schema.Number,
    height: Schema.Number,
  }),
  notices: Schema.Array(Schema.String),
});
export type BrowserImageResult = typeof BrowserImageResult.Type;

export const BrowserHostResult = Schema.Union([BrowserImageResult, BrowserTextResult]);
export type BrowserHostResult = typeof BrowserHostResult.Type;

export const BROWSER_TABS_CHANGED_NOTIFICATION = "browser.tabsChanged";
export const BrowserTabState = Schema.Struct({
  tabId: Schema.String,
  threadId: ThreadId,
  url: Schema.String,
  title: Schema.String,
  loading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  active: Schema.Boolean,
});
export const BrowserTabsChanged = Schema.Struct({ tabs: Schema.Array(BrowserTabState) });
export type BrowserTabsChanged = typeof BrowserTabsChanged.Type;
