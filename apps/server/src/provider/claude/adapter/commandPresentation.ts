import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { type ProviderListCommandsResult } from "@glade/contracts/provider/providerDiscovery";

export function mapSupportedCommands(commands: SlashCommand[]): ProviderListCommandsResult {
  return {
    commands: commands
      .filter((command) => command.name !== "goal" && command.name !== "plan")
      .map((cmd) => ({
        name: cmd.name,
        description: cmd.description.trim() || undefined,
      })),
    source: "claudeAgent",
    cached: false,
  };
}

export function isClaudeCompactionCommand(text: string | undefined): boolean {
  return /^\/compact(?:\s|$)/.test(text?.trim() ?? "");
}

export // When the session reported its commands, `/etc is odd` stays model input too; without that list
// (startup race, discovery failure) the shape alone decides.
function isClaudeNativeSlashCommand(
  text: string | undefined,
  nativeCommandNames?: ReadonlySet<string>,
): boolean {
  const name = /^\/([a-z][\w:-]*)(?:\s|$)/i.exec(text?.trim() ?? "")?.[1];
  if (name === undefined) return false;
  if (nativeCommandNames === undefined || nativeCommandNames.size === 0) return true;
  return nativeCommandNames.has(name) || isClaudeCompactionCommand(text);
}
