import { Schema } from "effect";
import { ThreadId } from "../core/baseSchemas";
import {
  BrowserClickInput,
  BrowserConsoleInput,
  BrowserContentBlockerInput,
  BrowserDialogInput,
  BrowserDragInput,
  BrowserFillInput,
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
  BrowserWaitInput,
  BrowserZoomInput,
} from "./browserTools";

export const BROWSER_FAILURE_CODES = [
  "unavailable",
  "no_tab",
  "tab_not_found",
  "stale_ref",
  "not_visible",
  "covered",
  "dialog_open",
  "user_picking",
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
// `actor: "user"` marks a call from the browser panel: it does not wait out human input and leaves
// the notices queued for the agent's next call.
const scoped = <Fields extends Schema.Struct.Fields>(input: Schema.Struct<Fields>) =>
  Schema.Struct({
    ...input.fields,
    threadId: ThreadId,
    workspaceDir: Schema.NullOr(Schema.String),
    actor: Schema.optional(Schema.Literal("user")),
  });

export const BROWSER_HOST_METHODS = {
  "browser.tabs": scoped(BrowserTabsInput),
  "browser.navigate": scoped(BrowserNavigateInput),
  "browser.snapshot": scoped(BrowserSnapshotInput),
  "browser.find": scoped(BrowserFindInput),
  "browser.getText": scoped(BrowserGetTextInput),
  "browser.click": scoped(BrowserClickInput),
  "browser.hover": scoped(BrowserHoverInput),
  "browser.drag": scoped(BrowserDragInput),
  "browser.type": scoped(BrowserTypeInput),
  "browser.fill": scoped(BrowserFillInput),
  "browser.press": scoped(BrowserPressInput),
  "browser.select": scoped(BrowserSelectInput),
  "browser.scroll": scoped(BrowserScrollInput),
  "browser.wait": scoped(BrowserWaitInput),
  "browser.screenshot": scoped(BrowserScreenshotInput),
  "browser.zoom": scoped(BrowserZoomInput),
  "browser.dialog": scoped(BrowserDialogInput),
  // Paths are absolute and already validated against the thread workspace by the server.
  "browser.upload": scoped(BrowserUploadInput),
  "browser.console": scoped(BrowserConsoleInput),
  "browser.network": scoped(BrowserNetworkInput),
  // Turns the content blocker on or off for the tab's site and reloads the tab.
  "browser.contentBlocker": scoped(BrowserContentBlockerInput),
  // Sent by the server when a thread is archived or deleted; closes every tab of the thread.
  "browser.closeThread": scoped(Schema.Struct({})),
} as const;
export type BrowserHostMethod = keyof typeof BROWSER_HOST_METHODS;
export type BrowserHostParams<M extends BrowserHostMethod> =
  (typeof BROWSER_HOST_METHODS)[M]["Type"];

export const BrowserPage = Schema.Struct({
  tabId: Schema.String,
  url: Schema.String,
  title: Schema.String,
});

// `text` is Glade's own report; `content` is text taken from the page (snapshot lines, page text,
// console output, a dialog's message), which the gateway marks as untrusted page data.
export const BrowserTextResult = Schema.Struct({
  page: Schema.NullOr(BrowserPage),
  text: Schema.String,
  content: Schema.optional(Schema.String),
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

// A page's alert or confirm waiting for an answer (Electron refuses prompt() in the page itself),
// or a `challenge`: a CAPTCHA or bot check on screen that only the user may complete, shown until
// the page navigates or the user dismisses it. `audience: "user"` marks one the user answers.
export const BrowserPageDialog = Schema.Struct({
  type: Schema.Literals(["alert", "confirm", "challenge"]),
  message: Schema.String,
  audience: Schema.Literals(["user", "agent"]),
});
export type BrowserPageDialog = typeof BrowserPageDialog.Type;

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
  dialog: Schema.NullOr(BrowserPageDialog),
  // Whether the content blocker applies to the page's site when it is on; null for pages without
  // a site, such as about:blank.
  siteBlocking: Schema.NullOr(Schema.Boolean),
});
export const BrowserTabsChanged = Schema.Struct({ tabs: Schema.Array(BrowserTabState) });
export type BrowserTabsChanged = typeof BrowserTabsChanged.Type;
