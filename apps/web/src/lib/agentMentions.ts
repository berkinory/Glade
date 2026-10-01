import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DEFAULT_MODEL } from "@glade/contracts/provider/model";

interface AgentModelMention {
  readonly alias: string;
  readonly provider: "codex";
  readonly kind: "model";
  readonly model: string;
  readonly displayName: string;
  readonly color: "violet";
}

export function getAgentMentionAutocompleteAliases(
  provider: ProviderKind,
  models: ReadonlyArray<{ slug: string; name: string; isSelectedHint?: boolean }> = [],
): AgentModelMention[] {
  if (provider !== "codex") return [];
  const aliases = new Map<string, AgentModelMention>();
  for (const model of models.toSorted((a, b) => a.slug.localeCompare(b.slug))) {
    if (model.isSelectedHint || model.slug === PROVIDER_DEFAULT_MODEL) continue;
    const alias = model.slug.toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(alias) || aliases.has(alias)) continue;
    aliases.set(alias, {
      alias,
      provider,
      kind: "model",
      model: model.slug,
      displayName: model.name,
      color: "violet",
    });
  }
  return [...aliases.values()];
}
