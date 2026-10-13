import {
  commandDirectory,
  commandSegments,
  shellAssignments,
  splitHeredoc,
  shellWriteTargets,
  splitToolAndArgs,
  tokenizeCommandArgs,
} from "./toolCallLabel.shell";

export type ScriptLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "ruby"
  | "perl"
  | "php"
  | "sql"
  | "applescript";

// The interpreter a script runs under names its language; bun and deno run TypeScript as written.
const INTERPRETER_LANGUAGES: Record<string, ScriptLanguage> = {
  python: "python",
  python3: "python",
  node: "javascript",
  bun: "typescript",
  deno: "typescript",
  ruby: "ruby",
  perl: "perl",
  php: "php",
  sqlite3: "sql",
  osascript: "applescript",
};

const INLINE_CODE_FLAGS = new Set(["-c", "-e", "--eval", "-r"]);

export interface InlineScript {
  interpreter: string;
  language: ScriptLanguage;
  // The code itself: a heredoc body or the argument of `-c`/`-e`; null for a script file.
  code: string | null;
  // The script file it runs, such as `scripts/migrate.py`, when it runs one.
  file: string | null;
}

/** The script a command hands to an interpreter, from the first step that runs one. */
export function inlineScriptOf(rawCommand: string): InlineScript | null {
  const primary = commandSegments(rawCommand).find(
    (segment) => INTERPRETER_LANGUAGES[splitToolAndArgs(segment)[0]] !== undefined,
  );
  if (!primary) return null;
  const [tool, args] = splitToolAndArgs(primary);
  const language = INTERPRETER_LANGUAGES[tool]!;
  const tokens = tokenizeCommandArgs(args);
  const flagIndex = tokens.findIndex((token) => INLINE_CODE_FLAGS.has(token));
  const heredoc = /<<-?\s*['"]?\w+/.test(primary) ? (splitHeredoc(rawCommand)?.body ?? null) : null;
  const code = heredoc ?? (flagIndex >= 0 ? (tokens[flagIndex + 1] ?? null) : null);
  const file =
    code === null
      ? (tokens.find((token) => !token.startsWith("-") && /\.[a-z]{1,4}$/i.test(token)) ?? null)
      : null;
  if (code === null && file === null) return null;
  return { interpreter: tool, language, code, file };
}

export interface CommandFileEffects {
  written: string[];
  read: string[];
  // How the files were written: plain shell output, or code that edits them in place.
  writeKind: "write" | "append" | "edit" | null;
}

/** Paths as a command wrote them, resolved against its leading `cd <absolute folder>`. */
export function resolveCommandPaths(rawCommand: string, paths: readonly string[]): string[] {
  const directory = commandDirectory(rawCommand);
  return unique(
    paths.map((path) =>
      directory && !path.startsWith("/") && !path.startsWith("~")
        ? `${directory.replace(/\/+$/, "")}/${path.replace(/^\.\//, "")}`
        : path,
    ),
  );
}

/** Files a command writes or reads, as written in the command with its own variables filled in. */
export function commandFileEffects(rawCommand: string): CommandFileEffects {
  const assignments = shellAssignments(rawCommand);
  const expand = (path: string) =>
    path.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (text, name: string) => assignments.get(name) ?? text);
  const shellWrites = shellWriteTargets(rawCommand).map((target) => ({
    ...target,
    path: expand(target.path),
  }));
  const script = inlineScriptOf(rawCommand);
  const scriptEffects = script?.code ? codeFileEffects(script.language, script.code) : null;
  const edited = [...(scriptEffects?.written ?? []), ...inPlaceEditTargets(rawCommand)].map(expand);
  const written = unique([...shellWrites.map((target) => target.path), ...edited]);
  const writeKind =
    written.length === 0
      ? null
      : edited.length > 0
        ? "edit"
        : shellWrites.every((target) => target.append)
          ? "append"
          : "write";
  return {
    written,
    read: unique(scriptEffects?.read ?? []),
    writeKind,
  };
}

/** The part of a heredoc script worth highlighting on its own, and its language. */
export function commandScriptParts(
  rawCommand: string,
): { head: string; body: string; tail: string; language: string } | null {
  const parts = splitHeredoc(rawCommand);
  if (!parts || parts.body.trim().length === 0) return null;
  const script = inlineScriptOf(rawCommand);
  if (script?.code) return { ...parts, language: script.language };
  // `cat > page.tsx <<EOF` writes a file whose extension names the body's language.
  const target = shellWriteTargets(rawCommand)[0]?.path;
  const extension = target ? /\.([a-z0-9]+)$/i.exec(target)?.[1]?.toLowerCase() : undefined;
  return { ...parts, language: extension ?? "text" };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// `sed -i 's/a/b/' a b` and `perl -pi -e 's/a/b/' a b` edit their files in place. Their script is
// the first argument unless `-e` or `-f` gives it; BSD sed's `-i ''` leaves an empty argument.
function inPlaceEditTargets(rawCommand: string): string[] {
  return commandSegments(rawCommand).flatMap((segment) => {
    const [tool, args] = splitToolAndArgs(segment);
    if (tool !== "sed" && tool !== "perl") return [];
    const tokens = tokenizeCommandArgs(args).filter((token) => token.length > 0);
    const inPlace = tokens.some(
      (token) => token === "--in-place" || (/^-[a-zA-Z]*i/.test(token) && !token.startsWith("--")),
    );
    if (!inPlace) return [];
    const positional: string[] = [];
    let scriptGiven = false;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (/^-[a-zA-Z]*[ef]$/.test(token) || token === "--expression" || token === "--file") {
        scriptGiven = true;
        index += 1;
        continue;
      }
      if (!token.startsWith("-")) positional.push(token);
    }
    return scriptGiven ? positional : positional.slice(1);
  });
}

// A file argument: a string literal, `Path("…")`, or a name bound to one of those.
const ARGUMENT = String.raw`((?:Path\(\s*)?[rbuf]?['"][^'"\n]+['"]\s*\)?|[A-Za-z_$][\w$]*)`;
const LITERAL_PATH = /^(?:Path\(\s*)?[rbuf]?(['"])([^'"\n]+)\1\s*\)?$/;
const WRITE_MODE = String.raw`[rbuf]?['"](?:[rbt]*\+[rbt]*|[rbt]*[wax][rbt+]*)['"]`;

function argumentPath(argument: string, bindings: ReadonlyMap<string, string>): string | null {
  const trimmed = argument.trim();
  const literal = LITERAL_PATH.exec(trimmed);
  if (literal) return literal[2]!;
  return bindings.get(trimmed) ?? null;
}

// `p = 'CHANGELOG.md'`, `const file = "a.ts"`: names bound to a literal path, even on one line with
// other statements.
function literalBindings(code: string, declaration: string): Map<string, string> {
  const bindings = new Map<string, string>();
  const pattern = new RegExp(
    String.raw`(?:^|;)\s*${declaration}([A-Za-z_$][\w$]*)\s*=\s*((?:Path\(\s*)?[rbuf]?(['"])[^'"\n]+\3\s*\)?)\s*(?=;|$)`,
    "gm",
  );
  for (const match of code.matchAll(pattern)) {
    const path = LITERAL_PATH.exec(match[2]!)?.[2];
    if (path) bindings.set(match[1]!, path);
  }
  return bindings;
}

const FILE_CALLS: Record<"python" | "javascript", { write: RegExp[]; read: RegExp[] }> = {
  python: {
    write: [
      new RegExp(String.raw`\bopen\(\s*${ARGUMENT}\s*,\s*(?:mode\s*=\s*)?${WRITE_MODE}`, "g"),
      new RegExp(String.raw`${ARGUMENT}\s*\.\s*write_(?:text|bytes)\(`, "g"),
      new RegExp(String.raw`\bshutil\.(?:copy2?|copyfile|move)\([^,\n]+,\s*${ARGUMENT}`, "g"),
    ],
    read: [
      new RegExp(
        String.raw`\bopen\(\s*${ARGUMENT}\s*(?:\)|,\s*(?:[rbuf]?['"]r[bt]?['"]|encoding))`,
        "g",
      ),
      new RegExp(String.raw`${ARGUMENT}\s*\.\s*read_(?:text|bytes)\(`, "g"),
    ],
  },
  javascript: {
    write: [
      new RegExp(
        String.raw`\b(?:writeFileSync|writeFile|appendFileSync|appendFile)\(\s*${ARGUMENT}`,
        "g",
      ),
      new RegExp(String.raw`\bBun\.write\(\s*${ARGUMENT}`, "g"),
    ],
    read: [
      new RegExp(String.raw`\b(?:readFileSync|readFile)\(\s*${ARGUMENT}`, "g"),
      new RegExp(String.raw`\bBun\.file\(\s*${ARGUMENT}`, "g"),
    ],
  },
};

/**
 * The files a short Python or JavaScript script writes or reads, read from its text without running
 * it. Only literal paths, or names bound to one, count; anything computed stays unknown.
 */
function codeFileEffects(
  language: ScriptLanguage,
  code: string,
): { written: string[]; read: string[] } {
  const family =
    language === "python"
      ? "python"
      : language === "javascript" || language === "typescript"
        ? "javascript"
        : null;
  if (!family) return { written: [], read: [] };
  const bindings =
    family === "python"
      ? literalBindings(code, "")
      : literalBindings(code, String.raw`(?:const|let|var)\s+`);
  const collect = (patterns: readonly RegExp[]) =>
    unique(
      patterns.flatMap((pattern) =>
        [...code.matchAll(pattern)].flatMap((match) => {
          const path = argumentPath(match[1]!, bindings);
          return path ? [path] : [];
        }),
      ),
    );
  const written = collect(FILE_CALLS[family].write);
  return {
    written,
    read: collect(FILE_CALLS[family].read).filter((path) => !written.includes(path)),
  };
}
