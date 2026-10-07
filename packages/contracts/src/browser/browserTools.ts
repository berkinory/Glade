import { Schema } from "effect";

// Refs come from browser_snapshot and browser_find; tab ids from browser_tabs.
export const BrowserRef = Schema.String.check(Schema.isPattern(/^e[1-9][0-9]*$/u)).annotate({
  description: 'Element ref from browser_snapshot or browser_find, for example "e12".',
});
export const BrowserTabId = Schema.String.check(Schema.isPattern(/^t[1-9][0-9]*$/u)).annotate({
  description: "Tab id from browser_tabs. Defaults to the thread's active tab.",
});

const tab = { tabId: Schema.optional(BrowserTabId) };
const Count = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const Text = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum));

export const BrowserTabsInput = Schema.Struct({
  action: Schema.Literals(["list", "open", "close", "select"]),
  url: Schema.optional(Text(8192)),
  ...tab,
});

export const BrowserNavigateInput = Schema.Struct({
  url: Schema.optional(Text(8192)),
  history: Schema.optional(Schema.Literals(["back", "forward", "reload"])),
  ...tab,
});

export const BrowserSnapshotInput = Schema.Struct({
  filter: Schema.optional(Schema.Literals(["interactive", "all"])),
  scope: Schema.optional(Schema.Literals(["viewport", "page"])),
  depth: Schema.optional(Count(1, 64)),
  ref: Schema.optional(BrowserRef),
  ...tab,
});

export const BrowserFindInput = Schema.Struct({
  query: Text(512).check(Schema.isNonEmpty()),
  regex: Schema.optional(Schema.Boolean),
  ...tab,
});

export const BrowserGetTextInput = Schema.Struct({
  maxChars: Schema.optional(Count(500, 60_000)),
  ref: Schema.optional(BrowserRef),
  ...tab,
});

export const BrowserModifier = Schema.Literals(["Alt", "Control", "Meta", "Shift"]);
export type BrowserModifier = typeof BrowserModifier.Type;

const Coordinate = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100_000 }));
// Either ref, or x and y in the pixels of the tab's latest browser_screenshot (viewport CSS pixels
// before any screenshot). The desktop rejects any other combination.
const target = {
  ref: Schema.optional(BrowserRef),
  x: Schema.optional(Coordinate),
  y: Schema.optional(Coordinate),
};
export const BrowserTarget = Schema.Struct(target);
export type BrowserTarget = typeof BrowserTarget.Type;

export const BrowserClickInput = Schema.Struct({
  ...target,
  button: Schema.optional(Schema.Literals(["left", "right", "middle"])),
  modifiers: Schema.optional(Schema.Array(BrowserModifier)),
  count: Schema.optional(Count(1, 3)),
  ...tab,
});

export const BrowserHoverInput = Schema.Struct({ ...target, ...tab });

export const BrowserDragInput = Schema.Struct({
  from: BrowserTarget,
  to: BrowserTarget,
  ...tab,
});

export const BrowserTypeInput = Schema.Struct({
  ref: Schema.optional(BrowserRef),
  text: Text(20_000),
  submit: Schema.optional(Schema.Boolean),
  ...tab,
});

export const BrowserPressInput = Schema.Struct({
  key: Text(64).check(Schema.isNonEmpty()),
  repeat: Schema.optional(Count(1, 50)),
  ...tab,
});

export const BrowserSelectInput = Schema.Struct({
  ref: BrowserRef,
  values: Schema.Array(Text(1024)).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  ...tab,
});

export const BrowserScrollInput = Schema.Struct({
  ref: Schema.optional(BrowserRef),
  direction: Schema.optional(Schema.Literals(["up", "down", "left", "right"])),
  // Long virtualized lists need jumps far past one screen.
  amount: Schema.optional(Count(1, 1_000_000)),
  ...tab,
});

export const BrowserFillInput = Schema.Struct({
  fields: Schema.Array(
    Schema.Struct({
      ref: BrowserRef,
      value: Schema.Union([Text(20_000), Schema.Boolean]).annotate({
        description:
          "Text for text fields, an option label or value for selects, a date like 2026-10-07 for date inputs, true or false for checkboxes, radios and switches.",
      }),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  ...tab,
});

export const BrowserRegion = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number.check(Schema.isGreaterThan(0)),
  height: Schema.Number.check(Schema.isGreaterThan(0)),
});

export const BrowserScreenshotInput = Schema.Struct({
  ref: Schema.optional(BrowserRef),
  region: Schema.optional(BrowserRegion),
  scale: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 1 }))),
  ...tab,
});

export const BrowserDialogInput = Schema.Struct({
  accept: Schema.Boolean,
  ...tab,
});

export const BrowserUploadInput = Schema.Struct({
  ref: BrowserRef,
  paths: Schema.Array(Text(4096).check(Schema.isNonEmpty())).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  ...tab,
});

export const BrowserEvaluateInput = Schema.Struct({
  expression: Text(20_000).check(Schema.isNonEmpty()),
  ...tab,
});

const Page = Schema.optional(Count(1, 500)).annotate({
  description: "Page of results, 1 (newest) by default.",
});

export const BrowserConsoleInput = Schema.Struct({
  level: Schema.optional(Schema.Literals(["all", "error", "warning", "info", "debug"])),
  pattern: Schema.optional(Text(512)),
  page: Page,
  clear: Schema.optional(Schema.Boolean),
  ...tab,
});

export const BrowserNetworkInput = Schema.Struct({
  pattern: Schema.optional(Text(512)),
  failedOnly: Schema.optional(Schema.Boolean),
  page: Page,
  requestId: Schema.optional(Text(256)),
  ...tab,
});

export const BROWSER_BATCH_TOOLS = [
  "browser_tabs",
  "browser_navigate",
  "browser_snapshot",
  "browser_find",
  "browser_get_text",
  "browser_click",
  "browser_hover",
  "browser_drag",
  "browser_type",
  "browser_fill",
  "browser_press",
  "browser_select",
  "browser_scroll",
  "browser_screenshot",
  "browser_dialog",
  "browser_upload",
  "browser_console",
  "browser_network",
] as const;
export type BrowserBatchTool = (typeof BROWSER_BATCH_TOOLS)[number];

export const BrowserBatchInput = Schema.Struct({
  steps: Schema.Array(
    Schema.Struct({
      tool: Schema.Literals(BROWSER_BATCH_TOOLS),
      args: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});
