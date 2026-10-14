import { asFiniteNumber } from "@glade/shared/transport/payloadValues";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { createReadStream, type Dirent, type Stats } from "node:fs";
import fs from "node:fs/promises";
import nodePath from "node:path";

import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type {
  ServerGetProviderUsageSnapshotInput,
  ServerGetProviderUsageSnapshotResult,
  ServerProviderUsageLine,
} from "@glade/contracts/server/server";
import { Effect } from "effect";

import { ServerConfig } from "../../server/config";

const LOOKBACK_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_7D_MS = 7 * ONE_DAY_MS;
const LOOKBACK_30D_MS = LOOKBACK_DAYS * ONE_DAY_MS;
const USAGE_CACHE_TTL_MS = 30_000;

const MAX_RECENT_USAGE_FILES = 2_000;
const PROVIDER_USAGE_FILE_READ_CONCURRENCY = 16;
// Parsing transcripts is CPU work on the server's event loop; reading many at once delayed every
// other request behind a queue of chunk callbacks while the first usage refresh ran.
const CLAUDE_TRANSCRIPT_READ_CONCURRENCY = 2;
const CODEX_SESSION_READ_CHUNK_BYTES = 64 * 1024;
const MAX_CODEX_SESSION_LINE_BYTES = 1024 * 1024;
const MAX_CLAUDE_TRANSCRIPT_LINE_BYTES = 1024 * 1024;

type UsageSnapshot = Exclude<ServerGetProviderUsageSnapshotResult, null>;

interface CachedUsageSnapshot {
  expiresAtMs: number;
  value: ServerGetProviderUsageSnapshotResult;
  pending: Promise<ServerGetProviderUsageSnapshotResult> | null;
}

interface CodexSessionSummary {
  timestampMs: number;
  totalTokens: number;
}

interface ClaudeUsageSample {
  sessionId: string;
  timestampMs: number;
  totalTokens: number;
  model: string | null;
}

const usageSnapshotCache = new Map<string, CachedUsageSnapshot>();

function asNonNegativeNumber(value: unknown): number | undefined {
  const parsed = asFiniteNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function formatCompactNumber(value: number): string {
  const absoluteValue = Math.abs(value);
  if (absoluteValue < 1_000) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: absoluteValue < 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatTokenValue(tokens: number): string {
  return `${formatCompactNumber(tokens)} tokens`;
}

function formatRecentSessionsSubtitle(sessionCount: number): string | undefined {
  if (sessionCount <= 0) {
    return undefined;
  }
  return `${new Intl.NumberFormat(undefined).format(sessionCount)} recent ${sessionCount === 1 ? "session" : "sessions"}`;
}

async function safeReadDir(path: string): Promise<ReadonlyArray<Dirent>> {
  try {
    return await fs.readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(path: string): Promise<Stats | null> {
  try {
    return await fs.stat(path);
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: Array<{ index: number; value: R }> = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        const item = items[index];
        if (item === undefined) {
          continue;
        }
        results.push({ index, value: await mapper(item) });
      }
    }),
  );

  return results.toSorted((left, right) => left.index - right.index).map((entry) => entry.value);
}

interface RecentFile {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
}

async function listRecentFiles(
  paths: ReadonlyArray<string>,
  maxFiles: number = MAX_RECENT_USAGE_FILES,
): Promise<ReadonlyArray<RecentFile>> {
  const filesWithStats = await mapWithConcurrency(
    paths,
    PROVIDER_USAGE_FILE_READ_CONCURRENCY,
    async (path): Promise<RecentFile> => {
      const stats = await safeStat(path);
      return { path, mtimeMs: stats?.mtimeMs ?? 0, size: stats?.size ?? 0 };
    },
  );

  return filesWithStats.toSorted((left, right) => right.mtimeMs - left.mtimeMs).slice(0, maxFiles);
}

function buildUsageLines(input: {
  tokens24h: number;
  tokens7d: number;
  tokens30d: number;
  sessions24h: number;
  sessions7d: number;
  sessions30d: number;
}): ReadonlyArray<ServerProviderUsageLine> {
  return [
    {
      label: "24h",
      value: formatTokenValue(input.tokens24h),
      ...(formatRecentSessionsSubtitle(input.sessions24h)
        ? { subtitle: formatRecentSessionsSubtitle(input.sessions24h) }
        : {}),
    },
    {
      label: "7d",
      value: formatTokenValue(input.tokens7d),
      ...(formatRecentSessionsSubtitle(input.sessions7d)
        ? { subtitle: formatRecentSessionsSubtitle(input.sessions7d) }
        : {}),
    },
    {
      label: "30d",
      value: formatTokenValue(input.tokens30d),
      ...(formatRecentSessionsSubtitle(input.sessions30d)
        ? { subtitle: formatRecentSessionsSubtitle(input.sessions30d) }
        : {}),
    },
  ];
}

function readCodexTotalTokens(payload: Record<string, unknown>): number {
  const info = asObjectRecord(payload.info);
  const totalUsage =
    asObjectRecord(info?.total_token_usage) ??
    asObjectRecord(info?.totalTokenUsage) ??
    asObjectRecord(info?.total) ??
    asObjectRecord(payload.total_token_usage) ??
    asObjectRecord(payload.totalTokenUsage) ??
    asObjectRecord(payload.total);

  return (
    asNonNegativeNumber(totalUsage?.total_tokens) ??
    asNonNegativeNumber(totalUsage?.totalTokens) ??
    asNonNegativeNumber(info?.total_tokens) ??
    asNonNegativeNumber(info?.totalTokens) ??
    asNonNegativeNumber(payload.total_tokens) ??
    asNonNegativeNumber(payload.totalTokens) ??
    0
  );
}

async function listRecentCodexSessionFiles(sessionsRoot: string): Promise<ReadonlyArray<string>> {
  const now = new Date();
  const candidates: string[] = [];

  for (let offset = 0; offset <= LOOKBACK_DAYS; offset += 1) {
    const current = new Date(now);
    current.setDate(now.getDate() - offset);
    const dayDir = nodePath.join(
      sessionsRoot,
      `${current.getFullYear()}`,
      `${String(current.getMonth() + 1).padStart(2, "0")}`,
      `${String(current.getDate()).padStart(2, "0")}`,
    );
    const entries = await safeReadDir(dayDir);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        candidates.push(nodePath.join(dayDir, entry.name));
      }
    }
  }

  return (await listRecentFiles(candidates)).map((file) => file.path);
}

async function readFileRange(
  handle: Awaited<ReturnType<typeof fs.open>>,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const result = await handle.read(buffer, bytesRead, length - bytesRead, position + bytesRead);
    if (result.bytesRead === 0) {
      break;
    }
    bytesRead += result.bytesRead;
  }
  return buffer.subarray(0, bytesRead);
}

function parseCodexSessionSummaryLine(line: string): CodexSessionSummary | null {
  if (!line.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const record = asObjectRecord(parsed);
  if (!record || record.type !== "event_msg") {
    return null;
  }

  const payload = asObjectRecord(record.payload);
  if (!payload || payload.type !== "token_count") {
    return null;
  }

  const timestampMs = parseTimestampMs(record.timestamp ?? payload.timestamp);
  if (timestampMs === null) {
    return null;
  }

  return {
    timestampMs,
    totalTokens: readCodexTotalTokens(payload),
  };
}

async function readCodexSessionSummary(path: string): Promise<CodexSessionSummary | null> {
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(path, "r");
  } catch {
    return null;
  }

  try {
    const { size } = await handle.stat();
    let position = size;
    let partialLine = Buffer.alloc(0);
    let skippingOversizedLine = false;

    while (position > 0) {
      const length = Math.min(CODEX_SESSION_READ_CHUNK_BYTES, position);
      position -= length;
      const bytes = await readFileRange(handle, position, length);
      let lineEnd = bytes.length;

      for (let index = bytes.length - 1; index >= 0; index -= 1) {
        if (bytes[index] !== 0x0a) {
          continue;
        }

        const linePrefix = bytes.subarray(index + 1, lineEnd);
        if (skippingOversizedLine) {
          skippingOversizedLine = false;
        } else {
          const lineLength = linePrefix.length + partialLine.length;
          if (lineLength <= MAX_CODEX_SESSION_LINE_BYTES) {
            const summary = parseCodexSessionSummaryLine(
              Buffer.concat([linePrefix, partialLine], lineLength).toString("utf8"),
            );
            if (summary) {
              return summary;
            }
          }
        }

        partialLine = Buffer.alloc(0);
        lineEnd = index;
      }

      if (skippingOversizedLine) {
        continue;
      }

      const linePrefix = bytes.subarray(0, lineEnd);
      const lineLength = linePrefix.length + partialLine.length;
      if (lineLength > MAX_CODEX_SESSION_LINE_BYTES) {
        partialLine = Buffer.alloc(0);
        skippingOversizedLine = true;
        continue;
      }
      partialLine = Buffer.concat([linePrefix, partialLine], lineLength);
    }

    return skippingOversizedLine
      ? null
      : parseCodexSessionSummaryLine(partialLine.toString("utf8"));
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function readClaudeTotalTokens(value: unknown): number {
  const usage = asObjectRecord(value);
  if (!usage) {
    return 0;
  }

  const inputTokens =
    (asNonNegativeNumber(usage.input_tokens) ?? 0) +
    (asNonNegativeNumber(usage.cache_creation_input_tokens) ?? 0) +
    (asNonNegativeNumber(usage.cache_read_input_tokens) ?? 0);
  const outputTokens = asNonNegativeNumber(usage.output_tokens) ?? 0;
  return asNonNegativeNumber(usage.total_tokens) ?? inputTokens + outputTokens;
}

function readClaudeAssistantSample(input: {
  record: Record<string, unknown>;
  fallbackKey: string;
}): { dedupeKey: string; sample: ClaudeUsageSample } | null {
  if (input.record.type !== "assistant") {
    return null;
  }

  const message = asObjectRecord(input.record.message);
  const usage = asObjectRecord(message?.usage);
  const totalTokens = readClaudeTotalTokens(usage);
  const timestampMs = parseTimestampMs(input.record.timestamp);
  if (!usage || totalTokens <= 0 || timestampMs === null) {
    return null;
  }

  const sessionId = nonEmptyTrimmed(input.record.sessionId) ?? input.fallbackKey;
  const model = nonEmptyTrimmed(message?.model) ?? null;
  const dedupeKey =
    `${sessionId}:assistant:` +
    (nonEmptyTrimmed(input.record.requestId) ??
      nonEmptyTrimmed(message?.id) ??
      nonEmptyTrimmed(input.record.uuid) ??
      input.fallbackKey);

  return {
    dedupeKey,
    sample: {
      sessionId,
      timestampMs,
      totalTokens,
      model,
    },
  };
}

function readClaudeToolResultSample(input: {
  record: Record<string, unknown>;
  fallbackKey: string;
}): { dedupeKey: string; sample: ClaudeUsageSample } | null {
  const toolUseResult = asObjectRecord(input.record.toolUseResult);
  const usage = asObjectRecord(toolUseResult?.usage);
  const totalTokens = readClaudeTotalTokens(usage);
  const timestampMs = parseTimestampMs(input.record.timestamp);
  if (!toolUseResult || !usage || totalTokens <= 0 || timestampMs === null) {
    return null;
  }

  const sessionId = nonEmptyTrimmed(input.record.sessionId) ?? input.fallbackKey;
  const dedupeKey =
    `${sessionId}:tool-result:` +
    (nonEmptyTrimmed(input.record.uuid) ??
      nonEmptyTrimmed(toolUseResult.agentId) ??
      nonEmptyTrimmed(input.record.requestId) ??
      input.fallbackKey);

  return {
    dedupeKey,
    sample: {
      sessionId,
      timestampMs,
      totalTokens,
      model: null,
    },
  };
}

function resolveClaudeProjectsRoot(homeDir: string): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return nodePath.join(configDir || nodePath.join(homeDir, ".claude"), "projects");
}

async function listRecentClaudeTranscriptFiles(
  projectsRoot: string,
  maxFiles: number = MAX_RECENT_USAGE_FILES,
): Promise<ReadonlyArray<RecentFile>> {
  const candidates: string[] = [];
  const projectEntries = await safeReadDir(projectsRoot);

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = nodePath.join(projectsRoot, projectEntry.name);
    const transcriptEntries = await safeReadDir(projectDir);
    for (const transcriptEntry of transcriptEntries) {
      if (transcriptEntry.isFile() && transcriptEntry.name.endsWith(".jsonl")) {
        candidates.push(nodePath.join(projectDir, transcriptEntry.name));
      }
    }
  }

  return listRecentFiles(candidates, maxFiles);
}

// Both sample kinds read a `usage` key and JSON never escapes its letters, so lines without these
// bytes are skipped before decoding. Most transcript bytes are tool output and file contents.
const CLAUDE_USAGE_KEY = Buffer.from('"usage"');
// Bytes just before the resume offset that must still match for a transcript to count as appended.
const CLAUDE_TRANSCRIPT_FINGERPRINT_BYTES = 64;

interface ClaudeTranscriptScan {
  readonly mtimeMs: number;
  readonly size: number;
  // End of the last complete line; a grown transcript is read again from here.
  readonly offset: number;
  readonly lineIndex: number;
  readonly fingerprint: Buffer;
  readonly samples: ReadonlyArray<ClaudeUsageSample>;
  readonly seenKeys: ReadonlySet<string>;
}

async function readClaudeTranscriptFingerprint(path: string, offset: number): Promise<Buffer> {
  const length = Math.min(offset, CLAUDE_TRANSCRIPT_FINGERPRINT_BYTES);
  const buffer = Buffer.alloc(length);
  if (length === 0) return buffer;
  const handle = await fs.open(path, "r");
  try {
    const { bytesRead } = await handle.read(buffer, 0, length, offset - length);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

// Reading one into a string costs its full size in the heap plus a second copy for the line split,
// so a few large transcripts are enough to exhaust old space and abort the backend. Stream chunks
// and cap individual records so malformed or tool-heavy lines cannot recreate the same problem
// inside a line reader. Active transcripts only grow, so a later read continues from the previous
// scan; the trailing unterminated line is read each time and deduplicated.
async function readClaudeUsageSamples(
  file: RecentFile,
  previous: ClaudeTranscriptScan | null,
): Promise<{ readonly scan: ClaudeTranscriptScan; readonly complete: boolean }> {
  const samples = previous ? [...previous.samples] : [];
  const seenKeys = new Set(previous?.seenKeys);
  let offset = previous?.offset ?? 0;
  let lineIndex = previous?.lineIndex ?? 0;
  let complete = true;
  const stream = createReadStream(file.path, { start: offset });
  let chunkStart = offset;
  let lineChunks: Buffer[] = [];
  let lineBytes = 0;
  let skippingOversizedLine = false;

  const collectLine = (line: Buffer, index: number): void => {
    if (line.indexOf(CLAUDE_USAGE_KEY) === -1) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line.toString("utf8"));
    } catch {
      return;
    }

    const record = asObjectRecord(parsed);
    if (!record) {
      return;
    }

    const fallbackKey = `${file.path}:${index}`;
    const assistantSample = readClaudeAssistantSample({ record, fallbackKey });
    if (assistantSample && !seenKeys.has(assistantSample.dedupeKey)) {
      seenKeys.add(assistantSample.dedupeKey);
      samples.push(assistantSample.sample);
    }

    const toolResultSample = readClaudeToolResultSample({ record, fallbackKey });
    if (toolResultSample && !seenKeys.has(toolResultSample.dedupeKey)) {
      seenKeys.add(toolResultSample.dedupeKey);
      samples.push(toolResultSample.sample);
    }
  };

  const appendLineChunk = (chunk: Buffer): void => {
    if (skippingOversizedLine || chunk.length === 0) {
      return;
    }
    if (lineBytes + chunk.length > MAX_CLAUDE_TRANSCRIPT_LINE_BYTES) {
      lineChunks = [];
      lineBytes = 0;
      skippingOversizedLine = true;
      return;
    }
    lineChunks.push(chunk);
    lineBytes += chunk.length;
  };

  const pendingLine = (): Buffer =>
    lineChunks.length === 1 ? lineChunks[0]! : Buffer.concat(lineChunks, lineBytes);

  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      let lineStart = 0;
      for (
        let newline = chunk.indexOf(0x0a);
        newline !== -1;
        newline = chunk.indexOf(0x0a, lineStart)
      ) {
        appendLineChunk(chunk.subarray(lineStart, newline));
        if (!skippingOversizedLine && lineBytes > 0) {
          collectLine(pendingLine(), lineIndex);
        }
        lineChunks = [];
        lineBytes = 0;
        lineIndex += 1;
        skippingOversizedLine = false;
        lineStart = newline + 1;
        offset = chunkStart + lineStart;
      }
      appendLineChunk(chunk.subarray(lineStart));
      chunkStart += chunk.length;
    }

    if (lineBytes > 0 && !skippingOversizedLine) {
      collectLine(pendingLine(), lineIndex);
    }
  } catch {
    complete = false;
  } finally {
    stream.destroy();
  }

  const fingerprint = complete
    ? await readClaudeTranscriptFingerprint(file.path, offset).catch(() => {
        complete = false;
        return Buffer.alloc(0);
      })
    : Buffer.alloc(0);
  return {
    scan: {
      mtimeMs: file.mtimeMs,
      size: file.size,
      offset,
      lineIndex,
      fingerprint,
      samples,
      seenKeys,
    },
    complete,
  };
}

const claudeTranscriptScans = new Map<string, ClaudeTranscriptScan>();

async function readCachedClaudeUsageSamples(
  file: RecentFile,
): Promise<ReadonlyArray<ClaudeUsageSample>> {
  const cached = claudeTranscriptScans.get(file.path);
  if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
    return cached.samples;
  }
  const appended =
    cached !== undefined &&
    file.size >= cached.offset &&
    (await readClaudeTranscriptFingerprint(file.path, cached.offset)
      .then((bytes) => bytes.equals(cached.fingerprint))
      .catch(() => false));
  const { scan, complete } = await readClaudeUsageSamples(file, appended ? cached : null);
  if (complete) {
    claudeTranscriptScans.set(file.path, scan);
  }
  return scan.samples;
}

async function loadCodexUsageSnapshot(input: {
  homeDir: string;
  homePath?: string;
}): Promise<UsageSnapshot | null> {
  const codexHomeDir =
    input.homePath?.trim() || process.env.CODEX_HOME || nodePath.join(input.homeDir, ".codex");
  const sessionsRoot = nodePath.join(codexHomeDir, "sessions");
  const sessionFiles = await listRecentCodexSessionFiles(sessionsRoot);
  if (sessionFiles.length === 0) {
    return null;
  }

  const sessionSummaries = (
    await mapWithConcurrency(
      sessionFiles,
      PROVIDER_USAGE_FILE_READ_CONCURRENCY,
      readCodexSessionSummary,
    )
  ).filter((summary): summary is CodexSessionSummary => summary !== null);

  if (sessionSummaries.length === 0) {
    return null;
  }

  const latestSummary = sessionSummaries.reduce((latest, current) =>
    current.timestampMs > latest.timestampMs ? current : latest,
  );
  const nowMs = Date.now();
  const cutoff24h = nowMs - ONE_DAY_MS;
  const cutoff7d = nowMs - LOOKBACK_7D_MS;
  const cutoff30d = nowMs - LOOKBACK_30D_MS;

  const recent24h = sessionSummaries.filter((summary) => summary.timestampMs >= cutoff24h);
  const recent7d = sessionSummaries.filter((summary) => summary.timestampMs >= cutoff7d);
  const recent30d = sessionSummaries.filter((summary) => summary.timestampMs >= cutoff30d);

  return {
    provider: "codex",
    updatedAt: toIsoString(latestSummary.timestampMs),
    limits: [],
    usageLines: buildUsageLines({
      tokens24h: recent24h.reduce((total, summary) => total + summary.totalTokens, 0),
      tokens7d: recent7d.reduce((total, summary) => total + summary.totalTokens, 0),
      tokens30d: recent30d.reduce((total, summary) => total + summary.totalTokens, 0),
      sessions24h: recent24h.length,
      sessions7d: recent7d.length,
      sessions30d: recent30d.length,
    }),
    source: "codex-session-archive",
  };
}

async function loadClaudeUsageSnapshot(input: { homeDir: string }): Promise<UsageSnapshot | null> {
  const projectsRoot = resolveClaudeProjectsRoot(input.homeDir);
  const transcriptFiles = await listRecentClaudeTranscriptFiles(projectsRoot);
  if (transcriptFiles.length === 0) {
    return null;
  }

  const lookbackStartMs = Date.now() - LOOKBACK_30D_MS;
  const usageSamples = (
    await mapWithConcurrency(
      // Every sample in a file predates its last write, so older files cannot reach the window.
      transcriptFiles.filter((file) => file.mtimeMs >= lookbackStartMs),
      CLAUDE_TRANSCRIPT_READ_CONCURRENCY,
      readCachedClaudeUsageSamples,
    )
  ).flat();
  const listedPaths = new Set(transcriptFiles.map((file) => file.path));
  for (const path of claudeTranscriptScans.keys()) {
    if (!listedPaths.has(path)) claudeTranscriptScans.delete(path);
  }

  if (usageSamples.length === 0) {
    return null;
  }

  const nowMs = Date.now();
  const cutoff24h = nowMs - ONE_DAY_MS;
  const cutoff7d = nowMs - LOOKBACK_7D_MS;
  const cutoff30d = nowMs - LOOKBACK_30D_MS;
  const recent24h = usageSamples.filter((sample) => sample.timestampMs >= cutoff24h);
  const recent7d = usageSamples.filter((sample) => sample.timestampMs >= cutoff7d);
  const recent30d = usageSamples.filter((sample) => sample.timestampMs >= cutoff30d);
  const latestSample = usageSamples.reduce((latest, current) =>
    current.timestampMs > latest.timestampMs ? current : latest,
  );

  return {
    provider: "claudeAgent",
    updatedAt: toIsoString(latestSample.timestampMs),
    limits: [],
    usageLines: buildUsageLines({
      tokens24h: recent24h.reduce((total, sample) => total + sample.totalTokens, 0),
      tokens7d: recent7d.reduce((total, sample) => total + sample.totalTokens, 0),
      tokens30d: recent30d.reduce((total, sample) => total + sample.totalTokens, 0),
      sessions24h: new Set(recent24h.map((sample) => sample.sessionId)).size,
      sessions7d: new Set(recent7d.map((sample) => sample.sessionId)).size,
      sessions30d: new Set(recent30d.map((sample) => sample.sessionId)).size,
    }),
    source: "claude-project-transcripts",
  };
}

async function loadProviderUsageSnapshot(input: {
  provider: ProviderKind;
  homeDir: string;
  homePath?: string;
}): Promise<ServerGetProviderUsageSnapshotResult> {
  switch (input.provider) {
    case "codex":
      return loadCodexUsageSnapshot({
        homeDir: input.homeDir,
        ...(input.homePath ? { homePath: input.homePath } : {}),
      });
    case "claudeAgent":
      return loadClaudeUsageSnapshot({ homeDir: input.homeDir });
    default:
      return null;
  }
}

async function getCachedProviderUsageSnapshot(input: {
  provider: ProviderKind;
  homeDir: string;
  homePath?: string;
}): Promise<ServerGetProviderUsageSnapshotResult> {
  const cacheKey = `${input.provider}:${input.homeDir}:${input.homePath?.trim() ?? ""}:${process.env.CLAUDE_CONFIG_DIR?.trim() ?? ""}`;
  const nowMs = Date.now();
  const existing = usageSnapshotCache.get(cacheKey);

  if (existing && existing.expiresAtMs > nowMs) {
    return existing.value;
  }
  if (existing?.pending) {
    return existing.pending;
  }

  const pending = loadProviderUsageSnapshot(input)
    .catch(() => null)
    .then((value) => {
      usageSnapshotCache.set(cacheKey, {
        expiresAtMs: Date.now() + USAGE_CACHE_TTL_MS,
        value,
        pending: null,
      });
      return value;
    });

  usageSnapshotCache.set(cacheKey, {
    expiresAtMs: existing?.expiresAtMs ?? 0,
    value: existing?.value ?? null,
    pending,
  });

  return pending;
}

export const getProviderUsageSnapshot = Effect.fn(function* (
  input: ServerGetProviderUsageSnapshotInput,
) {
  const serverConfig = yield* ServerConfig;
  return yield* Effect.tryPromise({
    try: () =>
      getCachedProviderUsageSnapshot({
        provider: input.provider,
        homeDir: serverConfig.homeDir,
        ...(input.homePath ? { homePath: input.homePath } : {}),
      }),
    catch: () => null,
  });
});

export async function loadLocalProviderUsageLines(input: {
  provider: ProviderKind;
  homeDir: string;
  homePath?: string;
}): Promise<ReadonlyArray<ServerProviderUsageLine>> {
  try {
    const snapshot = await getCachedProviderUsageSnapshot(input);
    return snapshot?.usageLines ?? [];
  } catch {
    return [];
  }
}
