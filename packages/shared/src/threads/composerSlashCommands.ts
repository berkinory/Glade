import { COMPUTER_USE_SLASH_COMMAND } from "../computer/computerInvocation";

export const BUILT_IN_COMPOSER_SLASH_COMMANDS = [
  "clear",
  "compact",
  "model",
  "plan",
  "debug",
  "default",
  "review",
  "fork",
  "status",
  "subagents",
  COMPUTER_USE_SLASH_COMMAND,
  "fast",
  "export",
  "goal",
  "rename",
  "feedback",
  "automation",
] as const;

export type BuiltInComposerSlashCommand = (typeof BUILT_IN_COMPOSER_SLASH_COMMANDS)[number];

export function normalizeComposerSlashCommandName(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

export function isBuiltInComposerSlashCommandName(
  value: string,
): value is BuiltInComposerSlashCommand {
  const normalizedValue = normalizeComposerSlashCommandName(value);
  return BUILT_IN_COMPOSER_SLASH_COMMANDS.some((command) => command === normalizedValue);
}
