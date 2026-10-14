import type { WorkLogToolOutputDetails } from "./toolCallDetails";
import { commandSearchShape } from "./toolCallLabel.commands";

// What a finished shell command produced, read from its output: test totals, diagnostics, the line
// that explains a failure, and the matches a search found. Every reader returns null rather than
// guess when the output does not have the shape it knows.

// Terminal colour codes, including the bare `u001b[…m` left when the escape byte was dropped.
const ANSI_SEQUENCE = /(?:\u001b|u001b)\[[0-9;]*[A-Za-z]/g;
// Claude reports a failed command's code on the first line and where its shell ended up last.
const EXIT_CODE_LINE = /^Exit code (\d+)\s*$/;
const SHELL_TRAILER = /^(?:Shell cwd was reset to |Session cwd remains )/;

/** Output lines with terminal colours and the provider's own notes removed. */
function commandOutputLines(output: string): string[] {
  return output
    .replace(ANSI_SEQUENCE, "")
    .split(/\r?\n/)
    .filter((line, index) => !(index === 0 && EXIT_CODE_LINE.test(line)))
    .filter((line) => !SHELL_TRAILER.test(line));
}

function commandExitCode(output: string | undefined, exitCode: number | undefined) {
  if (exitCode !== undefined) return exitCode;
  const match = output ? EXIT_CODE_LINE.exec(output.split(/\r?\n/, 1)[0] ?? "") : null;
  return match ? Number(match[1]) : undefined;
}

interface Totals {
  first: number;
  second: number;
}

function count(text: string, label: string): number {
  return Number(new RegExp(String.raw`(\d+) ${label}`).exec(text)?.[1] ?? 0);
}

// One summary line per runner, as passed and failed; turbo prints one per package.
const TEST_SUMMARIES: ReadonlyArray<(line: string) => Totals | null> = [
  // vitest: `Tests  1 failed | 395 passed (396)`
  (line) => {
    const match = /^(?:\S+:\s*)?\s*Tests\s+(.*)\(\d+\)\s*$/.exec(line);
    return match ? { first: count(match[1]!, "passed"), second: count(match[1]!, "failed") } : null;
  },
  // jest: `Tests:       2 failed, 10 passed, 12 total`
  (line) => {
    const match = /^\s*Tests:\s+(.*\d+ total)\s*$/.exec(line);
    return match ? { first: count(match[1]!, "passed"), second: count(match[1]!, "failed") } : null;
  },
  // pytest: `===== 2 failed, 10 passed in 1.23s =====`
  (line) => {
    const match = /^=+ (.*(?:passed|failed).*) in [\d.]+s(?: \(.*\))? =+$/.exec(line.trim());
    return match ? { first: count(match[1]!, "passed"), second: count(match[1]!, "failed") } : null;
  },
  // cargo: `test result: ok. 10 passed; 0 failed; …`
  (line) => {
    const match = /test result: \w+\. (\d+) passed; (\d+) failed/.exec(line);
    return match ? { first: Number(match[1]), second: Number(match[2]) } : null;
  },
  // bun test: ` 451 pass` and ` 2 fail` on their own lines
  (line) => {
    const match = /^\s*(\d+) (pass|fail)\s*$/.exec(line);
    if (!match) return null;
    return match[2] === "pass"
      ? { first: Number(match[1]), second: 0 }
      : { first: 0, second: Number(match[1]) };
  },
];

// Type checkers and linters, as errors and warnings: tsc's `Found 3 errors`, oxlint's `Found 0
// warnings and 2 errors.`, eslint's `✖ 5 problems (3 errors, 2 warnings)`.
const DIAGNOSTIC_SUMMARIES: ReadonlyArray<(line: string) => Totals | null> = [
  (line) => {
    const match = /Found (\d+) warnings? and (\d+) errors?/.exec(line);
    return match ? { first: Number(match[2]), second: Number(match[1]) } : null;
  },
  (line) => {
    const match = /^Found (\d+) errors?(?: in |\.?\s*$)/.exec(line.trim());
    return match ? { first: Number(match[1]), second: 0 } : null;
  },
  (line) => {
    const match = /✖ \d+ problems? \((\d+) errors?, (\d+) warnings?\)/.exec(line);
    return match ? { first: Number(match[1]), second: Number(match[2]) } : null;
  },
];

// unittest prints its total and its verdict on separate lines: `Ran 12 tests in 0.3s`, then `OK`,
// `OK (skipped=1)` or `FAILED (failures=1, errors=2)`.
function unittestTotals(lines: readonly string[]): Totals | null {
  const ran = lines.map((line) => /^Ran (\d+) tests? in /.exec(line.trim())).find(Boolean);
  if (!ran) return null;
  const verdict = lines.find((line) => /^(?:OK|FAILED)\b/.test(line.trim())) ?? "";
  const tally = (label: string) => Number(new RegExp(`${label}=(\\d+)`).exec(verdict)?.[1] ?? 0);
  const failed = tally("failures") + tally("errors");
  return { first: Number(ran[1]) - failed - tally("skipped"), second: failed };
}

function sumSummaries(
  lines: readonly string[],
  readers: ReadonlyArray<(line: string) => Totals | null>,
): Totals | null {
  let first = 0;
  let second = 0;
  let found = false;
  for (const line of lines) {
    const totals = readers.map((read) => read(line)).find((result) => result !== null);
    if (!totals) continue;
    found = true;
    first += totals.first;
    second += totals.second;
  }
  return found ? { first, second } : null;
}

// The command names a test run or a check, so a summary-shaped line in its output is that summary
// rather than text it happened to print.
const TEST_COMMAND =
  /\b(?:vitest|jest|pytest|python3?\s+-m\s+unittest|cargo\s+test|go\s+test|bun\s+test|(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test[\w:-]*|turbo\s+(?:run\s+)?test)\b/;
const CHECK_COMMAND =
  /\b(?:tsc|oxlint|eslint|biome|(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?(?:check|lint|typecheck)[\w:-]*)\b/;

// A line that states what went wrong, as programs print errors.
const ERROR_LINE =
  /^(?:error|fatal|panic)\b|\b(?:command not found|no matches found|no such file|not found|permission denied|cannot|unable to|timed out|traceback|exception)\b|^\S+: .*\berror\b/i;
// The shell's own complaint, such as `zsh:1: no matches found: *.py` or
// `bash: line 1: foo: command not found`: the command it names never ran as written.
const SHELL_DIAGNOSTIC = /^(?:zsh|bash|sh|dash)(?::\d+|: line \d+)?: /;
// A program that names itself by its full path before its message, such as
// `/usr/bin/python3: can't open file …`.
const PROGRAM_PATH_PREFIX = /^(?:[A-Za-z]:)?[\\/][^\s:]*: /;
const TOOL_ERROR = /^<tool_use_error>(.*?)(?:<\/tool_use_error>)?$/;
const MAX_FAILURE_LINE_CHARS = 90;

function failureLine(lines: readonly string[]): string | null {
  for (const raw of lines) {
    const line = raw.trim();
    if (ERROR_LINE.test(line)) {
      return truncateFailure(line.replace(SHELL_DIAGNOSTIC, "").replace(PROGRAM_PATH_PREFIX, ""));
    }
  }
  return null;
}

function truncateFailure(line: string): string {
  return line.length > MAX_FAILURE_LINE_CHARS
    ? `${line.slice(0, MAX_FAILURE_LINE_CHARS - 1)}…`
    : line;
}

interface SearchMatch {
  file: string;
  line: number | null;
  text: string;
}

// `path:12:text` from grep -n and rg; `12:text` when grep searched one file; a bare path from `-l`.
// Context lines from -A/-B/-C (`path-13-text`) surround a match without being one.
export function parseSearchMatches(
  lines: readonly string[],
  shape: { listsFiles: boolean; singleFile: string | null },
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line === "--" || SHELL_DIAGNOSTIC.test(line)) continue;
    if (shape.listsFiles) {
      if (!/^\s|\s{2,}/.test(line)) matches.push({ file: line, line: null, text: "" });
      continue;
    }
    if (shape.singleFile) {
      const lineOnly = /^(\d+):(.*)$/.exec(line);
      if (lineOnly) {
        matches.push({
          file: shape.singleFile,
          line: Number(lineOnly[1]),
          text: lineOnly[2]!.trim(),
        });
      }
      continue;
    }
    const withFile = /^([^:\s][^:]*?):(\d+):(.*)$/.exec(line);
    if (withFile) {
      matches.push({ file: withFile[1]!, line: Number(withFile[2]), text: withFile[3]!.trim() });
    }
  }
  return matches;
}

/** Search results a finished grep, rg or find printed, when the command only searched. */
function commandSearchMatches(
  command: string,
  output: WorkLogToolOutputDetails | undefined,
): SearchMatch[] | null {
  const shape = commandSearchShape(command);
  const text = output?.output ?? output?.stdout;
  if (!shape || text === undefined) return null;
  return parseSearchMatches(commandOutputLines(text), shape);
}

function plural(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

export interface CommandOutcome {
  text: string;
  failed: boolean;
}

/**
 * One short phrase for how a finished command went, such as "451 passed", "3 errors",
 * "12 matches in 4 files" or the line that explains a failure. Null when nothing is worth adding.
 */
export function describeCommandOutcome(input: {
  command: string;
  output: WorkLogToolOutputDetails | undefined;
  failed: boolean;
}): CommandOutcome | null {
  // Rows re-render with the same output object, and reading a long output is the costly part, so
  // the outcome is kept for as long as the output object lives.
  if (!input.output) return readCommandOutcome(input);
  const key = `${input.failed ? 1 : 0}\0${input.command}`;
  const byCommand = outcomeByOutput.get(input.output) ?? new Map<string, CommandOutcome | null>();
  outcomeByOutput.set(input.output, byCommand);
  if (!byCommand.has(key)) byCommand.set(key, readCommandOutcome(input));
  return byCommand.get(key)!;
}

const outcomeByOutput = new WeakMap<WorkLogToolOutputDetails, Map<string, CommandOutcome | null>>();

function readCommandOutcome(input: {
  command: string;
  output: WorkLogToolOutputDetails | undefined;
  failed: boolean;
}): CommandOutcome | null {
  const { command, output } = input;
  const text = output?.output ?? [output?.stdout, output?.stderr].filter(Boolean).join("\n");
  const lines = commandOutputLines(text ?? "");
  const exitCode = commandExitCode(output?.output, output?.exitCode);

  // The provider refused to run the command; nothing it would have printed applies.
  const toolError = lines.map((line) => TOOL_ERROR.exec(line.trim())?.[1]?.trim()).find(Boolean);
  if (toolError) return { text: truncateFailure(toolError), failed: true };

  const search = commandSearchShape(command);
  const shellDiagnostic = lines
    .map((line) => line.trim())
    .find((line) => SHELL_DIAGNOSTIC.test(line));
  if (search && shellDiagnostic) {
    return { text: truncateFailure(shellDiagnostic.replace(SHELL_DIAGNOSTIC, "")), failed: true };
  }
  if (search) {
    // grep and rg exit with 1 when nothing matched; that is an answer, not a failure.
    const matches = commandSearchMatches(command, output) ?? [];
    if (matches.length === 0) {
      return exitCode === undefined || exitCode <= 1 ? { text: "no matches", failed: false } : null;
    }
    // `| head -8` cuts the list: eight results may be the first eight of many.
    const limit = /\|\s*(?:head|tail)\s+(?:-n\s*)?-?(\d+)/.exec(command)?.[1];
    const shown = search.listsFiles
      ? new Set(matches.map((match) => match.file)).size
      : matches.length;
    const limited = limit !== undefined && shown >= Number(limit) ? "+" : "";
    const files = new Set(matches.map((match) => match.file)).size;
    return search.listsFiles
      ? { text: `${files}${limited} ${files === 1 ? "file" : "files"}`, failed: false }
      : {
          text: `${matches.length}${limited} ${matches.length === 1 ? "match" : "matches"}${files > 1 ? ` in ${files} files` : ""}`,
          failed: false,
        };
  }

  if (TEST_COMMAND.test(command)) {
    const totals = sumSummaries(lines, TEST_SUMMARIES) ?? unittestTotals(lines);
    if (totals) {
      return totals.second > 0
        ? { text: `${totals.second} failed, ${totals.first} passed`, failed: true }
        : { text: `${totals.first} passed`, failed: false };
    }
  }

  if (CHECK_COMMAND.test(command)) {
    const totals = sumSummaries(lines, DIAGNOSTIC_SUMMARIES);
    if (totals && totals.first > 0) {
      const warnings = totals.second > 0 ? `, ${plural(totals.second, "warning")}` : "";
      return { text: `${plural(totals.first, "error")}${warnings}`, failed: true };
    }
    if (totals && totals.second > 0)
      return { text: plural(totals.second, "warning"), failed: false };
  }

  if (input.failed || (exitCode !== undefined && exitCode !== 0)) {
    const line = failureLine(lines);
    if (line) return { text: line, failed: true };
    return exitCode !== undefined && exitCode !== 0
      ? { text: `exit ${exitCode}`, failed: true }
      : null;
  }
  return null;
}
