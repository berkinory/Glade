import { readNativeApi } from "~/nativeApi";
import type { TerminalRuntimeEntry } from "./terminalRuntimeTypes";
import { observeTerminalWriteParsed } from "./terminalPerformance";

const WRITE_BATCH_SIZE_LIMIT = 262_144;
const WRITE_BATCH_MAX_LATENCY_MS = 50;
const TERMINAL_TEXT_ENCODER = new TextEncoder();

export function terminalByteLength(data: string): number {
  return TERMINAL_TEXT_ENCODER.encode(data).byteLength;
}

function acknowledgeParsedOutput(entry: TerminalRuntimeEntry, bytes: number): void {
  if (bytes <= 0) return;
  const api = readNativeApi();
  if (!api) return;
  const ackOutput = api.terminal.ackOutput;
  if (typeof ackOutput !== "function") return;

  void ackOutput({
    threadId: entry.threadId,
    terminalId: entry.terminalId,
    bytes,
  }).catch(() => {});
}

export function clearPendingWrites(entry: TerminalRuntimeEntry): void {
  if (entry.writeRafHandle !== null) {
    window.cancelAnimationFrame(entry.writeRafHandle);
    entry.writeRafHandle = null;
  }
  if (entry.writeFlushTimeout !== null) {
    window.clearTimeout(entry.writeFlushTimeout);
    entry.writeFlushTimeout = null;
  }
  if (entry.pendingWriteBytes > 0) {
    acknowledgeParsedOutput(entry, entry.pendingWriteBytes);
  }
  entry.pendingWrites.length = 0;
  entry.pendingWriteLength = 0;
  entry.pendingWriteBytes = 0;
}

export function flushPendingWrites(entry: TerminalRuntimeEntry): void {
  if (entry.writeRafHandle !== null) {
    window.cancelAnimationFrame(entry.writeRafHandle);
    entry.writeRafHandle = null;
  }
  if (entry.writeFlushTimeout !== null) {
    window.clearTimeout(entry.writeFlushTimeout);
    entry.writeFlushTimeout = null;
  }
  if (entry.pendingWrites.length === 0) {
    entry.pendingWriteLength = 0;
    entry.pendingWriteBytes = 0;
    return;
  }
  const combined = entry.pendingWrites.map((write) => write.data).join("");
  const byteLength = entry.pendingWriteBytes;
  const queuedAt = entry.pendingWrites[0]?.queuedAt ?? performance.now();
  entry.pendingWrites.length = 0;
  entry.pendingWriteLength = 0;
  entry.pendingWriteBytes = 0;
  entry.output.write(combined, () => {
    acknowledgeParsedOutput(entry, byteLength);
    observeTerminalWriteParsed({
      runtimeKey: entry.runtimeKey,
      bytes: byteLength,
      queuedAt,
    });
  });
}

export function scheduleWrite(entry: TerminalRuntimeEntry, data: string, byteLength: number): void {
  entry.pendingWrites.push({
    data,
    byteLength,
    queuedAt: performance.now(),
  });
  entry.pendingWriteLength += data.length;
  entry.pendingWriteBytes += byteLength;

  if (entry.pendingWriteBytes >= WRITE_BATCH_SIZE_LIMIT) {
    flushPendingWrites(entry);
    return;
  }

  if (entry.writeRafHandle === null) {
    entry.writeRafHandle = window.requestAnimationFrame(() => {
      entry.writeRafHandle = null;
      flushPendingWrites(entry);
    });
  }
  if (entry.writeFlushTimeout === null) {
    entry.writeFlushTimeout = window.setTimeout(() => {
      entry.writeFlushTimeout = null;
      flushPendingWrites(entry);
    }, WRITE_BATCH_MAX_LATENCY_MS);
  }
}
