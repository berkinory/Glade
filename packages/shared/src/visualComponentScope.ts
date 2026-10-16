import type {
  VisualComponentBlock,
  VisualComponentInput,
} from "@glade/contracts/orchestration/visualComponents";

export type VisualInputScope = Readonly<Record<string, number>>;

/** Names a chart series formula reads for each label, besides the reply's inputs. */
export const VISUAL_CHART_POINT_NAMES: readonly string[] = ["x", "i"];

export function visualComponentInputs(
  blocks: readonly VisualComponentBlock[],
): VisualComponentInput[] {
  return blocks.flatMap((block) =>
    block.type === "inputs"
      ? block.items
      : block.type === "tabs"
        ? block.tabs.flatMap((tab) => visualComponentInputs(tab.blocks))
        : [],
  );
}

// Toggles enter formulas as 1 or 0.
export function defaultInputScope(inputs: readonly VisualComponentInput[]): VisualInputScope {
  return Object.fromEntries(
    inputs.map((input) => [input.id, input.kind === "toggle" ? Number(input.value) : input.value]),
  );
}

// `x` is a numeric label's value, or its 1-based position when the label is not a number.
export function chartPointScope(
  scope: VisualInputScope,
  label: string,
  index: number,
): VisualInputScope {
  const numeric = Number(label);
  return { ...scope, x: Number.isFinite(numeric) ? numeric : index + 1, i: index + 1 };
}
