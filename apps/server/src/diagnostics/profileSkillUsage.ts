import type { ProfileStats } from "@glade/contracts/server/stats";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { isBuiltInComposerSlashCommandName } from "@glade/shared/threads/composerSlashCommands";
import { num } from "./profileQueryValues";

type SkillUsage = ProfileStats["skills"][number];

export interface SkillUsageMessageRow {
  readonly messageId: string | null;
  readonly text: string | null;
  readonly skillsJson: string | null;
  readonly mentionsJson: string | null;
}

export interface ArchivedSkillUsageRow {
  readonly name: string | null;
  readonly kind: string | null;
  readonly runCount: number;
}

type UsageKind = "skill" | "agent";

interface UsageCount {
  name: string;
  kind: UsageKind;
  runCount: number;
}

const PROFILE_SKILL_NAME_TOKEN =
  "[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?(?::[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?)*";

const PROFILE_SKILL_TOKEN_REGEX = new RegExp(
  `(^|[\\s([{<])([$/])(${PROFILE_SKILL_NAME_TOKEN})(?=$|[\\s.,!?;)\\]}>])`,
  "giu",
);

const PROFILE_TRAILING_PROMPT_BLOCK_PATTERNS = [
  /\n*<pasted_text>\n[\s\S]*?\n<\/pasted_text>\s*$/u,
  /\n*<file_comments>\n[\s\S]*?\n<\/file_comments>\s*$/u,
  /\n*<terminal_context>\n[\s\S]*?\n<\/terminal_context>\s*$/u,
  /\n*<assistant_selection>\n[\s\S]*?\n<\/assistant_selection>\s*$/u,
] as const;

function normalizeUsageName(value: unknown): string | null {
  const name = nonEmptyTrimmed(value) ?? null;
  if (!name) {
    return null;
  }
  const withoutPrefix = name.replace(/^[$/@]+/u, "").trim();
  return withoutPrefix.length > 0 ? withoutPrefix : null;
}

function usageKey(kind: UsageKind, name: string): string {
  return `${kind}\u0000${name.toLowerCase()}`;
}

function usageKindSortOrder(kind: UsageKind): number {
  return kind === "skill" ? 0 : 1;
}

function isObviousNonSkillDollarToken(name: string): boolean {
  return /^\d/u.test(name) || /^[A-Z_][A-Z0-9_]*$/u.test(name);
}

function stripProfileTrailingPromptBlocks(prompt: string): string {
  let visiblePrompt = prompt;
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const pattern of PROFILE_TRAILING_PROMPT_BLOCK_PATTERNS) {
      const nextPrompt = visiblePrompt.replace(pattern, "").replace(/\n+$/u, "");
      if (nextPrompt !== visiblePrompt) {
        visiblePrompt = nextPrompt;
        stripped = true;
        break;
      }
    }
  }
  return visiblePrompt;
}

function parseReferenceNames(json: string | null): string[] {
  const value = nonEmptyTrimmed(json) ?? null;
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      if (entry && typeof entry === "object" && "name" in entry) {
        const name = normalizeUsageName((entry as { readonly name?: unknown }).name);
        return name ? [name] : [];
      }
      return [];
    });
  } catch {
    return [];
  }
}

function extractTextSkillNames(text: string | null): string[] {
  const prompt = nonEmptyTrimmed(text) ?? null;
  if (!prompt) {
    return [];
  }
  const visiblePrompt = stripProfileTrailingPromptBlocks(prompt);
  if (visiblePrompt.trim().length === 0) {
    return [];
  }

  const names: string[] = [];
  PROFILE_SKILL_TOKEN_REGEX.lastIndex = 0;
  for (const match of visiblePrompt.matchAll(PROFILE_SKILL_TOKEN_REGEX)) {
    const leadingBoundary = match[1] ?? "";
    const prefix = match[2] ?? "";
    const rawName = match[3] ?? "";

    if (leadingBoundary === "<" && prefix === "/") {
      continue;
    }
    if (prefix === "/" && isBuiltInComposerSlashCommandName(rawName)) {
      continue;
    }

    const hasExplicitSkillPrefix = rawName.toLowerCase().startsWith("skill:");
    const normalizedRawName = rawName.toLowerCase().startsWith("skill:")
      ? rawName.slice("skill:".length)
      : rawName;
    const name = normalizeUsageName(normalizedRawName);
    if (name) {
      if (prefix === "$" && !hasExplicitSkillPrefix && isObviousNonSkillDollarToken(name)) {
        continue;
      }
      names.push(name);
    }
  }
  return names;
}

export function aggregateProfileSkillUsageRows(
  rows: ReadonlyArray<SkillUsageMessageRow>,
  archivedRows: ReadonlyArray<ArchivedSkillUsageRow> = [],
): SkillUsage[] {
  const counts = new Map<string, UsageCount>();

  for (const row of rows) {
    const messageSkillCounts = new Map<
      string,
      { name: string; structuredCount: number; textCount: number }
    >();
    const messageAgentUsages = new Map<string, { name: string; kind: UsageKind }>();
    const addMessageSkillUsage = (rawName: string, source: "structured" | "text") => {
      const name = normalizeUsageName(rawName);
      if (!name) {
        return;
      }
      const key = usageKey("skill", name);
      const next = messageSkillCounts.get(key) ?? {
        name,
        structuredCount: 0,
        textCount: 0,
      };
      if (source === "structured") {
        next.structuredCount += 1;
      } else {
        next.textCount += 1;
      }
      messageSkillCounts.set(key, next);
    };
    const addMessageAgentUsage = (rawName: string) => {
      const name = normalizeUsageName(rawName);
      if (!name) {
        return;
      }
      const key = usageKey("agent", name);
      if (!messageAgentUsages.has(key)) {
        messageAgentUsages.set(key, { name, kind: "agent" });
      }
    };

    for (const name of parseReferenceNames(row.skillsJson)) {
      addMessageSkillUsage(name, "structured");
    }
    for (const name of extractTextSkillNames(row.text)) {
      addMessageSkillUsage(name, "text");
    }
    for (const name of parseReferenceNames(row.mentionsJson)) {
      addMessageAgentUsage(name);
    }

    for (const usage of messageSkillCounts.values()) {
      const increment = Math.max(usage.structuredCount, usage.textCount);
      if (increment <= 0) {
        continue;
      }
      const key = usageKey("skill", usage.name);
      const existing = counts.get(key);
      if (existing) {
        existing.runCount += increment;
      } else {
        counts.set(key, { name: usage.name, kind: "skill", runCount: increment });
      }
    }

    for (const usage of messageAgentUsages.values()) {
      const key = usageKey(usage.kind, usage.name);
      const existing = counts.get(key);
      if (existing) {
        existing.runCount += 1;
      } else {
        counts.set(key, { ...usage, runCount: 1 });
      }
    }
  }

  for (const row of archivedRows) {
    const name = normalizeUsageName(row.name);
    const kind: UsageKind | null = row.kind === "skill" || row.kind === "agent" ? row.kind : null;
    const runCount = Math.trunc(num(row.runCount));
    if (!name || !kind || runCount <= 0) {
      continue;
    }
    const key = usageKey(kind, name);
    const existing = counts.get(key);
    if (existing) {
      existing.runCount += runCount;
    } else {
      counts.set(key, { name, kind, runCount });
    }
  }

  return [...counts.values()]
    .toSorted(
      (left, right) =>
        right.runCount - left.runCount ||
        usageKindSortOrder(left.kind) - usageKindSortOrder(right.kind) ||
        left.name.localeCompare(right.name),
    )
    .map((row) => ({
      name: row.name,
      displayName: `${row.kind === "skill" ? "$" : "@"}${row.name}`,
      kind: row.kind,
      runCount: row.runCount,
    }));
}
