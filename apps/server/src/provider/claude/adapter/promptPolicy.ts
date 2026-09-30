import type { SettingSource, AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { renderGladeHarnessPolicy } from "../../../agentGateway/harnessPolicy.ts";
import { getAgentMentionAliases } from "@glade/shared/provider/agentMentions";

export const CLAUDE_SETTING_SOURCES = [
  "user",
  "project",
  "local",
] as const satisfies ReadonlyArray<SettingSource>;

export const buildEmbeddedClaudeSystemPromptAppend = (
  gatewayControlAvailable: boolean,
  enableComputerControl = false,
) =>
  [
    "You are running inside Glade, a coding app that embeds the Claude Agent SDK.",
    "Do not present the host app as Claude Code unless the user is explicitly asking about Claude Code.",
    "Treat the current working directory as the active workspace for the task.",
    "When the user asks about the current project, codebase, or repository, proactively inspect files in the current working directory before asking the user where to look.",
    "When spawning subagents, set the Agent tool's `model` parameter and pick reasoning effort by choosing a worker-<tier> subagent type (worker-low, worker-medium, worker-high, worker-xhigh).",
    "Honor explicit user instructions about a subagent's model or effort verbatim; otherwise match task complexity: mechanical work → haiku or worker-low, standard work → sonnet or worker-medium, hard reasoning → opus or fable with worker-high and above.",
    renderGladeHarnessPolicy({
      gatewayControlAvailable,
      enableComputerControl,
      automationAuthoring: "tool-descriptions",
    }),
  ].join("\n");

const CLAUDE_WORKER_EFFORT_TIERS = ["low", "medium", "high", "xhigh"] as const;

const CLAUDE_WORKER_PROMPT =
  "You are a general-purpose worker agent. Complete the assigned task end to end with the available tools, then return a concise report covering what you did, key findings, and any remaining risks.";

export function claudeWorkerEffortFromSubagentType(subagentType: string): string | undefined {
  return (CLAUDE_WORKER_EFFORT_TIERS as readonly string[]).find(
    (tier) => subagentType === `worker-${tier}`,
  );
}

export function claudeSubagentSteerContext(message: string): string {
  return `The user sent you a message mid-task: ${message}. Address it and adjust your work accordingly.`;
}

export function buildClaudeSdkSubagents(): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};

  for (const alias of getAgentMentionAliases("claudeAgent")) {
    if (alias.kind !== "claude-subagent" || agents[alias.agentName]) {
      continue;
    }

    agents[alias.agentName] = {
      description: alias.description,
      prompt: alias.prompt,
      ...(alias.tools ? { tools: [...alias.tools] } : {}),
      ...(alias.disallowedTools ? { disallowedTools: [...alias.disallowedTools] } : {}),
      ...(alias.model ? { model: alias.model } : {}),
    };
  }

  for (const tier of CLAUDE_WORKER_EFFORT_TIERS) {
    const agentName = `worker-${tier}`;
    if (agents[agentName]) {
      continue;
    }
    agents[agentName] = {
      description: `General-purpose worker at ${tier} reasoning effort; choose per task complexity`,
      prompt: CLAUDE_WORKER_PROMPT,
      effort: tier,
    };
  }

  return agents;
}
