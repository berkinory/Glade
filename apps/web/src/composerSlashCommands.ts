import { type GitBranch } from "@glade/contracts/git/git";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import {
  BUILT_IN_COMPOSER_SLASH_COMMANDS,
  isBuiltInComposerSlashCommandName,
  normalizeComposerSlashCommandName,
  type BuiltInComposerSlashCommand,
} from "@glade/shared/threads/composerSlashCommands";
import { rankProviderDiscoveryItems } from "./lib/providerDiscovery";

export type ComposerSlashCommand = BuiltInComposerSlashCommand;

export interface ComposerSlashCommandDefinition {
  command: ComposerSlashCommand;
  label: `/${ComposerSlashCommand}`;
  description: string;
  source: "app" | "shared";
}

export interface ComposerSlashInvocation {
  command: ComposerSlashCommand;
  args: string;
}

export type FastSlashCommandAction = "toggle" | "on" | "off" | "status" | "invalid";
export type ForkSlashCommandTarget = "local" | "worktree";

const CLAUDE_NATIVE_COMMAND_ALIASES: Record<string, readonly string[]> = {
  clear: ["reset", "new"],
  config: ["settings"],
  desktop: ["app"],
  exit: ["quit"],
  feedback: ["bug"],
  mobile: ["ios", "android"],
  permissions: ["allowed-tools"],
  "remote-control": ["rc"],
  resume: ["continue"],
};

function getProviderNativeSlashCommandAliases(
  provider: ProviderKind,
  command: string,
): readonly string[] {
  const normalizedCommand = normalizeComposerSlashCommandName(command);
  if (provider !== "claudeAgent") {
    return [];
  }
  return CLAUDE_NATIVE_COMMAND_ALIASES[normalizedCommand] ?? [];
}

function expandProviderNativeSlashCommandNames(
  provider: ProviderKind,
  commandNames: ReadonlyArray<string>,
): string[] {
  const expandedNames = new Set<string>();
  for (const commandName of commandNames) {
    const normalizedCommandName = normalizeComposerSlashCommandName(commandName);
    if (!normalizedCommandName || normalizedCommandName === "goal") {
      continue;
    }
    expandedNames.add(normalizedCommandName);
    for (const alias of getProviderNativeSlashCommandAliases(provider, normalizedCommandName)) {
      expandedNames.add(alias);
    }
  }
  return [...expandedNames];
}

function providerUsesAppOwnedReviewSlashCommand(provider: ProviderKind): boolean {
  return provider === "codex";
}

function shouldKeepBuiltInSlashCommandDespiteNativeCollision(
  provider: ProviderKind,
  command: ComposerSlashCommand,
): boolean {
  return (
    command === "computer-use" ||
    command === "export" ||
    command === "feedback" ||
    command === "fork" ||
    command === "rename" ||
    (providerUsesAppOwnedReviewSlashCommand(provider) && command === "review")
  );
}

export function shouldHideProviderNativeCommandFromComposerMenu(
  provider: ProviderKind,
  command: string,
  options: { readonly availableAppCommands?: ReadonlySet<string> } = {},
): boolean {
  const normalizedCommand = normalizeComposerSlashCommandName(command);
  const appCommandIsAvailable = options.availableAppCommands?.has(normalizedCommand) ?? true;
  return (
    normalizedCommand === "computer-use" ||
    normalizedCommand === "debug" ||
    normalizedCommand === "default" ||
    (normalizedCommand === "export" && appCommandIsAvailable) ||
    (normalizedCommand === "feedback" && appCommandIsAvailable) ||
    (normalizedCommand === "fork" && appCommandIsAvailable) ||
    (normalizedCommand === "rename" && appCommandIsAvailable) ||
    (providerUsesAppOwnedReviewSlashCommand(provider) && normalizedCommand === "review")
  );
}

export function providerSupportsTextNativeReviewCommand(
  provider: ProviderKind,
  nativeCommandNames: ReadonlyArray<{ readonly name: string } | string>,
): boolean {
  if (providerUsesAppOwnedReviewSlashCommand(provider)) {
    return false;
  }
  return nativeCommandNames.some((command) => {
    const name = typeof command === "string" ? command : command.name;
    return name.trim().toLowerCase() === "review";
  });
}

export function getProviderNativeSlashCommandSearchTerms(
  provider: ProviderKind,
  command: string,
): readonly string[] {
  const normalizedCommand = normalizeComposerSlashCommandName(command);
  return [normalizedCommand, ...getProviderNativeSlashCommandAliases(provider, normalizedCommand)];
}

const COMPOSER_SLASH_COMMAND_DEFINITIONS: Record<
  ComposerSlashCommand,
  ComposerSlashCommandDefinition
> = {
  clear: {
    command: "clear",
    label: "/clear",
    description: "Start a fresh thread and clear the current conversation context",
    source: "shared",
  },
  compact: {
    command: "compact",
    label: "/compact",
    description: "Compact the current thread context to free space",
    source: "app",
  },
  model: {
    command: "model",
    label: "/model",
    description: "Switch response model for this thread",
    source: "shared",
  },
  review: {
    command: "review",
    label: "/review",
    description: "Start a code review for current changes",
    source: "app",
  },
  fork: {
    command: "fork",
    label: "/fork",
    description: "Fork this thread into local or a new worktree",
    source: "app",
  },
  status: {
    command: "status",
    label: "/status",
    description: "Show context usage and rate-limit status",
    source: "app",
  },
  "computer-use": {
    command: "computer-use",
    label: "/computer-use",
    description: "Use Glade Computer for this request only",
    source: "app",
  },
  fast: {
    command: "fast",
    label: "/fast",
    description: "Turn fast mode on or off for this thread",
    source: "app",
  },
  export: {
    command: "export",
    label: "/export",
    description: "Download this thread as a ZIP archive (thread.json + transcript.md)",
    source: "app",
  },

  rename: {
    command: "rename",
    label: "/rename",
    description: "Regenerate this thread title, or set an exact title",
    source: "app",
  },
  feedback: {
    command: "feedback",
    label: "/feedback",
    description: "Send feedback to the Glade team",
    source: "app",
  },
};

export function isBuiltInComposerSlashCommand(value: string): value is ComposerSlashCommand {
  return isBuiltInComposerSlashCommandName(value);
}

function parseComposerSlashInvocation(text: string): ComposerSlashInvocation | null {
  return parseComposerSlashInvocationForCommands(text, BUILT_IN_COMPOSER_SLASH_COMMANDS);
}

export function parseComposerSlashInvocationForCommands(
  text: string,
  commands: ReadonlyArray<ComposerSlashCommand>,
): ComposerSlashInvocation | null {
  const match = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  const command = normalizeComposerSlashCommandName(match[1] ?? "");
  if (!command || !commands.includes(command as ComposerSlashCommand)) {
    return null;
  }
  return {
    command: command as ComposerSlashCommand,
    args: (match[2] ?? "").trim(),
  };
}

export function filterComposerSlashCommands(
  query: string,
  commands: ReadonlyArray<ComposerSlashCommand> = BUILT_IN_COMPOSER_SLASH_COMMANDS,
): ComposerSlashCommandDefinition[] {
  const matches = rankProviderDiscoveryItems(commands, query, (command) => {
    const definition = COMPOSER_SLASH_COMMAND_DEFINITIONS[command];
    return [
      { value: command },
      { value: definition.label.slice(1) },
      { value: definition.description, weight: 200 },
    ];
  });

  return matches.map((command) => COMPOSER_SLASH_COMMAND_DEFINITIONS[command]);
}

function hasMeaningfulComposerText(prompt: string): boolean {
  return prompt.trim().length > 0;
}

export function canOfferForkSlashCommand(input: {
  prompt: string;
  imageCount: number;
  terminalContextCount: number;
  selectedSkillCount: number;
  selectedMentionCount: number;
}): boolean {
  return (
    !hasMeaningfulComposerText(input.prompt) &&
    input.imageCount === 0 &&
    input.terminalContextCount === 0 &&
    input.selectedSkillCount === 0 &&
    input.selectedMentionCount === 0
  );
}

export function canOfferReviewSlashCommand(input: {
  prompt: string;
  imageCount: number;
  terminalContextCount: number;
  selectedSkillCount: number;
  selectedMentionCount: number;
}): boolean {
  return (
    !hasMeaningfulComposerText(input.prompt) &&
    input.imageCount === 0 &&
    input.terminalContextCount === 0 &&
    input.selectedSkillCount === 0 &&
    input.selectedMentionCount === 0
  );
}

function buildReviewPrompt(input: { target: "changes" | "base-branch" }): string {
  return input.target === "base-branch"
    ? "Review this branch's committed changes since its merge base with the intended base branch. Resolve the base from available repository or PR context; clarify only if ambiguity changes the review scope. Keep unrelated uncommitted changes outside the review.\n\nRead repository instructions, relevant callers and existing tests to establish the affected behavior. Check correctness, security, data integrity and lifecycle changes. When the user request or a relevant spec is available, also check missing or partial requirements and behavior added outside the agreed scope. Cite the requirement behind a mismatch; if intent is unavailable, state that limitation rather than inventing it.\n\nSupport each finding with the changed code, a credible trigger and its impact. Resolve uncertain API or control-flow assumptions before reporting a bug. Keep personal style preferences and unrelated pre-existing defects out of findings. Report missing coverage only for an important behavior with a concrete regression risk; avoid repeating checks already enforced by tooling.\n\nReturn actionable findings in severity order with precise file/line references. Label requirement mismatches distinctly from implementation defects, and separate unresolved questions and verification limits. If no actionable findings remain, say so without claiming proof of correctness. Review only; edits require a separate request."
    : "Review the current uncommitted changes: staged and unstaged diffs plus relevant untracked files from git status.\n\nRead repository instructions, relevant callers and existing tests to establish the affected behavior. Check correctness, security, data integrity and lifecycle changes. When the user request or a relevant spec is available, also check missing or partial requirements and behavior added outside the agreed scope. Cite the requirement behind a mismatch; if intent is unavailable, state that limitation rather than inventing it.\n\nSupport each finding with the changed code, a credible trigger and its impact. Resolve uncertain API or control-flow assumptions before reporting a bug. Keep personal style preferences and unrelated pre-existing defects out of findings. Report missing coverage only for an important behavior with a concrete regression risk; avoid repeating checks already enforced by tooling.\n\nReturn actionable findings in severity order with precise file/line references. Label requirement mismatches distinctly from implementation defects, and separate unresolved questions and verification limits. If no actionable findings remain, say so without claiming proof of correctness. Review only; edits require a separate request.";
}

export function parseFastSlashCommandAction(text: string): FastSlashCommandAction | null {
  const invocation = parseComposerSlashInvocation(text);
  if (!invocation || invocation.command !== "fast") {
    return null;
  }
  const arg = invocation.args.toLowerCase();
  if (!arg) {
    return "toggle";
  }
  if (arg === "on") {
    return "on";
  }
  if (arg === "off") {
    return "off";
  }
  if (arg === "status") {
    return "status";
  }
  return "invalid";
}

export function resolveComposerSlashRootBranch(input: {
  branches: ReadonlyArray<GitBranch> | null | undefined;
  activeProjectCwd: string | null | undefined;
  activeThreadBranch: string | null | undefined;
}): string | null {
  return (
    input.branches?.find(
      (branch) =>
        branch.current === true &&
        (branch.worktreePath === null ||
          branch.worktreePath === undefined ||
          branch.worktreePath === input.activeProjectCwd),
    )?.name ??
    input.branches?.find((branch) => branch.current === true)?.name ??
    input.activeThreadBranch ??
    null
  );
}

export function getAvailableComposerSlashCommands(input: {
  provider: ProviderKind;
  supportsFastSlashCommand: boolean;
  canOfferCompactCommand: boolean;
  canOfferReviewCommand: boolean;
  canOfferForkCommand: boolean;
  canOfferExportCommand: boolean;
  providerNativeCommandNames?: ReadonlyArray<string>;
}): ComposerSlashCommand[] {
  const collidingNativeCommandNames = new Set<ComposerSlashCommand>(
    expandProviderNativeSlashCommandNames(
      input.provider,
      input.providerNativeCommandNames ?? [],
    ).filter(
      (name): name is ComposerSlashCommand =>
        isBuiltInComposerSlashCommand(name) &&
        !shouldKeepBuiltInSlashCommandDespiteNativeCollision(input.provider, name),
    ),
  );

  const availableCommands: ComposerSlashCommand[] =
    input.provider !== "claudeAgent"
      ? [
          "clear",
          ...(input.canOfferCompactCommand ? (["compact"] as const) : []),
          "model",
          ...(input.supportsFastSlashCommand ? (["fast"] as const) : []),
          ...(input.canOfferReviewCommand ? (["review"] as const) : []),
          ...(input.canOfferForkCommand ? (["fork"] as const) : []),
          "status",
          "computer-use",
          ...(input.canOfferExportCommand ? (["export"] as const) : []),
          "rename",
          "feedback",
        ]
      : [
          ...(input.canOfferForkCommand ? (["fork"] as const) : []),
          ...(input.canOfferExportCommand ? (["export"] as const) : []),
          "rename",
          "computer-use",
          "feedback",
        ];
  return availableCommands.filter((command) => !collidingNativeCommandNames.has(command));
}

export function hasProviderNativeSlashCommand(
  provider: ProviderKind,
  commandNames: ReadonlyArray<string>,
  command: string,
): boolean {
  const normalizedCommand = normalizeComposerSlashCommandName(command);
  return expandProviderNativeSlashCommandNames(provider, commandNames).includes(normalizedCommand);
}

export function buildSlashReviewComposerPrompt(args: string): string {
  const trimmedArgs = args.trim();
  const normalizedArgs = trimmedArgs.toLowerCase();
  const reviewTarget =
    normalizedArgs === "base" || normalizedArgs.startsWith("base ") ? "base-branch" : "changes";
  const basePrompt = buildReviewPrompt({ target: reviewTarget });
  if (!trimmedArgs) {
    return basePrompt;
  }
  if (reviewTarget === "base-branch") {
    const baseBranchHint = trimmedArgs.replace(/^base\b/i, "").trim();
    return baseBranchHint.length > 0
      ? `${basePrompt}\nUse ${baseBranchHint} as the base branch if needed.`
      : basePrompt;
  }
  return `${basePrompt}\nFocus especially on: ${trimmedArgs}`;
}

export function parseForkSlashCommandArgs(args: string): {
  target: ForkSlashCommandTarget | null;
  invalid: boolean;
} {
  const trimmedArgs = args.trim();
  if (!trimmedArgs) {
    return { target: null, invalid: false };
  }

  const match = /^(local|worktree)$/i.exec(trimmedArgs);
  if (!match) {
    return { target: null, invalid: true };
  }

  return {
    target: match[1]!.toLowerCase() as ForkSlashCommandTarget,
    invalid: false,
  };
}
