import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SESSION_FILE_NAME = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jsonl$/i;
const MAX_METADATA_LINE_BYTES = 8 * 1024 * 1024;

async function directoryEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function sessionFiles(configDir: string): Promise<Map<string, string>> {
  const projectsDir = path.join(configDir, "projects");
  const files = new Map<string, string>();
  for (const project of await directoryEntries(projectsDir)) {
    if (!project.isDirectory()) continue;
    const directory = path.join(projectsDir, project.name);
    for (const file of await directoryEntries(directory)) {
      if (!file.isFile() || !SESSION_FILE_NAME.test(file.name)) continue;
      const id = file.name.slice(0, -6);
      const filePath = path.join(directory, file.name);
      const previous = files.get(id);
      if (previous) {
        const [previousStat, currentStat] = await Promise.all([stat(previous), stat(filePath)]);
        if (previousStat.mtimeMs >= currentStat.mtimeMs) continue;
      }
      files.set(id, filePath);
    }
  }
  return files;
}

function parseTranscriptEntry(line: string): Record<string, unknown> | undefined {
  if (Buffer.byteLength(line) > MAX_METADATA_LINE_BYTES) return undefined;
  try {
    const entry: unknown = JSON.parse(line);
    return entry && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function* readTranscriptEntries(file: string, maxBytes?: number) {
  const stream = createReadStream(file, {
    encoding: "utf8",
    highWaterMark: 64 * 1024,
    ...(maxBytes ? { end: maxBytes - 1 } : {}),
  });
  let pending = "";
  let skippingLine = false;
  try {
    for await (const chunk of stream) {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (skippingLine) {
          skippingLine = false;
          continue;
        }
        const entry = parseTranscriptEntry(line);
        if (entry) yield entry;
      }
      if (Buffer.byteLength(pending) > MAX_METADATA_LINE_BYTES) {
        pending = "";
        skippingLine = true;
      }
    }
    if (!skippingLine) {
      const entry = parseTranscriptEntry(pending);
      if (entry) yield entry;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally {
    stream.destroy();
  }
}

function claudeConfigDir(configDir?: string): string {
  return path.resolve(
    configDir?.trim() || process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude"),
  );
}

async function findClaudeSessionTranscriptPath(input: {
  readonly sessionId: string;
  readonly configDir?: string;
}): Promise<string | undefined> {
  const files = await sessionFiles(claudeConfigDir(input.configDir));
  return files.get(input.sessionId);
}

export async function readClaudeSessionParentUuid(input: {
  readonly sessionId: string;
  readonly messageId: string;
}): Promise<string | null> {
  const file = await findClaudeSessionTranscriptPath(input);
  if (!file) throw new Error("The native Claude transcript could not be found.");
  for await (const entry of readTranscriptEntries(file)) {
    if (entry.uuid !== input.messageId || entry.isSidechain === true) continue;
    if (entry.parentUuid === null || typeof entry.parentUuid === "string") {
      return entry.parentUuid;
    }
    throw new Error("The Claude edit boundary has no valid chain parent.");
  }
  throw new Error("The edited message is missing from the native Claude transcript.");
}
