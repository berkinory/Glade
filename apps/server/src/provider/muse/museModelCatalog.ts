import type { ProviderOptionDescriptor } from "@glade/contracts/provider/model";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { formatEffortLabel } from "@glade/shared/provider/effortLabel";

import type { MspModelCatalogEntry } from "./mspProtocol.ts";

// MSP's closed reasoning tier vocabulary; `turn/start` carries one per turn.
const REASONING_EFFORTS: ReadonlySet<string> = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

// Glade offers every provider's reasoning level under the `effort` option id.
export const MUSE_EFFORT_OPTION_ID = "effort";

export function museReasoningEffort(value: unknown): string | undefined {
  return typeof value === "string" && REASONING_EFFORTS.has(value) ? value : undefined;
}

function effortDescriptor(model: MspModelCatalogEntry): ProviderOptionDescriptor | undefined {
  const described = new Map(
    (model.reasoningEffortVariants ?? []).map(({ tier, description }) => [tier, description]),
  );
  // `variants` lists every selectable tier; "unknown" means the catalog does not say.
  const tiers = (Array.isArray(model.variants) ? model.variants : [...described.keys()]).filter(
    (tier): tier is string => museReasoningEffort(tier) !== undefined,
  );
  if (tiers.length === 0) return undefined;
  const current = museReasoningEffort(model.defaultReasoningEffort);
  return {
    id: MUSE_EFFORT_OPTION_ID,
    label: "Effort",
    type: "select",
    options: tiers.map((tier) => {
      const description = described.get(tier)?.trim();
      return {
        id: tier,
        label: formatEffortLabel(tier),
        ...(description ? { description } : {}),
        ...(tier === current ? { isDefault: true as const } : {}),
      };
    }),
    ...(current && tiers.includes(current) ? { currentValue: current } : {}),
  };
}

export function museModelCatalog(
  models: ReadonlyArray<MspModelCatalogEntry>,
): ReadonlyArray<ProviderModelDescriptor> {
  return models.flatMap((model) => {
    const slug = model.modelId.trim();
    if (!slug) return [];
    const effort = effortDescriptor(model);
    const description = model.description?.trim();
    return [
      {
        slug,
        name: model.displayLabel.trim() || slug,
        ...(description ? { description } : {}),
        ...(model.isDefault ? { isDefault: true } : {}),
        ...(effort ? { optionDescriptors: [effort] } : {}),
      },
    ];
  });
}
