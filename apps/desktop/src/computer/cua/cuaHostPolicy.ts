import { type CuaComputerTask, type CuaReply } from "@glade/shared/computer/cuaDriverProtocol";
import { execFileSync, type ChildProcess } from "node:child_process";
import { type Socket } from "node:net";
import { tmpdir } from "node:os";
import { cuaHostProcessIsAlive, sweepOwnedCuaRuntimeDirectories } from "./cuaRuntimeOwnership";
export interface TaskCursor {
  task: CuaComputerTask;
  firstActionObserved: boolean;
  enabled: boolean;
}

export interface TaskRequest {
  readonly task: CuaComputerTask;
  stopped: boolean;
}

export const CUA_CURSOR_IDLE_HIDE_MS = 60_000;

export const CUA_DRIVER_MISSING_MESSAGE =
  "Cua Driver is not bundled. Run the provisioning script (`node apps/desktop/scripts/provision-cua-driver.mjs`, needs the pinned Rust toolchain) in this checkout, then relaunch Glade.";

export interface ControlledTarget {
  pid: number;
  windowId?: number;
  threadId?: string;
  browserTargetId?: string;
  browserTabId?: string;
}

export interface Generation {
  nativeInputEpoch: number;
  browserInputControl: boolean;
  child: ChildProcess;
  socket: string;
  session: string;
  exited: Promise<void>;
  didExit: boolean;
  retired: boolean;
  cancellationReady: boolean;
  inputInFlight: boolean;

  inputTask: CuaComputerTask | undefined;
  browserInputInFlight: boolean;

  inputEverDispatched: boolean;

  sessionOpening?: Promise<void>;

  controlSession: string;
  controlSocket: Socket | undefined;
  // Browser lifecycle labels this host has seen end — either because `end_browser_thread` ran or
  // because the driver reported the session dead.
  endedBrowserSessions: Set<string>;

  liveBrowserSessions: Set<string>;
  // Mirrored from `endedBrowserSessions`: the next dispatch on an ended label revives it with
  // `start_session` first — a session-scoped heal that must not retire the whole generation the way a
  // shared-session death does.
  endedTaskSessions: Set<string>;

  appliedCursorStyle: string;

  appliedSessionCursorStyles: Map<string, string>;

  taskCursors: Map<string, TaskCursor>;
  retirement?: Promise<void>;
}

export function browserSessionLabel(threadId: string): string {
  return `glade-browser-${threadId}`;
}

const AGENT_SESSION_LABEL_PREFIX = "agent·";

const AGENT_SESSION_LABEL_MAX_CHARS = 120;

const agentBadgeComponent = (value: string) => value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();

export function agentSessionLabel(task: CuaComputerTask): string {
  const threadId = agentBadgeComponent(task.threadId) || "task";
  const label = [...agentBadgeComponent(task.label ?? "")]
    .slice(0, AGENT_SESSION_LABEL_MAX_CHARS)
    .join("");
  if (label.length === 0) return `${AGENT_SESSION_LABEL_PREFIX}${threadId}`;
  return `${AGENT_SESSION_LABEL_PREFIX}${label}·${threadId}`;
}

export interface CuaCursorStyle {
  readonly fill?: string;
  readonly rim?: string;
  readonly shadow?: string;
}

const CUA_CURSOR_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

function normalizeCuaCursorColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim().toLowerCase();
  return CUA_CURSOR_COLOR_PATTERN.test(candidate) ? candidate : undefined;
}

export function normalizeCuaCursorStyle(
  style: CuaCursorStyle | null | undefined,
): CuaCursorStyle | undefined {
  if (!style || typeof style !== "object") return undefined;
  const fill = normalizeCuaCursorColor(style.fill);
  const rim = normalizeCuaCursorColor(style.rim);
  const shadow = normalizeCuaCursorColor(style.shadow);
  if (!fill && !rim && !shadow) return undefined;
  return {
    ...(fill ? { fill } : {}),
    ...(rim ? { rim } : {}),
    ...(shadow ? { shadow } : {}),
  };
}

export interface HostPermissions {
  accessibility: boolean;
  screenRecording: boolean;
  inputMonitoring?: boolean;
}

export function permissionsChanged(a: HostPermissions, b: HostPermissions): boolean {
  return a.accessibility !== b.accessibility || a.screenRecording !== b.screenRecording;
}

export const log = (message: string) => console.info(`[desktop-cua] ${message}`);

export const safeNativeId = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff
    ? value
    : undefined;

export const LOGGABLE_CUA_CODES = new Set([
  "computer_input_paused",
  "desktop_input_paused",
  "same_pid_keyboard_ambiguity",
  "cua_action_failed",
  "cua_refusal",
  "invalid_arguments",
  "input_admission_closed",
  "target_not_on_active_space",
  "target_unavailable",
  "auth_sheet_focused",
  "input_monitor_unavailable",
  "gui_host_required",
  "background_pixel_focus_unavailable",
]);

export const ESCAPE_INPUT_COOLDOWN_MS = 1_500;

export function launchAppMatchNames(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const args = input as Record<string, unknown>;
  const names: string[] = [];
  if (typeof args.name === "string" && args.name.length > 0) names.push(args.name.toLowerCase());
  if (typeof args.bundle_id === "string" && args.bundle_id.length > 0) {
    names.push(args.bundle_id.toLowerCase());
    const tail = args.bundle_id.split(".").pop();
    if (tail) names.push(tail.toLowerCase());
  }
  return names;
}

export function sweepOrphanedCuaDrivers(): void {
  if (process.platform === "win32") return;
  let listing: string;
  try {
    listing = execFileSync("ps", ["-axo", "pid,args"], { encoding: "utf8" });
  } catch {
    return;
  }
  const liveSocketDirs = new Set<string>();
  for (const line of listing.split("\n")) {
    if (!/cua-driver\s+serve\s+--embedded/.test(line)) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (!pid || pid === process.pid) continue;
    const socketDir = line.match(/--socket\s+(\S+)\//)?.[1];

    if (socketDir) liveSocketDirs.add(socketDir);
    let env: string;
    try {
      env = execFileSync("ps", ["eww", "-p", String(pid), "-o", "command"], {
        encoding: "utf8",
      });
    } catch {
      continue;
    }
    const hostPid = Number(env.match(/CUA_DRIVER_EMBEDDED_HOST_PID=(\d+)/)?.[1]);
    if (!hostPid) continue;
    if (cuaHostProcessIsAlive(hostPid)) continue;
    try {
      process.kill(pid, "SIGKILL");
      log(`killed orphaned cua-driver pid=${pid} (host pid ${hostPid} gone)`);
    } catch {}
  }
  for (const entry of sweepOwnedCuaRuntimeDirectories({ directory: tmpdir(), liveSocketDirs }))
    log(`removed stale owned driver directory ${entry}`);
}

const DRIVER_SESSION_DEATH_CODES = new Set([
  "session_ended",
  "session-expired",
  "session_expired",
  "unknown_session",
  "session_not_found",
]);

export function isDriverSessionDeath(reply: CuaReply): boolean {
  if (!reply.ok) {
    // A transport rejection carries the same verdict in `error`: retired only when dispatch is ruled
    // out, so input that may have landed is never replayed.
    return (
      reply.effect !== "dispatched-unknown" &&
      typeof reply.error === "string" &&
      reply.error.includes("has ended") &&
      reply.error.includes("start_session")
    );
  }
  const result = reply.result;
  if (!result?.isError) return false;
  const code = result.structuredContent?.code;
  if (typeof code === "string" && DRIVER_SESSION_DEATH_CODES.has(code)) return true;
  const texts: string[] = [];
  for (const part of result.content ?? []) {
    if (part && typeof part.text === "string") texts.push(part.text);
  }
  const message = result.structuredContent?.message;
  if (typeof message === "string") texts.push(message);
  const joined = texts.join("\n");
  return joined.includes("has ended") && joined.includes("start_session");
}
export const CUA_DEFAULT_OWN_PIDS: ReadonlySet<number> = new Set([process.pid]);
