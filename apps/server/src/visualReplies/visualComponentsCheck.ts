import type {
  VisualComponentBlock,
  VisualComponentInput,
  VisualComponentLeafBlock,
} from "@glade/contracts/orchestration/visualComponents";
import {
  chartPointScope,
  defaultInputScope,
  VISUAL_CHART_POINT_NAMES,
  visualComponentInputs,
  type VisualInputScope,
} from "@glade/shared/visualComponentScope";
import {
  parseVisualFormula,
  VISUAL_FORMULA_RESERVED_NAMES,
  type VisualFormula,
} from "@glade/shared/visualFormula";

const MAX_PROBLEMS = 8;

interface FormulaSite {
  readonly where: string;
  readonly source: string;
  // Chart series evaluate once per label; stats once.
  readonly labels: readonly string[] | null;
}

function formulaSites(block: VisualComponentLeafBlock, where: string): FormulaSite[] {
  if (block.type === "stats")
    return block.items.flatMap((item) =>
      typeof item.value === "object"
        ? [{ where: `${where} stat "${item.label}"`, source: item.value.formula, labels: null }]
        : [],
    );
  if (block.type === "chart")
    return block.series.flatMap((series) =>
      "formula" in series
        ? [
            {
              where: `${where} series "${series.name}"`,
              source: series.formula,
              labels: block.labels,
            },
          ]
        : [],
    );
  return [];
}

function allFormulaSites(blocks: readonly VisualComponentBlock[]): FormulaSite[] {
  return blocks.flatMap((block, index) =>
    block.type === "tabs"
      ? block.tabs.flatMap((tab) =>
          tab.blocks.flatMap((child, childIndex) =>
            formulaSites(child, `Block ${index + 1} tab "${tab.label}" block ${childIndex + 1}`),
          ),
        )
      : formulaSites(block, `Block ${index + 1}`),
  );
}

// The defaults, then every slider at each end and every toggle flipped, one input at a time.
function scenarios(inputs: readonly VisualComponentInput[]) {
  const defaults = defaultInputScope(inputs);
  const variations = inputs.flatMap((input) =>
    input.kind === "slider"
      ? [
          { scope: { ...defaults, [input.id]: input.min }, note: `${input.id} = ${input.min}` },
          { scope: { ...defaults, [input.id]: input.max }, note: `${input.id} = ${input.max}` },
        ]
      : [
          {
            scope: { ...defaults, [input.id]: Number(!input.value) },
            note: `${input.id} = ${!input.value}`,
          },
        ],
  );
  return [{ scope: defaults, note: "the default inputs" }, ...variations];
}

function firstNonFinite(
  formula: VisualFormula,
  site: FormulaSite,
  scope: VisualInputScope,
): string | null {
  if (site.labels === null) return Number.isFinite(formula.evaluate(scope)) ? null : "";
  const index = site.labels.findIndex(
    (label, at) => !Number.isFinite(formula.evaluate(chartPointScope(scope, label, at))),
  );
  return index === -1 ? null : ` at label "${site.labels[index]}"`;
}

/**
 * Runs every formula the way readers will before the reply is published, so the agent gets the
 * failure instead of the reader getting a blank figure.
 */
export function checkVisualComponents(blocks: readonly VisualComponentBlock[]): string[] {
  const problems: string[] = [];
  const inputs = visualComponentInputs(blocks);
  const ids = new Set<string>();
  for (const input of inputs) {
    if (ids.has(input.id)) problems.push(`Input id "${input.id}" is used more than once.`);
    if (VISUAL_FORMULA_RESERVED_NAMES.has(input.id) || VISUAL_CHART_POINT_NAMES.includes(input.id))
      problems.push(`Input id "${input.id}" is reserved; choose another name.`);
    ids.add(input.id);
  }
  const cases = scenarios(inputs);
  for (const site of allFormulaSites(blocks)) {
    if (problems.length >= MAX_PROBLEMS) break;
    const parsed = parseVisualFormula(site.source);
    if (!parsed.ok) {
      problems.push(`${site.where}: ${parsed.message}`);
      continue;
    }
    const unknown = [...parsed.formula.names].filter(
      (name) => !ids.has(name) && !(site.labels && VISUAL_CHART_POINT_NAMES.includes(name)),
    );
    if (unknown.length > 0) {
      problems.push(
        `${site.where}: unknown name ${unknown.map((name) => `"${name}"`).join(", ")}.`,
      );
      continue;
    }
    for (const { scope, note } of cases) {
      const failure = firstNonFinite(parsed.formula, site, scope);
      if (failure === null) continue;
      problems.push(`${site.where}: not a finite number${failure} with ${note}.`);
      break;
    }
  }
  return problems.slice(0, MAX_PROBLEMS);
}
