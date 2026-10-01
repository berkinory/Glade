import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import {
  type ProviderArtifactsState,
  type ProviderListCommandsResult,
} from "@glade/contracts/provider/providerDiscovery";

const CLAUDE_ARTIFACT_TOOL_NAME = "Artifact";

const CLAUDE_ARTIFACT_PROBE_COMMAND = "slides";

export function resolveClaudeArtifactsState(input: {
  readonly artifactsEnabled: boolean;
  readonly commands: readonly SlashCommand[];
  readonly initToolNames?: ReadonlySet<string> | undefined;
}): ProviderArtifactsState {
  if (!input.artifactsEnabled) return "disabled";
  const available = input.initToolNames
    ? input.initToolNames.has(CLAUDE_ARTIFACT_TOOL_NAME)
    : input.commands.some((command) => command.name === CLAUDE_ARTIFACT_PROBE_COMMAND);
  return available ? "available" : "unavailable";
}

const CLAUDE_ARTIFACT_COMMANDS = [
  { name: "design", description: "Make a new Design artifact from a brief" },
  { name: "slides", description: "Make a new Slides deck artifact from a brief" },
] as const;

export function mapSupportedCommands(
  commands: SlashCommand[],
  artifacts: ProviderArtifactsState,
): ProviderListCommandsResult {
  const missingArtifactCommands =
    artifacts === "available"
      ? []
      : CLAUDE_ARTIFACT_COMMANDS.filter(
          (known) => !commands.some((command) => command.name === known.name),
        );
  return {
    commands: [
      ...commands
        .filter((command) => command.name !== "goal" && command.name !== "plan")
        .map((cmd) => ({
          name: cmd.name,
          description: cmd.description || undefined,
        })),
      ...missingArtifactCommands,
    ],
    artifacts,
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
