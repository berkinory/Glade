import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const DEVICE_WS_METHODS = {
  list: "device.list",
  boot: "device.boot",
  shutdown: "device.shutdown",
  attach: "device.attach",
  detach: "device.detach",
  getThreadState: "device.getThreadState",
  tap: "device.tap",
  swipe: "device.swipe",
  typeText: "device.typeText",
  keyEvent: "device.keyEvent",
  pressButton: "device.pressButton",
  installApp: "device.installApp",
  launchApp: "device.launchApp",
  openUrl: "device.openUrl",
  screenshot: "device.screenshot",
  startRecording: "device.startRecording",
  stopRecording: "device.stopRecording",
  describeUi: "device.describeUi",
  scrollToElement: "device.scrollToElement",
  subscribeEvents: "device.subscribeEvents",
} as const;

export const DEVICE_WS_CHANNELS = {
  event: "device.event",
} as const;

const DEVICE_UDID_MAX_LENGTH = 128;
const DEVICE_TEXT_MAX_LENGTH = 4_096;
const DEVICE_PATH_MAX_LENGTH = 1_024;
const DEVICE_URL_MAX_LENGTH = 8_192;
const DEVICE_MESSAGE_MAX_LENGTH = 2_048;

export const DeviceUdid = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DEVICE_UDID_MAX_LENGTH),
).check(Schema.isPattern(/^[A-Za-z0-9._:-]+$/));
export type DeviceUdid = typeof DeviceUdid.Type;

export const DevicePlatform = Schema.Literals(["ios-simulator"]);
export type DevicePlatform = typeof DevicePlatform.Type;

export const DeviceRuntimeState = Schema.Literals([
  "shutdown",
  "booting",
  "booted",
  "shutting-down",
]);
export type DeviceRuntimeState = typeof DeviceRuntimeState.Type;

export const DeviceBootSource = Schema.Literals(["glade", "user"]);
export type DeviceBootSource = typeof DeviceBootSource.Type;

// Optional because a backend that cannot read the device type profile still lists devices; the pane
// falls back to the name there.
export const DeviceFamily = Schema.Literals(["phone", "tablet"]);
export type DeviceFamily = typeof DeviceFamily.Type;

export const DeviceDescriptor = Schema.Struct({
  platform: DevicePlatform,
  udid: DeviceUdid,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),

  runtime: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  state: DeviceRuntimeState,
  bootSource: DeviceBootSource,
  family: Schema.optional(DeviceFamily),
  // Input coordinates are device points while video frames are pixels, so a pane mapping a canvas
  // click without dividing by the scale sends coordinates several times too large (1206x2622 pixels
  // against a 402x874 point screen). Optional because a backend that cannot read the profile (or a
  // fake one) still lists devices, and requiring it would break those listings.
  geometry: Schema.optional(
    Schema.Struct({
      pointWidth: Schema.Finite.check(Schema.isGreaterThan(0)),
      pointHeight: Schema.Finite.check(Schema.isGreaterThan(0)),
      scale: Schema.Finite.check(Schema.isGreaterThan(0)),
    }),
  ),
});
export type DeviceDescriptor = typeof DeviceDescriptor.Type;

export type DeviceGeometry = NonNullable<DeviceDescriptor["geometry"]>;

// Alias kept because the pane talks about "device state" while the manager stores descriptors.
export const DeviceState = DeviceDescriptor;
export type DeviceState = DeviceDescriptor;

export const DeviceSetupStepId = Schema.Literals([
  "install-xcode",
  "accept-xcode-license",
  "select-xcode-command-line-tools",
  "install-ios-runtime",
  "build-device-helper",
]);
export type DeviceSetupStepId = typeof DeviceSetupStepId.Type;

export const DeviceSetupStep = Schema.Struct({
  id: DeviceSetupStepId,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  done: Schema.Boolean,

  detail: Schema.optional(Schema.String.check(Schema.isMaxLength(DEVICE_MESSAGE_MAX_LENGTH))),
});
export type DeviceSetupStep = typeof DeviceSetupStep.Type;

export const DeviceCapabilityId = Schema.Literals([
  "framebuffer",

  "hid",

  "accessibility",

  "encoder",
]);
export type DeviceCapabilityId = typeof DeviceCapabilityId.Type;

export const DeviceCapabilityStatus = Schema.Struct({
  id: DeviceCapabilityId,
  ok: Schema.Boolean,

  missingSymbol: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),

  detail: Schema.optional(Schema.String.check(Schema.isMaxLength(DEVICE_MESSAGE_MAX_LENGTH))),
});
export type DeviceCapabilityStatus = typeof DeviceCapabilityStatus.Type;

export const DeviceToolchain = Schema.Struct({
  xcodeVersion: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  xcodeBuild: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  macOS: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export type DeviceToolchain = typeof DeviceToolchain.Type;

export const DeviceAvailability = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("available"),

    capabilities: Schema.optional(
      Schema.Array(DeviceCapabilityStatus).check(Schema.isMaxLength(16)),
    ),
    toolchain: Schema.optional(DeviceToolchain),
  }),
  Schema.Struct({
    kind: Schema.Literal("unsupported-platform"),
    platform: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  }),
  Schema.Struct({
    kind: Schema.Literal("setup-required"),
    steps: Schema.Array(DeviceSetupStep).check(Schema.isMaxLength(16)),
  }),
  // Distinct from `setup-required` because there is nothing for the user to install: the pane opens
  // and everything backed by a working capability keeps working.
  Schema.Struct({
    kind: Schema.Literal("degraded"),
    capabilities: Schema.Array(DeviceCapabilityStatus).check(Schema.isMaxLength(16)),
    toolchain: Schema.optional(DeviceToolchain),
  }),

  Schema.Struct({
    kind: Schema.Literal("helper-unavailable"),
    message: TrimmedNonEmptyString.check(Schema.isMaxLength(DEVICE_MESSAGE_MAX_LENGTH)),
  }),
]);
export type DeviceAvailability = typeof DeviceAvailability.Type;

export const DEVICE_CAPABILITY_LABELS: Record<DeviceCapabilityId, string> = {
  framebuffer: "Screen capture",
  hid: "Touch and keyboard input",
  accessibility: "Accessibility inspection",
  encoder: "Video encoding",
};

export const DeviceAttachPhase = Schema.Literals([
  "booting",

  "waiting-for-display",

  "connecting",
]);
export type DeviceAttachPhase = typeof DeviceAttachPhase.Type;

export const ThreadDeviceState = Schema.Struct({
  threadId: ThreadId,

  version: NonNegativeInt,
  attachedDeviceUdid: Schema.NullOr(DeviceUdid),

  attachPhase: Schema.optional(Schema.NullOr(DeviceAttachPhase)),

  devices: Schema.Array(DeviceDescriptor).check(Schema.isMaxLength(64)),

  agentActive: Schema.Boolean,
  availability: DeviceAvailability,
  lastError: Schema.NullOr(Schema.String.check(Schema.isMaxLength(DEVICE_MESSAGE_MAX_LENGTH))),
});
export type ThreadDeviceState = typeof ThreadDeviceState.Type;

export const DEVICE_GLADE_BOOT_LIMIT = 3;

const DeviceTargetInput = Schema.Struct({ udid: DeviceUdid });

export const DeviceListInput = Schema.Struct({
  includeShutdown: Schema.optional(Schema.Boolean),
});
export type DeviceListInput = typeof DeviceListInput.Type;

export const DeviceListResult = Schema.Struct({
  devices: Schema.Array(DeviceDescriptor).check(Schema.isMaxLength(256)),
  availability: DeviceAvailability,
});
export type DeviceListResult = typeof DeviceListResult.Type;

export const DeviceBootInput = DeviceTargetInput;
export type DeviceBootInput = typeof DeviceBootInput.Type;

export const DeviceBootResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("booted"), device: DeviceDescriptor }),
  Schema.Struct({
    kind: Schema.Literal("boot-limit-reached"),
    limit: NonNegativeInt,
    gladeBooted: Schema.Array(DeviceDescriptor).check(Schema.isMaxLength(64)),
  }),
]);
export type DeviceBootResult = typeof DeviceBootResult.Type;

export const DeviceShutdownInput = DeviceTargetInput;
export type DeviceShutdownInput = typeof DeviceShutdownInput.Type;

export const DeviceAttachInput = Schema.Struct({
  threadId: ThreadId,
  udid: DeviceUdid,
});
export type DeviceAttachInput = typeof DeviceAttachInput.Type;

export const DeviceDetachInput = Schema.Struct({ threadId: ThreadId });
export type DeviceDetachInput = typeof DeviceDetachInput.Type;

export const DeviceThreadInput = Schema.Struct({ threadId: ThreadId });
export type DeviceThreadInput = typeof DeviceThreadInput.Type;

const DeviceCoordinate = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 20_000 }));

// Element targeting exists because the coordinate arithmetic is where taps go wrong: the caller
// must pick the right node and then the right coordinate within it, and a control merged into its
// row has a frame centre that does nothing at all.
export const DeviceTapInput = Schema.Struct({
  udid: DeviceUdid,
  x: Schema.optional(DeviceCoordinate),
  y: Schema.optional(DeviceCoordinate),
  label: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(1_024))),
  role: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export type DeviceTapInput = typeof DeviceTapInput.Type;

export const DEVICE_SWIPE_DURATION_MIN_MS = 0;
export const DEVICE_SWIPE_DURATION_MAX_MS = 10_000;

export const DeviceSwipeInput = Schema.Struct({
  udid: DeviceUdid,
  fromX: DeviceCoordinate,
  fromY: DeviceCoordinate,
  toX: DeviceCoordinate,
  toY: DeviceCoordinate,
  durationMs: Schema.Int.check(
    Schema.isBetween({
      minimum: DEVICE_SWIPE_DURATION_MIN_MS,
      maximum: DEVICE_SWIPE_DURATION_MAX_MS,
    }),
  ),
});
export type DeviceSwipeInput = typeof DeviceSwipeInput.Type;

export const DeviceTypeTextInput = Schema.Struct({
  udid: DeviceUdid,
  text: Schema.String.check(Schema.isMaxLength(DEVICE_TEXT_MAX_LENGTH)),
});
export type DeviceTypeTextInput = typeof DeviceTypeTextInput.Type;

export const DeviceKeyModifier = Schema.Literals([
  "command",
  "shift",
  "option",
  "control",
  "function",
]);
export type DeviceKeyModifier = typeof DeviceKeyModifier.Type;

export const DeviceKeyEventInput = Schema.Struct({
  udid: DeviceUdid,
  keyCode: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65_535 })),
  modifiers: Schema.Array(DeviceKeyModifier).check(Schema.isMaxLength(5)),
  direction: Schema.Literals(["down", "up"]),
});
export type DeviceKeyEventInput = typeof DeviceKeyEventInput.Type;

export const DeviceHardwareButton = Schema.Literals([
  "home",
  "lock",
  "volume-up",
  "volume-down",
  "rotate",
]);
export type DeviceHardwareButton = typeof DeviceHardwareButton.Type;

export const DevicePressButtonInput = Schema.Struct({
  udid: DeviceUdid,
  button: DeviceHardwareButton,
});
export type DevicePressButtonInput = typeof DevicePressButtonInput.Type;

export const DeviceBundleId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
export type DeviceBundleId = typeof DeviceBundleId.Type;

export const DeviceInstallAppInput = Schema.Struct({
  udid: DeviceUdid,
  // Absolute path to a built `.app` bundle; Glade never runs the build itself.
  appPath: TrimmedNonEmptyString.check(Schema.isMaxLength(DEVICE_PATH_MAX_LENGTH)),
});
export type DeviceInstallAppInput = typeof DeviceInstallAppInput.Type;

export const DeviceInstallAppResult = Schema.Struct({
  udid: DeviceUdid,
  bundleId: DeviceBundleId,
});
export type DeviceInstallAppResult = typeof DeviceInstallAppResult.Type;

export const DeviceLaunchAppInput = Schema.Struct({
  udid: DeviceUdid,
  bundleId: DeviceBundleId,
  arguments: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(1_024))).check(Schema.isMaxLength(64)),
  ),
});
export type DeviceLaunchAppInput = typeof DeviceLaunchAppInput.Type;

export const DeviceLaunchAppResult = Schema.Struct({
  udid: DeviceUdid,
  bundleId: DeviceBundleId,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type DeviceLaunchAppResult = typeof DeviceLaunchAppResult.Type;

export const DeviceOpenUrlInput = Schema.Struct({
  udid: DeviceUdid,
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(DEVICE_URL_MAX_LENGTH)),
});
export type DeviceOpenUrlInput = typeof DeviceOpenUrlInput.Type;

export const DeviceScreenshotInput = Schema.Struct({
  udid: DeviceUdid,

  save: Schema.optional(Schema.Boolean),
});
export type DeviceScreenshotInput = typeof DeviceScreenshotInput.Type;

const DevicePixelDimension = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16_384 }));

export const DeviceScreenshotResult = Schema.Struct({
  udid: DeviceUdid,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  mimeType: Schema.Literal("image/png"),
  width: DevicePixelDimension,
  height: DevicePixelDimension,
  sizeBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 * 1024 * 1024 })),
  bytesBase64: TrimmedNonEmptyString.check(Schema.isMaxLength(44 * 1024 * 1024)),
  capturedAt: IsoDateTime,

  path: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(DEVICE_PATH_MAX_LENGTH))),
});
export type DeviceScreenshotResult = typeof DeviceScreenshotResult.Type;

export const DeviceStartRecordingInput = DeviceTargetInput;
export type DeviceStartRecordingInput = typeof DeviceStartRecordingInput.Type;

export const DeviceStartRecordingResult = Schema.Struct({
  udid: DeviceUdid,

  path: TrimmedNonEmptyString.check(Schema.isMaxLength(DEVICE_PATH_MAX_LENGTH)),

  startedAt: IsoDateTime,
});
export type DeviceStartRecordingResult = typeof DeviceStartRecordingResult.Type;

export const DeviceStopRecordingInput = DeviceTargetInput;
export type DeviceStopRecordingInput = typeof DeviceStopRecordingInput.Type;

export const DeviceStopRecordingResult = Schema.Struct({
  udid: DeviceUdid,
  // Repeated because stopping can finish after the pane that started the recording is gone.
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(DEVICE_PATH_MAX_LENGTH)),

  sizeBytes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),

  durationMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),

  stoppedAt: IsoDateTime,
});
export type DeviceStopRecordingResult = typeof DeviceStopRecordingResult.Type;

export const DeviceDescribeUiInput = DeviceTargetInput;
export type DeviceDescribeUiInput = typeof DeviceDescribeUiInput.Type;

export const DeviceUiFrame = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  height: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type DeviceUiFrame = typeof DeviceUiFrame.Type;

export const DeviceUiPoint = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
});
export type DeviceUiPoint = typeof DeviceUiPoint.Type;

export interface DeviceUiNode {
  readonly role: string;

  readonly subrole: string | null;
  readonly label: string | null;
  readonly value: string | null;
  readonly frame: DeviceUiFrame;

  readonly activationPoint: DeviceUiPoint | null;
  readonly children: readonly DeviceUiNode[];
}

export const DeviceUiNode: Schema.Codec<DeviceUiNode> = Schema.Struct({
  role: Schema.String.check(Schema.isMaxLength(128)),
  subrole: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  label: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_024))),
  value: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_024))),
  frame: DeviceUiFrame,
  activationPoint: Schema.NullOr(DeviceUiPoint),
  children: Schema.Array(Schema.suspend((): Schema.Codec<DeviceUiNode> => DeviceUiNode)).check(
    Schema.isMaxLength(512),
  ),
});

export const DeviceDescribeUiResult = Schema.Struct({
  udid: DeviceUdid,
  capturedAt: IsoDateTime,
  root: DeviceUiNode,
});
export type DeviceDescribeUiResult = typeof DeviceDescribeUiResult.Type;

export const DEVICE_SCROLL_MIN_SWIPES = 1;
export const DEVICE_SCROLL_MAX_SWIPES = 32;

export const DeviceScrollToElementInput = Schema.Struct({
  udid: DeviceUdid,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(1_024)),
  role: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  maxSwipes: Schema.optional(
    Schema.Int.check(
      Schema.isBetween({ minimum: DEVICE_SCROLL_MIN_SWIPES, maximum: DEVICE_SCROLL_MAX_SWIPES }),
    ),
  ),
});
export type DeviceScrollToElementInput = typeof DeviceScrollToElementInput.Type;

export const DeviceScrollToElementResult = Schema.Struct({
  udid: DeviceUdid,

  element: DeviceUiNode,
  tapPoint: DeviceUiPoint,
});
export type DeviceScrollToElementResult = typeof DeviceScrollToElementResult.Type;

export const DeviceOpenPaneReason = Schema.Literals([
  "agent-install",
  "agent-launch",
  "agent-tool",
]);
export type DeviceOpenPaneReason = typeof DeviceOpenPaneReason.Type;

export const DeviceThreadStateEvent = Schema.Struct({
  type: Schema.Literal("device.thread-state"),
  state: ThreadDeviceState,
});
export type DeviceThreadStateEvent = typeof DeviceThreadStateEvent.Type;

export const DeviceOpenPaneRequestedEvent = Schema.Struct({
  type: Schema.Literal("device.open-pane-requested"),
  threadId: ThreadId,
  udid: DeviceUdid,
  reason: DeviceOpenPaneReason,
});
export type DeviceOpenPaneRequestedEvent = typeof DeviceOpenPaneRequestedEvent.Type;

export const DeviceEvent = Schema.Union([DeviceThreadStateEvent, DeviceOpenPaneRequestedEvent]);
export type DeviceEvent = typeof DeviceEvent.Type;

// Encoded video frames ride the existing WebSocket as binary messages prefixed with this header, so
// a frame can be routed to the right pane without parsing the bitstream.
export const DEVICE_FRAME_MAGIC = 0x5346;
export const DEVICE_FRAME_VERSION = 1;
export const DEVICE_FRAME_FLAG_KEYFRAME = 0b0000_0001;
export const DEVICE_FRAME_FLAG_CODEC_CONFIG = 0b0000_0010;

export const DEVICE_FRAME_HEADER_FIXED_BYTES = 17;
export const DEVICE_FRAME_MAX_DEVICE_ID_BYTES = 255;

export const DeviceFrameHeader = Schema.Struct({
  deviceId: DeviceUdid,
  sequence: NonNegativeInt,
  timestampMs: Schema.Finite,
  keyframe: Schema.Boolean,
  codecConfig: Schema.Boolean,
});
export type DeviceFrameHeader = typeof DeviceFrameHeader.Type;

export const DeviceFrameDecodeErrorReason = Schema.Literals([
  "too-short",
  "bad-magic",
  "unsupported-version",
  "truncated-device-id",
  "invalid-device-id",
]);
export type DeviceFrameDecodeErrorReason = typeof DeviceFrameDecodeErrorReason.Type;
