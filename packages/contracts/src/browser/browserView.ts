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

export const BrowserTabTarget = Schema.Struct({ threadId: ThreadId, tabId: BrowserTabId });
export type BrowserTabTarget = typeof BrowserTabTarget.Type;

// Resolved CSS colors and font from Glade's theme; the picker overlay is drawn inside the page,
// which cannot read Glade's stylesheet.
const ThemeColor = Schema.String.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[#a-z0-9(),.%/\s+-]+$/iu),
);
export const BrowserPickTheme = Schema.Struct({
  accent: ThemeColor,
  surface: ThemeColor,
  foreground: ThemeColor,
  border: ThemeColor,
  fontFamily: Schema.String.check(Schema.isMaxLength(512), Schema.isPattern(/^[\w\s"',.-]*$/u)),
  reducedMotion: Schema.Boolean,
});
export type BrowserPickTheme = typeof BrowserPickTheme.Type;

export const BrowserPickRequest = Schema.Struct({
  ...BrowserTabTarget.fields,
  theme: BrowserPickTheme,
});
export type BrowserPickRequest = typeof BrowserPickRequest.Type;

export interface BrowserCapture {
  readonly data: string;
  readonly mimeType: "image/jpeg";
}

export interface BrowserPickedElement {
  readonly tabId: string;
  readonly ref: typeof BrowserRef.Type;
  readonly role: string;
  readonly name: string;
  readonly url: string;
  readonly screenshot: { readonly data: string; readonly mimeType: "image/jpeg" } | null;
}
