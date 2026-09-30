import type {
  DeviceAvailability,
  DeviceCapabilityId,
  DeviceCapabilityStatus,
  DeviceDescriptor,
  DeviceFrameHeader,
  DeviceGeometry,
  DeviceHardwareButton,
  DeviceKeyModifier,
  DeviceSetupStep,
  DeviceSetupStepId,
  DeviceToolchain,
  DeviceUdid,
  ThreadDeviceState,
} from "@glade/contracts/device/device";

import { DEVICE_CAPABILITY_LABELS } from "@glade/contracts/device/device";

type DeviceFrameGatePhase = "awaiting-config" | "awaiting-keyframe" | "streaming";

export interface DeviceFrameGateState {
  readonly phase: DeviceFrameGatePhase;

  readonly lastSequence: number | null;

  readonly droppedSinceResync: number;
}

type DeviceFrameGateAction =
  | { readonly kind: "configure" }
  | { readonly kind: "decode"; readonly keyframe: boolean }
  | { readonly kind: "drop"; readonly reason: DeviceFrameDropReason }
  | { readonly kind: "ignore" };

type DeviceFrameDropReason =
  | "no-codec-config"
  | "awaiting-keyframe"
  | "sequence-gap"
  | "stale-sequence";

export interface DeviceFrameGateStep {
  readonly state: DeviceFrameGateState;
  readonly action: DeviceFrameGateAction;

  readonly requestKeyframe: boolean;
}

export function createDeviceFrameGateState(): DeviceFrameGateState {
  return { phase: "awaiting-config", lastSequence: null, droppedSinceResync: 0 };
}

const SEQUENCE_MODULUS = 2 ** 32;

// Used to tell a small forward gap (dropped frames) from a stale/reordered frame, which would
// otherwise look like an enormous forward jump.
function forwardSequenceDistance(previous: number, next: number): number {
  return (next - previous + SEQUENCE_MODULUS) % SEQUENCE_MODULUS;
}

const MAX_PLAUSIBLE_SEQUENCE_GAP = 1_024;

export function stepDeviceFrameGate(
  state: DeviceFrameGateState,
  header: Pick<DeviceFrameHeader, "deviceId" | "sequence" | "keyframe" | "codecConfig">,
  expectedDeviceId: DeviceUdid | string | null,
): DeviceFrameGateStep {
  if (expectedDeviceId === null || header.deviceId !== expectedDeviceId) {
    return { state, action: { kind: "ignore" }, requestKeyframe: false };
  }

  if (header.codecConfig) {
    return {
      state: {
        phase: "awaiting-keyframe",
        lastSequence: header.sequence,
        droppedSinceResync: 0,
      },
      action: { kind: "configure" },
      requestKeyframe: state.phase !== "awaiting-keyframe",
    };
  }

  if (state.phase === "awaiting-config") {
    return {
      state: { ...state, droppedSinceResync: state.droppedSinceResync + 1 },
      action: { kind: "drop", reason: "no-codec-config" },
      requestKeyframe: false,
    };
  }

  if (state.lastSequence !== null) {
    const distance = forwardSequenceDistance(state.lastSequence, header.sequence);
    if (distance === 0 || distance > MAX_PLAUSIBLE_SEQUENCE_GAP) {
      // Reordered, duplicated, or from a previous stream generation. Dropping it keeps `lastSequence`
      // monotonic so one stale frame cannot wedge the gate.
      return {
        state: { ...state, droppedSinceResync: state.droppedSinceResync + 1 },
        action: { kind: "drop", reason: "stale-sequence" },
        requestKeyframe: false,
      };
    }
    if (distance > 1 && !header.keyframe && state.phase === "streaming") {
      return {
        state: {
          phase: "awaiting-keyframe",
          lastSequence: header.sequence,
          droppedSinceResync: state.droppedSinceResync + 1,
        },
        action: { kind: "drop", reason: "sequence-gap" },
        requestKeyframe: true,
      };
    }
  }

  if (state.phase === "awaiting-keyframe" && !header.keyframe) {
    return {
      state: {
        ...state,
        lastSequence: header.sequence,
        droppedSinceResync: state.droppedSinceResync + 1,
      },
      action: { kind: "drop", reason: "awaiting-keyframe" },
      requestKeyframe: false,
    };
  }

  return {
    state: { phase: "streaming", lastSequence: header.sequence, droppedSinceResync: 0 },
    action: { kind: "decode", keyframe: header.keyframe },
    requestKeyframe: false,
  };
}

export interface DeviceCanvasGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;

  readonly displayWidth: number;
  readonly displayHeight: number;
}

export interface DevicePoint {
  readonly x: number;
  readonly y: number;
}

function deviceContainRect(geometry: DeviceCanvasGeometry): {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
} | null {
  const { frameWidth, frameHeight, displayWidth, displayHeight } = geometry;
  if (
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight) ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    displayWidth <= 0 ||
    displayHeight <= 0
  ) {
    return null;
  }
  const scale = Math.min(displayWidth / frameWidth, displayHeight / frameHeight);
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  return {
    offsetX: (displayWidth - width) / 2,
    offsetY: (displayHeight - height) / 2,
    width,
    height,
  };
}

// Returns null for clicks in the letterbox bands, which must not be clamped onto the screen edge —
// a stray tap at (0, y) is worse than no tap.
export function canvasPointToDevicePoint(
  geometry: DeviceCanvasGeometry & {
    readonly devicePointWidth?: number;
    readonly devicePointHeight?: number;
  },
  canvasX: number,
  canvasY: number,
): DevicePoint | null {
  const rect = deviceContainRect(geometry);
  if (!rect) return null;

  const withinX = canvasX - rect.offsetX;
  const withinY = canvasY - rect.offsetY;
  if (withinX < 0 || withinY < 0 || withinX > rect.width || withinY > rect.height) {
    return null;
  }

  const pointWidth = geometry.devicePointWidth ?? geometry.frameWidth;
  const pointHeight = geometry.devicePointHeight ?? geometry.frameHeight;

  return {
    x: clampToRange(Math.round((withinX / rect.width) * pointWidth), 0, pointWidth),
    y: clampToRange(Math.round((withinY / rect.height) * pointHeight), 0, pointHeight),
  };
}

function clampToRange(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

const DEVICE_TAP_MOVEMENT_THRESHOLD_POINTS = 8;

export type DevicePointerGesture =
  | { readonly kind: "tap"; readonly point: DevicePoint }
  | {
      readonly kind: "swipe";
      readonly from: DevicePoint;
      readonly to: DevicePoint;
      readonly durationMs: number;
    };

export function resolveDevicePointerGesture(input: {
  readonly from: DevicePoint | null;
  readonly to: DevicePoint | null;
  readonly durationMs: number;
  readonly movementThreshold?: number;
}): DevicePointerGesture | null {
  const { from, to } = input;
  if (!from) return null;
  if (!to) return { kind: "tap", point: from };

  const threshold = input.movementThreshold ?? DEVICE_TAP_MOVEMENT_THRESHOLD_POINTS;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance <= threshold) {
    return { kind: "tap", point: to };
  }
  return {
    kind: "swipe",
    from,
    to,

    durationMs: Math.max(16, Math.round(input.durationMs)),
  };
}

export interface DeviceShortcutEventLike {
  readonly key: string;
  readonly code?: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
}

// Leave unclaimed Cmd shortcuts to Glade. Do not swallow simulator rotate chords that the backend
// cannot inject.
export function resolveDeviceHardwareButtonShortcut(
  event: DeviceShortcutEventLike,
): DeviceHardwareButton | null {
  if (!event.metaKey || event.ctrlKey) return null;

  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    return key === "h" ? "home" : null;
  }
  if (key === "arrowup") return "volume-up";
  if (key === "arrowdown") return "volume-down";
  return key === "l" ? "lock" : null;
}

export function deviceKeyModifiers(event: DeviceShortcutEventLike): DeviceKeyModifier[] {
  const modifiers: DeviceKeyModifier[] = [];
  if (event.metaKey) modifiers.push("command");
  if (event.shiftKey) modifiers.push("shift");
  if (event.altKey) modifiers.push("option");
  if (event.ctrlKey) modifiers.push("control");
  return modifiers;
}

const HID_USAGE_BY_KEY: Readonly<Record<string, number>> = {
  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  " ": 0x2c,
  "-": 0x2d,
  "=": 0x2e,
  "[": 0x2f,
  "]": 0x30,
  "\\": 0x31,
  ";": 0x33,
  "'": 0x34,
  "`": 0x35,
  ",": 0x36,
  ".": 0x37,
  "/": 0x38,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,
};

const HID_USAGE_A = 0x04;
const HID_USAGE_1 = 0x1e;
const HID_USAGE_0 = 0x27;

export function deviceHidUsageForKey(key: string): number | null {
  if (key.length === 1) {
    const lower = key.toLowerCase();
    const codePoint = lower.codePointAt(0);
    if (codePoint === undefined) return null;
    if (lower >= "a" && lower <= "z") {
      return HID_USAGE_A + (codePoint - 97);
    }
    if (lower === "0") return HID_USAGE_0;
    if (lower >= "1" && lower <= "9") {
      return HID_USAGE_1 + (codePoint - 49);
    }
  }
  return HID_USAGE_BY_KEY[key] ?? null;
}

type DevicePickerAction =
  | { readonly kind: "attach" }
  | { readonly kind: "boot-then-attach" }
  // Mid-transition: selecting would race the state machine.
  | { readonly kind: "wait" };

export interface DevicePickerEntry {
  readonly device: DeviceDescriptor;
  readonly attached: boolean;
  readonly action: DevicePickerAction;

  readonly detail: string;
}

const RUNTIME_STATE_LABELS = {
  shutdown: "Shut down",
  booting: "Booting",
  booted: "Booted",
  "shutting-down": "Shutting down",
} as const satisfies Record<DeviceDescriptor["state"], string>;

function deviceRuntimeStateLabel(state: DeviceDescriptor["state"]): string {
  return RUNTIME_STATE_LABELS[state];
}

function devicePickerAction(state: DeviceDescriptor["state"]): DevicePickerAction {
  switch (state) {
    case "booted":
      return { kind: "attach" };
    case "shutdown":
      return { kind: "boot-then-attach" };
    default:
      return { kind: "wait" };
  }
}

export function buildDevicePickerEntries(input: {
  readonly devices: readonly DeviceDescriptor[];
  readonly attachedDeviceUdid: DeviceUdid | null;
}): readonly DevicePickerEntry[] {
  const rank = (device: DeviceDescriptor): number => {
    if (device.udid === input.attachedDeviceUdid) return 0;
    if (device.state === "booted") return 1;
    if (device.state === "booting") return 2;
    return 3;
  };

  return input.devices
    .toSorted((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name))
    .map((device) => ({
      device,
      attached: device.udid === input.attachedDeviceUdid,
      action: devicePickerAction(device.state),
      detail: `${device.runtime} · ${deviceRuntimeStateLabel(device.state)}`,
    }));
}

export type DeviceAvailabilityView =
  | { readonly kind: "ready" }
  // Kept separate from "blocked" because the user has nothing to fix and everything else still runs:
  // blocking the pane over a broken accessibility path would cost streaming and input for no reason.
  | {
      readonly kind: "degraded";
      readonly notice: string;
      readonly brokenCapabilities: readonly DeviceCapabilityId[];
    }
  | {
      readonly kind: "blocked";
      readonly title: string;
      readonly description: string;

      readonly steps: readonly DeviceSetupStep[];

      readonly retryable: boolean;
    };

function describeDegradedCapabilities(
  capabilities: readonly DeviceCapabilityStatus[],
  toolchain: DeviceToolchain | undefined,
): string {
  const broken = capabilities.filter((capability) => !capability.ok);
  const working = capabilities.filter((capability) => capability.ok);
  const list = (entries: readonly DeviceCapabilityStatus[]): string => {
    const names = entries.map((entry) => DEVICE_CAPABILITY_LABELS[entry.id]);
    if (names.length <= 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!.toLowerCase()}`;
  };

  const xcode = toolchain?.xcodeVersion
    ? ` with Xcode ${toolchain.xcodeVersion}`
    : toolchain?.xcodeBuild
      ? ` with Xcode build ${toolchain.xcodeBuild}`
      : "";
  const unaffected = working.length > 0 ? ` — ${list(working).toLowerCase()} unaffected` : "";
  return `${list(broken)} unavailable${xcode}${unaffected}.`;
}

function onlyHelperBuildRemains(steps: readonly DeviceSetupStep[]): boolean {
  const remaining = steps.filter((step) => !step.done);
  return remaining.length > 0 && remaining.every((step) => step.id === "build-device-helper");
}

export function resolveDeviceAvailabilityView(
  availability: DeviceAvailability,
): DeviceAvailabilityView {
  switch (availability.kind) {
    case "available":
      return { kind: "ready" };
    case "unsupported-platform":
      return {
        kind: "blocked",
        title: "iOS Simulator needs macOS",
        description: `This Glade server runs on ${availability.platform}. Simulators are only available when the server runs on a Mac with Xcode installed.`,
        steps: [],
        retryable: false,
      };
    case "setup-required":
      if (onlyHelperBuildRemains(availability.steps)) return { kind: "ready" };
      return {
        kind: "blocked",
        title: "Set up the iOS Simulator",
        description: "Progress updates automatically as each step finishes.",
        steps: availability.steps,
        retryable: true,
      };
    case "degraded":
      return {
        kind: "degraded",
        notice: describeDegradedCapabilities(availability.capabilities, availability.toolchain),
        brokenCapabilities: availability.capabilities
          .filter((capability) => !capability.ok)
          .map((capability) => capability.id),
      };
    case "helper-unavailable":
      return {
        kind: "blocked",
        title: "Simulator helper could not start",
        description: availability.message,
        steps: [],
        retryable: true,
      };
  }
}

function inferDeviceScaleFactor(framePixelWidth: number): number {
  if (!Number.isFinite(framePixelWidth) || framePixelWidth <= 0) return 1;
  if (framePixelWidth >= 1000 && framePixelWidth <= 1400) return 3;
  if (framePixelWidth > 1400) return 2;

  return framePixelWidth >= 640 ? 2 : 1;
}

function usablePointSize(
  size: { readonly width: number; readonly height: number } | null | undefined,
): { readonly width: number; readonly height: number } | null {
  if (!size) return null;
  const { width, height } = size;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

// Resolves the device's point dimensions, in descending order of authority: 1. `geometry` from the
// device descriptor. This is the helper's own attachment geometry — the exact numbers the backend
// validates input against — so a coordinate derived from it can never be rejected as out of bounds.
// 2.
export function resolveDevicePointSize(input: {
  readonly framePixelWidth: number;
  readonly framePixelHeight: number;
  readonly geometry?: DeviceGeometry | null | undefined;
  readonly measured?: { readonly width: number; readonly height: number } | null | undefined;
}): { readonly width: number; readonly height: number } | null {
  const { framePixelWidth, framePixelHeight, geometry, measured } = input;
  const fromContract = usablePointSize(
    geometry ? { width: geometry.pointWidth, height: geometry.pointHeight } : null,
  );
  if (fromContract) return fromContract;
  const fromAccessibility = usablePointSize(measured);
  if (fromAccessibility) return fromAccessibility;
  if (framePixelWidth <= 0 || framePixelHeight <= 0) return null;
  const scale = inferDeviceScaleFactor(framePixelWidth);
  return {
    width: Math.round(framePixelWidth / scale),
    height: Math.round(framePixelHeight / scale),
  };
}

// The pane's view of a recording. `starting` and `stopping` exist because both RPCs are slow enough
// to see: the server waits for simctl's "Recording started" before acking, and stopping sends
// SIGINT and waits for the container to finalise.
export type DeviceRecordingState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  | { readonly kind: "recording"; readonly path: string; readonly startedAtMs: number }
  | { readonly kind: "stopping"; readonly path: string };

export type DeviceRecordingEvent =
  | { readonly kind: "start-requested" }
  | { readonly kind: "started"; readonly path: string; readonly startedAtMs: number }
  | { readonly kind: "stop-requested" }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed" }
  | { readonly kind: "device-lost" };

export function createDeviceRecordingState(): DeviceRecordingState {
  return { kind: "idle" };
}

// Ignoring rather than throwing is deliberate: a stop that arrives after a failure, or a second
// click that beats the first response, is a race the UI should absorb silently rather than a bug to
// surface.
export function stepDeviceRecording(
  state: DeviceRecordingState,
  event: DeviceRecordingEvent,
): DeviceRecordingState {
  if (event.kind === "device-lost" || event.kind === "failed") {
    return { kind: "idle" };
  }
  switch (state.kind) {
    case "idle":
      return event.kind === "start-requested" ? { kind: "starting" } : state;
    case "starting":
      return event.kind === "started"
        ? { kind: "recording", path: event.path, startedAtMs: event.startedAtMs }
        : state;
    case "recording":
      return event.kind === "stop-requested" ? { kind: "stopping", path: state.path } : state;
    case "stopping":
      return event.kind === "stopped" ? { kind: "idle" } : state;
  }
}

export function isDeviceRecordingActive(state: DeviceRecordingState): boolean {
  return state.kind === "recording" || state.kind === "stopping";
}

export function deviceRecordingClickIntent(state: DeviceRecordingState): "start" | "stop" | null {
  if (state.kind === "idle") return "start";
  if (state.kind === "recording") return "stop";
  return null;
}

export interface DeviceSetupAction {
  readonly label: string;
  readonly url: string;
}

const DEVICE_SETUP_ACTIONS: Partial<Record<DeviceSetupStepId, DeviceSetupAction>> = {
  "install-xcode": {
    label: "Open Mac App Store",
    url: "https://apps.apple.com/app/xcode/id497799835",
  },
};

export function resolveDeviceSetupAction(
  steps: readonly DeviceSetupStep[],
): DeviceSetupAction | null {
  const next = steps.find((step) => !step.done);
  return next ? (DEVICE_SETUP_ACTIONS[next.id] ?? null) : null;
}

export function deviceSetupCheckingLabel(steps: readonly DeviceSetupStep[]): string | null {
  const next = steps.find((step) => !step.done);
  if (!next) return null;
  return next.id === "install-xcode" ? "Checking for Xcode…" : "Checking your setup…";
}

function attachedDeviceFromThreadState(
  state: ThreadDeviceState | undefined,
): DeviceDescriptor | null {
  if (!state?.attachedDeviceUdid) return null;
  return state.devices.find((device) => device.udid === state.attachedDeviceUdid) ?? null;
}

export interface PendingDeviceSelection {
  readonly device: DeviceDescriptor;
  readonly supersedes: DeviceUdid | null;
}

export function resolveDisplayedDevice(input: {
  readonly threadState: ThreadDeviceState | undefined;
  readonly pending: PendingDeviceSelection | null;
}): DeviceDescriptor | null {
  const attached = attachedDeviceFromThreadState(input.threadState);
  const { pending } = input;
  if (!pending) return attached;

  const reported = input.threadState?.attachedDeviceUdid ?? null;

  if (reported !== pending.supersedes) return attached;

  const known = input.threadState?.devices.find((device) => device.udid === pending.device.udid);
  return known ?? pending.device;
}

// Driven by the server's phase where there is one, because only the server knows whether it is
// waiting on the boot or on the display. `selecting` is the client-only stage before the first
// response, and every stage names the device so the pane never shows an anonymous spinner.
export function deviceAttachStatusLabel(input: {
  readonly phase: ThreadDeviceState["attachPhase"] | undefined;
  readonly deviceState: DeviceDescriptor["state"];
  readonly pendingSelection: boolean;
}): string | null {
  switch (input.phase) {
    case "booting":
      return "Starting up…";
    case "waiting-for-display":
      return "Waiting for the screen…";
    case "connecting":
      return "Connecting…";
    default:
      break;
  }
  if (input.deviceState === "booting") return "Starting up…";
  if (input.deviceState === "shutdown") return input.pendingSelection ? "Starting up…" : null;
  return input.pendingSelection ? "Connecting…" : null;
}

export function shouldSubscribeToDeviceStream(input: {
  readonly runtimeMode: "live" | "preview";
  readonly isVisible: boolean;
  readonly attachedDevice: DeviceDescriptor | null;
}): boolean {
  return (
    input.runtimeMode === "live" &&
    input.isVisible &&
    input.attachedDevice !== null &&
    input.attachedDevice.state === "booted"
  );
}
