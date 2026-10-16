import type { IconComponent } from "./iconComponent";
import { resolveServiceBrand } from "./serviceBrandArtwork";

// A skill named after a service, such as `hyperframes-cli` or `plugin:vercel-deploy`, shows that
// service's mark on the row that loads it. Claude loads skills through its `Skill` tool.
export function resolveSkillToolIcon(input: {
  readonly toolName?: string | undefined;
  readonly toolDetails?: { readonly input?: Readonly<Record<string, unknown>> } | undefined;
}): IconComponent | null {
  if (input.toolName !== "Skill") return null;
  const skill = input.toolDetails?.input?.skill;
  if (typeof skill !== "string") return null;
  const name = skill.slice(skill.lastIndexOf(":") + 1);
  const brand = resolveServiceBrand(name) ?? resolveServiceBrand(name.split(/[-_]/u)[0]);
  return brand?.icon ?? null;
}
