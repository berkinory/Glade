import * as fs from "node:fs/promises";

import { parse as parseYaml, YAMLParseError } from "yaml";

export type FrontmatterValue = string | boolean;

// Skill files come from arbitrary repositories and home folders. Only the head of the file is read,
// and frontmatter that does not close inside it is ignored, so a huge or unterminated file cannot
// make discovery read or parse unbounded input.
const SKILL_HEAD_MAX_BYTES = 64 * 1024;
// Skills have no use for anchors; a small cap keeps alias expansion from multiplying the output.
const FRONTMATTER_MAX_ALIAS_COUNT = 16;

const FRONTMATTER_PATTERN = /^﻿?---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const TOP_LEVEL_SCALAR_LINE = /^([A-Za-z][\w-]*):[ \t]+(\S.*)$/;

export async function readSkillFileHead(path: string): Promise<string> {
  const handle = await fs.open(path, "r");
  try {
    const buffer = Buffer.alloc(SKILL_HEAD_MAX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SKILL_HEAD_MAX_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

// Hand-written skills often contain plain scalars that YAML rejects, most commonly a second colon
// (`description: Use when: ...`). For those files only unindented single-line `key: value` pairs are
// read, so nested keys never override top-level ones and block scalar indicators are not taken as text.
function readTopLevelScalarLines(block: string): Record<string, FrontmatterValue> {
  const record: Record<string, FrontmatterValue> = {};
  for (const line of block.split("\n")) {
    const match = TOP_LEVEL_SCALAR_LINE.exec(line.trimEnd());
    if (!match) continue;
    const key = match[1]!;
    const raw = match[2]!;
    if (/^[|>][-+0-9]*$/.test(raw) || raw.startsWith("#") || raw.startsWith("&")) continue;
    const value = stripQuotes(raw);
    if (value === "true" || value === "false") record[key] = value === "true";
    else if (value.length > 0) record[key] = value;
  }
  return record;
}

function readYamlRecord(parsed: object): Record<string, FrontmatterValue> {
  const record: Record<string, FrontmatterValue> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) record[key] = trimmed;
    } else if (typeof value === "boolean") {
      record[key] = value;
    }
  }
  const metadata: unknown = (parsed as { readonly metadata?: unknown }).metadata;
  const nestedShortDescription =
    typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)["short-description"]
      : undefined;
  if (
    record["short-description"] === undefined &&
    typeof nestedShortDescription === "string" &&
    nestedShortDescription.trim().length > 0
  ) {
    record["short-description"] = nestedShortDescription.trim();
  }
  return record;
}

/** Top-level string and boolean fields of a skill's frontmatter; other value types are ignored. */
export function parseSkillFrontmatter(markdown: string): Record<string, FrontmatterValue> {
  const match = FRONTMATTER_PATTERN.exec(markdown.replace(/\r\n/g, "\n"));
  if (!match) return {};
  const block = match[1] ?? "";

  let parsed: unknown;
  try {
    // `uniqueKeys: false` skips the quadratic duplicate-key scan; the last duplicate wins.
    parsed = parseYaml(block, {
      uniqueKeys: false,
      maxAliasCount: FRONTMATTER_MAX_ALIAS_COUNT,
      // "error" throws syntax errors (a "silent" parse drops them) without printing warnings.
      logLevel: "error",
      prettyErrors: false,
    });
  } catch (cause) {
    // Only syntax errors get the line reader; frontmatter over the alias limit is ignored.
    if (cause instanceof YAMLParseError) return readTopLevelScalarLines(block);
    return {};
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? readYamlRecord(parsed)
    : {};
}
