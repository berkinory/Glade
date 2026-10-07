import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { BrowserTabsChanged } from "../../browser/browserHost";
import { BrowserTabId } from "../../browser/browserTools";
import { ThreadId } from "../../core/baseSchemas";
import { WsRpcError } from "./rpcErrors";

export const BROWSER_WS_METHODS = {
  subscribeTabs: "browser.subscribeTabs",
  command: "browser.command",
} as const;

const Url = Schema.String.check(Schema.isMaxLength(8192));

// Commands the user issues from the browser panel; the server scopes them to the thread.
export const BrowserPanelCommand = Schema.Union([
  Schema.Struct({ threadId: ThreadId, action: Schema.Literal("open"), url: Schema.optional(Url) }),
  Schema.Struct({
    threadId: ThreadId,
    action: Schema.Literals(["close", "select"]),
    tabId: BrowserTabId,
  }),
  Schema.Struct({
    threadId: ThreadId,
    action: Schema.Literal("navigate"),
    tabId: BrowserTabId,
    url: Schema.optional(Url),
    history: Schema.optional(Schema.Literals(["back", "forward", "reload"])),
  }),
  Schema.Struct({
    threadId: ThreadId,
    action: Schema.Literal("dialog"),
    tabId: BrowserTabId,
    accept: Schema.Boolean,
  }),
  Schema.Struct({
    threadId: ThreadId,
    action: Schema.Literal("contentBlocker"),
    tabId: BrowserTabId,
    enabled: Schema.Boolean,
  }),
]);
export type BrowserPanelCommand = typeof BrowserPanelCommand.Type;

export const BrowserTabsSubscribeInput = Schema.Struct({ threadId: ThreadId });
export type BrowserTabsSubscribeInput = typeof BrowserTabsSubscribeInput.Type;

export const WsBrowserSubscribeTabsRpc = Rpc.make(BROWSER_WS_METHODS.subscribeTabs, {
  payload: BrowserTabsSubscribeInput,
  success: BrowserTabsChanged,
  error: WsRpcError,
  stream: true,
});

export const WsBrowserCommandRpc = Rpc.make(BROWSER_WS_METHODS.command, {
  payload: BrowserPanelCommand,
  success: Schema.Void,
  error: WsRpcError,
});
