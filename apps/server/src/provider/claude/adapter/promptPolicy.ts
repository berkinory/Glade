import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";
import { renderGladeHarnessPolicy } from "../../../agentGateway/harnessPolicy.ts";

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
    renderGladeHarnessPolicy({
      gatewayControlAvailable,
      enableComputerControl,
      automationAuthoring: "tool-descriptions",
    }),
  ].join("\n");

export function claudeSubagentSteerContext(message: string): string {
  return `The user sent you a message mid-task: ${message}. Address it and adjust your work accordingly.`;
}
