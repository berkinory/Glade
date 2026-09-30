import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "../core/baseSchemas";

export const COMPUTER_WS_METHODS = {
  getStatus: "computer.getStatus",
  getAuditHistory: "computer.getAuditHistory",
  // Installs or compiles whatever this desktop is missing, on the user's explicit request from the
  // settings panel. Separate from `getStatus` because reading status must never be the thing that
  // compiles a helper.
  provision: "computer.provision",
  listWindows: "computer.listWindows",
  getState: "computer.getState",
  getScreenSize: "computer.getScreenSize",
  launchApp: "computer.launchApp",
  click: "computer.click",
  doubleClick: "computer.doubleClick",
  rightClick: "computer.rightClick",
  moveCursor: "computer.moveCursor",
  drag: "computer.drag",
  scroll: "computer.scroll",
  typeText: "computer.typeText",
  pressKey: "computer.pressKey",
  hotkey: "computer.hotkey",
  setValue: "computer.setValue",
  performAction: "computer.performAction",
  selectText: "computer.selectText",
  getThreadState: "computer.getThreadState",
  setControlEnabled: "computer.setControlEnabled",
  subscribeEvents: "computer.subscribeEvents",
  // Separate from the tool surface above because it must work with no agent turn in flight, and
  // because a pane only ever sends resolved desktop coordinates — never the semantic (label/role)
  // targets the agent tools resolve through AT-SPI.
  inputClick: "computer.input.click",
  inputScroll: "computer.input.scroll",
  inputKey: "computer.input.key",
} as const;

export const COMPUTER_WS_CHANNELS = {
  event: "computer.event",
} as const;

export const COMPUTER_ID_MAX_LENGTH = 128;
// Exported because it bounds `ComputerActionResult.value`, and the clipboard read path must enforce
// it before putting clipboard text on that field.
export const COMPUTER_TEXT_MAX_LENGTH = 16 * 1024;
// Exported because backend window enumerators copy titles and app names verbatim off the desktop,
// and must clamp them to this before constructing `ComputerWindow` objects.
export const COMPUTER_LABEL_MAX_LENGTH = 1_024;
// Exported because the backend composes health and availability messages from error text it does
// not control, and must clamp them to this before they reach a state payload.
export const COMPUTER_MESSAGE_MAX_LENGTH = 2_048;
// Exported because the name comes off a backend helper's reply verbatim, and the backend must clamp
// it before putting it on a result — an over-long name would fail the encode of an action that
// actually happened.
export const COMPUTER_DELIVERY_PATH_MAX_LENGTH = 64;
// Exported because a backend enumerator must clamp its own list to this.
export const COMPUTER_WINDOW_LIST_MAX_LENGTH = 512;

export const COMPUTER_OCCLUDERS_MAX_LENGTH = 32;
// Exported because the sentence is composed from output the backend does not control — a compiler's
// stderr, a package manager's transcript — and an unbounded one would either fail the encode of a
// provision that actually succeeded or push a build log into the settings card.
export const COMPUTER_PROVISION_SUMMARY_MAX_LENGTH = 4_096;
// Exported because the tool layer advertises the same ceiling it validates against, and a second
// literal there drifted from this one.
export const COMPUTER_DRAG_MAX_DURATION_MS = 30_000;

export const COMPUTER_HOTKEY_MAX_KEYS = 16;

export const COMPUTER_KEY_NAME_MAX_LENGTH = 128;

export const COMPUTER_SEMANTIC_ACTION_MAX_LENGTH = 256;

export const COMPUTER_SELECT_TEXT_RANGE_MAX = 4 * 1024 * 1024;

// Thread-activity kind appended by the agent gateway when a computer tool call failed because the
// OS has not granted Glade the privacy permissions the desktop backend needs. The web app keys its
// actionable "set up computer control" chat card off this kind, so the user can grant them from the
// chat instead of hunting through Settings. The grant names travel with the activity so the card
// can say which permission is missing; an empty list means the backend reported a refusal without
// naming one, and the card falls back to the general wording.
export const COMPUTER_CONTROL_DENIED_ACTIVITY_KIND = "computer.control-denied";

export const COMPUTER_SETUP_REQUIRED_ACTIVITY_KIND = "computer.setup-required";

// Shared because the hotkey below exists only there, so every surface that advertises it has to
// recognise that one backend by name.
export const COMPUTER_KWIN_BACKEND = "kwin";

// Its own name because the release hotkey above does not apply — the nested compositor never hears
// the human's keys — and because the settings panel names the two integrations differently.
export const COMPUTER_NESTED_KWIN_BACKEND = "nested-kwin";

export const COMPUTER_HYPRLAND_BACKEND = "hyprland";

// The backend name reported by the macOS backend: a native helper that drives the human's real Mac
// desktop the way Codex's computer use does — a "Software Cursor" overlay drawn by the helper,
// input posted to the target process (never the shared HID stream, so the real pointer never
// warps), and AX-first perception. Its own name because the Linux release hotkey does not apply —
// the macOS release affordance is not a compositor global — and because the settings panel names
// the integration differently. `visibleDesktop` is true: like the KWin plugin, the agent drives the
// display the human is already looking at, only through a picture of a cursor rather than a second
// seat.
export const COMPUTER_MAC_BACKEND = "mac";

// Advertise the release chord only for backends that register it. It must match the compositor
// plugin's actual binding.
export const COMPUTER_RELEASE_CONTROL_HOTKEY = "Meta+Shift+Esc";

export const COMPUTER_RELEASE_HOTKEY_BACKENDS: readonly string[] = [
  COMPUTER_KWIN_BACKEND,
  COMPUTER_HYPRLAND_BACKEND,
];

export const ComputerId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(COMPUTER_ID_MAX_LENGTH),
).check(Schema.isPattern(/^[A-Za-z0-9._:-]+$/));
export type ComputerId = typeof ComputerId.Type;

export const ComputerWindowId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(COMPUTER_ID_MAX_LENGTH),
);
export type ComputerWindowId = typeof ComputerWindowId.Type;

// Named rather than described so every surface says the same words: the chat's setup card, the
// settings panel, and the tool result the agent reads all key off these identifiers, and their
// user-facing labels live in one place (`@glade/shared/computerGrants`). There is no fourth surface
// — the Electron-side permission preflight that used to be one was deleted, because the prompt has
// to come from the process that actually needs the grant.
export const ComputerPermission = Schema.Literals([
  "accessibility",
  "screenRecording",
  "inputMonitoring",
]);
export type ComputerPermission = typeof ComputerPermission.Type;

// How the running build is code-signed, which decides whether a *stale* grant is a plausible
// explanation for a missing permission. macOS pins an ad-hoc signature's TCC grant to the binary's
// cdhash, so every local rebuild silently invalidates it while System Settings keeps showing the
// app switched on — the user sees "Glade: on" and the helper still reports the permission missing.
// A Developer ID signature keys on identifier plus team and survives rebuilds, so that advice must
// never be shown for one.
export const ComputerBuildSignature = Schema.Literals(["adhoc", "signed", "unknown"]);
export type ComputerBuildSignature = typeof ComputerBuildSignature.Type;

// The payload the agent gateway attaches to a `COMPUTER_SETUP_REQUIRED_ACTIVITY_KIND` activity, and
// the chat card reads back. `buildSignature` is optional because only a backend with a permission
// model reports one: it is what lets the card explain the case where System Settings already shows
// Glade switched on (an ad-hoc build's grant is pinned to a cdhash a rebuild replaced) instead of
// leaving the user staring at a switch that looks correct. `bundleId` is the identifier of the app
// the grant is *filed against* — the desktop shell that started this server, which on a `.dev` or
// `.canary` build is not the released Glade. It rides along because the card's recovery advice
// names it in a `tccutil reset` command, and a command naming the wrong app revokes a different
// Glade's grants while fixing nothing. Optional for the same reason it cannot be guessed: a server
// started outside the desktop shell has no responsible app, and the card must then omit the command
// entirely.
export const ComputerSetupRequiredPayload = Schema.Struct({
  toolName: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),

  missing: Schema.Array(ComputerPermission).check(Schema.isMaxLength(8)),
  buildSignature: Schema.optional(ComputerBuildSignature),
  bundleId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
});
export type ComputerSetupRequiredPayload = typeof ComputerSetupRequiredPayload.Type;

export const ComputerAvailability = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("available"),
    backend: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  }),
  Schema.Struct({
    kind: Schema.Literal("unsupported-platform"),
    platform: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  }),
  // The backend exists and works; the OS is withholding a grant it cannot run without. Its own kind
  // rather than a `backend-unavailable` message because this is the one unavailability a user can fix
  // in thirty seconds, and every surface has to be able to *act* on it — name the grants, offer the
  // button, raise the chat's setup card — which reading English out of a message field cannot do.
  // Only a grant whose absence blocks control is reported this way. A desktop that can be driven but
  // not seen (Screen Recording alone) stays `available` with `health.captureAvailable` false, because
  // refusing the whole feature over a blind spot would take away the half that still works.
  Schema.Struct({
    kind: Schema.Literal("permission-required"),

    missing: Schema.Array(ComputerPermission).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
    message: TrimmedNonEmptyString.check(Schema.isMaxLength(COMPUTER_MESSAGE_MAX_LENGTH)),
    buildSignature: ComputerBuildSignature,

    bundleId: ComputerSetupRequiredPayload.fields.bundleId,
  }),
  Schema.Struct({
    kind: Schema.Literal("backend-unavailable"),
    message: TrimmedNonEmptyString.check(Schema.isMaxLength(COMPUTER_MESSAGE_MAX_LENGTH)),
  }),
]);
export type ComputerAvailability = typeof ComputerAvailability.Type;

export const ComputerHealthStatus = Schema.Literals(["connected", "reconnecting", "unavailable"]);
export type ComputerHealthStatus = typeof ComputerHealthStatus.Type;

export const ComputerHealthFailure = Schema.Struct({
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(COMPUTER_MESSAGE_MAX_LENGTH)),
  at: IsoDateTime,
});
export type ComputerHealthFailure = typeof ComputerHealthFailure.Type;

export const ComputerHealth = Schema.Struct({
  status: ComputerHealthStatus,

  consecutiveFailures: NonNegativeInt,
  // Unlike the consecutive count this is never reset, because a desktop that keeps recovering is
  // still a desktop that keeps dying.
  reconnects: NonNegativeInt,

  lastFailure: Schema.optional(ComputerHealthFailure),

  captureAvailable: Schema.Boolean,
  // The connected backend can drive the desktop, but not without the human seeing it: one rung of its
  // input delivery ladder is missing, so reaching a background window means briefly bringing that
  // window forward. True today only on macOS releases where the helper cannot resolve the private
  // SkyLight symbol that routes a key event into an unfocused web view. Optional because a backend
  // with no delivery ladder has no answer to give, and absent is not the same claim as `false`.
  backgroundInputDegraded: Schema.optional(Schema.Boolean),
});
export type ComputerHealth = typeof ComputerHealth.Type;

// The backends differ in kind, not only in quality: a compositor plugin owning a dedicated seat can
// enumerate windows with geometry, stack them, and draw a ghost cursor, while a backend still being
// provisioned may have none of that yet. A caller that cannot tell those apart lies to the model —
// "no windows" when the truth is "no window enumeration exists here" — so the answer travels with
// the state instead of being inferred from the backend's name.
export const ComputerCapabilities = Schema.Struct({
  // Windows can be enumerated at all. `false` means listing refuses, never `[]`.
  windows: Schema.Boolean,

  windowBounds: Schema.Boolean,

  stacking: Schema.Boolean,
  capture: Schema.Boolean,
  input: Schema.Boolean,
  clipboard: Schema.Boolean,
  // A window can be given the agent's keyboard focus, so window-targeted typing is possible. Split
  // from `raise` because the two are genuinely separate abilities and the macOS helper deliberately
  // does one without the other: it aims the keyboard at a window's process while leaving the stacking
  // order exactly as the human left it.
  focus: Schema.Boolean,

  raise: Schema.Boolean,

  ghostCursor: Schema.Boolean,
  // The driven desktop is the display the human is already looking at, so every action is visible
  // without a preview. On a nested or offscreen desktop the pane is the only window onto the agent's
  // work; on a visible one the pane still opens on request (auto-open is client-preference gated) but
  // renders stills only — interactive input stays off, because a second cursor on the human's own
  // screen would fight theirs. The agent still drives that visible desktop through a seat of its own
  // — never the human's.
  visibleDesktop: Schema.Boolean,
});
export type ComputerCapabilities = typeof ComputerCapabilities.Type;

export const ComputerRect = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  height: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ComputerRect = typeof ComputerRect.Type;

export const ComputerPoint = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
});
export type ComputerPoint = typeof ComputerPoint.Type;

export const ComputerScreenSize = Schema.Struct({
  width: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32_768 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32_768 })),
  scale: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
});
export type ComputerScreenSize = typeof ComputerScreenSize.Type;

const ObservedComputerSpaceId = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);

export const ComputerWindow = Schema.Struct({
  id: ComputerWindowId,
  title: Schema.String.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH)),
  appName: Schema.optional(Schema.String.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH))),
  pid: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  // Absent when the backend exposes no window geometry — a client under Wayland cannot ask where a
  // window is, so only an in-compositor plugin can answer.
  bounds: Schema.optional(ComputerRect),
  focused: Schema.Boolean,

  keyboardFocused: Schema.optional(Schema.Boolean),
  // Distinct from `focused` (the agent's own input target): toolkits gate keyboard-shortcut dispatch
  // on activation, so a hotkey sent to a window that is not active may be silently dropped. Optional
  // because a backend need not expose activation.
  active: Schema.optional(Schema.Boolean),
  minimized: Schema.Boolean,
  visible: Schema.Boolean,

  spaceIds: Schema.optional(
    Schema.Array(ObservedComputerSpaceId).check(
      Schema.isMaxLength(COMPUTER_WINDOW_LIST_MAX_LENGTH),
    ),
  ),

  currentSpaceId: Schema.optional(ObservedComputerSpaceId),
  onCurrentSpace: Schema.optional(Schema.Boolean),
  // Optional because a backend need not expose a stacking order.
  stackingIndex: Schema.optional(NonNegativeInt),

  occludedBy: Schema.optional(
    Schema.Array(ComputerWindowId).check(Schema.isMaxLength(COMPUTER_WINDOW_LIST_MAX_LENGTH)),
  ),
});
export type ComputerWindow = typeof ComputerWindow.Type;

export const ComputerUiFrame = ComputerRect;
export type ComputerUiFrame = typeof ComputerUiFrame.Type;

export const ComputerUiPoint = ComputerPoint;
export type ComputerUiPoint = typeof ComputerUiPoint.Type;

const COMPUTER_NODE_PATH_MAX_DEPTH = 64;

export interface ComputerUiNode {
  readonly role: string;
  readonly label: string | null;
  readonly value: string | null;
  readonly description: string | null;
  readonly frame: ComputerUiFrame;
  readonly activationPoint: ComputerUiPoint | null;
  readonly onScreen: boolean;
  readonly windowId: ComputerWindowId | null;
  // Child-index path from the owning window's accessibility root, present when the perception source
  // can re-resolve a node without holding a live handle. A semantic write addresses `windowId` +
  // `nodePath` on a fresh read, so the pair stays valid across helper restarts while the tree is
  // unchanged.
  readonly nodePath?: readonly number[] | undefined;
  readonly accessibilityRoot?: "window" | "menu-bar" | "menu-bar-extra" | undefined;

  readonly editable?: boolean | undefined;

  readonly truncated?: boolean | undefined;
  readonly children: readonly ComputerUiNode[];
}

export const ComputerUiNode: Schema.Codec<ComputerUiNode> = Schema.Struct({
  role: Schema.String.check(Schema.isMaxLength(128)),
  label: Schema.NullOr(Schema.String.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH))),
  value: Schema.NullOr(Schema.String.check(Schema.isMaxLength(COMPUTER_TEXT_MAX_LENGTH))),
  description: Schema.NullOr(Schema.String.check(Schema.isMaxLength(COMPUTER_TEXT_MAX_LENGTH))),
  frame: ComputerUiFrame,
  activationPoint: Schema.NullOr(ComputerUiPoint),
  onScreen: Schema.Boolean,
  windowId: Schema.NullOr(ComputerWindowId),
  accessibilityRoot: Schema.optional(Schema.Literals(["window", "menu-bar", "menu-bar-extra"])),
  nodePath: Schema.optional(
    Schema.Array(NonNegativeInt).check(Schema.isMaxLength(COMPUTER_NODE_PATH_MAX_DEPTH)),
  ),
  editable: Schema.optional(Schema.Boolean),
  truncated: Schema.optional(Schema.Boolean),
  children: Schema.Array(Schema.suspend((): Schema.Codec<ComputerUiNode> => ComputerUiNode)).check(
    Schema.isMaxLength(2_048),
  ),
});

export const ComputerScreenshot = Schema.Struct({
  mimeType: Schema.Literal("image/png"),
  width: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32_768 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32_768 })),
  sizeBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 * 1024 * 1024 })),
  bytesBase64: TrimmedNonEmptyString.check(Schema.isMaxLength(88 * 1024 * 1024)),

  windowId: Schema.optional(ComputerWindowId),

  region: Schema.optional(ComputerRect),

  scale: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  capturedAt: IsoDateTime,
});
export type ComputerScreenshot = typeof ComputerScreenshot.Type;

export const ComputerInputPause = Schema.Struct({
  windowId: Schema.optional(ComputerWindowId),

  pid: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 0x7fffffff }))),
  message: Schema.String.check(Schema.isMaxLength(COMPUTER_MESSAGE_MAX_LENGTH)),
});
export type ComputerInputPause = typeof ComputerInputPause.Type;

export const ComputerState = Schema.Struct({
  inputPause: Schema.optional(ComputerInputPause),
  // A non-fatal preview note: the window observation behind this state hit a preview-only failure
  // (the native preview helper errored or the window's preview could not be established), so there is
  // no screenshot to show. Absent when previews are healthy or were never asked for — it never
  // carries an input refusal.
  previewNote: Schema.optional(
    Schema.String.check(Schema.isMaxLength(COMPUTER_MESSAGE_MAX_LENGTH)),
  ),
  accessibility: Schema.optional(
    Schema.Struct({
      status: Schema.Literals(["complete", "partial", "unavailable"]),
      unavailableWindowIds: Schema.Array(ComputerWindowId),
    }),
  ),
  computerId: ComputerId,
  windows: Schema.Array(ComputerWindow).check(Schema.isMaxLength(COMPUTER_WINDOW_LIST_MAX_LENGTH)),
  screenSize: ComputerScreenSize,
  // Optional because a backend with no permission model has nothing to add, but load-bearing where
  // there is one: a perception read is the primary tool an agent reaches for, and without this field
  // the one result that most needs to say "the OS is withholding a grant" was the one result that
  // could not.
  availability: Schema.optional(ComputerAvailability),
  root: Schema.optional(ComputerUiNode),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(4 * 1024 * 1024))),
  screenshot: Schema.optional(ComputerScreenshot),
  capturedAt: IsoDateTime,
});
export type ComputerState = typeof ComputerState.Type;

export const ThreadComputerState = Schema.Struct({
  controlGeneration: Schema.optional(NonNegativeInt),
  threadId: ThreadId,
  version: NonNegativeInt,
  computerId: ComputerId,
  windows: Schema.Array(ComputerWindow).check(Schema.isMaxLength(COMPUTER_WINDOW_LIST_MAX_LENGTH)),
  screenSize: ComputerScreenSize,
  cursor: Schema.optional(ComputerPoint),
  agentActive: Schema.Boolean,
  activity: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
  inputPause: Schema.optional(ComputerInputPause),

  controlOwnerThreadId: Schema.optional(ThreadId),
  controlOwnerLabel: Schema.optional(
    Schema.String.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH)),
  ),

  controlledByOtherThread: Schema.Boolean,

  sharedPreviewUnavailable: Schema.optional(Schema.Boolean),
  availability: ComputerAvailability,

  health: ComputerHealth,

  capabilities: ComputerCapabilities,

  inputStopped: Schema.optional(Schema.Boolean),
  lastError: Schema.NullOr(Schema.String.check(Schema.isMaxLength(COMPUTER_MESSAGE_MAX_LENGTH))),
});
export type ThreadComputerState = typeof ThreadComputerState.Type;

export const ComputerGetStatusInput = Schema.Struct({});
export type ComputerGetStatusInput = typeof ComputerGetStatusInput.Type;

export const ComputerStatusResult = Schema.Struct({
  provisionable: Schema.optional(Schema.Boolean),
  computerId: ComputerId,
  availability: ComputerAvailability,
  health: ComputerHealth,
  capabilities: ComputerCapabilities,

  inputStopped: Schema.optional(Schema.Boolean),
});
export type ComputerStatusResult = typeof ComputerStatusResult.Type;

export const ComputerProvisionInput = Schema.Struct({});
export type ComputerProvisionInput = typeof ComputerProvisionInput.Type;

export const ComputerProvisionResult = Schema.Struct({
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(COMPUTER_PROVISION_SUMMARY_MAX_LENGTH)),
  status: ComputerStatusResult,
});
export type ComputerProvisionResult = typeof ComputerProvisionResult.Type;

export const ComputerListWindowsInput = Schema.Struct({});
export type ComputerListWindowsInput = typeof ComputerListWindowsInput.Type;

export const ComputerListWindowsResult = Schema.Struct({
  computerId: ComputerId,
  windows: Schema.Array(ComputerWindow).check(Schema.isMaxLength(COMPUTER_WINDOW_LIST_MAX_LENGTH)),
  availability: ComputerAvailability,
});
export type ComputerListWindowsResult = typeof ComputerListWindowsResult.Type;

export const ComputerApp = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  name: Schema.String.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH)),
  bundleId: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),

  teamId: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),

  running: Schema.Boolean,

  active: Schema.Boolean,

  launchPath: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),

  windowCount: Schema.optional(NonNegativeInt),

  lastUsed: Schema.optional(IsoDateTime),
});
export type ComputerApp = typeof ComputerApp.Type;

export const ComputerListAppsResult = Schema.Struct({
  computerId: ComputerId,
  apps: Schema.Array(ComputerApp).check(Schema.isMaxLength(1_024)),
  availability: ComputerAvailability,
});
export type ComputerListAppsResult = typeof ComputerListAppsResult.Type;

export const ComputerVerifyStateResult = Schema.Struct({
  status: Schema.Literals(["satisfied", "unsatisfied", "unknown"]),

  stable: Schema.Boolean,

  samples: NonNegativeInt,
  elapsedMs: NonNegativeInt,

  predicates: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(8)),
});
export type ComputerVerifyStateResult = typeof ComputerVerifyStateResult.Type;

export const ComputerZoomResult = Schema.Struct({
  mimeType: Schema.Literal("image/jpeg"),
  width: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32_768 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32_768 })),
  sizeBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 * 1024 * 1024 })),
  bytesBase64: TrimmedNonEmptyString.check(Schema.isMaxLength(88 * 1024 * 1024)),
  windowId: Schema.optional(ComputerWindowId),
  capturedAt: IsoDateTime,
});
export type ComputerZoomResult = typeof ComputerZoomResult.Type;

export const ComputerAccessibilityTreeApp = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  name: Schema.String.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH)),
  bundleId: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
});
export type ComputerAccessibilityTreeApp = typeof ComputerAccessibilityTreeApp.Type;

export const ComputerAccessibilityTreeWindow = Schema.Struct({
  id: ComputerWindowId,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  appName: Schema.optional(Schema.String.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH))),
  title: Schema.String.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH)),
  bounds: Schema.optional(ComputerRect),
  onScreen: Schema.optional(Schema.Boolean),
  zIndex: Schema.optional(NonNegativeInt),
});
export type ComputerAccessibilityTreeWindow = typeof ComputerAccessibilityTreeWindow.Type;

export const ComputerAccessibilityTreeResult = Schema.Struct({
  computerId: ComputerId,
  apps: Schema.Array(ComputerAccessibilityTreeApp).check(Schema.isMaxLength(1_024)),
  windows: Schema.Array(ComputerAccessibilityTreeWindow).check(
    Schema.isMaxLength(COMPUTER_WINDOW_LIST_MAX_LENGTH),
  ),

  windowId: Schema.optional(ComputerWindowId),

  truncated: Schema.Boolean,
  availability: ComputerAvailability,
});
export type ComputerAccessibilityTreeResult = typeof ComputerAccessibilityTreeResult.Type;

export const ComputerCursorPosition = Schema.Struct({
  computerId: ComputerId,
  x: Schema.Finite,
  y: Schema.Finite,
  capturedAt: IsoDateTime,
  availability: ComputerAvailability,

  windowId: Schema.optional(ComputerWindowId),

  insideWindow: Schema.optional(Schema.Boolean),
});
export type ComputerCursorPosition = typeof ComputerCursorPosition.Type;

export const ComputerGetStateInput = Schema.Struct({
  includeScreenshot: Schema.optional(Schema.Boolean),
  includeText: Schema.optional(Schema.Boolean),

  windowId: Schema.optional(ComputerWindowId),

  labelContains: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH)),
  ),
});
export type ComputerGetStateInput = typeof ComputerGetStateInput.Type;

export const ComputerGetScreenSizeInput = Schema.Struct({});
export type ComputerGetScreenSizeInput = typeof ComputerGetScreenSizeInput.Type;

export const ComputerGetScreenSizeResult = Schema.Struct({
  computerId: ComputerId,
  screenSize: ComputerScreenSize,
  availability: ComputerAvailability,
});
export type ComputerGetScreenSizeResult = typeof ComputerGetScreenSizeResult.Type;

export const ComputerSetControlEnabledInput = Schema.Struct({
  threadId: ThreadId,
  enabled: Schema.Boolean,
});
export type ComputerSetControlEnabledInput = typeof ComputerSetControlEnabledInput.Type;
export const ComputerControlEnabledResult = Schema.Struct({
  enabled: Schema.Boolean,
  generation: Schema.optional(NonNegativeInt),
});
export type ComputerControlEnabledResult = typeof ComputerControlEnabledResult.Type;

export const ComputerThreadInput = Schema.Struct({ threadId: ThreadId });
export type ComputerThreadInput = typeof ComputerThreadInput.Type;

export const ComputerLaunchAppInput = Schema.Struct({
  app: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  arguments: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(4_096))).check(Schema.isMaxLength(128)),
  ),
});
export type ComputerLaunchAppInput = typeof ComputerLaunchAppInput.Type;

export const ComputerLaunchAppResult = Schema.Struct({
  computerId: ComputerId,
  app: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),

  focusChangedDuringLaunch: Schema.optional(Schema.Boolean),
  pid: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 0x7fffffff }))),

  windowStatus: Schema.optional(Schema.Literals(["ready", "no_usable_window", "not_checked"])),
  windowReason: Schema.optional(
    Schema.Literals(["no_window", "ambiguous", "off_space", "hidden", "input_unavailable"]),
  ),

  resolvedCommand: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
  window: Schema.NullOr(ComputerWindow),
});
export type ComputerLaunchAppResult = typeof ComputerLaunchAppResult.Type;

// One list, because a chord the pane can express and the agent cannot (or the reverse) is a
// difference nothing in the product means.
export const ComputerInputModifier = Schema.Literals(["ctrl", "alt", "shift", "meta"]);
export type ComputerInputModifier = typeof ComputerInputModifier.Type;

export const COMPUTER_MODIFIERS_MAX_ITEMS = 4;

const ComputerHeldModifiers = Schema.optional(
  Schema.Array(ComputerInputModifier).check(Schema.isMaxLength(COMPUTER_MODIFIERS_MAX_ITEMS)),
);

const ComputerTargetFields = {
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
  label: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(COMPUTER_LABEL_MAX_LENGTH)),
  ),
  role: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  windowId: Schema.optional(ComputerWindowId),
  // An element's stable handle from a `computer_get_state` elements listing — the compact targeting
  // form. A ref resolves to the listed element's identity and occurrence ordinal, so it survives
  // label truncation and names duplicates a bare label cannot. The binding holds across observations
  // while the element is present; it never moves to a different element.
  ref: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),

  refOrdinal: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
} as const;

export const ComputerTarget = Schema.Struct(ComputerTargetFields);
export type ComputerTarget = typeof ComputerTarget.Type;

const ComputerModifiedTargetFields = {
  ...ComputerTargetFields,
  modifiers: ComputerHeldModifiers,
} as const;

export const ComputerClickInput = Schema.Struct(ComputerModifiedTargetFields);
export type ComputerClickInput = typeof ComputerClickInput.Type;
export const ComputerDoubleClickInput = Schema.Struct(ComputerModifiedTargetFields);
export type ComputerDoubleClickInput = typeof ComputerDoubleClickInput.Type;
export const ComputerTripleClickInput = Schema.Struct(ComputerModifiedTargetFields);
export type ComputerTripleClickInput = typeof ComputerTripleClickInput.Type;
export const ComputerRightClickInput = Schema.Struct(ComputerModifiedTargetFields);
export type ComputerRightClickInput = typeof ComputerRightClickInput.Type;

export const ComputerMoveCursorInput = ComputerTarget;
export type ComputerMoveCursorInput = typeof ComputerMoveCursorInput.Type;

export const ComputerActivateWindowInput = Schema.Struct({ windowId: ComputerWindowId });
export type ComputerActivateWindowInput = typeof ComputerActivateWindowInput.Type;

// Bounded because the wait holds the turn: a model that reads "wait for the installer" as a number
// of minutes would stall the conversation behind a sleep nothing can interrupt.
export const COMPUTER_WAIT_MAX_MS = 10_000;

export const ComputerWaitInput = Schema.Struct({
  durationMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: COMPUTER_WAIT_MAX_MS })),
});
export type ComputerWaitInput = typeof ComputerWaitInput.Type;

export const ComputerDragInput = Schema.Struct({
  from: ComputerTarget,
  to: ComputerTarget,
  durationMs: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: COMPUTER_DRAG_MAX_DURATION_MS })),
  ),
});
export type ComputerDragInput = typeof ComputerDragInput.Type;

export const ComputerScrollInput = Schema.Struct({
  ...ComputerModifiedTargetFields,
  deltaX: Schema.Finite,
  deltaY: Schema.Finite,
});
export type ComputerScrollInput = typeof ComputerScrollInput.Type;

export const ComputerTypeTextInput = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(COMPUTER_TEXT_MAX_LENGTH)),
});
export type ComputerTypeTextInput = typeof ComputerTypeTextInput.Type;

export const ComputerPressKeyInput = Schema.Struct({
  key: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type ComputerPressKeyInput = typeof ComputerPressKeyInput.Type;

export const ComputerHotkeyInput = Schema.Struct({
  keys: Schema.Array(
    TrimmedNonEmptyString.check(Schema.isMaxLength(COMPUTER_KEY_NAME_MAX_LENGTH)),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(COMPUTER_HOTKEY_MAX_KEYS)),
});
export type ComputerHotkeyInput = typeof ComputerHotkeyInput.Type;

export const ComputerSetValueInput = Schema.Struct({
  ...ComputerTargetFields,
  value: Schema.String.check(Schema.isMaxLength(COMPUTER_TEXT_MAX_LENGTH)),
});
export type ComputerSetValueInput = typeof ComputerSetValueInput.Type;

export const ComputerPerformActionInput = Schema.Struct({
  ...ComputerTargetFields,
  action: TrimmedNonEmptyString.check(Schema.isMaxLength(COMPUTER_SEMANTIC_ACTION_MAX_LENGTH)),
});
export type ComputerPerformActionInput = typeof ComputerPerformActionInput.Type;

export const ComputerSelectTextInput = Schema.Struct({
  ...ComputerTargetFields,
  start: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: COMPUTER_SELECT_TEXT_RANGE_MAX }),
  ),
  length: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: COMPUTER_SELECT_TEXT_RANGE_MAX }),
  ),
});
export type ComputerSelectTextInput = typeof ComputerSelectTextInput.Type;

const COMPUTER_INPUT_COORDINATE_MAX = 32_767;

export const COMPUTER_INPUT_SCROLL_LIMIT = 4_096;

const ComputerInputCoordinate = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: COMPUTER_INPUT_COORDINATE_MAX }),
);

const ComputerInputDelta = Schema.Finite.check(
  Schema.isBetween({ minimum: -COMPUTER_INPUT_SCROLL_LIMIT, maximum: COMPUTER_INPUT_SCROLL_LIMIT }),
);

export const ComputerInputButton = Schema.Literals(["left", "right"]);
export type ComputerInputButton = typeof ComputerInputButton.Type;

export const ComputerInputClickInput = Schema.Struct({
  x: ComputerInputCoordinate,
  y: ComputerInputCoordinate,

  button: Schema.optional(ComputerInputButton),
  // `2` issues the backend's double click, whose two presses are spaced closely enough for a toolkit
  // to pair them; two separate single clicks cannot be, because each one pays a browser round trip
  // and a pointer glide.
  clickCount: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 }))),
});
export type ComputerInputClickInput = typeof ComputerInputClickInput.Type;

export const ComputerInputScrollInput = Schema.Struct({
  x: ComputerInputCoordinate,
  y: ComputerInputCoordinate,
  deltaX: ComputerInputDelta,
  deltaY: ComputerInputDelta,
});
export type ComputerInputScrollInput = typeof ComputerInputScrollInput.Type;

export const ComputerInputKeyInput = Schema.Struct({
  key: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),

  modifiers: Schema.optional(Schema.Array(ComputerInputModifier).check(Schema.isMaxLength(4))),
});
export type ComputerInputKeyInput = typeof ComputerInputKeyInput.Type;

export const ComputerDeliveryVerification = Schema.Literals([
  "confirmed",
  "unconfirmed",
  "unverifiable",
]);
export type ComputerDeliveryVerification = typeof ComputerDeliveryVerification.Type;

export const ComputerActionResult = Schema.Struct({
  computerId: ComputerId,
  action: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  point: Schema.optional(ComputerPoint),

  clampedTo: Schema.optional(ComputerPoint),
  windowId: Schema.optional(ComputerWindowId),
  value: Schema.optional(Schema.String.check(Schema.isMaxLength(COMPUTER_TEXT_MAX_LENGTH))),

  scroll: Schema.optional(
    Schema.Struct({
      requested: Schema.Struct({ deltaX: Schema.Finite, deltaY: Schema.Finite }),
      injected: Schema.Struct({ deltaX: Schema.Finite, deltaY: Schema.Finite }),

      limitedTo: Schema.optional(Schema.Struct({ deltaX: Schema.Finite, deltaY: Schema.Finite })),
      traveledY: Schema.optional(Schema.Finite),
      gearing: Schema.optional(Schema.Finite),
      // Gearing is learned per route because the two move different distances for the same request.
      routes: Schema.optional(
        Schema.Array(Schema.String.check(Schema.isMaxLength(32))).check(Schema.isMaxLength(4)),
      ),
    }),
  ),
  // Input delivery telemetry: which rung of the backend's delivery ladder carried the input (`path`),
  // and what the backend could establish about the outcome (`verified`). `verified` is three-valued
  // on purpose, because the two things a boolean conflated are not the same failure. `confirmed`
  // means the backend read the effect back. `unconfirmed` means it tried to read the effect back and
  // could not see it — the one case where a caller must look at the screen before building on the
  // action. `unverifiable` means the surface exposes no readable value at all, which is the ordinary
  // answer for most native controls: the input was delivered, nothing about it is suspect, and a
  // caller that treated it as a failure would take a screenshot after every keystroke for nothing.
  // Optional because only backends with a delivery ladder answer it; the Linux backends never set it,
  // and their results encode exactly as before.
  delivery: Schema.optional(
    Schema.Struct({
      path: Schema.String.check(Schema.isMaxLength(COMPUTER_DELIVERY_PATH_MAX_LENGTH)),
      verified: ComputerDeliveryVerification,
      effect: Schema.optional(
        Schema.Literals(["not-dispatched", "dispatched-unknown", "verified"]),
      ),
    }),
  ),
});
export type ComputerActionResult = typeof ComputerActionResult.Type;

export const ComputerThreadStateEvent = Schema.Struct({
  type: Schema.Literal("computer.thread-state"),
  state: ThreadComputerState,
});
export type ComputerThreadStateEvent = typeof ComputerThreadStateEvent.Type;

export const ComputerWindowsChangedEvent = Schema.Struct({
  type: Schema.Literal("computer.windows-changed"),
  windows: Schema.Array(ComputerWindow).check(Schema.isMaxLength(COMPUTER_WINDOW_LIST_MAX_LENGTH)),
});
export type ComputerWindowsChangedEvent = typeof ComputerWindowsChangedEvent.Type;

export const ComputerActionEvent = Schema.Struct({
  windowId: Schema.optional(ComputerWindowId),
  delivery: ComputerActionResult.fields.delivery,
  type: Schema.Literal("computer.action"),
  action: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String.check(Schema.isMaxLength(COMPUTER_MESSAGE_MAX_LENGTH))),

  threadId: Schema.optional(ThreadId),
});
export type ComputerActionEvent = typeof ComputerActionEvent.Type;

export const ComputerFrameEvent = Schema.Struct({
  type: Schema.Literal("computer.frame"),
  header: Schema.Struct({
    computerId: ComputerId,
    sequence: NonNegativeInt,
    timestampMs: Schema.Finite,
    keyframe: Schema.Boolean,
    codecConfig: Schema.Boolean,
  }),
});
export type ComputerFrameEvent = typeof ComputerFrameEvent.Type;

export const ComputerOpenPaneRequestedEvent = Schema.Struct({
  type: Schema.Literal("computer.open-pane-requested"),
  threadId: ThreadId,
});
export type ComputerOpenPaneRequestedEvent = typeof ComputerOpenPaneRequestedEvent.Type;

// Host-wide and thread-independent: the press belongs to the person at the machine, not to any
// conversation, so it cannot ride `computer.thread-state` — which also does not exist at all until
// a pane has opened for the thread.
export const ComputerInputStoppedEvent = Schema.Struct({
  type: Schema.Literal("computer.input-stopped"),
  stopped: Schema.Boolean,
});
export type ComputerInputStoppedEvent = typeof ComputerInputStoppedEvent.Type;

export const ComputerEvent = Schema.Union([
  ComputerThreadStateEvent,
  ComputerWindowsChangedEvent,
  ComputerActionEvent,
  ComputerFrameEvent,
  ComputerOpenPaneRequestedEvent,
  ComputerInputStoppedEvent,
]);
export type ComputerEvent = typeof ComputerEvent.Type;

export const COMPUTER_FRAME_MAGIC = 0x5343;
export const COMPUTER_FRAME_VERSION = 1;
export const COMPUTER_FRAME_MAX_COMPUTER_ID_BYTES = 255;

export const ComputerFrameHeader = Schema.Struct({
  computerId: ComputerId,
  sequence: NonNegativeInt,
  timestampMs: Schema.Finite,
  keyframe: Schema.Boolean,
  codecConfig: Schema.Boolean,
});
export type ComputerFrameHeader = typeof ComputerFrameHeader.Type;

export const ComputerFrameDecodeErrorReason = Schema.Literals([
  "too-short",
  "bad-magic",
  "unsupported-version",
  "truncated-computer-id",
  "invalid-computer-id",
]);
export type ComputerFrameDecodeErrorReason = typeof ComputerFrameDecodeErrorReason.Type;
