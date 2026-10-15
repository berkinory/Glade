// Node decodes a module's UTF-8 source into a two-byte V8 string as soon as it holds one non-ASCII
// character, so a single arrow or ellipsis in a prompt doubles the memory the source occupies for
// the life of the process. This output plugin rewrites those characters as \u escapes inside
// string, template and regular expression literals and identifiers, and as plain whitespace in
// comments. A chunk it cannot rewrite exactly (a tagged template, an astral identifier) is left
// unchanged with a warning, and every rewrite is checked by parsing it again and comparing literal
// values.

interface SyntaxNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

interface PluginContext {
  parse(code: string): unknown;
  warn(message: string): void;
}

// `raw` text (a tagged template) cannot change, and an identifier cannot take an astral character
// as two \u escapes.
interface Range {
  readonly start: number;
  readonly end: number;
  readonly kind: "literal" | "identifier" | "raw";
}

const NON_ASCII = /[^\u0000-\u007f]/u;

function isNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { start?: unknown }).start === "number"
  );
}

// Leaf tokens that may contain wide characters, in source order, plus the literal values the rewrite
// must preserve.
function collect(program: unknown): { ranges: Range[]; values: string[] } {
  const ranges: Range[] = [];
  const values: string[] = [];
  const visit = (value: unknown, taggedQuasi: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, taggedQuasi);
      return;
    }
    if (!isNode(value)) return;
    const node = value as SyntaxNode & Record<string, unknown>;
    switch (node.type) {
      case "Literal": {
        const regex = node.regex as { pattern: string; flags: string } | undefined;
        if (regex) values.push(`/${decodePattern(regex.pattern)}/${regex.flags}`);
        else if (typeof node.value === "string") values.push(node.value);
        else return;
        ranges.push({ start: node.start, end: node.end, kind: "literal" });
        return;
      }
      case "TemplateElement": {
        const text = node.value as { cooked: string | null; raw: string };
        // A tag receives the raw text too, so only untagged templates may change it.
        values.push(taggedQuasi ? `raw:${text.raw}` : (text.cooked ?? ""));
        ranges.push({ start: node.start, end: node.end, kind: taggedQuasi ? "raw" : "literal" });
        return;
      }
      case "Identifier":
      case "PrivateIdentifier":
        values.push(String(node.name));
        ranges.push({ start: node.start, end: node.end, kind: "identifier" });
        return;
      case "TaggedTemplateExpression":
        visit(node.tag, false);
        visit(node.quasi, true);
        return;
      case "TemplateLiteral":
        visit(node.quasis, taggedQuasi);
        visit(node.expressions, false);
        return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "type" && key !== "start" && key !== "end") visit(child, false);
    }
  };
  visit(program, false);
  return { ranges: ranges.toSorted((left, right) => left.start - right.start), values };
}

function containing(ranges: readonly Range[], index: number): Range | null {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle]!;
    if (index < range.start) high = middle - 1;
    else if (index >= range.end) low = middle + 1;
    else return range;
  }
  return null;
}

function escapeNonAscii(code: string, ranges: readonly Range[]): string | null {
  let output = "";
  let copied = 0;
  for (let index = 0; index < code.length; index += 1) {
    const unit = code.charCodeAt(index);
    if (unit <= 0x7f) continue;
    const range = containing(ranges, index);
    let replaceFrom = index;
    let replacement: string;
    if (range === null) {
      // Outside every token only comments and whitespace remain; line separators must stay breaks.
      replacement = unit === 0x2028 || unit === 0x2029 ? "\n" : " ";
    } else if (
      range.kind === "raw" ||
      (range.kind === "identifier" && unit >= 0xd800 && unit <= 0xdfff)
    ) {
      return null;
    } else {
      let backslashes = 0;
      while (index - backslashes - 1 >= range.start && code[index - backslashes - 1] === "\\") {
        backslashes += 1;
      }
      // An identity escape (`\→`) already denotes the character; replace it whole.
      if (backslashes % 2 === 1) replaceFrom = index - 1;
      replacement = `\\u${unit.toString(16).padStart(4, "0")}`;
    }
    output += code.slice(copied, replaceFrom) + replacement;
    copied = index + 1;
  }
  return output + code.slice(copied);
}

// A regular expression's pattern is its source text, so compare patterns with \u escapes and
// identity escapes of non-ASCII characters resolved.
function decodePattern(pattern: string): string {
  return pattern
    .replace(
      /(?<!\\)((?:\\\\)*)\\u([0-9a-fA-F]{4})/gu,
      (_match, slashes: string, hex: string) =>
        `${slashes}${String.fromCharCode(Number.parseInt(hex, 16))}`,
    )
    .replace(/(?<!\\)((?:\\\\)*)\\([^\u0000-\u007f])/gu, "$1$2");
}

interface OutputChunk {
  readonly type: "chunk";
  readonly fileName: string;
  code: string;
}

function rewrite(context: PluginContext, code: string): string | null {
  try {
    const original = collect(context.parse(code));
    const rewritten = escapeNonAscii(code, original.ranges);
    if (rewritten === null || NON_ASCII.test(rewritten)) return null;
    const reparsed = collect(context.parse(rewritten));
    return reparsed.values.length === original.values.length &&
      reparsed.values.every((value, index) => value === original.values[index])
      ? rewritten
      : null;
  } catch {
    // Unparseable as a module (sloppy-mode CommonJS); the chunk is kept.
    return null;
  }
}

// Runs on the final output, after any minifier, which would otherwise print the characters back.
export function asciiOnlyChunks(options: { readonly enabled: boolean }) {
  return {
    name: "glade-ascii-only-chunks",
    generateBundle(
      this: PluginContext,
      _outputOptions: unknown,
      bundle: Record<string, OutputChunk | { readonly type: "asset" }>,
    ) {
      if (!options.enabled) return;
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk" || !NON_ASCII.test(output.code)) continue;
        const rewritten = rewrite(this, output.code);
        if (rewritten === null) {
          this.warn(`${output.fileName} keeps non-ASCII characters; V8 holds it as two-byte`);
        } else {
          output.code = rewritten;
        }
      }
    },
  };
}
