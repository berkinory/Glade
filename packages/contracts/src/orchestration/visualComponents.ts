import { Option, Schema, SchemaIssue } from "effect";
import { ThreadId, TrimmedNonEmptyString } from "../core/baseSchemas";
import { VisualReply } from "./visualReply";

export const VISUAL_COMPONENTS_MAX_BYTES = 64 * 1024;
export const VISUAL_COMPONENTS_MAX_BLOCKS = 12;

const Text = (maxLength: number) => TrimmedNonEmptyString.check(Schema.isMaxLength(maxLength));
const List = <S extends Schema.Top>(item: S, min: number, max: number) =>
  Schema.Array(item).check(Schema.isMinLength(min), Schema.isMaxLength(max));
const invalid = (actual: unknown, message: string) =>
  new SchemaIssue.InvalidValue(Option.some(actual), { message });

// Plain arithmetic over input ids, evaluated by the reader's client as inputs change.
const FormulaSource = Text(300);

const FormulaValue = Schema.Struct({
  formula: FormulaSource,
  prefix: Schema.optionalKey(Text(4)),
  unit: Schema.optionalKey(Text(12)),
  decimals: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }))),
});

const StatsBlock = Schema.Struct({
  type: Schema.Literal("stats"),
  items: List(
    Schema.Struct({
      label: Text(60),
      value: Schema.Union([Text(40), Schema.Finite, FormulaValue]),
      detail: Schema.optionalKey(Text(80)),
      trend: Schema.optionalKey(Schema.Literals(["up", "down", "flat"])),
    }),
    1,
    6,
  ),
});

const ChartBlock = Schema.Struct({
  type: Schema.Literal("chart"),
  kind: Schema.Literals(["bar", "line"]),
  title: Schema.optionalKey(Text(120)),
  unit: Schema.optionalKey(Text(12)),
  labels: List(Text(40), 1, 60),
  series: List(
    Schema.Union([
      Schema.Struct({ name: Text(40), values: List(Schema.Finite, 1, 60) }),
      Schema.Struct({ name: Text(40), formula: FormulaSource }),
    ]),
    1,
    5,
  ),
}).check(
  Schema.makeFilter(
    (chart) => {
      if (
        chart.series.some(
          (series) => "values" in series && series.values.length !== chart.labels.length,
        )
      )
        return invalid(chart.labels.length, "Every series needs exactly one value per label.");
      return (
        chart.kind === "bar" ||
        chart.labels.length >= 2 ||
        invalid(chart.labels.length, "A line chart needs at least two labels.")
      );
    },
    { identifier: "VisualChartShape" },
  ),
);

const TableBlock = Schema.Struct({
  type: Schema.Literal("table"),
  title: Schema.optionalKey(Text(120)),
  columns: List(Text(60), 1, 8),
  rows: List(
    List(Schema.Union([Schema.String.check(Schema.isMaxLength(200)), Schema.Finite]), 1, 8),
    1,
    100,
  ),
}).check(
  Schema.makeFilter(
    (table) =>
      table.rows.every((row) => row.length === table.columns.length) ||
      invalid(table.columns.length, "Every row needs exactly one cell per column."),
    { identifier: "VisualTableShape" },
  ),
);

const ChecklistBlock = Schema.Struct({
  type: Schema.Literal("checklist"),
  title: Schema.optionalKey(Text(120)),
  items: List(
    Schema.Struct({
      label: Text(200),
      detail: Schema.optionalKey(Text(400)),
      checked: Schema.optionalKey(Schema.Boolean),
    }),
    1,
    40,
  ),
});

const ChoicesBlock = Schema.Struct({
  type: Schema.Literal("choices"),
  prompt: Schema.optionalKey(Text(200)),
  options: List(
    Schema.Struct({
      label: Text(80),
      // Sent as the reader's next message when chosen; defaults to the label.
      message: Schema.optionalKey(Text(1000)),
    }),
    1,
    6,
  ),
});

const InputId = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]{0,31}$/u));

const SliderInput = Schema.Struct({
  kind: Schema.Literal("slider"),
  id: InputId,
  label: Text(60),
  min: Schema.Finite,
  max: Schema.Finite,
  step: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
  value: Schema.Finite,
  unit: Schema.optionalKey(Text(12)),
}).check(
  Schema.makeFilter(
    (slider) =>
      (slider.min < slider.max && slider.value >= slider.min && slider.value <= slider.max) ||
      invalid(slider.value, "A slider needs min < max and a value between them."),
    { identifier: "VisualSliderRange" },
  ),
);

const ToggleInput = Schema.Struct({
  kind: Schema.Literal("toggle"),
  id: InputId,
  label: Text(60),
  value: Schema.Boolean,
});

export const VisualComponentInput = Schema.Union([SliderInput, ToggleInput]);
export type VisualComponentInput = typeof VisualComponentInput.Type;

const InputsBlock = Schema.Struct({
  type: Schema.Literal("inputs"),
  items: List(VisualComponentInput, 1, 6),
});

export const VisualComponentLeafBlock = Schema.Union([
  InputsBlock,
  StatsBlock,
  ChartBlock,
  TableBlock,
  ChecklistBlock,
  ChoicesBlock,
]);
export type VisualComponentLeafBlock = typeof VisualComponentLeafBlock.Type;

// Tabs hold leaf blocks only, so a spec stays one level deep.
const TabsBlock = Schema.Struct({
  type: Schema.Literal("tabs"),
  tabs: List(
    Schema.Struct({ label: Text(40), blocks: List(VisualComponentLeafBlock, 1, 8) }),
    2,
    6,
  ),
});

export const VisualComponentBlock = Schema.Union([VisualComponentLeafBlock, TabsBlock]);
export type VisualComponentBlock = typeof VisualComponentBlock.Type;

export const VisualComponentBlocks = List(
  VisualComponentBlock,
  1,
  VISUAL_COMPONENTS_MAX_BLOCKS,
).check(
  Schema.makeFilter(
    (blocks) => {
      const bytes = new TextEncoder().encode(JSON.stringify(blocks)).byteLength;
      return (
        bytes <= VISUAL_COMPONENTS_MAX_BYTES ||
        invalid(bytes, `Blocks exceed ${VISUAL_COMPONENTS_MAX_BYTES / 1024} KiB as JSON.`)
      );
    },
    { identifier: "VisualComponentBlocksSize" },
  ),
);

const Title = Text(160);

export const VisualComponentsInput = Schema.Struct({
  title: Title,
  blocks: VisualComponentBlocks,
});
export type VisualComponentsInput = typeof VisualComponentsInput.Type;

export const VisualComponentsReply = Schema.Struct({
  version: Schema.Literal(1),
  format: Schema.Literal("components"),
  threadId: ThreadId,
  title: Title,
  blocks: VisualComponentBlocks,
});
export type VisualComponentsReply = typeof VisualComponentsReply.Type;

// Both formats share the visual reply activity kind; HTML payloads predate the format field.
export const PublishedVisualReply = Schema.Union([VisualReply, VisualComponentsReply]);
export type PublishedVisualReply = typeof PublishedVisualReply.Type;
