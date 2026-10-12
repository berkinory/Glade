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

export function extractSearchPatternAndPath(args: string): {
  pattern: string | null;
  path: string | null;
} {
  const tokens = tokenizeCommandArgs(args);
  let pattern: string | null = null;
  let path: string | null = null;
  let skipNext = false;

  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token.startsWith("-")) {
      if (
        token === "-t" ||
        token === "-g" ||
        token === "--type" ||
        token === "--glob" ||
        token === "--max-count"
      ) {
        skipNext = true;
      }
      continue;
    }
    if (!pattern) {
      const normalizedPattern = normalizeSearchPatternToken(token);
      if (!normalizedPattern) {
        const normalizedPath = normalizeSearchPathToken(token);
        if (normalizedPath && (!path || path === "current directory")) {
          path = normalizedPath;
        }
        continue;
      }
      pattern = normalizedPattern;
      continue;
    }
    if (!path || path === "current directory") {
      path = normalizeSearchPathToken(token) ?? path;
      continue;
    }
  }

  if (pattern && path === "current directory" && looksLikeSearchPath(pattern)) {
    path = normalizeSearchPathToken(pattern);
    pattern = null;
  }

  return { pattern, path };
}

function normalizeSearchPatternToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return null;
  }
  if (!/[a-z0-9]/i.test(trimmed)) {
    return null;
  }
  return trimmed.length > 30 ? `${trimmed.slice(0, 27)}...` : trimmed;
}

function normalizeSearchPathToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  return compactPath(trimmed);
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
        if (args[index] === "\\" && index + 1 < args.length) {
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

// The commands a shell script runs, in order. `&&`, `||`, `;` and newlines separate commands, a
// pipe keeps only the command that produces its input, and setup (cd, exports, assignments) and
// control-flow keywords are dropped. A heredoc's body is text rather than commands, so parsing
// stops at the end of the line that opens it.
export function commandSegments(rawCommand: string): string[] {
  const command = unwrapShellInvocation(rawCommand);
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let inPipeConsumer = false;
  let opensHeredoc = false;
  const flush = () => {
    const segment = normalizeCommandSegment(current);
    if (segment) segments.push(segment);
    current = "";
    inPipeConsumer = false;
  };
  const keep = (text: string) => {
    if (!inPipeConsumer) current += text;
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
    if (char === "<" && next === "<") {
      opensHeredoc = true;
    }
    if (char === "\n") {
      flush();
      if (opensHeredoc) return segments;
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
      inPipeConsumer = true;
      continue;
    }
    keep(char);
  }
  flush();
  return segments;
}

const CONTROL_FLOW_PREFIX = /^(?:do|then|else)\s+/;
const CONTROL_FLOW_STATEMENT = /^(?:for|while|until|if|elif|case|select)\b|^(?:done|fi|esac|[{}])$/;

function normalizeCommandSegment(segment: string): string | null {
  let current = segment
    .trim()
    .replace(/^\(\s*/, "")
    .replace(/\s*\)$/, "");
  while (CONTROL_FLOW_PREFIX.test(current)) {
    current = current.replace(CONTROL_FLOW_PREFIX, "");
  }
  if (!current || CONTROL_FLOW_STATEMENT.test(current) || isShellSetupPreamble(current)) {
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
