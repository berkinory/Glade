import { Schema } from "effect";
import { ThreadId } from "../core/baseSchemas";
import { BrowserRef, BrowserTabId } from "./browserTools";

const Length = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

// CSS pixels of the Glade page, relative to its viewport; the desktop converts them to window
// coordinates with the page zoom.
export const BrowserViewRect = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Length,
  height: Length,
});
export type BrowserViewRect = typeof BrowserViewRect.Type;

// `tab: null` takes the thread's view off the window; the tab keeps running hidden.
export const BrowserViewPlacement = Schema.Struct({
  threadId: ThreadId,
  tab: Schema.NullOr(Schema.Struct({ tabId: BrowserTabId, bounds: BrowserViewRect })),
});
export type BrowserViewPlacement = typeof BrowserViewPlacement.Type;

export const BrowserPickTarget = Schema.Struct({ threadId: ThreadId, tabId: BrowserTabId });
export type BrowserPickTarget = typeof BrowserPickTarget.Type;

export interface BrowserPickedElement {
  readonly tabId: string;
  readonly ref: typeof BrowserRef.Type;
  readonly role: string;
  readonly name: string;
  readonly url: string;
  readonly screenshot: { readonly data: string; readonly mimeType: "image/jpeg" } | null;
}
