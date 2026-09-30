import {
  WS_CLIENT_REQUIRED_CAPABILITIES,
  WS_COMPATIBILITY_QUERY,
  WS_FEATURE_PATH,
  WS_NEGOTIATE_HTTP_PATH,
  WS_NEGOTIATE_QUERY,
  WS_PROTOCOL_EPOCH,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
  WsBootstrapNegotiateResult,
  WsCompatibilityError,
} from "@glade/contracts/transport/ws/wsCompatibility";
import {
  WS_CHANNELS,
  type WsPushChannel,
  type WsPushMessage,
} from "@glade/contracts/transport/ws/ws";
import { WsBootstrapRpcGroup } from "@glade/contracts/transport/ws/bootstrapRpc";
import { WsDeviceRpcGroup } from "@glade/contracts/transport/ws/deviceRpc";
import { WsComputerRpcGroup } from "@glade/contracts/transport/ws/computerRpc";
import { WsFeatureRpcGroup } from "@glade/contracts/transport/ws/rpc";
import type {
  ProjectFileChangeEvent,
  ProjectWatchFileInput,
} from "@glade/contracts/workspace/project";
import { Cause, Data, Effect, Layer, Option, Schema } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import { APP_VERSION } from "./branding";

export type PushListener<C extends WsPushChannel> = (message: WsPushMessage<C>) => void;

type RpcClientEffect = typeof makeRpcClient;

export type RpcClientInstance =
  RpcClientEffect extends Effect.Effect<infer Client, any, any> ? Client : never;

export type ProjectFileChangeSubscription = {
  readonly input: ProjectWatchFileInput;
  readonly listeners: Set<(event: ProjectFileChangeEvent) => void>;
};

export function projectFileChangeStreamKey(input: ProjectWatchFileInput): string {
  return `projects.file-change:${input.cwd.length}:${input.cwd}${input.relativePath}`;
}

export class WsTransportRpcError extends Data.TaggedError("WsTransportRpcError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class WsTransportRequestInterruptedError extends Data.TaggedError(
  "WsTransportRequestInterruptedError",
)<{
  readonly message: string;
  readonly code: "WS_REQUEST_TIMEOUT" | "WS_REQUEST_ABORTED" | "WS_REQUEST_RECONNECTED";
  readonly method: string;
  readonly timeoutMs?: number;
  readonly cause?: unknown;

  readonly retryable?: boolean;
}> {}

// True when a request failure is the transport's own doing — the Effect runtime that carried the
// request was interrupted or disposed mid-flight (reconnect, runtime swap) — rather than an error
// the server returned. Interrupts have no typed channel out of `runPromise`; they surface as the
// squashed "All fibers interrupted without error" Error or as runtime-disposal defects, which is
// exactly the raw leakage this classification exists to stop.
export function isRuntimeInterruptFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === "All fibers interrupted without error" ||
    error.message === "Missing runtime for WebSocket RPC client" ||
    error.message.includes("ManagedRuntime disposed")
  );
}

export interface WsRequestOptions {
  readonly timeoutMs?: number | null;
  readonly signal?: AbortSignal;
}

interface RequestAbortScope {
  readonly signal: AbortSignal | undefined;
  readonly didTimeout: () => boolean;
  readonly cleanup: () => void;
}

export function makeRequestAbortScope(options?: WsRequestOptions): RequestAbortScope {
  const timeoutMs = options?.timeoutMs;
  if (timeoutMs !== undefined && timeoutMs !== null) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError("WebSocket RPC timeoutMs must be a finite non-negative number or null.");
    }
  }
  if (timeoutMs === undefined || timeoutMs === null) {
    return {
      signal: options?.signal,
      didTimeout: () => false,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let cleanedUp = false;
  const externalSignal = options?.signal;
  const abortFromExternal = () => {
    if (!controller.signal.aborted) controller.abort(externalSignal?.reason);
  };
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }
  const timeoutId = globalThis.setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (cleanedUp) return;
      cleanedUp = true;
      globalThis.clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

export function awaitWithAbort<A>(
  promise: Promise<A>,
  signal: AbortSignal | undefined,
): Promise<A> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<A>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export // The device group is declared separately in contracts because its engine is macOS-only, but the
// client must carry the methods on every platform: the server is the authority that refuses them
// off darwin, and the pane needs a real RPC error (or an `unsupported-platform` availability) to
// render its blocked state.
const makeRpcClient = RpcClient.make(
  WsFeatureRpcGroup.merge(WsDeviceRpcGroup).merge(WsComputerRpcGroup),
);

export const makeBootstrapRpcClient = RpcClient.make(WsBootstrapRpcGroup);

export const REQUEST_TIMEOUT_MS = 60_000;

export const FEATURE_CONNECTION_PROBE_TIMEOUT_MS = 10_000;

const INITIAL_RECONNECT_RETRY_MS = 500;

const MAX_RECONNECT_RETRY_MS = 5_000;

export function getReconnectRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(Math.trunc(attempt), 16));
  return Math.min(INITIAL_RECONNECT_RETRY_MS * 2 ** exponent, MAX_RECONNECT_RETRY_MS);
}

export function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function delayMs(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal) return delayWithAbort(ms, signal);
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function resolveRpcUrl(rawUrl: string, path: string): string {
  const url = new URL(rawUrl);
  url.pathname = path;
  return url.toString();
}

function rawSocketUrl(explicitUrl: string | null): string {
  if (explicitUrl) return explicitUrl;
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  return bridgeUrl && bridgeUrl.length > 0
    ? bridgeUrl
    : envUrl && envUrl.length > 0
      ? envUrl
      : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`;
}

export function makeSocketUrl(explicitUrl: string | null, path: string): string {
  return resolveRpcUrl(rawSocketUrl(explicitUrl), path);
}

export function makeFeatureSocketUrl(
  explicitUrl: string | null,
  compatibility: WsBootstrapNegotiateResult,
): string {
  const url = new URL(makeSocketUrl(explicitUrl, WS_FEATURE_PATH));
  url.searchParams.set(WS_COMPATIBILITY_QUERY.clientBuild, APP_VERSION);
  url.searchParams.set(WS_COMPATIBILITY_QUERY.protocolEpoch, String(compatibility.protocolEpoch));
  url.searchParams.set(
    WS_COMPATIBILITY_QUERY.protocolRevision,
    String(compatibility.negotiatedRevision),
  );
  url.searchParams.set(WS_COMPATIBILITY_QUERY.serverInstanceId, compatibility.serverInstanceId);
  return url.toString();
}

export function makeNegotiateHttpUrl(explicitUrl: string | null): string {
  const url = new URL(makeSocketUrl(explicitUrl, WS_NEGOTIATE_HTTP_PATH));
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.searchParams.set(WS_NEGOTIATE_QUERY.clientBuild, APP_VERSION);
  url.searchParams.set(WS_NEGOTIATE_QUERY.protocolEpoch, String(WS_PROTOCOL_EPOCH));
  url.searchParams.set(WS_NEGOTIATE_QUERY.minRevision, String(WS_PROTOCOL_MIN_REVISION));
  url.searchParams.set(WS_NEGOTIATE_QUERY.maxRevision, String(WS_PROTOCOL_MAX_REVISION));
  for (const capability of WS_CLIENT_REQUIRED_CAPABILITIES) {
    url.searchParams.append(WS_NEGOTIATE_QUERY.requiredCapability, capability);
  }
  return url.toString();
}

const NEGOTIATE_HTTP_TIMEOUT_MS = 5_000;

export async function negotiateOverHttp(
  explicitUrl: string | null,
  lifetimeSignal?: AbortSignal,
): Promise<WsBootstrapNegotiateResult | null> {
  // Without the deadline, a connection that accepts and then stalls (the WAN/tunnel case this
  // endpoint exists to improve) never settles, so the bootstrap fallback never runs and the transport
  // wedges; the legacy socket path got that backstop for free from the browser's WS handshake
  // timeout. The caller's lifetime signal is composed in so disposal aborts the request too.
  const deadline = AbortSignal.timeout(NEGOTIATE_HTTP_TIMEOUT_MS);
  const signal = lifetimeSignal ? AbortSignal.any([lifetimeSignal, deadline]) : deadline;
  let response: Response;
  try {
    response = await fetch(makeNegotiateHttpUrl(explicitUrl), { cache: "no-store", signal });
  } catch {
    return null;
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 426) {
    const issue = Schema.decodeUnknownOption(WsCompatibilityError)(body);
    if (Option.isSome(issue)) throw issue.value;
    throw new Error("WebSocket negotiation was refused with an unreadable 426 response.");
  }
  if (!response.ok) return null;
  const result = Schema.decodeUnknownOption(WsBootstrapNegotiateResult)(body);
  return Option.isSome(result) ? result.value : null;
}

export function makeProtocolLayer(url: string) {
  const socketLayer = Socket.layerWebSocket(url).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );

  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)),
  );
}

export function causeToError(cause: Cause.Cause<unknown>): Error {
  const error = Cause.squash(cause);
  return error instanceof Error ? error : new Error(String(error));
}

const STREAM_ADMISSION_ERROR_CODES = new Set([
  "STREAM_DUPLICATE_SUBSCRIPTION",
  "STREAM_CAPACITY_EXCEEDED",
  "THREAD_STREAM_CAPACITY_EXCEEDED",
  "THREAD_SNAPSHOT_NOT_FOUND",
  "WS_NEGOTIATION_REQUIRED",
  "WS_PROTOCOL_INCOMPATIBLE",
  "WS_CAPABILITIES_INCOMPATIBLE",

  "PROJECT_FILE_WATCH_FAILED",

  "ORCHESTRATION_RESNAPSHOT_REQUIRED",
  "ORCHESTRATION_SNAPSHOT_STALLED",
  "ORCHESTRATION_PROJECTION_STATE_INCOMPLETE",
]);

const RESNAPSHOT_REQUIRED_ERROR_CODE = "ORCHESTRATION_RESNAPSHOT_REQUIRED";

// The stream must neither die permanently — the shell stream has no route-level fallback, so a dead
// stream means a silently stale sidebar — nor hammer the server; a slow in-place retry converges as
// soon as the server heals. RESNAPSHOT_REQUIRED belongs here too, but only as a fallback: this
// classifier is consulted after the bounded fast retries are exhausted (the admission-retry path
// returns first), which is precisely the advancing-but-still-behind fence — a projector working
// through a backlog larger than the replay limit. The server keeps that demand retryable because
// progress is real, so the stream must keep slow-retrying until the gap closes rather than dying
// while recovery is succeeding.
const SNAPSHOT_FAULT_ERROR_CODES = new Set([
  "ORCHESTRATION_SNAPSHOT_STALLED",
  "ORCHESTRATION_PROJECTION_STATE_INCOMPLETE",
  RESNAPSHOT_REQUIRED_ERROR_CODE,
]);

export const SNAPSHOT_FAULT_RETRY_MS = 30_000;

export function getSnapshotFaultRetryDelayMs(cause: Cause.Cause<unknown>): number | null {
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    if (!error || typeof error !== "object") continue;
    const code = "code" in error ? error.code : undefined;
    if (typeof code === "string" && SNAPSHOT_FAULT_ERROR_CODES.has(code)) {
      return SNAPSHOT_FAULT_RETRY_MS;
    }
  }
  return null;
}

const TERMINAL_COMPATIBILITY_ERROR_CODES = new Set([
  "WS_NEGOTIATION_REQUIRED",
  "WS_PROTOCOL_INCOMPATIBLE",
  "WS_CAPABILITIES_INCOMPATIBLE",
]);

export function isTerminalCompatibilityFailure(error: unknown): boolean {
  return (
    (Schema.is(WsCompatibilityError)(error) && error.retryable === false) ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string" &&
      TERMINAL_COMPATIBILITY_ERROR_CODES.has(error.code))
  );
}

// Compared against the last *successful* identity rather than the current negotiation, which a
// failed reconnect clears: an outage longer than the first retry would otherwise erase the evidence
// of the change, which is exactly the restore-with-downtime case this guards against.
export function serverIdentityChanged(
  lastKnownServerInstanceId: string | null,
  negotiatedServerInstanceId: string,
): boolean {
  return (
    lastKnownServerInstanceId !== null && lastKnownServerInstanceId !== negotiatedServerInstanceId
  );
}

export function getTerminalCompatibilityError(error: unknown): WsCompatibilityError | null {
  return Schema.is(WsCompatibilityError)(error) && error.retryable === false ? error : null;
}

export function shouldReconnectAfterStreamFailure(cause: Cause.Cause<unknown>): boolean {
  return !cause.reasons.some((reason) => {
    if (!Cause.isFailReason(reason)) return false;
    const error = reason.error;
    if (!error || typeof error !== "object") return false;
    const code = "code" in error ? error.code : undefined;
    return typeof code === "string" && STREAM_ADMISSION_ERROR_CODES.has(code);
  });
}

const RETRYABLE_STREAM_CAPACITY_ERROR_CODES = new Set([
  "STREAM_CAPACITY_EXCEEDED",
  "THREAD_STREAM_CAPACITY_EXCEEDED",
]);

const DEFAULT_STREAM_CAPACITY_RETRY_MS = 1_000;

export const MAX_STREAM_CAPACITY_RETRY_MS = 10_000;

const INITIAL_UNEXPECTED_STREAM_COMPLETION_RETRY_MS = 100;

const MAX_UNEXPECTED_STREAM_COMPLETION_RETRY_MS = 5_000;

export const STABLE_STREAM_LIFETIME_MS = 10_000;

const PROJECT_FILE_WATCH_FAILED_ERROR_CODE = "PROJECT_FILE_WATCH_FAILED";

const INITIAL_PROJECT_FILE_WATCH_RETRY_MS = 500;

const MAX_PROJECT_FILE_WATCH_RETRY_MS = 8_000;

export const MAX_PROJECT_FILE_WATCH_RETRY_ATTEMPTS = 5;

export function getProjectFileWatchRetryDelayMs(
  cause: Cause.Cause<unknown>,
  previousAttempts: number,
): number | null {
  if (previousAttempts >= MAX_PROJECT_FILE_WATCH_RETRY_ATTEMPTS) return null;
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    if (!error || typeof error !== "object") continue;
    const code = "code" in error ? error.code : undefined;
    if (code !== PROJECT_FILE_WATCH_FAILED_ERROR_CODE) continue;
    return Math.min(
      INITIAL_PROJECT_FILE_WATCH_RETRY_MS * 2 ** previousAttempts,
      MAX_PROJECT_FILE_WATCH_RETRY_MS,
    );
  }
  return null;
}

export function getUnexpectedStreamCompletionRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(Math.trunc(attempt) - 1, 16));
  return Math.min(
    INITIAL_UNEXPECTED_STREAM_COMPLETION_RETRY_MS * 2 ** exponent,
    MAX_UNEXPECTED_STREAM_COMPLETION_RETRY_MS,
  );
}

export function getStreamCapacityRetryDelayMs(cause: Cause.Cause<unknown>): number | null {
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    if (!error || typeof error !== "object") continue;
    const code = "code" in error ? error.code : undefined;
    if (typeof code !== "string" || !RETRYABLE_STREAM_CAPACITY_ERROR_CODES.has(code)) continue;
    if ("retryable" in error && error.retryable === false) continue;
    const retryAfterMs = "retryAfterMs" in error ? error.retryAfterMs : undefined;
    return typeof retryAfterMs === "number" && retryAfterMs > 0
      ? retryAfterMs
      : DEFAULT_STREAM_CAPACITY_RETRY_MS;
  }
  return null;
}

const RETRYABLE_STREAM_DUPLICATE_ERROR_CODES = new Set([
  "STREAM_DUPLICATE_SUBSCRIPTION",
  "THREAD_STREAM_DUPLICATE_SUBSCRIPTION",
]);

const DEFAULT_STREAM_DUPLICATE_RETRY_MS = 250;

export const MAX_STREAM_DUPLICATE_RETRY_ATTEMPTS = 5;

const THREAD_SNAPSHOT_BOOTSTRAP_ERROR_CODE = "THREAD_SNAPSHOT_NOT_FOUND";

const DEFAULT_THREAD_SNAPSHOT_BOOTSTRAP_RETRY_MS = 100;

export const MAX_THREAD_SNAPSHOT_BOOTSTRAP_RETRY_ATTEMPTS = 12;

// Duplicate rejections arrive marked `retryable: false` because one socket may not hold two leases
// for the same stream. A cancel→fast-resubscribe still races the server-side lease release (the
// lease frees only when the server stream scope closes), so a bounded in-place retry is required to
// let the stale lease drain instead of leaving the stream permanently dead.
export function getStreamDuplicateRetryDelayMs(
  cause: Cause.Cause<unknown>,
  previousAttempts: number,
): number | null {
  if (previousAttempts >= MAX_STREAM_DUPLICATE_RETRY_ATTEMPTS) return null;
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    if (!error || typeof error !== "object") continue;
    const code = "code" in error ? error.code : undefined;
    if (typeof code !== "string" || !RETRYABLE_STREAM_DUPLICATE_ERROR_CODES.has(code)) continue;
    const retryAfterMs = "retryAfterMs" in error ? error.retryAfterMs : undefined;
    return typeof retryAfterMs === "number" && retryAfterMs > 0
      ? retryAfterMs
      : DEFAULT_STREAM_DUPLICATE_RETRY_MS;
  }
  return null;
}

// A visible local draft subscribes before its `thread.create` projection exists so it cannot miss
// the first provider events. Retry only that admission race in place; bounded attempts still
// surface genuinely missing or deleted thread ids.
export function getThreadSnapshotBootstrapRetryDelayMs(
  cause: Cause.Cause<unknown>,
  previousAttempts: number,
): number | null {
  if (previousAttempts >= MAX_THREAD_SNAPSHOT_BOOTSTRAP_RETRY_ATTEMPTS) return null;
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    if (!error || typeof error !== "object") continue;
    const code = "code" in error ? error.code : undefined;
    if (code !== THREAD_SNAPSHOT_BOOTSTRAP_ERROR_CODE) continue;
    const retryAfterMs = "retryAfterMs" in error ? error.retryAfterMs : undefined;
    return typeof retryAfterMs === "number" && retryAfterMs > 0
      ? retryAfterMs
      : DEFAULT_THREAD_SNAPSHOT_BOOTSTRAP_RETRY_MS;
  }
  return null;
}

const DEFAULT_RESNAPSHOT_RETRY_MS = 250;

export const MAX_RESNAPSHOT_RETRY_ATTEMPTS = 2;

// The server asks for a stream restart because its snapshot fence trails the journal beyond the
// replay limit. The attempts are deliberately few — the server escalates a non-advancing fence to
// the non-retryable ORCHESTRATION_SNAPSHOT_STALLED on the repeat demand, so more client-side
// patience only delays surfacing the fault.
export function getResnapshotRetryDelayMs(
  cause: Cause.Cause<unknown>,
  previousAttempts: number,
): number | null {
  if (previousAttempts >= MAX_RESNAPSHOT_RETRY_ATTEMPTS) return null;
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    if (!error || typeof error !== "object") continue;
    const code = "code" in error ? error.code : undefined;
    if (code !== RESNAPSHOT_REQUIRED_ERROR_CODE) continue;
    if ("retryable" in error && error.retryable === false) continue;
    return DEFAULT_RESNAPSHOT_RETRY_MS;
  }
  return null;
}

export type StreamAdmissionRetry =
  | { readonly kind: "capacity"; readonly attempt: number; readonly delayMs: number }
  | { readonly kind: "duplicate"; readonly attempt: number; readonly delayMs: number }
  | { readonly kind: "thread-bootstrap"; readonly attempt: number; readonly delayMs: number }
  | { readonly kind: "resnapshot"; readonly attempt: number; readonly delayMs: number };

export function resolveStreamAdmissionRetry(
  cause: Cause.Cause<unknown>,
  capacityAttempts: number,
  duplicateAttempts: number,
  threadBootstrapAttempts = 0,
  resnapshotAttempts = 0,
): StreamAdmissionRetry | null {
  const capacityDelayMs = getStreamCapacityRetryDelayMs(cause);
  if (capacityDelayMs !== null) {
    return {
      kind: "capacity",
      attempt: capacityAttempts + 1,
      delayMs: capacityDelayMs,
    };
  }
  const duplicateDelayMs = getStreamDuplicateRetryDelayMs(cause, duplicateAttempts);
  if (duplicateDelayMs !== null) {
    return {
      kind: "duplicate",
      attempt: duplicateAttempts + 1,
      delayMs: duplicateDelayMs,
    };
  }
  const threadBootstrapDelayMs = getThreadSnapshotBootstrapRetryDelayMs(
    cause,
    threadBootstrapAttempts,
  );
  if (threadBootstrapDelayMs !== null) {
    return {
      kind: "thread-bootstrap",
      attempt: threadBootstrapAttempts + 1,
      delayMs: threadBootstrapDelayMs,
    };
  }
  const resnapshotDelayMs = getResnapshotRetryDelayMs(cause, resnapshotAttempts);
  if (resnapshotDelayMs === null) return null;
  return {
    kind: "resnapshot",
    attempt: resnapshotAttempts + 1,
    delayMs: resnapshotDelayMs,
  };
}

export function getStreamFailureCode(cause: Cause.Cause<unknown>): string | null {
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    if (!error || typeof error !== "object") continue;
    const code = "code" in error ? error.code : undefined;
    if (typeof code === "string") return code;
  }
  return null;
}

const THREAD_STREAM_KEY_PREFIX = "orchestration.thread:";

export function threadIdFromStreamKey(key: string): string | null {
  return key.startsWith(THREAD_STREAM_KEY_PREFIX)
    ? key.slice(THREAD_STREAM_KEY_PREFIX.length)
    : null;
}

export function threadStreamInputsEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  return leftEntries.every(([key, value]) => (right as Record<string, unknown>)[key] === value);
}

export interface WsThreadStreamFailure {
  readonly threadId: string;
  readonly code: string | null;
  readonly error: Error;
}

export function omitNullUserInputAnswers(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return input;
  }
  const command = input as { type?: unknown; answers?: unknown };
  if (command.type !== "thread.user-input.respond" || !command.answers) {
    return input;
  }
  if (typeof command.answers !== "object") {
    return input;
  }
  return {
    ...command,
    answers: Object.fromEntries(
      Object.entries(command.answers).filter(
        ([, answer]) => answer !== null && answer !== undefined,
      ),
    ),
  };
}

export function isServerLifecyclePushChannel(channel: string): boolean {
  return channel === WS_CHANNELS.serverWelcome || channel === WS_CHANNELS.serverMaintenanceUpdated;
}

export function shouldKeepServerLifecycleStream(activeChannels: ReadonlySet<string>): boolean {
  return (
    activeChannels.has(WS_CHANNELS.serverWelcome) ||
    activeChannels.has(WS_CHANNELS.serverMaintenanceUpdated)
  );
}
