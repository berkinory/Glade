import { cachedByCommand } from "./commandParseCache";
import { basenameOfPath } from "../file-icons";

export function compactPath(path: string): string {
  if (path === ".") {
    return "current directory";
  }
  if (path === "..") {
    return "parent directory";
  }
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) {
    return path;
  }
  return parts.slice(-2).join("/");
}

// Options whose value is the next argument rather than a pattern or a path.
const SEARCH_OPTIONS_WITH_VALUE = new Set([
  "-t",
  "-g",
  "-m",
  "-A",
  "-B",
  "-C",
  "--type",
  "--glob",
  "--max-count",
]);
const SEARCH_PATTERN_OPTIONS = new Set(["-e", "--regexp"]);

export function extractSearchPatternAndPath(args: string): {
  pattern: string | null;
  // The words the pattern looks for, one per alternative.
  terms: string[];
  // The searched paths as written, for opening them.
  rawPaths: string[];
  paths: string[];
  // `-l` lists the files that match instead of the matching lines.
  listsFiles: boolean;
} {
  const tokens = tokenizeCommandArgs(args);
  let pattern: string | null = null;
  const positional: string[] = [];
  let listsFiles = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (SEARCH_PATTERN_OPTIONS.has(token)) {
      pattern ??= tokens[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (SEARCH_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (token === "--files-with-matches" || /^-[a-zA-Z]*l[a-zA-Z]*$/.test(token)) {
      listsFiles = true;
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    positional.push(token);
  }

  if (pattern === null) {
    pattern = positional.shift() ?? null;
  }
  // `rg src/` names a folder, not a pattern.
  if (pattern !== null && positional.length === 0 && looksLikeSearchPath(pattern)) {
    positional.push(pattern);
    pattern = null;
  }
  return {
    pattern: pattern === null ? null : readableSearchPattern(pattern),
    terms: pattern === null ? [] : searchTerms(pattern),
    rawPaths: positional.map((path) => path.trim()).filter(Boolean),
    paths: positional.map((path) => compactPath(path.trim())).filter(Boolean),
    listsFiles,
  };
}

const MAX_SEARCH_PATTERN_CHARS = 40;

// Agents search with regular expressions; the row names what they looked for. `["'](claudeAgent|codex)["']`
// reads as "claudeAgent or codex". A pattern with no words left keeps its raw text.
function readableSearchPattern(pattern: string): string | null {
  const alternatives = searchTerms(pattern);
  // One pattern's two alternatives read as a choice; more are counted like several searches.
  const readable =
    alternatives.length === 0
      ? pattern.trim()
      : alternatives.length === 2
        ? alternatives.join(" or ")
        : formatSearchTerms(alternatives);
  if (!/[a-z0-9]/i.test(readable)) {
    return null;
  }
  return readable.length > MAX_SEARCH_PATTERN_CHARS
    ? `${readable.slice(0, MAX_SEARCH_PATTERN_CHARS - 3)}...`
    : readable;
}

/** Up to two terms by name and how many more: `a`, `a, b`, `a, b +3`. */
export function formatSearchTerms(terms: readonly string[]): string {
  return terms.length <= 2
    ? terms.join(", ")
    : `${terms.slice(0, 2).join(", ")} +${terms.length - 2}`;
}

function searchTerms(pattern: string): string[] {
  return (
    pattern
      .replace(/\\\|/g, "|")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\\[bBsSwWdD]/g, "")
      .replace(/\{\d*,?\d*\}/g, "")
      // `.*`, `.+` and `.?` match anything; a lone dot is usually the literal one in `a.b`.
      .replace(/\.[*+?]/g, "")
      .replace(/\\(.)/g, "$1")
      .replace(/[()^$*+?"'`]/g, "")
      .split("|")
      .map((alternative) => alternative.trim())
      .filter((alternative) => /[a-z0-9]/i.test(alternative))
  );
}

function looksLikeSearchPath(token: string): boolean {
  return token.includes("/") || token.startsWith(".") || token.includes("\\");
}

export function tokenizeCommandArgs(args: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < args.length) {
    while (args[index] === " ") {
      index += 1;
    }
    if (index >= args.length) {
      break;
    }

    const quote = args[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      let token = "";
      while (index < args.length && args[index] !== quote) {
        // Single quotes keep every backslash; double quotes only escape $ ` " \ and newlines, so a
        // regex's `\b` or `\|` reaches the command as written.
        if (
          quote === '"' &&
          args[index] === "\\" &&
          index + 1 < args.length &&
          '$`"\\\n'.includes(args[index + 1]!)
        ) {
          token += args[index + 1];
          index += 2;
          continue;
        }
        token += args[index];
        index += 1;
      }
      if (args[index] === quote) {
        index += 1;
      }
      tokens.push(token);
      continue;
    }

    let token = "";
    while (index < args.length && args[index] !== " ") {
      token += args[index];
      index += 1;
    }
    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

export function splitToolAndArgs(command: string): [tool: string, args: string] {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return ["", ""];
  }
  const separator = normalized.indexOf(" ");
  if (separator === -1) {
    return [basenameOfPath(normalized).toLowerCase(), ""];
  }
  const tool = basenameOfPath(normalized.slice(0, separator)).toLowerCase();
  const args = normalized.slice(separator + 1).trim();
  return [tool, args];
}

// Strips a shell invocation such as `/bin/zsh -lc "..."` down to the script it runs.
function unwrapShellInvocation(rawCommand: string): string {
  const value = rawCommand.trim();
  const lowered = value.toLowerCase();
  const prefix = SHELL_INVOCATION_PREFIXES.find((candidate) => lowered.startsWith(candidate));
  if (!prefix) {
    return value;
  }
  const script = value.slice(prefix.length).trim();
  const quoted =
    script.length >= 2 &&
    ((script.startsWith('"') && script.endsWith('"')) ||
      (script.startsWith("'") && script.endsWith("'")));
  return quoted ? script.slice(1, -1).trim() : script;
}

const SHELL_INVOCATION_PREFIXES = ["/usr/bin/", "/bin/", ""].flatMap((directory) =>
  ["bash", "zsh", "sh"].flatMap((shell) =>
    ["-lc ", "-c "].map((flag) => `${directory}${shell} ${flag}`),
  ),
);

function parseCommandSegments(rawCommand: string): string[] {
  return splitShellCommands(unwrapShellInvocation(rawCommand)).flatMap(({ producer }) => {
    const normalized = normalizeCommandSegment(producer);
    return normalized ? [normalized] : [];
  });
}

// The commands a shell script runs, in order. `&&`, `||`, `;` and newlines separate commands, a
// pipe keeps only the command that produces its input, and setup (cd, exports, assignments) and
// control-flow keywords are dropped. A heredoc's body is text rather than commands, so parsing
// skips it and resumes after its terminator.
export const commandSegments = cachedByCommand(parseCommandSegments);

/**
 * The folder a script's file paths are relative to: its last `cd <absolute path>`, such as the one in
 * `mkdir -p /tmp/x && cd /tmp/x && cat > notes.md`. A relative `cd` leaves it unknown.
 */
export function commandDirectory(rawCommand: string): string | null {
  let directory: string | null = null;
  for (const { producer } of splitShellCommands(unwrapShellInvocation(rawCommand))) {
    const cd = /^\s*(?:builtin\s+)?cd\s+(\S+)\s*$/.exec(producer);
    if (!cd) continue;
    const target = cd[1]!.replace(/^(['"])(.*)\1$/, "$2");
    directory = target.startsWith("/") ? target : null;
  }
  return directory;
}

export interface ShellWriteTarget {
  path: string;
  append: boolean;
}

// Commands whose only job is to produce text, so redirecting their output writes a file.
const CONTENT_WRITERS = new Set(["cat", "echo", "printf"]);
const STDOUT_REDIRECTION = /(?:^|\s)1?(>>?)\s*([^\s&|;<>]+)/g;

/**
 * Files a script writes with plain shell: `cat > a.ts <<EOF`, `echo x >> log`, `… | tee a b`.
 * Other commands redirected to a file (a build piped into a log) only run; they are not writes.
 */
export function shellWriteTargets(rawCommand: string): ShellWriteTarget[] {
  const targets: ShellWriteTarget[] = [];
  // A file another program's output went to is a log: `echo exit=$? >> test.log` annotates it.
  const logs = new Set<string>();
  for (const { producer, consumers } of splitShellCommands(unwrapShellInvocation(rawCommand))) {
    const core = stripControlFlow(producer);
    if (!core || isShellSetupPreamble(core)) continue;
    const [tool] = splitToolAndArgs(core);
    // Quoted text is the content being written, never a redirection.
    const unquoted = core.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, " ");
    for (const match of unquoted.matchAll(STDOUT_REDIRECTION)) {
      const path = match[2]!;
      if (path === "/dev/null") continue;
      if (CONTENT_WRITERS.has(tool)) targets.push({ path, append: match[1] === ">>" });
      else logs.add(path);
    }
    for (const consumer of [core, ...consumers]) {
      const [consumerTool, args] = splitToolAndArgs(stripControlFlow(consumer));
      if (consumerTool !== "tee") continue;
      const tokens = tokenizeCommandArgs(args);
      const append = tokens.some((token) => token === "-a" || token === "--append");
      for (const token of tokens) {
        if (!token.startsWith("-") && token !== "/dev/null") targets.push({ path: token, append });
      }
    }
  }
  return targets.filter((target) => !logs.has(target.path));
}

/** `NAME=value` assignments a script makes before its commands, such as `f=src/a.ts`. */
export function shellAssignments(rawCommand: string): Map<string, string> {
  const assignments = new Map<string, string>();
  for (const { producer } of splitShellCommands(unwrapShellInvocation(rawCommand))) {
    const match = /^\s*(?:export\s+)?([A-Za-z_]\w*)=(\S+)\s*$/.exec(producer);
    if (match) assignments.set(match[1]!, match[2]!.replace(/^(['"])(.*)\1$/, "$2"));
  }
  return assignments;
}

/**
 * A script that opens a heredoc, split at it: the lines up to the one that opens it, the text it
 * feeds its command, and whatever follows the terminator.
 */
export function splitHeredoc(
  rawCommand: string,
): { head: string; body: string; tail: string } | null {
  const lines = unwrapShellInvocation(rawCommand).split("\n");
  const openIndex = lines.findIndex((line) => HEREDOC_OPENER.test(line));
  if (openIndex < 0) return null;
  const terminator = HEREDOC_OPENER.exec(lines[openIndex]!)![2]!;
  const rest = lines.slice(openIndex + 1);
  const closeIndex = rest.findIndex((line) => line.trim() === terminator);
  const body = closeIndex < 0 ? rest : rest.slice(0, closeIndex);
  const tail = closeIndex < 0 ? [] : rest.slice(closeIndex + 1);
  return {
    head: lines.slice(0, openIndex + 1).join("\n"),
    body: body.join("\n"),
    tail: tail.join("\n").trim(),
  };
}

const HEREDOC_OPENER = /<<-?\s*(['"]?)([A-Za-z0-9_]+)\1/;
const HEREDOC_OPERATOR = new RegExp(`^${HEREDOC_OPENER.source}`);

interface ShellSegment {
  // The command that produces the segment's output; pipe consumers are listed apart.
  producer: string;
  consumers: string[];
}

function splitShellCommands(command: string): ShellSegment[] {
  const segments: ShellSegment[] = [];
  let producer = "";
  let consumers: string[] = [];
  let quote: '"' | "'" | null = null;
  // Terminators of the heredocs the current line opens, in order.
  let heredocTerminators: string[] = [];
  const flush = () => {
    segments.push({ producer, consumers });
    producer = "";
    consumers = [];
  };
  const keep = (text: string) => {
    if (consumers.length > 0) consumers[consumers.length - 1] += text;
    else producer += text;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    const next = command[index + 1];
    if (char === "\\" && next !== undefined) {
      keep(char + next);
      index += 1;
      continue;
    }
    if (quote) {
      keep(char);
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      keep(char);
      continue;
    }
    if (char === "<" && next === "<" && command[index + 2] !== "<") {
      const terminator = HEREDOC_OPERATOR.exec(command.slice(index))?.[2];
      if (terminator) heredocTerminators.push(terminator);
    }
    if (char === "\n") {
      flush();
      for (const terminator of heredocTerminators) {
        index = heredocEnd(command, index + 1, terminator);
        if (index < 0) return segments;
      }
      heredocTerminators = [];
      continue;
    }
    if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
      flush();
      index += 1;
      continue;
    }
    if (char === ";") {
      flush();
      continue;
    }
    if (char === "|") {
      consumers.push("");
      continue;
    }
    keep(char);
  }
  flush();
  return segments;
}

// The index of the newline ending a heredoc's terminator line, searching from `start`; -1 when the
// heredoc never closes, so the rest of the script is its body.
function heredocEnd(command: string, start: number, terminator: string): number {
  let lineStart = start;
  while (lineStart <= command.length) {
    const newline = command.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? command.length : newline;
    if (command.slice(lineStart, lineEnd).trim() === terminator) return lineEnd;
    if (newline < 0) return -1;
    lineStart = newline + 1;
  }
  return -1;
}

const CONTROL_FLOW_PREFIX = /^(?:do|then|else)\s+/;
const CONTROL_FLOW_STATEMENT = /^(?:for|while|until|if|elif|case|select)\b|^(?:done|fi|esac|[{}])$/;

function stripControlFlow(segment: string): string {
  let current = segment
    .trim()
    .replace(/^\(\s*/, "")
    .replace(/\s*\)$/, "");
  while (CONTROL_FLOW_PREFIX.test(current)) {
    current = current.replace(CONTROL_FLOW_PREFIX, "");
  }
  return CONTROL_FLOW_STATEMENT.test(current) ? "" : current;
}

function normalizeCommandSegment(segment: string): string | null {
  const current = stripControlFlow(segment);
  if (!current || isShellSetupPreamble(current)) {
    return null;
  }
  return stripCommandDisplayWrappers(current.replace(OUTPUT_REDIRECTION, "")) || null;
}

// `2>/dev/null`, `> out.txt`, `2>&1`: where output goes is not what the command works on.
const OUTPUT_REDIRECTION = /(^|\s)(?:\d*|&)>>?\s*\S+/g;

export function containsHeredoc(command: string): boolean {
  return /(^|\s)<<-?\s*['"]?[A-Za-z0-9_]+/.test(command);
}

function isShellSetupPreamble(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  if (/^(?:builtin\s+)?cd(?:\s+|$)/.test(normalized)) {
    return true;
  }
  if (/^(?:source|\.)\s+/.test(normalized)) {
    return true;
  }
  if (/^set\s+[-+][A-Za-z]/.test(normalized)) {
    return true;
  }
  if (
    /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=[^\s]+(?:\s+[A-Za-z_][A-Za-z0-9_]*=[^\s]+)*$/.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

function stripCommandDisplayWrappers(command: string): string {
  let current = command.replace(/\s+/g, " ").trim();
  for (let attempts = 0; attempts < 4; attempts += 1) {
    const [tool, args] = splitToolAndArgs(current);
    const next =
      tool === "env"
        ? stripEnvCommand(args)
        : tool === "timeout" || tool === "gtimeout"
          ? stripTimeoutCommand(args)
          : tool === "nice"
            ? stripNiceCommand(args)
            : tool === "arch"
              ? stripArchCommand(args)
              : tool === "command"
                ? args
                : null;
    if (!next || next === current) {
      return current;
    }
    current = next.trim();
  }
  return current;
}

function stripEnvCommand(args: string): string | null {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === "--") {
      index += 1;
      break;
    }
    if (token === "-u" || token === "--unset" || token === "-C" || token === "--chdir") {
      index += 2;
      continue;
    }
    if (token.startsWith("--unset=") || token.startsWith("--chdir=")) {
      index += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    break;
  }
  return index < tokens.length ? tokens.slice(index).join(" ") : null;
}

function stripTimeoutCommand(args: string): string | null {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  while (index < tokens.length && tokens[index]?.startsWith("-")) {
    index += tokens[index] === "-s" || tokens[index] === "-k" ? 2 : 1;
  }
  if (index < tokens.length && /^\d+(?:\.\d+)?[smhd]?$/.test(tokens[index]!)) {
    index += 1;
  }
  return index < tokens.length ? tokens.slice(index).join(" ") : null;
}

function stripNiceCommand(args: string): string | null {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  if (tokens[index] === "-n") {
    index += 2;
  } else {
    while (tokens[index]?.startsWith("-")) {
      index += 1;
    }
  }
  return index < tokens.length ? tokens.slice(index).join(" ") : null;
}

function stripArchCommand(args: string): string | null {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  while (tokens[index]?.startsWith("-")) {
    index += 1;
  }
  return index < tokens.length ? tokens.slice(index).join(" ") : null;
}
