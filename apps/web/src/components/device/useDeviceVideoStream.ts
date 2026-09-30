import type { DeviceUdid } from "@glade/contracts/device/device";
import type { DeviceFrame } from "@glade/shared/deviceFrame";
import { useEffect, useRef, useState } from "react";

import {
  createDeviceFrameGateState,
  stepDeviceFrameGate,
  type DeviceFrameGateState,
} from "../DevicePanel.logic";
import {
  createDeviceFrameSource,
  type DeviceFrameSource,
  type DeviceFrameSourceResetReason,
} from "~/lib/deviceFrameSource";

const FRAME_RECONNECT_MAX_DELAY_MS = 5_000;

export interface DeviceVideoDimensions {
  readonly width: number;
  readonly height: number;
}

export type DeviceVideoStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "connecting" }
  | { readonly kind: "streaming" }
  | { readonly kind: "error"; readonly message: string };

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function avcCodecStringFromConfig(payload: Uint8Array): string | null {
  for (let offset = 0; offset + 4 < payload.byteLength; offset += 1) {
    const isLongStart =
      payload[offset] === 0 &&
      payload[offset + 1] === 0 &&
      payload[offset + 2] === 0 &&
      payload[offset + 3] === 1;
    const isShortStart =
      payload[offset] === 0 && payload[offset + 1] === 0 && payload[offset + 2] === 1;
    if (!isLongStart && !isShortStart) continue;

    const nalOffset = offset + (isLongStart ? 4 : 3);
    const nalHeader = payload[nalOffset];
    if (nalHeader === undefined) continue;

    if ((nalHeader & 0x1f) !== 7) continue;

    const profile = payload[nalOffset + 1];
    const constraints = payload[nalOffset + 2];
    const level = payload[nalOffset + 3];
    if (profile === undefined || constraints === undefined || level === undefined) return null;
    return `avc1.${hexByte(profile)}${hexByte(constraints)}${hexByte(level)}`;
  }
  return null;
}

function isWebCodecsAvailable(): boolean {
  return (
    typeof globalThis.VideoDecoder === "function" &&
    typeof globalThis.EncodedVideoChunk === "function"
  );
}

export function useDeviceVideoStream(input: {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;

  readonly udid: DeviceUdid | null;
  readonly enabled: boolean;
}): { readonly status: DeviceVideoStatus; readonly dimensions: DeviceVideoDimensions | null } {
  const { canvasRef, udid, enabled } = input;
  const [status, setStatus] = useState<DeviceVideoStatus>({ kind: "idle" });
  const [dimensions, setDimensions] = useState<DeviceVideoDimensions | null>(null);

  // Generation guards every async callback: a decoder output or socket message from a torn-down
  // stream must not paint over the current one.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!enabled || udid === null) {
      setStatus({ kind: "idle" });
      setDimensions(null);
      return;
    }
    if (!isWebCodecsAvailable()) {
      setStatus({ kind: "unsupported" });
      return;
    }

    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;

    let gate: DeviceFrameGateState = createDeviceFrameGateState();
    let decoder: VideoDecoder | null = null;
    let source: DeviceFrameSource | null = null;
    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const openFrameSource = () =>
      createDeviceFrameSource({
        udid,
        handlers: { onFrame: handleFrame, onReset: handleReset },
      });

    let pendingParameterSets: Uint8Array | null = null;

    setStatus({ kind: "connecting" });

    const paint = (videoFrame: VideoFrame) => {
      try {
        const canvas = canvasRef.current;
        if (!canvas || !isCurrent()) return;
        const width = videoFrame.displayWidth;
        const height = videoFrame.displayHeight;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          setDimensions({ width, height });
        }
        const context = canvas.getContext("2d");
        context?.drawImage(videoFrame, 0, 0);
        setStatus((previous) => (previous.kind === "streaming" ? previous : { kind: "streaming" }));
      } finally {
        videoFrame.close();
      }
    };

    const teardownDecoder = () => {
      pendingParameterSets = null;
      if (!decoder) return;
      const current = decoder;
      decoder = null;
      try {
        if (current.state !== "closed") current.close();
      } catch {}
    };

    const failStream = (message: string) => {
      if (!isCurrent() || disposed) return;
      teardownDecoder();
      gate = createDeviceFrameGateState();
      setStatus({ kind: "error", message });
    };

    const configureDecoder = (frame: DeviceFrame) => {
      const codec = avcCodecStringFromConfig(frame.payload);
      if (!codec) {
        failStream("The simulator stream sent parameters Glade could not read.");
        return;
      }
      teardownDecoder();
      const next = new VideoDecoder({
        output: (videoFrame) => {
          if (!isCurrent() || disposed) {
            videoFrame.close();
            return;
          }
          paint(videoFrame);
        },
        error: (error) => {
          failStream(error instanceof Error ? error.message : "The video decoder failed.");
          source?.requestResync();
        },
      });
      try {
        next.configure({ codec, optimizeForLatency: true });
      } catch (error) {
        failStream(
          error instanceof Error ? error.message : "The video decoder could not be configured.",
        );
        return;
      }
      decoder = next;

      pendingParameterSets = frame.payload.slice();
    };

    const submit = (frame: DeviceFrame, keyframe: boolean) => {
      if (!decoder || decoder.state !== "configured") return;
      let data = frame.payload;
      if (keyframe && pendingParameterSets) {
        const combined = new Uint8Array(pendingParameterSets.byteLength + data.byteLength);
        combined.set(pendingParameterSets, 0);
        combined.set(data, pendingParameterSets.byteLength);
        data = combined;
        pendingParameterSets = null;
      }
      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: keyframe ? "key" : "delta",
            timestamp: Math.round(frame.header.timestampMs * 1000),
            data,
          }),
        );
      } catch (error) {
        failStream(error instanceof Error ? error.message : "A video frame could not be decoded.");
        source?.requestResync();
      }
    };

    const handleFrame = (frame: DeviceFrame) => {
      reconnectAttempts = 0;
      if (!isCurrent() || disposed) return;
      const step = stepDeviceFrameGate(gate, frame.header, udid);
      gate = step.state;
      if (step.requestKeyframe) source?.requestResync();

      switch (step.action.kind) {
        case "configure":
          configureDecoder(frame);
          return;
        case "decode":
          submit(frame, step.action.keyframe);
          return;
        default:
          return;
      }
    };

    const handleReset = (reason: DeviceFrameSourceResetReason) => {
      if (!isCurrent() || disposed) return;
      teardownDecoder();
      gate = createDeviceFrameGateState();
      if (reason === "closed") {
        setStatus({ kind: "connecting" });

        reconnectAttempts += 1;
        const delay = Math.min(500 * 2 ** (reconnectAttempts - 1), FRAME_RECONNECT_MAX_DELAY_MS);
        reconnectTimer = setTimeout(() => {
          if (disposed || !isCurrent()) return;
          source?.close();
          source = openFrameSource();
        }, delay);
        return;
      }
      setStatus({
        kind: "error",
        message:
          reason === "decode-failed"
            ? "The simulator stream sent a frame Glade could not read."
            : "The simulator stream disconnected.",
      });
    };

    source = openFrameSource();

    return () => {
      disposed = true;
      generationRef.current += 1;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      source?.close();
      teardownDecoder();
    };
  }, [canvasRef, udid, enabled]);

  return { status, dimensions };
}
