import * as fs from "node:fs/promises";

import { isRecord } from "@glade/shared/transport/payloadValues";

// Drops comments and trailing commas outside strings, as JSONC config files allow.
function stripJsonComments(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < source.length && source[index] !== '"') {
        index += source[index] === "\\" ? 2 : 1;
      }
      index += 1;
      output += source.slice(start, index);
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      output += char;
      index += 1;
    }
  }
  return output.replace(/,(\s*[}\]])/gu, "$1");
}

// Undefined when the file does not exist.
export async function readJsonConfig(path: string): Promise<unknown> {
  let source: string;
  try {
    source = await fs.readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
  return JSON.parse(stripJsonComments(source));
}

// Only plain JSON is rewritten: a file with comments is left alone rather than losing them.
export async function removeJsonConfigKey(
  path: string,
  keyPath: ReadonlyArray<string>,
): Promise<void> {
  const source = await fs.readFile(path, "utf8");
  let config: unknown;
  try {
    config = JSON.parse(source);
  } catch {
    throw new Error(`${path} has comments, so Glade leaves it to you to edit.`);
  }
  let parent: unknown = config;
  for (const key of keyPath.slice(0, -1)) {
    parent = isRecord(parent) ? parent[key] : undefined;
  }
  const last = keyPath.at(-1);
  if (!isRecord(parent) || last === undefined || !(last in parent)) return;
  delete parent[last];
  const indent = /^([ \t]+)"/mu.exec(source)?.[1] ?? "  ";
  const text = JSON.stringify(config, null, indent) + (source.endsWith("\n") ? "\n" : "");
  const { mode } = await fs.stat(path);
  const temporary = `${path}.glade-${process.pid}.tmp`;
  await fs.writeFile(temporary, text, { mode });
  await fs.rename(temporary, path);
}
