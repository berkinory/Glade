import { normalizeCompactToolLabel } from "./toolCallLabel.presentations";
import type { ReadableToolTitleInput } from "./toolCallLabel.presentations";
import {
  extractToolDescriptorFromPayload,
  humanizeRequestKind,
  isGenericToolTitle,
  normalizeToolDescriptor,
} from "./toolCallLabel.descriptors";
import type { CommandVisualKind, ReadableCommandDisplay } from "./toolCallLabel.descriptors";
import {
  compactPath,
  extractSearchPatternAndPath,
  findShellChain,
  splitToolAndArgs,
  stripCommandDisplayWrappers,
  tokenizeCommandArgs,
  unwrapShellCommandIfPresent,
} from "./toolCallLabel.shell";

export function deriveReadableToolTitle(input: ReadableToolTitleInput): string | null {
  const normalizedTitle = normalizeCompactToolLabel(input.title ?? "");
  const normalizedFallback = normalizeCompactToolLabel(input.fallbackLabel);
  const commandLabel = input.command
    ? deriveReadableCommandDisplay(input.command, input.isRunning).verb
    : null;
  const commandLike = input.itemType === "command_execution" || input.requestKind === "command";

  const requestKindLabel = humanizeRequestKind(input.requestKind, input.itemType);

  if (normalizedTitle.length > 0 && !isGenericToolTitle(normalizedTitle)) {
    return (input.itemType === "mcp_tool_call" || input.itemType === "dynamic_tool_call") &&
      /[_-]/.test(normalizedTitle)
      ? (normalizeToolDescriptor(normalizedTitle) ?? normalizedTitle)
      : normalizedTitle;
  }

  if (commandLike && commandLabel) {
    return commandLabel;
  }

  const descriptor = normalizeToolDescriptor(extractToolDescriptorFromPayload(input.payload));
  if (descriptor && !isGenericToolTitle(descriptor)) {
    return descriptor;
  }

  if (requestKindLabel) {
    return requestKindLabel;
  }

  if (normalizedFallback.length > 0 && !isGenericToolTitle(normalizedFallback)) {
    return normalizedFallback;
  }
  if (normalizedTitle.length > 0) {
    return normalizedTitle;
  }
  if (normalizedFallback.length > 0) {
    return normalizedFallback;
  }
  return null;
}

export function deriveReadableCommandDisplay(
  rawCommand: string,
  isRunning = false,
): ReadableCommandDisplay {
  const command = stripCommandDisplayWrappers(unwrapShellCommandIfPresent(rawCommand));
  const primaryCommand = firstShellCommandSegment(command);
  const [tool, args] = splitToolAndArgs(primaryCommand);

  const inspect = Object.hasOwn(INSPECT_COMMAND_PRESENTATIONS, tool)
    ? INSPECT_COMMAND_PRESENTATIONS[tool]
    : undefined;
  if (inspect) {
    const [running, completed, targetKind] = inspect;
    const target =
      targetKind === "file" || targetKind === "directory"
        ? lastPathComponents(args, targetKind)
        : targetKind === "search"
          ? searchSummary(args)
          : findTarget(args, "files");
    return commandDisplay(running, completed, target, rawCommand, isRunning);
  }

  switch (tool) {
    case "mkdir":
      return commandDisplay(
        "Creating",
        "Created",
        lastPathComponents(args, "directory"),
        rawCommand,
        isRunning,
      );
    case "rm":
      return commandDisplay(
        "Removing",
        "Removed",
        lastPathComponents(args, "file"),
        rawCommand,
        isRunning,
      );
    case "cp":
    case "mv":
      return commandDisplay(
        tool === "cp" ? "Copying" : "Moving",
        tool === "cp" ? "Copied" : "Moved",
        lastPathComponents(args, "file"),
        rawCommand,
        isRunning,
      );
    case "git":
      return humanizeGitCommand(args, rawCommand, isRunning);
    case "node":
    case "bun":
    case "deno":
    case "python":
    case "python3":
    case "ruby":
    case "perl":
      return commandDisplay(
        "Running",
        "Ran",
        inlineScriptTarget(tool, command, args) ?? compactInlineCommand(command),
        rawCommand,
        isRunning,
      );
    case "osascript":
      return commandDisplay("Running", "Ran", "AppleScript", rawCommand, isRunning);
    default:
      return commandDisplay("Running", "Ran", compactInlineCommand(command), rawCommand, isRunning);
  }
}

function commandDisplay(
  running: string,
  completed: string,
  target: string,
  fullCommand: string,
  isRunning: boolean,
): ReadableCommandDisplay {
  return { verb: isRunning ? running : completed, target, fullCommand };
}

type InspectPresentation = readonly [
  running: string,
  completed: string,
  target: "file" | "directory" | "search" | "find",
];

const INSPECT_COMMAND_PRESENTATIONS: Record<string, InspectPresentation> = Object.fromEntries(
  (
    [
      [["cat", "nl", "head", "tail", "sed", "less", "more"], "Reading", "Read", "file"],
      [["rg", "grep", "ag", "ack"], "Searching", "Searched", "search"],
      [["find", "fd"], "Finding", "Found", "find"],
      [["ls"], "Listing", "Listed", "directory"],
    ] as const
  ).flatMap(([tools, running, completed, target]) =>
    tools.map((tool) => [tool, [running, completed, target]]),
  ),
);

function firstCommandExecutable(rawCommand: string): string {
  const trimmed = rawCommand.trim();
  const match = /^(?:"([^"]+)"|'([^']+)'|(\S+))/u.exec(trimmed);
  const executable = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  return executable.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
}

export function deriveFriendlyCommandTarget(rawCommand: string): string {
  const executable = firstCommandExecutable(rawCommand);
  if (
    executable === "pwsh" ||
    executable === "pwsh.exe" ||
    executable === "powershell" ||
    executable === "powershell.exe"
  ) {
    return "PowerShell";
  }
  if (executable === "cmd" || executable === "cmd.exe") {
    return "Command Prompt";
  }

  const target = deriveReadableCommandDisplay(rawCommand).target.trim();
  return target.length <= 72 ? target : `${target.slice(0, 69).trimEnd()}…`;
}

export function resolveCommandVisualKind(rawCommand: string): CommandVisualKind {
  const command = stripCommandDisplayWrappers(unwrapShellCommandIfPresent(rawCommand));
  const [tool] = splitToolAndArgs(firstShellCommandSegment(command));
  if (Object.hasOwn(INSPECT_COMMAND_PRESENTATIONS, tool)) {
    return "inspect";
  }
  if (tool === "git") {
    return "git";
  }
  if (tool === "gh" || tool === "hub") {
    return "github";
  }
  return "terminal";
}

function humanizeGitCommand(
  args: string,
  rawCommand: string,
  isRunning: boolean,
): ReadableCommandDisplay {
  const normalizedArgs = stripGitGlobalOptions(args);
  const subcommand = normalizedArgs.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (subcommand === "checkout" || subcommand === "switch") {
    return commandDisplay(
      "Switching to",
      "Switched to",
      checkoutTarget(args),
      rawCommand,
      isRunning,
    );
  }
  const presentation = Object.hasOwn(GIT_COMMAND_PRESENTATIONS, subcommand)
    ? GIT_COMMAND_PRESENTATIONS[subcommand]
    : undefined;
  return presentation
    ? commandDisplay(...presentation, rawCommand, isRunning)
    : commandDisplay(
        "Running",
        "Ran",
        compactInlineCommand(`git ${normalizedArgs}`.trim()),
        rawCommand,
        isRunning,
      );
}

const GIT_COMMAND_PRESENTATIONS: Record<string, readonly [string, string, string]> = {
  status: ["Checking", "Checked", "git status"],
  diff: ["Comparing", "Compared", "changes"],
  show: ["Inspecting", "Inspected", "commit"],
  log: ["Reviewing", "Reviewed", "git history"],
  add: ["Staging", "Staged", "changes"],
  commit: ["Committing", "Committed", "changes"],
  push: ["Pushing", "Pushed", "to remote"],
  pull: ["Pulling", "Pulled", "from remote"],
};

function stripGitGlobalOptions(args: string): string {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === "-C" || token === "-c" || token === "--git-dir" || token === "--work-tree") {
      index += 2;
      continue;
    }
    if (
      token.startsWith("-C") ||
      token.startsWith("-c") ||
      token.startsWith("--git-dir=") ||
      token.startsWith("--work-tree=")
    ) {
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      index += 1;
      continue;
    }
    break;
  }
  return tokens.slice(index).join(" ");
}

function checkoutTarget(args: string): string {
  const branch = tokenizeCommandArgs(args).at(-1)?.trim();
  return branch ? branch : "branch";
}

function lastPathComponents(args: string, fallback: string): string {
  const tokens = tokenizeCommandArgs(args);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!.replace(/^['"]|['"]$/g, "");
    if (!token || token.startsWith("-")) {
      continue;
    }
    return compactPath(token);
  }
  return fallback;
}

function findTarget(args: string, fallback: string): string {
  const tokens = tokenizeCommandArgs(args);
  let skipNext = false;
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token.startsWith("-")) {
      if (
        token === "-maxdepth" ||
        token === "-mindepth" ||
        token === "-name" ||
        token === "-type" ||
        token === "-path"
      ) {
        skipNext = true;
      }
      continue;
    }
    return compactPath(token);
  }
  return fallback;
}

function compactInlineCommand(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  if (normalized.length <= 140) {
    return normalized;
  }
  return `${normalized.slice(0, 137).trimEnd()}...`;
}

function firstShellCommandSegment(command: string): string {
  const chain = findShellChain(command);
  return chain ? command.slice(0, chain.operatorStart).trim() : command;
}

function inlineScriptTarget(tool: string, command: string, args: string): string | null {
  const normalizedTool = tool === "python3" ? "python" : tool;
  if (containsHeredoc(command) || hasInlineScriptFlag(args)) {
    return `${normalizedTool} script`;
  }
  return null;
}

function containsHeredoc(command: string): boolean {
  return /(^|\s)<<-?\s*['"]?[A-Za-z0-9_]+/.test(command);
}

function hasInlineScriptFlag(args: string): boolean {
  const tokens = tokenizeCommandArgs(args);
  return tokens.some((token) => token === "-e" || token === "-c" || token.startsWith("-e="));
}

function searchSummary(args: string): string {
  const { pattern, path } = extractSearchPatternAndPath(args);
  if (pattern && path) {
    return `for ${pattern} in ${path}`;
  }
  if (pattern) {
    return `for ${pattern}`;
  }
  if (path) {
    return `in ${path}`;
  }
  return "files";
}
