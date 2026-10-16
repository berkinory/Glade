import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type {
  ProviderSkillDescriptor,
  ProviderSkillsCatalogResult,
} from "@glade/contracts/provider/providerDiscovery";

import { DEFAULT_PROVIDER_ORDER } from "~/providerOrdering";

export interface SkillGroup {
  readonly key: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  // Set when a copy sits in the shared folder (or Glade's), so every agent loads it.
  readonly shared: boolean;
  // Agents that keep their own copy of the skill.
  readonly providers: ReadonlyArray<ProviderKind>;
  // Copies directly in an agent's home folder: those sharing moves or removes. Plugin, synced and
  // built-in skills are never among them.
  readonly movableCopies: number;
}

export function skillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

const normalizedPath = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/u, "");

// `<root>/<skill>/SKILL.md` → `<root>`
function skillRoot(skill: ProviderSkillDescriptor): string | null {
  const segments = normalizedPath(skill.path).split("/");
  if (segments.at(-1)?.toLowerCase() !== "skill.md" || segments.length < 3) return null;
  return segments.slice(0, -2).join("/");
}

function inRoot(skill: ProviderSkillDescriptor, roots: ReadonlyArray<string>): boolean {
  const root = skillRoot(skill);
  return root !== null && roots.some((candidate) => normalizedPath(candidate) === root);
}

export function skillGroups(
  catalog: ProviderSkillsCatalogResult,
  disabledProviders: ReadonlyArray<ProviderKind>,
): ReadonlyArray<SkillGroup> {
  const sharedRoots = [
    catalog.sharedSkillsDir,
    ...(catalog.gladeSkillsDir ? [catalog.gladeSkillsDir] : []),
  ];
  const byName = new Map<string, ProviderSkillDescriptor[]>();
  for (const skill of catalog.skills) {
    const provider = skill.scope ? catalog.scopeProviders[skill.scope] : undefined;
    // A disabled agent's own skills stay out until it is enabled again.
    if (provider && disabledProviders.includes(provider)) continue;
    const key = skillNameKey(skill.name);
    byName.set(key, [...(byName.get(key) ?? []), skill]);
  }
  return [...byName.entries()]
    .flatMap(([key, copies]): SkillGroup[] => {
      const shared = copies.find((skill) => inRoot(skill, sharedRoots));
      const primary = shared ?? copies[0];
      if (!primary) return [];
      const providers = DEFAULT_PROVIDER_ORDER.filter((provider) =>
        copies.some(
          (skill) => skill.scope !== undefined && catalog.scopeProviders[skill.scope] === provider,
        ),
      );
      return [
        {
          key,
          name: primary.name,
          displayName: primary.interface?.displayName ?? primary.name,
          description:
            primary.interface?.shortDescription ?? primary.description ?? "No description.",
          shared: shared !== undefined,
          providers,
          movableCopies: copies.filter((skill) => inRoot(skill, catalog.agentSkillsDirs)).length,
        },
      ];
    })
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

export function matchesSkill(group: SkillGroup, query: string): boolean {
  return (
    query.length === 0 ||
    group.displayName.toLowerCase().includes(query) ||
    group.description.toLowerCase().includes(query)
  );
}
