import { RotatingFileSink } from "@glade/shared/platform/logging";
import { app } from "electron";
import * as Path from "node:path";
import {
  APP_RUN_ID,
  BACKEND_LOG_FILE_NAME,
  DESKTOP_LOG_FILE_NAME,
  LOG_DIR,
  LOG_FILE_MAX_BYTES,
  LOG_FILE_MAX_FILES,
} from "../desktopEnvironment";
import { isBrokenPipeError } from "./desktopProcessErrors";
export function sanitizeLogValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
export function safeConsoleError(...args: Parameters<typeof console.error>): void {
  try {
    console.error(...args);
  } catch (error: unknown) {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  }
}
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
export interface DesktopLog {
  writeDesktopLogHeader(message: string): void;
  writeBackendSessionBoundary(phase: "START" | "END", details: string): void;
  readonly writeBackendOutput: ((chunk: Buffer) => void) | undefined;
  dispose(): void;
}
export function createDesktopLogging(): DesktopLog {
  let desktopLogSink: RotatingFileSink | null = null;
  let backendLogSink: RotatingFileSink | null = null;
  let restoreStdIoCapture: (() => void) | null = null;
  const handleStreamError = (streamName: "stdout" | "stderr", error: Error): void => {
    if (!isBrokenPipeError(error)) throw error;
    // The launcher is gone; write only to the file sink to avoid another pipe error.
    writeDesktopLogHeader(`${streamName} output pipe closed`);
  };
  const onStdoutError = (error: Error) => handleStreamError("stdout", error);
  const onStderrError = (error: Error) => handleStreamError("stderr", error);
  process.stdout.on("error", onStdoutError);
  process.stderr.on("error", onStderrError);

  function logTimestamp(): string {
    return new Date().toISOString();
  }

  function logScope(scope: string): string {
    return `${scope} run=${APP_RUN_ID}`;
  }

  function writeDesktopLogHeader(message: string): void {
    if (!desktopLogSink) return;
    desktopLogSink.write(`[${logTimestamp()}] [${logScope("desktop")}] ${message}\n`);
  }

  function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
    if (!backendLogSink) return;
    const normalizedDetails = sanitizeLogValue(details);
    backendLogSink.write(
      `[${logTimestamp()}] ---- APP SESSION ${phase} run=${APP_RUN_ID} ${normalizedDetails} ----\n`,
    );
  }

  function writeDesktopStreamChunk(
    streamName: "stdout" | "stderr",
    chunk: unknown,
    encoding: BufferEncoding | undefined,
  ): void {
    if (!desktopLogSink) return;
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), typeof chunk === "string" ? encoding : undefined);
    desktopLogSink.write(`[${logTimestamp()}] [${logScope(streamName)}] `);
    desktopLogSink.write(buffer);
    if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) {
      desktopLogSink.write("\n");
    }
  }

  function installStdIoCapture(): void {
    if (!app.isPackaged || desktopLogSink === null || restoreStdIoCapture !== null) {
      return;
    }

    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    const patchWrite =
      (streamName: "stdout" | "stderr", originalWrite: typeof process.stdout.write) =>
      (
        chunk: string | Uint8Array,
        encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
        callback?: (error?: Error | null) => void,
      ): boolean => {
        const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
        writeDesktopStreamChunk(streamName, chunk, encoding);
        if (typeof encodingOrCallback === "function") {
          return originalWrite(chunk, encodingOrCallback);
        }
        if (callback !== undefined) {
          return originalWrite(chunk, encoding, callback);
        }
        if (encoding !== undefined) {
          return originalWrite(chunk, encoding);
        }
        return originalWrite(chunk);
      };

    process.stdout.write = patchWrite("stdout", originalStdoutWrite);
    process.stderr.write = patchWrite("stderr", originalStderrWrite);

    restoreStdIoCapture = () => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      restoreStdIoCapture = null;
    };
  }

  function initializePackagedLogging(): void {
    if (!app.isPackaged) return;
    try {
      desktopLogSink = new RotatingFileSink({
        filePath: Path.join(LOG_DIR, DESKTOP_LOG_FILE_NAME),
        maxBytes: LOG_FILE_MAX_BYTES,
        maxFiles: LOG_FILE_MAX_FILES,
      });
      backendLogSink = new RotatingFileSink({
        filePath: Path.join(LOG_DIR, BACKEND_LOG_FILE_NAME),
        maxBytes: LOG_FILE_MAX_BYTES,
        maxFiles: LOG_FILE_MAX_FILES,
      });
      installStdIoCapture();
      writeDesktopLogHeader(`runtime log capture enabled logDir=${LOG_DIR}`);
    } catch (error) {
      console.error("[desktop] failed to initialize packaged logging", error);
    }
  }
  initializePackagedLogging();
  return {
    writeDesktopLogHeader,
    writeBackendSessionBoundary,
    get writeBackendOutput() {
      return backendLogSink?.write.bind(backendLogSink);
    },
    dispose: () => {
      restoreStdIoCapture?.();
      process.stdout.off("error", onStdoutError);
      process.stderr.off("error", onStderrError);
    },
  };
}
