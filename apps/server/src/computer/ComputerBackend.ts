import { MODEL_SCREEN_IMAGE_MAX_DIMENSION } from "@glade/shared/modelImageBudget";
import {
  COMPUTER_DELIVERY_PATH_MAX_LENGTH,
  COMPUTER_MESSAGE_MAX_LENGTH,
  type ComputerAccessibilityTreeApp,
  type ComputerAccessibilityTreeWindow,
  type ComputerActionResult,
  type ComputerApp,
  type ComputerAvailability,
  type ComputerBuildSignature,
  type ComputerCapabilities,
  type ComputerCursorPosition,
  type ComputerDeliveryVerification,
  type ComputerHealth,
  type ComputerId,
  type ComputerInputModifier,
  type ComputerInputPause,
  type ComputerLaunchAppResult,
  type ComputerPermission,
  type ComputerPoint,
  type ComputerRect,
  type ComputerScreenSize,
  type ComputerScreenshot,
  type ComputerState,
  type ComputerTarget,
  type ComputerUiNode,
  type ComputerVerifyStateResult,
  type ComputerWindow,
  type ComputerZoomResult,
} from "@glade/contracts/computer/computer";
import { type ComputerSpaceInventory } from "@glade/contracts/computer/computerSpaces";

// Downscale before delivery so model coordinates refer to the exact recorded image, never an
// API-resized image. The 1536 bound keeps dense controls legible while avoiding the provider's
// larger-image downscale.
const COMPUTER_AGENT_IMAGE_MAX_DIMENSION = MODEL_SCREEN_IMAGE_MAX_DIMENSION;

export const DEFAULT_COMPUTER_CAPTURE_MAX_DIMENSION = COMPUTER_AGENT_IMAGE_MAX_DIMENSION;

export const COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION = COMPUTER_AGENT_IMAGE_MAX_DIMENSION;
// Clipboards hold whole documents, so both directions need a ceiling: without one a read would
// stream unbounded data into a turn and a write would pipe it back out.
export const MAX_COMPUTER_CLIPBOARD_BYTES = 1024 * 1024;

// Shared rather than repeated because it is the key the frame socket, the pane, and the thread
// state all address that desktop by: two backends spelling it differently would route a frame to a
// pane that is not listening.
export const DEFAULT_COMPUTER_ID = "desktop";

export function assertComputerClipboardWriteFits(text: string): void {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= MAX_COMPUTER_CLIPBOARD_BYTES) return;
  throw new ComputerBackendError(
    `Clipboard text is ${bytes} bytes, past the ${MAX_COMPUTER_CLIPBOARD_BYTES} byte limit this tool writes.`,
  );
}

export type ComputerCaptureRequest =
  | { readonly kind: "window"; readonly windowId: string; readonly maxDimension?: number }
  | { readonly kind: "region"; readonly region: ComputerRect; readonly maxDimension?: number };

export interface ComputerStreamFrame {
  readonly sequence: number;
  readonly timestampMs: number;
  readonly keyframe: boolean;
  readonly codecConfig: boolean;
  readonly data: Uint8Array;
}

export interface ComputerResolvedTarget {
  readonly target: ComputerTarget;
  readonly point: ComputerPoint;
  readonly node: ComputerUiNode;
}

export interface ComputerTextRange {
  readonly start: number;
  readonly length: number;
}

// A window target may prepare and restore that exact window's menu focus. App and pid targets must
// not select, focus or raise a window.
export type ComputerMenuTarget =
  | { readonly windowId: string }
  | { readonly app: string }
  | { readonly pid: number };

// An app name is resolved to a live pid before dispatch, so a backend never has to guess which
// process a name meant.
export type ComputerMenuBackendTarget = { readonly windowId: string } | { readonly pid: number };

export interface ComputerBackendActionResult {
  readonly point?: ComputerPoint;

  readonly clampedTo?: ComputerPoint;
  readonly windowId?: string;
  readonly value?: string;

  readonly deliveryPath?: string;
  readonly verified?: ComputerDeliveryVerification;
  readonly effect?: "not-dispatched" | "dispatched-unknown" | "verified";

  readonly scrollDelta?: { readonly deltaX: number; readonly deltaY: number };
}

export type ComputerBackendEvent =
  | { readonly type: "windows-changed"; readonly windows: readonly ComputerWindow[] }
  | { readonly type: "health-changed"; readonly health: ComputerHealth }
  | { readonly type: "capabilities-changed"; readonly capabilities: ComputerCapabilities }
  // An OS interruption revokes standing consent even when the desktop resumed between replies. Input
  // drain and consent invalidation are separate obligations.
  | {
      readonly type: "desktop-interrupted";

      readonly pauses: readonly string[];
    }
  | { readonly type: "frame"; readonly frame: ComputerStreamFrame };

export interface ComputerShieldTarget {
  readonly shieldId: string;
  readonly windowId: string;
  readonly frame: ComputerRect;
  readonly label: string;
}

export interface ComputerBrowserCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly task: { readonly threadId: string; readonly turnId?: string; readonly label?: string };
  readonly mutation: boolean;
  readonly signal: AbortSignal;
}

export interface ComputerBrowserCallResult {
  readonly content?: ReadonlyArray<Record<string, unknown>>;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

// Separate from the desktop method set because browser targets are opaque session-scoped
// capabilities, not `windowId`s, and because a backend can drive a desktop without owning any
// browser route (or refuse every browser call). Absent means "no browser surface": callers must not
// advertise the tools.
export interface ComputerBrowserBackend {
  call(call: ComputerBrowserCall): Promise<ComputerBrowserCallResult>;

  endThread?(threadId: string): Promise<void>;
}

export type ComputerFrameListener = (frame: ComputerStreamFrame) => void;
export type ComputerBackendEventListener = (event: ComputerBackendEvent) => void;

export class ComputerBackendError extends Error {
  readonly _tag = "ComputerBackendError";
  readonly retryable: boolean;
  // Automatic supervision that sees this must report the message and stand down, because retrying
  // cannot conjure a desktop the backend refused to boot — and on a backend that boots on demand, a
  // retry that did boot would respawn a window the human just closed.
  readonly dormant: boolean;

  readonly rejectedOperation: string | undefined;
  // The desktop refused because the OS has not granted Glade a privacy permission it needs — macOS
  // Screen Recording or Accessibility today. Only the backend can tell this apart from an ordinary
  // action failure, so it is marked here rather than guessed from message text further up: the agent
  // gateway turns exactly this flag into the chat's "needs setup" card, and a card raised for a
  // window that merely moved would be noise.
  readonly setupRequired: boolean;

  readonly inputPause: ComputerInputPause | undefined;
  // The call was refused because the thread's computer control was disabled — the kill switch, not a
  // fault.
  readonly controlRevoked: boolean;

  constructor(
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly dormant?: boolean;
      readonly cause?: unknown;
      readonly rejectedOperation?: string;
      readonly setupRequired?: boolean;
      readonly inputPause?: ComputerInputPause;
      readonly controlRevoked?: boolean;
    } = {},
  ) {
    super(message, options);
    this.name = "ComputerBackendError";
    this.retryable = options.retryable ?? false;
    this.dormant = options.dormant ?? false;
    this.rejectedOperation = options.rejectedOperation;
    this.setupRequired = options.setupRequired ?? false;
    this.inputPause = options.inputPause;
    this.controlRevoked = options.controlRevoked ?? false;
  }
}

export const NO_COMPUTER_CAPABILITIES: ComputerCapabilities = {
  windows: false,
  windowBounds: false,
  stacking: false,
  capture: false,
  input: false,
  clipboard: false,
  focus: false,
  raise: false,
  ghostCursor: false,
  visibleDesktop: false,
};

export type ComputerAgentDialect = "linux" | "macos";

export interface ComputerBackend {
  readonly agentDialect?: ComputerAgentDialect;
  readonly computerId: ComputerId;
  // Side-effect-free by contract: no session is started, nothing is installed, nothing is loaded into
  // a compositor, and no connection outlives the call — the most a backend may spend is the cheap
  // questions a desktop answers for free, such as who owns a bus name and what is on disk. This is
  // what boot and the UI's thread-state seeding read, because both run for every user on every
  // launch, long before anyone has asked for a desktop. `availability()` is the opposite trade: it
  // establishes the real thing and reports what actually happened, so it belongs only on paths that
  // were about to use the desktop anyway. Optimism is the intended failure mode. A probe that says
  // "available" and then cannot provision costs the caller one actionable error card at first use; a
  // probe that says "unavailable" because it refused to look costs the user the feature.
  probeAvailability(): Promise<ComputerAvailability>;

  availability(options?: { readonly refresh?: boolean }): Promise<ComputerAvailability>;

  // Optional because not every backend has anything to provision: the fake and the unavailable
  // backends have nothing, and a nested session's compositor arrived with its own. A backend that
  // implements it returns one sentence describing what it did, for the settings card that asked.
  provision?(): Promise<string>;
  // Synchronous and side-effect free on purpose: it reports what the connect and reconnect paths
  // already know, so reading it can never cost the display server a round trip, and it stays safe to
  // call from the handler of the very event that changed it.
  health(): ComputerHealth;
  // Synchronous and cheap by contract: a capability is a property of the display server this process
  // talks to, not a live reading, so it is safe to publish with every state snapshot. And it is not a
  // live reading of the running session: only the nested backend varies it at all, reporting the
  // empty set until its compositor and plugin exist so the settings panel can offer Set up, and the
  // full KWin set afterwards. That one transition arrives through `onEvent` as
  // `capabilities-changed`, so a caller may cache this until the event fires.
  capabilities(): ComputerCapabilities;
  // Asynchronous because the answer is only allowed to be stale in one direction. The tool surface
  // consults this after every computer call to decide whether the user is owed a setup card, and the
  // moment that matters most is the one just after the user granted something: a cached "missing"
  // kept the card and the model's refusal on screen while the grant was already live, which is the
  // exact failure this signature exists to prevent. A backend that knows nothing is missing answers
  // from memory and costs nothing; one whose last look saw a gap has to look again (behind its own
  // short cache, so a burst of calls still pays for one probe). Empty means either "nothing is
  // missing" or "nothing has looked yet" — both are states in which no user action is owed, so they
  // need not be told apart here. Optional because only macOS has a permission model at all; a backend
  // that omits it is read as missing nothing. `availability()` reports the *blocking* subset of this
  // as `permission-required`; a grant that only degrades the desktop (Screen Recording) shows up here
  // and nowhere else.
  missingPermissions?(): Promise<readonly ComputerPermission[]>;
  // Synchronous and free: it is a property of the binary, not a live reading. It travels beside
  // `missingPermissions()` because a missing grant on an ad-hoc build has a second, invisible
  // explanation — the grant is pinned to a cdhash a rebuild replaced — and the card cannot say so
  // without knowing this.
  buildSignature?(): ComputerBuildSignature | undefined;
  listWindows(): Promise<readonly ComputerWindow[]>;

  listSpaces?(): Promise<ComputerSpaceInventory>;
  getScreenSize(): Promise<ComputerScreenSize>;
  getState(options: {
    readonly includeScreenshot?: boolean;
    // Tree reads must not pay for text rendering unless the caller requests it.
    readonly includeTree?: boolean;
    readonly windowId?: string;
    // The agent-facing state tools never set this: what the model reads must stay fresh. Safe only
    // because dispatch validates the resolved element natively — a stale candidate fails closed rather
    // than acting on a moved control.
    readonly reuseRecentTree?: boolean;
  }): Promise<ComputerState>;

  captureScreenshot(request: ComputerCaptureRequest): Promise<ComputerScreenshot>;

  focusWindow?(windowId: string): Promise<void>;

  raiseWindow?(windowId: string): Promise<void>;
  clearFocusWindow?(): Promise<void>;
  // Best effort by design: a label is presentation, so failing to set one must never fail the action
  // that changed the holder.
  setDrivingAgent?(name: string | null): Promise<void>;
  // Cosmetic activity only: never activates a window or sends input.
  setCursorActivity?(text: string | null): Promise<void>;
  launchApp(
    app: string,
    args: readonly string[],
    options?: {
      readonly hidden?: boolean;
    },
  ): Promise<ComputerLaunchAppResult>;
  // Fresh exact-window readiness only; never focus, raise, or send input.
  checkInputReady?(windowId: string): Promise<void>;
  // Pure read — no input, no mutation lease — so it is safe to run between an action's dispatch and
  // its observation. Optional because only the macOS driver exposes an AX observer; callers must fall
  // back to a fixed wait when it is absent or refused.
  waitForSettle?(options: {
    readonly windowId: string;
    readonly timeoutMs: number;
    readonly quietMs: number;
  }): Promise<{
    readonly settled: boolean;
    readonly waitedMs: number;
    readonly eventsSeen?: number;
  }>;
  // Optional because a compositor plugin may only see windows; the agent tool refuses when it is
  // absent.
  listApps?(): Promise<readonly ComputerApp[]>;

  setWindowFrame?(
    windowId: string,
    frame: ComputerRect,
  ): Promise<ComputerBackendActionResult | void>;

  invokeMenu?(
    target: ComputerMenuBackendTarget,
    path: readonly string[],
  ): Promise<ComputerBackendActionResult | void>;

  verifyState?(
    windowId: string,
    expect: readonly Record<string, unknown>[],
  ): Promise<ComputerVerifyStateResult>;

  zoomWindow?(windowId: string, region: ComputerRect): Promise<ComputerZoomResult>;
  // The driver's desktop-wide inventory — running apps and their on-screen windows — a cheaper
  // discovery read than a per-window accessibility walk. `windowId` scopes the answer to the app that
  // owns that exact window; the driver itself only ever enumerates the whole desktop, so the scoping
  // is this layer's filter, and the caller still validates the window id exists before asking.
  // Optional because a compositor plugin may only see windows; the agent tool refuses when it is
  // absent.
  getAccessibilityTree?(windowId?: string): Promise<{
    readonly apps: readonly ComputerAccessibilityTreeApp[];
    readonly windows: readonly ComputerAccessibilityTreeWindow[];
    readonly truncated: boolean;
  }>;
  // The human cursor's position in desktop points — a read, never a move. `windowId` scopes the
  // answer with whether the point lies inside that window's bounds; the position itself is
  // desktop-global either way. Optional because a backend with a private pointer seat may have no
  // shared cursor to report; the agent tool refuses when it is absent.
  getCursorPosition?(
    windowId?: string,
  ): Promise<Omit<ComputerCursorPosition, "computerId" | "availability">>;

  setWindowMinimized?(
    windowId: string,
    minimized: boolean,
  ): Promise<ComputerBackendActionResult | void>;
  // Hide or unhide a running application by pid without activating it — the Cmd+H path, not a Space
  // change. A hidden app keeps its windows addressable for background semantic reads and writes;
  // neither direction brings it frontmost. Same verification contract as `setWindowMinimized`.
  setAppVisibility?(pid: number, hidden: boolean): Promise<ComputerBackendActionResult | void>;

  killApp?(pid: number): Promise<ComputerBackendActionResult | void>;

  supportsAction?(target: ComputerResolvedTarget, action: string): boolean;
  click(
    point: ComputerPoint,
    windowId?: string,
    modifiers?: readonly ComputerInputModifier[],
  ): Promise<ComputerBackendActionResult | void>;
  doubleClick(
    point: ComputerPoint,
    windowId?: string,
    modifiers?: readonly ComputerInputModifier[],
  ): Promise<ComputerBackendActionResult | void>;
  // Optional because it is not the same gesture as three separate clicks — the click count has to
  // reach the target as one number — so a backend that cannot express it must refuse rather than
  // approximate it with a loop the application reads as three carets.
  tripleClick?(
    point: ComputerPoint,
    windowId?: string,
    modifiers?: readonly ComputerInputModifier[],
  ): Promise<ComputerBackendActionResult | void>;
  rightClick(
    point: ComputerPoint,
    windowId?: string,
    modifiers?: readonly ComputerInputModifier[],
  ): Promise<ComputerBackendActionResult | void>;
  moveCursor(point: ComputerPoint, windowId?: string): Promise<ComputerBackendActionResult | void>;
  drag(
    from: ComputerPoint,
    to: ComputerPoint,
    durationMs: number,
    windowId?: string,
  ): Promise<ComputerBackendActionResult | void>;
  scroll(
    point: ComputerPoint | null,
    deltaX: number,
    deltaY: number,
    windowId?: string,
    modifiers?: readonly ComputerInputModifier[],
    target?: ComputerResolvedTarget,
  ): Promise<ComputerBackendActionResult | void>;

  readonly focusNeutralSemanticText?: boolean;
  // Exact targets are revalidated and background input never falls back to global input.
  readonly exactTargetBackgroundInput?: boolean;
  typeText(
    text: string,
    windowId?: string,
    target?: ComputerResolvedTarget,
  ): Promise<ComputerBackendActionResult | void>;
  pressKey(
    key: string,
    windowId?: string,
    target?: ComputerResolvedTarget,
  ): Promise<ComputerBackendActionResult | void>;
  hotkey(
    keys: readonly string[],
    windowId?: string,
    target?: ComputerResolvedTarget,
  ): Promise<ComputerBackendActionResult | void>;

  readClipboard?(): Promise<string>;

  writeClipboard?(text: string): Promise<void>;
  setValue(
    target: ComputerResolvedTarget,
    value: string,
  ): Promise<ComputerBackendActionResult | void>;
  performAction(
    target: ComputerResolvedTarget,
    action: string,
  ): Promise<ComputerBackendActionResult | void>;

  selectText(
    target: ComputerResolvedTarget,
    range: ComputerTextRange,
  ): Promise<ComputerBackendActionResult | void>;
  onEvent?(listener: ComputerBackendEventListener): () => void;
  attachStream(listener: ComputerFrameListener): Promise<void>;
  detachStream(): Promise<void>;
  requestKeyframe?(): Promise<void>;
  // Present only on backends that own a shield surface (the macOS CUA path through the
  // ComputerPermission helper). `engage` resolves once the shield is confirmed on screen and returns
  // its id. It must fail rather than degrade: a caller that armed masked activation for a window
  // refuses the activation outright when the shield cannot be shown — never a silent unmasked
  // excursion. `release` drops one shield by id and `releaseAll` drops every live shield; both are
  // idempotent teardown, safe to call from any cleanup path in any host state.
  engageShield?(target: ComputerShieldTarget): Promise<string>;
  releaseShield?(shieldId: string): Promise<void>;
  releaseAllShields?(): Promise<void>;
  stopInput?(task?: { readonly threadId: string; readonly turnId?: string }): Promise<void>;

  endTask?(threadId: string, turnId?: string): Promise<void>;

  readonly browser?: ComputerBrowserBackend;
  dispose(): Promise<void> | void;
}

export function intersectComputerRects(
  first: ComputerRect,
  second: ComputerRect,
): ComputerRect | undefined {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function clampComputerMessage(text: string, fallback: string): string {
  const trimmed = text.trim();
  const message = trimmed.length > 0 ? trimmed : fallback;
  return message.length > COMPUTER_MESSAGE_MAX_LENGTH
    ? `${message.slice(0, COMPUTER_MESSAGE_MAX_LENGTH - 1)}…`
    : message;
}

export function computerBackendActionResult(
  computerId: string,
  action: string,
  result: ComputerBackendActionResult | void,
): ComputerActionResult {
  return {
    computerId,
    action,
    ...(result?.point ? { point: result.point } : {}),
    ...(result?.clampedTo ? { clampedTo: result.clampedTo } : {}),
    ...(result?.windowId ? { windowId: result.windowId } : {}),
    ...(result?.value !== undefined ? { value: result.value } : {}),
    // Both halves or neither: a path with no verdict cannot tell a caller whether the input landed,
    // which is the only question this field answers. The path is clamped here rather than in each
    // backend, because it is copied verbatim out of a helper reply and an over-long one would otherwise
    // fail the encode of an action that already happened.
    ...(result?.deliveryPath !== undefined && result.verified !== undefined
      ? {
          delivery: {
            path: result.deliveryPath.slice(0, COMPUTER_DELIVERY_PATH_MAX_LENGTH),
            verified: result.verified,
            ...(result.effect ? { effect: result.effect } : {}),
          },
        }
      : {}),
  } as ComputerActionResult;
}
