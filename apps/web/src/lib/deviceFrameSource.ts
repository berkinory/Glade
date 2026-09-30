import {
  DEVICE_FRAME_RESYNC_MESSAGE,
  DEVICE_FRAME_WS_PATH,
  DEVICE_FRAME_WS_UDID_PARAM,
  decodeDeviceFrame,
  type DeviceFrame,
} from "@glade/shared/deviceFrame";
import type { DeviceUdid } from "@glade/contracts/device/device";

import {
  createBinaryFrameSource,
  type FrameSourceResetReason,
  type WebSocketLike,
} from "./binaryFrameSource";

interface DeviceFrameSourceHandlers {
  readonly onFrame: (frame: DeviceFrame) => void;
  readonly onReset: (reason: DeviceFrameSourceResetReason) => void;
}

export type DeviceFrameSourceResetReason = FrameSourceResetReason;

const DEVICE_FRAME_RESYNC_COOLDOWN_MS = 1_000;

export interface DeviceFrameSource {
  readonly requestResync: () => boolean;
  readonly close: () => void;
}

export interface DeviceFrameSourceOptions {
  readonly udid: DeviceUdid;
  readonly handlers: DeviceFrameSourceHandlers;
  readonly createSocket?: (url: string) => WebSocketLike;
  readonly explicitUrl?: string | null;
  readonly now?: () => number;
  readonly resyncCooldownMs?: number;
}

export function createDeviceFrameSource(options: DeviceFrameSourceOptions): DeviceFrameSource {
  return createBinaryFrameSource({
    streamId: options.udid,
    streamIdParam: DEVICE_FRAME_WS_UDID_PARAM,
    wsPath: DEVICE_FRAME_WS_PATH,
    resyncMessage: DEVICE_FRAME_RESYNC_MESSAGE,
    handlers: options.handlers,
    decode: decodeDeviceFrame,
    ...(options.createSocket !== undefined ? { createSocket: options.createSocket } : {}),
    ...(options.explicitUrl !== undefined ? { explicitUrl: options.explicitUrl } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    resyncCooldownMs: options.resyncCooldownMs ?? DEVICE_FRAME_RESYNC_COOLDOWN_MS,
  });
}
