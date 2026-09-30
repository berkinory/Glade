import type {
  DeviceAvailability,
  DeviceGeometry,
  DeviceDescribeUiResult,
  DeviceDescriptor,
  DeviceHardwareButton,
  DeviceInstallAppResult,
  DeviceKeyModifier,
  DeviceLaunchAppResult,
  DevicePlatform,
  DeviceScreenshotResult,
  DeviceStartRecordingResult,
  DeviceStopRecordingResult,
} from "@glade/contracts/device/device";

export interface DeviceStreamFrame {
  readonly sequence: number;
  readonly timestampMs: number;
  readonly keyframe: boolean;
  readonly codecConfig: boolean;
  readonly data: Uint8Array;
}

export type DeviceFrameListener = (frame: DeviceStreamFrame) => void;

export class DeviceBackendError extends Error {
  readonly _tag = "DeviceBackendError";
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: { readonly retryable?: boolean; readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DeviceBackendError";
    this.retryable = options?.retryable ?? false;
  }
}

export interface DeviceListOptions {
  readonly includeShutdown?: boolean;
}

export interface DeviceSwipeGesture {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly durationMs: number;
}

export interface DeviceKeyEvent {
  readonly keyCode: number;
  readonly modifiers: readonly DeviceKeyModifier[];
  readonly direction: "down" | "up";
}

export interface DeviceBackend {
  readonly platform: DevicePlatform;

  availability(): Promise<DeviceAvailability>;

  listDevices(options?: DeviceListOptions): Promise<readonly DeviceDescriptor[]>;

  boot(udid: string): Promise<DeviceDescriptor>;
  shutdown(udid: string): Promise<void>;

  install(udid: string, appPath: string): Promise<DeviceInstallAppResult>;
  launch(
    udid: string,
    bundleId: string,
    launchArguments?: readonly string[],
  ): Promise<DeviceLaunchAppResult>;
  openUrl(udid: string, url: string): Promise<void>;

  tap(udid: string, x: number, y: number): Promise<void>;
  swipe(udid: string, gesture: DeviceSwipeGesture): Promise<void>;
  typeText(udid: string, text: string): Promise<void>;
  keyEvent(udid: string, event: DeviceKeyEvent): Promise<void>;
  pressButton(udid: string, button: DeviceHardwareButton): Promise<void>;

  screenshot(
    udid: string,
    options?: { readonly save?: boolean; readonly maxInlineBytes?: number },
  ): Promise<DeviceScreenshotResult>;
  startRecording(udid: string): Promise<DeviceStartRecordingResult>;
  stopRecording(udid: string): Promise<DeviceStopRecordingResult>;
  describeUi(udid: string): Promise<DeviceDescribeUiResult>;

  geometry(udid: string): DeviceGeometry | null;

  attachStream(udid: string, onFrame: DeviceFrameListener): Promise<void>;
  detachStream(udid: string): Promise<void>;

  dispose(): Promise<void>;
}
