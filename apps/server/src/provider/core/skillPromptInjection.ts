import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderSkillReference } from "@glade/contracts/provider/providerDiscovery";

const MAX_INLINE_SKILL_CONTENT_CHARS = 24_000;

const INLINE_SKILLS_HEADER =
  "The user invoked the following agent skill(s) for this request. Follow each " +
  "skill's instructions. File paths referenced inside a skill are relative to its " +
  '"dir" attribute.';

function pathSegments(path: string): Set<string> {
  return new Set(
    nodePath
      .normalize(path)
      .split(/[\\/]+/)
      .map((segment) => segment.toLowerCase()),
  );
}

function shouldInlineSkillForProvider(provider: ProviderKind, skillPath: string): boolean {
  const segments = pathSegments(skillPath);
  switch (provider) {
    case "codex":
      return segments.has(".claude");
    case "claudeAgent":
      return !segments.has(".claude");
  }
}

export async function buildInlineSkillInstructions(input: {
  readonly provider: ProviderKind;
  readonly skills: ReadonlyArray<ProviderSkillReference>;
  readonly maxChars: number;
}): Promise<string> {
  const inlineSkills = input.skills.filter((skill) =>
    shouldInlineSkillForProvider(input.provider, skill.path),
  );
  if (inlineSkills.length === 0 || input.maxChars <= 0) {
    return "";
  }

  let text = "";
  for (const skill of inlineSkills) {
    let content: string;
    try {
      content = await fs.readFile(skill.path, "utf8");
    } catch {
      continue;
    }
    let trimmed = content.trim();
    if (trimmed.length > MAX_INLINE_SKILL_CONTENT_CHARS) {
      trimmed = `${trimmed.slice(0, MAX_INLINE_SKILL_CONTENT_CHARS)}\n[skill content truncated]`;
    }
    const block = `<skill name=${JSON.stringify(skill.name)} dir=${JSON.stringify(
      nodePath.dirname(skill.path),
    )}>\n${trimmed}\n</skill>`;
    const candidate =
      text.length === 0 ? `${INLINE_SKILLS_HEADER}\n\n${block}` : `${text}\n\n${block}`;
    if (candidate.length > input.maxChars) {
      break;
    }
    text = candidate;
  }
  return text;
}
