import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DEFAULT_MODEL, type ModelSlug } from "@glade/contracts/provider/model";

type AgentAliasColor = "violet" | "fuchsia" | "teal" | "cyan" | "amber" | "orange";

interface BaseAgentAliasDefinition {
  readonly provider: ProviderKind;
  readonly displayName: string;
  readonly color: AgentAliasColor;
}

export interface CodexAgentAliasDefinition extends BaseAgentAliasDefinition {
  readonly provider: "codex";
  readonly kind: "model";
  readonly model: ModelSlug;
}

export interface ClaudeSubagentAliasDefinition extends BaseAgentAliasDefinition {
  readonly provider: "claudeAgent";
  readonly kind: "claude-subagent";
  readonly agentName: string;
  readonly description: string;
  readonly prompt: string;
  readonly tools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly model?: string;
}

export type AgentAliasDefinition = CodexAgentAliasDefinition | ClaudeSubagentAliasDefinition;

export type ResolvedAgentAlias = AgentAliasDefinition & {
  readonly alias: string;
};

const CLAUDE_AGENT_MENTION_ALIASES: Record<string, ClaudeSubagentAliasDefinition> = {
  explore: {
    provider: "claudeAgent",
    kind: "claude-subagent",
    agentName: "explore",
    displayName: "Explore",
    color: "cyan",
    description:
      "Read-only codebase explorer. Use for file discovery, code search, and gathering context before implementation.",
    prompt:
      "You are a focused codebase exploration specialist. Search broadly, gather the most relevant findings, and return a concise summary with the key files, evidence, and risks. Do not make code changes.",
    tools: ["Read", "Grep", "Glob"],
    model: "haiku",
  },
  review: {
    provider: "claudeAgent",
    kind: "claude-subagent",
    agentName: "review",
    displayName: "Code Review",
    color: "amber",
    description:
      "Bug and risk reviewer. Use for code review, regression hunting, and edge-case analysis.",
    prompt:
      "You are a senior code reviewer. Focus on behavioral regressions, correctness bugs, edge cases, and missing tests. Return findings first, then open questions, then a brief summary.",
    tools: ["Read", "Grep", "Glob"],
    model: "sonnet",
  },
  reviewer: {
    provider: "claudeAgent",
    kind: "claude-subagent",
    agentName: "review",
    displayName: "Code Review",
    color: "amber",
    description:
      "Bug and risk reviewer. Use for code review, regression hunting, and edge-case analysis.",
    prompt:
      "You are a senior code reviewer. Focus on behavioral regressions, correctness bugs, edge cases, and missing tests. Return findings first, then open questions, then a brief summary.",
    tools: ["Read", "Grep", "Glob"],
    model: "sonnet",
  },
  build: {
    provider: "claudeAgent",
    kind: "claude-subagent",
    agentName: "build",
    displayName: "Implementer",
    color: "violet",
    description:
      "Implementation teammate. Use for scoped code changes, debugging, and hands-on execution tasks.",
    prompt:
      "You are an implementation-focused coding teammate. Make targeted changes, validate assumptions with the available tools, and return a short implementation summary plus any remaining risks.",
    tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "MultiEdit"],
    model: "sonnet",
  },
  implement: {
    provider: "claudeAgent",
    kind: "claude-subagent",
    agentName: "build",
    displayName: "Implementer",
    color: "violet",
    description:
      "Implementation teammate. Use for scoped code changes, debugging, and hands-on execution tasks.",
    prompt:
      "You are an implementation-focused coding teammate. Make targeted changes, validate assumptions with the available tools, and return a short implementation summary plus any remaining risks.",
    tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "MultiEdit"],
    model: "sonnet",
  },
  plan: {
    provider: "claudeAgent",
    kind: "claude-subagent",
    agentName: "plan",
    displayName: "Planner",
    color: "fuchsia",
    description:
      "Planning specialist. Use for breaking work into steps, evaluating approaches, and preparing execution plans.",
    prompt:
      "You are a planning specialist. Clarify goals, evaluate tradeoffs, identify edge cases, and return a concrete ordered plan with the main risks called out explicitly.",
    tools: ["Read", "Grep", "Glob", "TodoWrite"],
    model: "sonnet",
  },
  planner: {
    provider: "claudeAgent",
    kind: "claude-subagent",
    agentName: "plan",
    displayName: "Planner",
    color: "fuchsia",
    description:
      "Planning specialist. Use for breaking work into steps, evaluating approaches, and preparing execution plans.",
    prompt:
      "You are a planning specialist. Clarify goals, evaluate tradeoffs, identify edge cases, and return a concrete ordered plan with the main risks called out explicitly.",
    tools: ["Read", "Grep", "Glob", "TodoWrite"],
    model: "sonnet",
  },
};

export const AGENT_MENTION_ALIASES_BY_PROVIDER: Record<
  ProviderKind,
  Record<string, AgentAliasDefinition>
> = {
  codex: {},
  claudeAgent: CLAUDE_AGENT_MENTION_ALIASES,
} as const satisfies Record<ProviderKind, Record<string, AgentAliasDefinition>>;

function mapAgentEntries(input: Record<string, AgentAliasDefinition>): ResolvedAgentAlias[] {
  return Object.entries(input)
    .map(([alias, definition]) => Object.assign({ alias }, definition))
    .toSorted((a, b) => a.alias.localeCompare(b.alias));
}

export function getAgentMentionAliases(provider?: ProviderKind): ResolvedAgentAlias[] {
  if (provider) {
    return mapAgentEntries(AGENT_MENTION_ALIASES_BY_PROVIDER[provider]);
  }

  return Object.values(AGENT_MENTION_ALIASES_BY_PROVIDER).flatMap((definitions) =>
    mapAgentEntries(definitions),
  );
}

export function getAgentMentionAutocompleteAliases(
  provider: ProviderKind,
  models: ReadonlyArray<{ slug: string; name: string; isSelectedHint?: boolean }> = [],
): ResolvedAgentAlias[] {
  if (provider === "claudeAgent") {
    return ["explore", "review", "build", "plan"].map((alias) => ({
      alias,
      ...CLAUDE_AGENT_MENTION_ALIASES[alias]!,
    }));
  }
  const aliases = new Map<string, ResolvedAgentAlias>();
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

export function resolveAgentAlias(
  alias: string,
  provider?: ProviderKind,
): AgentAliasDefinition | null {
  const normalized = alias.toLowerCase();
  if (provider) {
    return AGENT_MENTION_ALIASES_BY_PROVIDER[provider][normalized] ?? null;
  }

  for (const definitions of Object.values(AGENT_MENTION_ALIASES_BY_PROVIDER)) {
    const resolved = definitions[normalized];
    if (resolved) {
      return resolved;
    }
  }
  return null;
}
