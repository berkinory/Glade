import { cachedByCommand } from "./commandParseCache";
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
  type CommandFileEffects,
  type ScriptLanguage,
  commandFileEffects,
  inlineScriptOf,
  isFileWriteStep,
  resolveCommandPaths,
} from "./commandFileEffects";
import {
  commandSegments,
  formatSearchTerms,
  compactPath,
  containsHeredoc,
  extractSearchPatternAndPath,
  splitToolAndArgs,
  tokenizeCommandArgs,
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

const settledCommandDisplay = cachedByCommand((rawCommand) =>
  parseReadableCommandDisplay(rawCommand, false),
);
const runningCommandDisplay = cachedByCommand((rawCommand) =>
  parseReadableCommandDisplay(rawCommand, true),
);

export function deriveReadableCommandDisplay(
  rawCommand: string,
  isRunning = false,
): ReadableCommandDisplay {
  return (isRunning ? runningCommandDisplay : settledCommandDisplay)(rawCommand);
}

function parseReadableCommandDisplay(
  rawCommand: string,
  isRunning: boolean,
): ReadableCommandDisplay {
  const effects = commandFileEffects(rawCommand);
  if (effects.writeKind) {
    const [running, completed] = WRITE_VERBS[effects.writeKind];
    return commandDisplay(
      running,
      completed,
      filesTarget(effects.written, ""),
      rawCommand,
      isRunning,
    );
  }
  const segments = meaningfulSegments(rawCommand);
  const inspections = segments.map(inspectPresentation);
  if (segments.length > 1 && inspections.every(Boolean)) {
    return combinedInspectDisplay(segments, rawCommand, isRunning);
  }
  // A chain that does more than look around is named by the first thing it does besides writing.
  const acting = segments.filter((_, index) => !inspections[index]);
  const primary =
    acting.find((segment) => !isFileWriteStep(segment, rawCommand)) ??
    acting[0] ??
    segments[0] ??
    rawCommand;
  return segmentDisplay(primary, rawCommand, isRunning);
}

function parseCommandSearchShape(
  rawCommand: string,
): { listsFiles: boolean; singleFile: string | null } | null {
  const segments = meaningfulSegments(rawCommand);
  if (segments.length === 0) return null;
  const searches = segments.map((segment) => {
    const kind = inspectPresentation(segment)?.[2];
    return kind === "search" ? extractSearchPatternAndPath(splitToolAndArgs(segment)[1]) : null;
  });
  if (searches.some((search) => search === null)) return null;
  const only = searches.length === 1 ? searches[0]! : null;
  const singlePath = only?.paths.length === 1 ? only.rawPaths[0]! : null;
  return {
    listsFiles: searches.every((search) => search!.listsFiles),
    // grep and rg only print the file name when they search more than one file.
    singleFile: singlePath && /\.[A-Za-z0-9]{1,8}$/.test(singlePath) ? singlePath : null,
  };
}

/**
 * How to read a command's output as search results, when every step is a grep, rg or find: whether
 * it lists files (`-l`), and the one file it searched, whose matches carry no file name.
 */
export const commandSearchShape = cachedByCommand(parseCommandSearchShape);

export type ReadRange = { start: number; end: number | null } | { lastLines: number };

function parseCommandReadRange(rawCommand: string): ReadRange | null {
  const segments = meaningfulSegments(rawCommand).filter(
    (segment) => inspectPresentation(segment)?.[2] === "file",
  );
  if (segments.length !== 1 || readFilesOf(segments).length !== 1) return null;
  const [tool, args] = splitToolAndArgs(segments[0]!);
  const tokens = tokenizeCommandArgs(args);
  if (tool === "sed") {
    const script = tokens.find((token) => /^\d+(?:,(?:\d+|\$))?p$/.test(token));
    const match = script ? /^(\d+)(?:,(\d+|\$))?p$/.exec(script) : null;
    if (!match) return null;
    const end =
      match[2] === undefined ? Number(match[1]) : match[2] === "$" ? null : Number(match[2]);
    return { start: Number(match[1]), end };
  }
  const countIndex = tokens.findIndex(
    (token) => token === "-n" || /^-\d+$/.test(token) || /^-n\d+$/.test(token),
  );
  if (countIndex < 0) return null;
  const token = tokens[countIndex]!;
  const count = Number(token === "-n" ? tokens[countIndex + 1] : token.replace(/^-n?/, ""));
  if (!Number.isInteger(count) || count <= 0) return null;
  if (tool === "head") return { start: 1, end: count };
  if (tool === "tail") return { lastLines: count };
  return null;
}

/** The lines a single-file read shows: `sed -n 40,80p`, `head -n 20` or `tail -n 30`. */
export const commandReadRange = cachedByCommand(parseCommandReadRange);

function parseCommandPrimaryTool(rawCommand: string): string | null {
  const segments = meaningfulSegments(rawCommand);
  const primary = segments.find((segment) => !inspectPresentation(segment)) ?? segments[0];
  return primary ? splitToolAndArgs(primary)[0] : null;
}

/** The program a command is named after: its first step that does more than look around. */
export const commandPrimaryTool = cachedByCommand(parseCommandPrimaryTool);

function segmentDisplay(
  segment: string,
  rawCommand: string,
  isRunning: boolean,
): ReadableCommandDisplay {
  const [tool, args] = splitToolAndArgs(segment);
  const inspect = inspectPresentation(segment);
  if (inspect) {
    const [running, completed, targetKind] = inspect;
    if (targetKind === "search" && extractSearchPatternAndPath(args).listsFiles) {
      const summary = searchSummary(args);
      return commandDisplay(
        "Finding files",
        "Found files",
        summary.startsWith("for ") ? `with ${summary.slice(4)}` : summary,
        rawCommand,
        isRunning,
      );
    }
    const target =
      targetKind === "file"
        ? filesTarget(readSegmentFiles(segment), args)
        : targetKind === "directory"
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
    case "php":
    case "sqlite3":
    case "osascript":
      return scriptDisplay(segment, rawCommand, isRunning);
    default:
      return commandDisplay("Running", "Ran", compactInlineCommand(segment), rawCommand, isRunning);
  }
}

// Several reads, searches and listings chained together read as one look around the project.
function combinedInspectDisplay(
  segments: readonly string[],
  rawCommand: string,
  isRunning: boolean,
): ReadableCommandDisplay {
  const kinds = new Set(segments.map((segment) => inspectPresentation(segment)![2]));
  const files = readFilesOf(segments);
  const fileTarget = filesTarget(files, "");
  if (kinds.size === 1 && kinds.has("file")) {
    return commandDisplay("Reading", "Read", fileTarget, rawCommand, isRunning);
  }
  if ([...kinds].every((kind) => kind === "search" || kind === "find")) {
    return combinedSearchDisplay(segments, rawCommand, isRunning);
  }
  if (kinds.size === 1 && kinds.has("directory")) {
    return commandDisplay("Listing", "Listed", `${segments.length} folders`, rawCommand, isRunning);
  }
  return commandDisplay(
    "Exploring",
    "Explored",
    files.length > 0 ? fileTarget : "the project",
    rawCommand,
    isRunning,
  );
}

const WRITE_VERBS: Record<NonNullable<CommandFileEffects["writeKind"]>, [string, string]> = {
  edit: ["Editing", "Edited"],
  write: ["Writing", "Wrote"],
  append: ["Appending to", "Appended to"],
};

const SCRIPT_LABELS: Record<ScriptLanguage, string> = {
  python: "Python script",
  javascript: "JavaScript",
  typescript: "TypeScript",
  ruby: "Ruby script",
  perl: "Perl script",
  php: "PHP script",
  sql: "SQL",
  applescript: "AppleScript",
};

// Code handed to an interpreter is named by its language, or by the script file it runs. What it
// does inside is only claimed when its text shows it: the files it writes are labelled before this.
function scriptDisplay(
  segment: string,
  rawCommand: string,
  isRunning: boolean,
): ReadableCommandDisplay {
  const [tool, args] = splitToolAndArgs(segment);
  if (tool === "sqlite3") {
    const database = tokenizeCommandArgs(args).find((token) => !token.startsWith("-"));
    if (database) {
      // `file:…/state.sqlite?mode=ro` opens the same database read-only.
      const path = database.replace(/^file:/, "").replace(/\?.*$/, "");
      return commandDisplay("Querying", "Queried", compactPath(path), rawCommand, isRunning);
    }
  }
  // The step itself says whether it runs inline code or a file; in `python3 - <<EOF … EOF` followed
  // by `python3 -m unittest`, the second step is the test run, not the script.
  const script = inlineScriptOf(segment);
  if (!script) {
    return commandDisplay("Running", "Ran", compactInlineCommand(segment), rawCommand, isRunning);
  }
  if (script.file) {
    return commandDisplay("Running", "Ran", compactPath(script.file), rawCommand, isRunning);
  }
  const read = commandFileEffects(rawCommand).read;
  if (read.length > 0) {
    return commandDisplay("Reading", "Read", filesTarget(read, ""), rawCommand, isRunning);
  }
  return commandDisplay("Running", "Ran", SCRIPT_LABELS[script.language], rawCommand, isRunning);
}

// Several searches name what they looked for and, when they share it, where.
function combinedSearchDisplay(
  segments: readonly string[],
  rawCommand: string,
  isRunning: boolean,
): ReadableCommandDisplay {
  const searches = segments.map((segment) =>
    extractSearchPatternAndPath(splitToolAndArgs(segment)[1]),
  );
  const terms = [...new Set(searches.flatMap((search) => search.terms))];
  const folders = new Set(searches.map((search) => search.paths[0] ?? ""));
  const sharedFolder = folders.size === 1 ? [...folders][0] : "";
  const where = sharedFolder ? ` in ${sharedFolder}` : "";
  const listsFiles = searches.every((search) => search.listsFiles);
  if (terms.length === 0) {
    return commandDisplay(
      "Searching",
      "Searched",
      `${segments.length} times${where}`,
      rawCommand,
      isRunning,
    );
  }
  const named = formatSearchTerms(terms);
  return listsFiles
    ? commandDisplay("Finding files", "Found files", `with ${named}${where}`, rawCommand, isRunning)
    : commandDisplay("Searching", "Searched", `for ${named}${where}`, rawCommand, isRunning);
}

function filesTarget(files: readonly string[], args: string): string {
  if (files.length === 0) return lastPathComponents(args, "file");
  return files.length === 1 ? compactPath(files[0]!) : `${files.length} files`;
}

// Options of read commands whose value is the next argument rather than a file.
const READ_OPTIONS_WITH_VALUE: Record<string, ReadonlySet<string>> = {
  head: new Set(["-n", "-c"]),
  tail: new Set(["-n", "-c"]),
  sed: new Set(["-e", "-f", "--expression", "--file"]),
};

// The files one read command names: `cat a b`, `head -n 20 a b`, `sed -n 1,30p a b`. Without `-e`
// or `-f`, sed's first argument is its script.
function readSegmentFiles(segment: string): string[] {
  const [tool, args] = splitToolAndArgs(segment);
  const valueOptions = READ_OPTIONS_WITH_VALUE[tool];
  const positional: string[] = [];
  let scriptGiven = false;
  const tokens = tokenizeCommandArgs(args);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (valueOptions?.has(token)) {
      scriptGiven ||= tool === "sed";
      index += 1;
      continue;
    }
    // `-ne SCRIPT` ends a cluster of short flags with the one that takes the script.
    if (tool === "sed" && /^-[a-zA-Z]*[ef]$/.test(token)) {
      scriptGiven = true;
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    positional.push(token);
  }
  return tool === "sed" && !scriptGiven ? positional.slice(1) : positional;
}

function readFilesOf(segments: readonly string[]): string[] {
  return [
    ...new Set(
      segments
        .filter((segment) => inspectPresentation(segment)?.[2] === "file")
        .flatMap(readSegmentFiles),
    ),
  ];
}

function parseCommandReadFilePaths(rawCommand: string): string[] {
  return resolveCommandPaths(rawCommand, readFilesOf(meaningfulSegments(rawCommand)));
}

/**
 * Every file a shell command reads with cat, sed, head and the like. Paths relative to a leading
 * `cd <absolute folder>` are resolved against it; others stay as written.
 */
export const commandReadFilePaths = cachedByCommand(parseCommandReadFilePaths);

// Output plumbing that only shapes what another command printed.
const PASSTHROUGH_TOOLS: ReadonlySet<string> = new Set([
  "echo",
  "printf",
  "true",
  "wc",
  "sort",
  "uniq",
  "cut",
  "tr",
  "sleep",
]);

const meaningfulSegments = cachedByCommand(parseMeaningfulSegments);

function parseMeaningfulSegments(rawCommand: string): string[] {
  const segments = commandSegments(rawCommand);
  const meaningful = segments.filter(
    (segment) => !PASSTHROUGH_TOOLS.has(splitToolAndArgs(segment)[0]),
  );
  return meaningful.length > 0 ? meaningful : segments;
}

function isInPlaceSed(args: string): boolean {
  return tokenizeCommandArgs(args).some(
    (token) => token === "-i" || token.startsWith("-i") || token === "--in-place",
  );
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

// `cat <<'EOF' | wc -l` feeds text it writes inline and `sed -i` edits; neither only reads.
function inspectPresentation(segment: string): InspectPresentation | undefined {
  const [tool, args] = splitToolAndArgs(segment);
  if (
    !Object.hasOwn(INSPECT_COMMAND_PRESENTATIONS, tool) ||
    containsHeredoc(segment) ||
    (tool === "sed" && isInPlaceSed(args))
  ) {
    return undefined;
  }
  return INSPECT_COMMAND_PRESENTATIONS[tool];
}

function firstCommandExecutable(rawCommand: string): string {
  const trimmed = rawCommand.trim();
  const match = /^(?:"([^"]+)"|'([^']+)'|(\S+))/u.exec(trimmed);
  const executable = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  return executable.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
}

function parseFriendlyCommandTarget(rawCommand: string): string {
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

export const deriveFriendlyCommandTarget = cachedByCommand(parseFriendlyCommandTarget);

function parseInspectKind(rawCommand: string): "read" | "search" | "list" | null {
  const kinds = new Set<InspectPresentation[2]>();
  for (const segment of meaningfulSegments(rawCommand)) {
    const inspect = inspectPresentation(segment);
    if (!inspect) return null;
    kinds.add(inspect[2]);
  }
  if (kinds.size === 0) return null;
  // A chain that reads files counts them, even when it also searches or lists.
  if (kinds.has("file")) return "read";
  if (kinds.size === 1 && kinds.has("directory")) return "list";
  return "search";
}

export const classifyInspectCommand = cachedByCommand(parseInspectKind);

function parseCommandVisualKind(rawCommand: string): CommandVisualKind {
  const segments = meaningfulSegments(rawCommand);
  const primary = segments.find((segment) => !inspectPresentation(segment));
  if (!primary) {
    return segments.length > 0 ? "inspect" : "terminal";
  }
  const [tool] = splitToolAndArgs(primary);
  if (tool === "git") {
    return "git";
  }
  if (tool === "gh" || tool === "hub") {
    return "github";
  }
  return "terminal";
}

export const resolveCommandVisualKind = cachedByCommand(parseCommandVisualKind);

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

function searchSummary(args: string): string {
  const { pattern, paths } = extractSearchPatternAndPath(args);
  const where = paths.length > 1 ? `${paths[0]} +${paths.length - 1}` : paths[0];
  if (pattern && where) {
    return `for ${pattern} in ${where}`;
  }
  if (pattern) {
    return `for ${pattern}`;
  }
  if (where) {
    return `in ${where}`;
  }
  return "files";
}
