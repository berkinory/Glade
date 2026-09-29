import { createConnection } from "node:net";
import release from "./cuaDriverRelease.json" with { type: "json" };

export const CUA_DRIVER_VERSION = release.version;
export const CUA_NATIVE_REVISION = release.nativeRevision;
export const CUA_DRIVER_SOURCE = release.source;
export const CUA_DRIVER_ARCHIVE_SHA256 = release.sha256;
export const CUA_HOST_SOCKET_ENV = "GLADE_CUA_HOST_SOCKET";

export const CUA_SETUP_TIMEOUT_MS = 120_000;
export const CUA_MAX_RESPONSE_BYTES = 96 * 1024 * 1024;
// The host uses one request/response per authenticated Unix socket connection. Verify the native
// revision before admitting input. Retirement requires cancel_input to acknowledge the exact child
// PID, closed admission, completed cleanup and zero pending input; absent proof closes admission
// for the host lifetime. Session IDs and epochs reject stale replies. OS interruption counts
// invalidate consent even across unobserved pause/resume cycles. Shield handles are caller-minted
// so lost replies remain releasable, and all release paths stay available while admission is
// closed. Parent death, EOF, TTL and display/Space changes independently release helper shields.
export interface CuaComputerTask {
  threadId: string;
  turnId?: string;
  label?: string;
}

export interface CuaPreviewTarget {
  task: CuaComputerTask;
  pid: number;
  windowId: number;
  cursor?: { x: number; y: number };
}

export function cuaComputerTaskKey(task: CuaComputerTask): string {
  return JSON.stringify([task.threadId, task.turnId ?? null]);
}

export const CUA_SHIELD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const CUA_SHIELD_MAX_EXTENT = 32_768;
export const CUA_SHIELD_MAX_COORDINATE = 1_000_000;

export type CuaShieldArgs =
  | {
      readonly action: "engage";
      readonly shieldId: string;
      readonly frame: { x: number; y: number; width: number; height: number };
      readonly windowId: number;
      readonly pid: number;
      readonly label?: string;
    }
  | { readonly action: "release"; readonly shieldId: string }
  | { readonly action: "release_all" };

const shieldCoordinate = (value: unknown): number | undefined =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= CUA_SHIELD_MAX_COORDINATE
    ? value
    : undefined;

const shieldExtent = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= CUA_SHIELD_MAX_EXTENT
    ? value
    : undefined;

export function parseCuaShieldArgs(value: unknown): CuaShieldArgs | undefined {
  if (!value || typeof value !== "object") return undefined;
  const args = value as Record<string, unknown>;
  if (args.action === "release_all") return { action: "release_all" };
  const shieldId = args.shield_id;
  if (typeof shieldId !== "string" || !CUA_SHIELD_ID_PATTERN.test(shieldId)) return undefined;
  if (args.action === "release") return { action: "release", shieldId };
  if (args.action !== "engage") return undefined;
  const frame = args.frame as Record<string, unknown> | undefined;
  const x = shieldCoordinate(frame?.x);
  const y = shieldCoordinate(frame?.y);
  const width = shieldExtent(frame?.width);
  const height = shieldExtent(frame?.height);
  const windowId = args.window_id;
  const pid = args.pid;
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    typeof windowId !== "number" ||
    !Number.isSafeInteger(windowId) ||
    windowId <= 0 ||
    windowId > 0xffffffff ||
    typeof pid !== "number" ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    pid > 0x7fffffff
  )
    return undefined;
  const label =
    typeof args.label === "string"
      ? // The helper paints the label verbatim: strip control/format characters and cap it so a malicious
        // or broken caller cannot smuggle escape sequences or an unbounded string onto the operator's
        // screen.
        args.label
          .replace(/[\p{Cc}\p{Cf}]/gu, "")
          .trim()
          .slice(0, 160) || undefined
      : undefined;
  return {
    action: "engage",
    shieldId,
    frame: { x, y, width, height },
    windowId,
    pid,
    ...(label !== undefined ? { label } : {}),
  };
}

export function parseCuaComputerTask(value: unknown): CuaComputerTask | undefined {
  if (!value || typeof value !== "object") return undefined;
  const task = value as Record<string, unknown>;
  const identifier = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= 256;
  if (!identifier(task.threadId) || (task.turnId !== undefined && !identifier(task.turnId)))
    return undefined;
  return {
    threadId: task.threadId,
    ...(task.turnId === undefined ? {} : { turnId: task.turnId }),
    ...(typeof task.label === "string" ? { label: task.label.slice(0, 160) } : {}),
  };
}
// How far a mutating call is known to have gone — the honesty taxonomy every computer action
// reports instead of guessing: - `not-dispatched`: the call provably never reached the driver —
// refused, cancelled, or failed before dispatch. Nothing happened; retrying is safe. -
// `dispatched-unknown`: the call crossed the dispatch boundary but its landing is unproven — a lost
// connection, an unverifiable delivery rung, a cancelled mid-flight write. It may have taken
// effect; it must never be replayed silently. - `verified`: the backend observed the effect it was
// asked to produce — the click's target state, the frame it moved, the value it wrote. The audit
// log records the same three values for completed calls, plus `refused`/`error` outcomes for calls
// that never produced a delivery verdict.
export type CuaEffect = "not-dispatched" | "dispatched-unknown" | "verified";
export class CuaTransportError extends Error {
  constructor(
    message: string,
    readonly effect: CuaEffect,
  ) {
    super(message);
  }
}

export function cuaRequest<T = unknown>(
  socketPath: string,
  request: unknown,
  options: {
    signal?: AbortSignal | undefined;
    timeoutMs?: number;
    mutation?: boolean;
  } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new CuaTransportError("Cancelled before dispatch.", "not-dispatched"));
      return;
    }
    let encoded: string;
    try {
      encoded = JSON.stringify(request) + "\n";
      if (Buffer.byteLength(encoded) > 1024 * 1024)
        throw new Error("Request exceeds its byte budget.");
    } catch {
      reject(new CuaTransportError("Invalid or oversized computer request.", "not-dispatched"));
      return;
    }
    const socket = createConnection(socketPath);
    const chunks: Buffer[] = [];
    let bytes = 0;
    let dispatched = false;
    let settled = false;
    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error);
      else resolve(result as T);
    };
    const fail = (message: string) =>
      finish(
        new CuaTransportError(
          message,
          options.mutation && dispatched ? "dispatched-unknown" : "not-dispatched",
        ),
      );
    const abort = () =>
      fail(
        "Computer operation cancelled. Input already dispatched may have taken effect; do not replay.",
      );
    const timer = setTimeout(
      () => fail("Computer request timed out; do not replay an uncertain action."),
      options.timeoutMs ?? 15_000,
    );
    timer.unref?.();
    options.signal?.addEventListener("abort", abort, { once: true });
    socket.once("connect", () => {
      if (options.signal?.aborted) {
        abort();
        return;
      }
      dispatched = true;
      socket.write(encoded);
    });
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > CUA_MAX_RESPONSE_BYTES) {
        fail("Computer response exceeded its byte budget.");
        return;
      }
      const end = chunk.indexOf(10);
      chunks.push(end < 0 ? chunk : chunk.subarray(0, end));
      if (end < 0) return;
      try {
        finish(undefined, JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch {
        fail("Invalid computer response.");
      }
    });
    socket.once("error", (error) => fail(error.message));
    socket.once("close", () => {
      if (!settled) fail("Computer connection closed before a result.");
    });
  });
}

export interface CuaToolResult {
  content?: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}
// Every field must read exactly as documented in the protocol notes above — a reply that merely
// echoes success text is not an acknowledgement and must not retire a generation that may hold OS
// input.
export interface CuaCleanupAcknowledgement {
  // Echoes the spawned child's PID so a reply cannot vouch for another process.
  readonly pid: number;

  readonly input_admission_closed: boolean;

  readonly cleanup_complete: boolean;

  readonly pending_input: number;
}
// Anything less is absent or invalid — the caller must not kill or replace that generation.
export function cuaCleanupAcknowledged(
  result: CuaToolResult | Record<string, unknown> | undefined,
  expectedPid: number | undefined,
): boolean {
  const cleanup = result as Partial<CuaCleanupAcknowledgement> | undefined;
  return (
    expectedPid !== undefined &&
    cleanup?.pid === expectedPid &&
    cleanup?.input_admission_closed === true &&
    cleanup?.cleanup_complete === true &&
    cleanup?.pending_input === 0
  );
}
export interface CuaReply {
  ok: boolean;

  desktopEpoch?: number;
  // Sorted list of the host's currently-active desktop pause reasons (`"screen-lock"`,
  // `"system-sleep"`, `"user-session"`), piggybacked on every reply so the backend learns
  // lock/session interruptions even when no event channel exists between them. Absent on direct
  // native replies; an empty or absent list never proves the desktop was never paused — use {@link
  // CuaReply.desktopInterruptions} to detect unobserved cycles.
  desktopPauses?: string[];

  desktopInterruptions?: number;

  driverNativeRevision?: number;
  // Verified Linux browser-only dispatch-epoch and input-drain support. This never certifies native
  // desktop input, focus neutrality, or Escape. False/absent until the running child completes the
  // exact host handshake.
  driverBrowserInputControl?: boolean;

  hostPlatform?: string;

  result?: CuaToolResult & Record<string, unknown>;
  error?: string;

  effect?: CuaEffect;
}
export const CUA_READ_TOOLS = new Set([
  "check_permissions",
  "check_input_ready",
  "list_windows",
  "list_spaces",
  "list_apps",
  "get_window_state",
  "get_screen_size",
  "get_desktop_state",
  "get_accessibility_tree",
  "get_agent_cursor_state",
  "get_cursor_position",
  "verify_state",
  "wait_for_settle",
  "zoom",
]);
export const CUA_ACTION_TOOLS = new Set([
  "click",
  "move_cursor",
  "drag",
  "scroll",
  "type_text",
  "press_key",
  "hotkey",
  "set_value",
  "select_text",
  "clipboard_read",
  "clipboard_write",
  "launch_app",
  "bring_to_front",
  "invoke_menu",
  "set_window_frame",
  "set_window_minimized",
  "set_app_visibility",
  "kill_app",
]);
// Bind calls that carry a real `pid`/`window_id` do point the frame tap at the bound window — a
// browser-driven task's preview is otherwise stuck on the whole-desktop stills.
export const CUA_BROWSER_TOOLS = new Set([
  "get_browser_state",
  "browser_prepare",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_dialog",
  "browser_set_input_files",
  "browser_download",
  "browser_pointer",
]);

export const CUA_BROWSER_MUTATION_TOOLS = new Set([
  "browser_prepare",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_dialog",
  "browser_set_input_files",
  "browser_download",
  "browser_pointer",
]);
