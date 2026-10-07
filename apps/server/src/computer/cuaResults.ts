import { Schema } from "effect";

// Shapes of the pinned Cua 0.34 MCP results that Glade reads. Unknown fields are ignored; the
// fields listed here are the contract, pinned by cuaResults.test.ts against captured fixtures.

const Text = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });
const Image = Schema.Struct({
  type: Schema.Literal("image"),
  data: Schema.String,
  mimeType: Schema.String,
});

export const CuaToolResult = Schema.Struct({
  content: Schema.Array(Schema.Union([Text, Image, Schema.Struct({ type: Schema.String })])),
  structuredContent: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  isError: Schema.optional(Schema.Boolean),
});
export type CuaToolResult = typeof CuaToolResult.Type;

const NullableString = Schema.optional(Schema.NullOr(Schema.String));

export const CuaWindow = Schema.Struct({
  window_id: Schema.Int,
  pid: Schema.NullOr(Schema.Int),
  app_name: Schema.String,
  title: Schema.String,
  bounds: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
  is_on_screen: Schema.Boolean,
  z_index: Schema.NullOr(Schema.Int),
  minimized: Schema.optional(Schema.NullOr(Schema.Boolean)),
});
export type CuaWindow = typeof CuaWindow.Type;

export const CuaListWindows = Schema.Struct({ windows: Schema.Array(CuaWindow) });

export const CuaListApps = Schema.Struct({
  apps: Schema.Array(
    Schema.Struct({
      pid: Schema.Int,
      name: Schema.String,
      running: Schema.Boolean,
      active: Schema.Boolean,
      bundle_id: NullableString,
    }),
  ),
});

export const CuaElement = Schema.Struct({
  element_index: Schema.Int,
  element_token: Schema.String,
  role: Schema.String,
  label: NullableString,
  value: Schema.optional(Schema.Unknown),
  depth: Schema.optional(Schema.Int),
  enabled: Schema.optional(Schema.Boolean),
  selected: Schema.optional(Schema.Boolean),
});
export type CuaElement = typeof CuaElement.Type;

export const CuaWindowState = Schema.Struct({
  elements: Schema.optional(Schema.Array(CuaElement)),
  element_count: Schema.optional(Schema.Int),
  truncated: Schema.optional(Schema.Boolean),
  degraded_reason: NullableString,
  app_name: NullableString,
  window_title: NullableString,
});
export type CuaWindowState = typeof CuaWindowState.Type;

export const CuaActionOutcome = Schema.Struct({
  effect: Schema.Literals(["confirmed", "partial", "unverifiable", "suspected_noop", "refused"]),
  summary: NullableString,
  escalation: Schema.optional(
    Schema.NullOr(Schema.Struct({ target: Schema.String, reason: Schema.String })),
  ),
});
export type CuaActionOutcome = typeof CuaActionOutcome.Type;

// Tool errors (isError) carry Cua's machine-readable code here, e.g. background_unavailable.
export const CuaFailure = Schema.Struct({ code: Schema.String });

export const CuaPermissions = Schema.Struct({
  accessibility: Schema.Boolean,
  screen_recording: Schema.Boolean,
});

export const CuaHealth = Schema.Struct({
  overall: Schema.String,
  checks: Schema.Array(
    Schema.Struct({ name: Schema.String, status: Schema.String, message: Schema.String }),
  ),
});

export const resultText = (result: CuaToolResult): string =>
  result.content
    .flatMap((part) => (part.type === "text" && "text" in part ? [part.text] : []))
    .join("\n");

export const resultImage = (result: CuaToolResult) =>
  result.content.find(
    (part): part is typeof Image.Type => part.type === "image" && "data" in part,
  ) ?? null;
