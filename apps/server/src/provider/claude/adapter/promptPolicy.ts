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
    "This session uses the Claude Agent SDK inside Glade. Glade is the host app; Claude Code is not the host app's name.\nUse the current working directory as the active workspace. For questions about this repository, inspect its files before asking the user for information the workspace can provide.\nApply the shared Glade harness policy alongside the Claude coding-agent instructions.",
    renderGladeHarnessPolicy({ gatewayControlAvailable, enableComputerControl }),
  ].join("\n\n");

export function claudeSubagentSteerContext(message: string): string {
  return `A user message arrived while you were working:
<user_steer>
${message}
</user_steer>
Apply it to the active task. Preserve existing objectives and constraints unless the user changes them; stop or replace the task when explicitly directed. Address a question or status request, then continue work that remains authorized.`;
}
