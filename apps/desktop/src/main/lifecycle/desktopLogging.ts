import { RotatingFileSink } from "@glade/shared/platform/logging";
import { app } from "electron";
import * as Path from "node:path";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import { isBrokenPipeError } from "./desktopProcessErrors";

export function createDesktopLogging(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "APP_RUN_ID"
    | "desktopLogSink"
    | "backendLogSink"
    | "restoreStdIoCapture"
    | "LOG_DIR"
    | "DESKTOP_LOG_FILE_NAME"
    | "LOG_FILE_MAX_BYTES"
    | "LOG_FILE_MAX_FILES"
    | "BACKEND_LOG_FILE_NAME"
  >,
) {
  function logTimestamp(): string {
    return new Date().toISOString();
  }

  function logScope(scope: string): string {
    return `${scope} run=${desktopRuntime.APP_RUN_ID}`;
  }

  function sanitizeLogValue(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function writeDesktopLogHeader(message: string): void {
    if (!desktopRuntime.desktopLogSink) return;
    desktopRuntime.desktopLogSink.write(
      `[${logTimestamp()}] [${logScope("desktop")}] ${message}\n`,
    );
  }

  function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
    if (!desktopRuntime.backendLogSink) return;
    const normalizedDetails = sanitizeLogValue(details);
    desktopRuntime.backendLogSink.write(
      `[${logTimestamp()}] ---- APP SESSION ${phase} run=${desktopRuntime.APP_RUN_ID} ${normalizedDetails} ----\n`,
    );
  }

  function safeConsoleError(...args: Parameters<typeof console.error>): void {
    try {
      console.error(...args);
    } catch (error: unknown) {
      if (!isBrokenPipeError(error)) {
        throw error;
      }
    }
  }

  function formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  function writeDesktopStreamChunk(
    streamName: "stdout" | "stderr",
    chunk: unknown,
    encoding: BufferEncoding | undefined,
  ): void {
    if (!desktopRuntime.desktopLogSink) return;
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), typeof chunk === "string" ? encoding : undefined);
    desktopRuntime.desktopLogSink.write(`[${logTimestamp()}] [${logScope(streamName)}] `);
    desktopRuntime.desktopLogSink.write(buffer);
    if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) {
      desktopRuntime.desktopLogSink.write("\n");
    }
  }

  function installStdIoCapture(): void {
    if (
      !app.isPackaged ||
      desktopRuntime.desktopLogSink === null ||
      desktopRuntime.restoreStdIoCapture !== null
    ) {
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

    desktopRuntime.restoreStdIoCapture = () => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      desktopRuntime.restoreStdIoCapture = null;
    };
  }

  function initializePackagedLogging(): void {
    if (!app.isPackaged) return;
    try {
      desktopRuntime.desktopLogSink = new RotatingFileSink({
        filePath: Path.join(desktopRuntime.LOG_DIR, desktopRuntime.DESKTOP_LOG_FILE_NAME),
        maxBytes: desktopRuntime.LOG_FILE_MAX_BYTES,
        maxFiles: desktopRuntime.LOG_FILE_MAX_FILES,
      });
      desktopRuntime.backendLogSink = new RotatingFileSink({
        filePath: Path.join(desktopRuntime.LOG_DIR, desktopRuntime.BACKEND_LOG_FILE_NAME),
        maxBytes: desktopRuntime.LOG_FILE_MAX_BYTES,
        maxFiles: desktopRuntime.LOG_FILE_MAX_FILES,
      });
      installStdIoCapture();
      writeDesktopLogHeader(`runtime log capture enabled logDir=${desktopRuntime.LOG_DIR}`);
    } catch (error) {
      console.error("[desktop] failed to initialize packaged logging", error);
    }
  }
  return {
    sanitizeLogValue,
    writeDesktopLogHeader,
    writeBackendSessionBoundary,
    safeConsoleError,
    formatErrorMessage,
    initializePackagedLogging,
  };
}
