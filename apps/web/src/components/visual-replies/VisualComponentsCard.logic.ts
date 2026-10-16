import type { VisualComponentLeafBlock } from "@glade/contracts/orchestration/visualComponents";
import { chartPointScope, type VisualInputScope } from "@glade/shared/visualComponentScope";
import { parseVisualFormula } from "@glade/shared/visualFormula";
import type { ResolvedVisualLeafBlock } from "./blocks/visualBlockTypes";
import { formatVisualNumber } from "./blocks/visualNumber";

function evaluate(source: string, scope: VisualInputScope): number {
  const parsed = parseVisualFormula(source);
  return parsed.ok ? parsed.formula.evaluate(scope) : Number.NaN;
}

// Formulas become the plain values the blocks draw; a non-finite result stays NaN so blocks
// can show it as undefined rather than as a number.
export function resolveVisualBlock(
  block: VisualComponentLeafBlock,
  scope: VisualInputScope,
): ResolvedVisualLeafBlock {
  if (block.type === "stats")
    return {
      ...block,
      items: block.items.map((item) => {
        if (typeof item.value !== "object") return { ...item, value: item.value };
        const value = evaluate(item.value.formula, scope);
        return {
          ...item,
          value: Number.isFinite(value)
            ? `${item.value.prefix ?? ""}${formatVisualNumber(value, item.value.decimals)}${item.value.unit ? ` ${item.value.unit}` : ""}`
            : "—",
        };
      }),
    };
  if (block.type === "chart")
    return {
      ...block,
      series: block.series.map((series) =>
        "values" in series
          ? series
          : {
              name: series.name,
              values: block.labels.map((label, index) =>
                evaluate(series.formula, chartPointScope(scope, label, index)),
              ),
            },
      ),
    };
  return block;
}
