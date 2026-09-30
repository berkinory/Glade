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

export function unwrapShellCommandIfPresent(rawCommand: string): string {
  let value = rawCommand.trim();
  if (!value) {
    return value;
  }

  const shellPrefixes = [
    "/usr/bin/bash -lc ",
    "/usr/bin/bash -c ",
    "/bin/bash -lc ",
    "/bin/bash -c ",
    "/usr/bin/zsh -lc ",
    "/usr/bin/zsh -c ",
    "/bin/zsh -lc ",
    "/bin/zsh -c ",
    "/bin/sh -lc ",
    "/bin/sh -c ",
    "bash -lc ",
    "bash -c ",
    "zsh -lc ",
    "zsh -c ",
    "sh -lc ",
    "sh -c ",
  ];

  const lowered = value.toLowerCase();
  for (const prefix of shellPrefixes) {
    if (!lowered.startsWith(prefix)) {
      continue;
    }
    value = value.slice(prefix.length).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1).trim();
    }
    value = stripLeadingShellPreambles(value);
    break;
  }

  const pipeIndex = value.indexOf("|");
  if (pipeIndex > 0) {
    value = value.slice(0, pipeIndex).trim();
  }

  return value;
}

function stripLeadingShellPreambles(value: string): string {
  let current = value.trim();
  for (let attempts = 0; attempts < 4; attempts += 1) {
    const chain = findShellChain(current);
    if (!chain) {
      return current;
    }
    const head = current.slice(0, chain.operatorStart).trim();
    if (!isShellSetupPreamble(head)) {
      return current;
    }
    current = current.slice(chain.commandStart).trim();
  }
  return current;
}

function isShellSetupPreamble(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  if (/^(?:builtin\s+)?cd\s+/.test(normalized)) {
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

export function findShellChain(
  value: string,
): { operatorStart: number; commandStart: number } | null {
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length - 1; index += 1) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    const next = value[index + 1];
    if (char === "&" && next === "&") {
      return { operatorStart: index, commandStart: index + 2 };
    }
    if (char === ";") {
      return { operatorStart: index, commandStart: index + 1 };
    }
  }

  return null;
}

export function stripCommandDisplayWrappers(command: string): string {
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
