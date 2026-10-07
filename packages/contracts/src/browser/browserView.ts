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

// Everything below is read from the page and is untrusted page data.
export interface BrowserPickedDetails {
  // Verified to match only this element when it was picked; null when no short one was found.
  readonly selector: string | null;
  // A form field's label.
  readonly fieldLabel: string | null;
  // For elements without an accessible name: the first distinct short texts inside, and how many
  // more there are.
  readonly contains: { readonly texts: readonly string[]; readonly more: number } | null;
  // Nearest landmarks and sections, outermost first, at most four.
  readonly context: ReadonlyArray<{ readonly role: string; readonly name: string }>;
  // Position among elements with the same role and name (or tag and text); null when unique.
  readonly rank: { readonly index: number; readonly total: number } | null;
  // Size and non-default computed styles: `160×40 · padding 10px 16px · 14px/600 · #fff on #2563eb`.
  readonly style: string;
}

export interface BrowserPickedElement {
  readonly tabId: string;
  readonly ref: typeof BrowserRef.Type;
  // The accessible role when it says something, otherwise the element's tag name.
  readonly role: string;
  // The accessible name; empty when the role is a tag name.
  readonly name: string;
  // `button "Save"`, or `div.pricing-card` built from identifier-like id and class tokens only.
  readonly label: string;
  readonly url: string;
  readonly title: string;
  // Null when the page could not be read, e.g. the element sits in a cross-origin frame.
  readonly details: BrowserPickedDetails | null;
  readonly screenshot: { readonly data: string; readonly mimeType: "image/jpeg" } | null;
}
