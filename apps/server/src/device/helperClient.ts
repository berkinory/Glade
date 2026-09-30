import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { decodeDeviceFrame } from "@glade/shared/workspace/deviceFrame";
import {
  LengthPrefixedRecordError,
  LengthPrefixedRecordParser,
} from "../platform/transport/lengthPrefixedRecords";
import {
  JsonRpcStdioFramer,
  JsonRpcStdioRequestRegistry,
  JsonRpcStdioTransportError,
  JsonRpcStdioWriter,
} from "../platform/transport/jsonRpcStdio";

import type { DeviceStreamFrame } from "./DeviceBackend.ts";
import { describeSandboxSuspicion, type HelperSandboxCommand } from "./helperSandbox.ts";

export const HELPER_METHODS = {
  ping: "ping",
  list: "list",
  attach: "attach",
  streamStart: "stream.start",
  streamStop: "stream.stop",
  streamStats: "stream.stats",
  tap: "tap",
  touch: "touch",
  swipe: "swipe",
  key: "key",
  text: "text",
  button: "button",
  screenshot: "screenshot",
  describeUi: "describe-ui",
} as const;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONTROL_LINE_BYTES = 4 * 1024 * 1024;

export class DeviceHelperError extends Error {
  readonly _tag = "DeviceHelperError";
  readonly code: string;

  constructor(code: string, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "DeviceHelperError";
    this.code = code;
  }
}

export interface DeviceHelperAttachment {
  readonly udid: string;
  readonly pointWidth: number;
  readonly pointHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly scale: number;
  readonly inputAvailable: boolean;
  readonly accessibilityAvailable: boolean;
}

export interface HelperClientOptions {
  readonly binaryPath: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly requestTimeoutMs?: number;
  readonly onExit?: (reason: string) => void;
  // Resolved by the caller because building it reads the filesystem while `start()` is synchronous.
  readonly launch?: HelperSandboxCommand | undefined;
}

function disposedError(): DeviceHelperError {
  return new DeviceHelperError("helper_disposed", "Device helper was shut down");
}

// The error names both the offending value and the valid range, because the overwhelmingly common
// cause is a caller passing frame pixels: seeing "1019 is outside 0..402" makes the scale factor
// obvious immediately.
function normalizeCoordinate(
  value: number,
  extent: number,
  axis: "x" | "y",
  attachment: DeviceHelperAttachment,
): number {
  if (!Number.isFinite(value) || value < 0 || value > extent) {
    throw new DeviceHelperError(
      "device_coordinate_out_of_bounds",
      `Device ${axis}=${value} is outside the screen bounds 0..${extent} device points ` +
        `(${attachment.pointWidth}x${attachment.pointHeight} points at ${attachment.scale}x; ` +
        `pass device points, not frame pixels).`,
    );
  }
  return extent === 0 ? 0 : value / extent;
}

function readNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// Map framing failures to DeviceHelperError so the transport rejects desynchronized streams.
class DeviceFramePrefixParser {
  private readonly parser = new LengthPrefixedRecordParser();

  push(chunk: Uint8Array): readonly Uint8Array[] {
    try {
      return this.parser.push(chunk);
    } catch (error) {
      if (error instanceof LengthPrefixedRecordError) {
        throw new DeviceHelperError(
          "frame_stream_desync",
          `Helper frame record claims ${error.declaredBytes} bytes`,
        );
      }
      throw error;
    }
  }
}

export class HelperClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutFramer: JsonRpcStdioFramer | null = null;
  private stdinWriter: JsonRpcStdioWriter | null = null;
  private requestRegistry: JsonRpcStdioRequestRegistry | null = null;
  private readonly requestTimeoutMs: number;
  private stderrTail = "";
  private exited = false;
  private disposed = false;

  private attachment: DeviceHelperAttachment | null = null;
  private frameServer: Server | null = null;
  private frameSocket: Socket | null = null;
  private frameSocketDirectory: string | null = null;

  constructor(private readonly options: HelperClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  get running(): boolean {
    return this.process !== null && !this.exited;
  }

  get attachedDevice(): DeviceHelperAttachment | null {
    return this.attachment;
  }

  start(): void {
    if (this.disposed) throw disposedError();
    if (this.process) return;
    const launch = this.options.launch;
    const [command, args] = launch
      ? [launch.command, [...launch.args]]
      : [this.options.binaryPath, [...(this.options.args ?? [])]];
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.options.env ?? process.env,
    });
    this.process = child;
    this.exited = false;
    this.stdoutFramer = new JsonRpcStdioFramer(MAX_CONTROL_LINE_BYTES, (error) =>
      this.handleControlLineError(error),
    );
    this.stdinWriter = new JsonRpcStdioWriter(child.stdin);
    this.requestRegistry = new JsonRpcStdioRequestRegistry({
      requestTimeoutMs: this.requestTimeoutMs,
      includeJsonRpcVersion: true,
      timeoutError: (method) =>
        new DeviceHelperError(
          "helper_timeout",
          `Device helper ${method} timed out.${describeSandboxSuspicion(
            this.options.launch?.profilePath ?? null,
          )}`,
        ),
      responseError: ({ error }) =>
        new DeviceHelperError(
          typeof error.code === "number" ? `helper_${error.code}` : "helper_error",
          typeof error.message === "string" ? error.message : "Device helper reported an error",
        ),
    });
    this.requestRegistry.processStarted();

    child.stdout.on("data", (chunk: Buffer) => {
      if (this.process !== child) return;
      this.consumeStdout(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (this.process !== child) return;
      // Keep only a tail: helper diagnostics belong in the failure message but must never grow without
      // bound over a long-lived session.
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4_096);
    });
    child.on("error", (error) => {
      if (this.process !== child) return;
      this.fail(new DeviceHelperError("helper_spawn_failed", error.message));
    });
    child.on("exit", (code, signal) => {
      if (this.process !== child) return;
      this.exited = true;
      this.attachment = null;
      const reason = `device helper exited (code=${code ?? "null"}, signal=${signal ?? "null"})${
        this.stderrTail.trim() ? `: ${this.stderrTail.trim()}` : ""
      }`;
      this.fail(new DeviceHelperError("helper_exited", reason));
      this.options.onExit?.(reason);
    });
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.process) this.start();
    const child = this.process;
    if (!child || this.exited) {
      throw new DeviceHelperError("helper_unavailable", "Device helper is not running");
    }

    const registry = this.requestRegistry;
    const writer = this.stdinWriter;
    if (!registry || !writer) {
      throw new DeviceHelperError("helper_unavailable", "Device helper transport is not ready");
    }
    try {
      return await registry.request(method, params, (message) => writer.write(message));
    } catch (error) {
      if (error instanceof DeviceHelperError) throw error;
      throw new DeviceHelperError(
        "helper_write_failed",
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }

  async attach(
    udid: string,
    options: { readonly force?: boolean } = {},
  ): Promise<DeviceHelperAttachment> {
    if (!options.force && this.attachment?.udid === udid) return this.attachment;
    // Cleared before the request: a failed re-attach must not leave the caller believing the previous,
    // now-dead attachment is still good.
    this.attachment = null;
    const result = asObjectRecord(await this.request(HELPER_METHODS.attach, { udid })) ?? {};
    const capabilities = asObjectRecord(result.capabilities) ?? {};
    const pixelWidth = readNumber(result, "pixelWidth", 0);
    const pixelHeight = readNumber(result, "pixelHeight", 0);
    const scale = readNumber(result, "scale", 3);
    const attachment: DeviceHelperAttachment = {
      udid,
      pixelWidth,
      pixelHeight,
      scale,
      pointWidth: readNumber(result, "pointWidth", pixelWidth / scale),
      pointHeight: readNumber(result, "pointHeight", pixelHeight / scale),
      inputAvailable: capabilities.input === true,
      accessibilityAvailable: capabilities.accessibility === true,
    };
    if (attachment.pointWidth <= 0 || attachment.pointHeight <= 0) {
      throw new DeviceHelperError(
        "helper_malformed_response",
        "Device helper reported no usable screen geometry",
      );
    }
    this.attachment = attachment;
    return attachment;
  }

  // Shutting the device down invalidates that descriptor, but the helper process outlives the
  // simulator, so without this the next `attach` would short-circuit on the matching udid and every
  // call would fail against a dead framebuffer.
  invalidateAttachment(udid: string): void {
    if (this.attachment?.udid === udid) this.attachment = null;
  }

  // Reject out-of-bounds points instead of clamping: clamping hides coordinate-space errors behind
  // successful edge taps.
  normalize(x: number, y: number): { readonly x: number; readonly y: number } {
    const attachment = this.attachment;
    if (!attachment) {
      throw new DeviceHelperError(
        "helper_not_attached",
        "Device helper is not attached to a device",
      );
    }
    return {
      x: normalizeCoordinate(x, attachment.pointWidth, "x", attachment),
      y: normalizeCoordinate(y, attachment.pointHeight, "y", attachment),
    };
  }

  // The server owns the socket: it listens first and passes the path, so the helper never has to
  // guess where to connect and a stale socket file cannot be reused.
  async startStream(udid: string, onFrame: (frame: DeviceStreamFrame) => void): Promise<void> {
    await this.stopStream();
    await this.attach(udid);

    const directory = await mkdtemp(path.join(tmpdir(), "glade-device-frames-"));
    const socketPath = path.join(directory, "frames.sock");
    this.frameSocketDirectory = directory;

    const server = createServer();
    this.frameServer = server;
    server.on("connection", (socket) => {
      this.frameSocket = socket;
      const parser = new DeviceFramePrefixParser();
      socket.on("data", (chunk: Buffer) => {
        let payloads: readonly Uint8Array[];
        try {
          payloads = parser.push(chunk);
        } catch {
          socket.destroy();
          return;
        }
        for (const record of payloads) {
          const decoded = decodeDeviceFrame(record);
          if (!decoded.ok) continue;
          const { header, payload } = decoded.frame;
          onFrame({
            sequence: header.sequence,
            timestampMs: header.timestampMs,
            keyframe: header.keyframe,
            codecConfig: header.codecConfig,

            data: payload,
          });
        }
      });
      socket.on("error", () => socket.destroy());
      socket.on("close", () => {
        if (this.frameSocket === socket) this.frameSocket = null;
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      await this.request(HELPER_METHODS.streamStart, { socketPath });
    } catch (error) {
      await this.closeFrameSocket();
      throw error;
    }
  }

  async stopStream(): Promise<void> {
    if (this.running && this.frameServer !== null) {
      await this.request(HELPER_METHODS.streamStop).catch(() => undefined);
    }
    await this.closeFrameSocket();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stopStream().catch(() => undefined);
    this.fail(disposedError());
    const child = this.process;
    this.process = null;
    this.attachment = null;
    this.exited = true;
    child?.stdin.end();
    child?.kill("SIGTERM");
  }

  private async closeFrameSocket(): Promise<void> {
    this.frameSocket?.destroy();
    this.frameSocket = null;
    const server = this.frameServer;
    this.frameServer = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const directory = this.frameSocketDirectory;
    this.frameSocketDirectory = null;
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }

  private consumeStdout(chunk: Buffer): void {
    const framer = this.stdoutFramer;
    if (!framer) return;
    try {
      for (const line of framer.push(chunk)) {
        const trimmed = line.trim();
        if (trimmed.length > 0) this.handleControlLine(trimmed);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.rejectInFlight(
        new DeviceHelperError("helper_protocol_error", message, { cause: error }),
      );
    }
  }

  // The framer has already resynchronized, so this only decides how loudly to react. An oversized
  // line is louder, because it means a response we were waiting for is gone: in-flight requests are
  // rejected so callers fail fast instead of sitting out the full timeout.
  private handleControlLineError(error: JsonRpcStdioTransportError): void {
    if (error.reason !== "frame-too-large") return;
    this.rejectInFlight(
      new DeviceHelperError("helper_protocol_error", "Device helper control line exceeded limit", {
        cause: error,
      }),
    );
  }

  private handleControlLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const record = asObjectRecord(message) ?? {};

    if (typeof record.id !== "number") return;
    const error =
      record.error === undefined || record.error === null
        ? undefined
        : (asObjectRecord(record.error) ?? {});
    this.requestRegistry?.handleResponse({
      id: record.id,
      result: record.result ?? null,
      ...(error
        ? {
            error: {
              ...(typeof error.code === "number" ? { code: error.code } : {}),
              ...(typeof error.message === "string" ? { message: error.message } : {}),
            },
          }
        : {}),
    });
  }

  private rejectInFlight(error: DeviceHelperError): void {
    this.requestRegistry?.rejectAll(error);
  }

  private fail(error: DeviceHelperError): void {
    this.requestRegistry?.processExited(error);
    this.stdinWriter?.close(error);
  }
}
