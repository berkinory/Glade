// Model coordinates refer to delivered screenshot pixels, not desktop points. Keep frame geometry
// per thread so concurrent agents cannot resolve coordinates against another thread's view.
import { createHash } from "node:crypto";

import type {
  ComputerPoint,
  ComputerRect,
  ComputerScreenshot,
} from "@glade/contracts/computer/computer";

import { ComputerTargetError } from "./uiTreeTargeting.ts";

export interface ScreenshotFrame {
  readonly id: string;

  readonly width: number;
  readonly height: number;

  readonly region: ComputerRect;

  readonly scale: number;

  readonly windowId?: string;
}

export type ScreenshotFrameSource = Pick<
  ComputerScreenshot,
  "width" | "height" | "region" | "scale"
> & { readonly bytesBase64?: string };

const SCREENSHOT_FRAMES_PER_THREAD = 8;

const SCREENSHOT_FRAME_THREADS = 256;

export class ScreenshotFrameRegistry {
  private readonly threads = new Map<string, ScreenshotFrame[]>();
  private readonly hashes = new WeakMap<ScreenshotFrame, string>();
  private sequence = 0;
  private readonly sourceHashes = new WeakMap<ScreenshotFrameSource, string>();

  private imageHash(screenshot: ScreenshotFrameSource): string {
    let hash = this.sourceHashes.get(screenshot);
    if (hash === undefined) {
      hash = createHash("sha256")
        .update(screenshot.bytesBase64 ?? "")
        .digest("hex");
      this.sourceHashes.set(screenshot, hash);
    }
    return hash;
  }

  record(
    threadId: string,
    screenshot: ScreenshotFrameSource,
    windowId?: string,
  ): ScreenshotFrame | undefined {
    const region = screenshot.region;
    if (!region || region.width <= 0 || region.height <= 0) {
      this.threads.delete(threadId);
      return undefined;
    }
    const scale = screenshot.scale ?? screenshot.width / region.width;
    if (!Number.isFinite(scale) || scale <= 0) {
      this.threads.delete(threadId);
      return undefined;
    }
    this.sequence += 1;
    const frame: ScreenshotFrame = {
      id: `shot-${this.sequence}`,
      width: screenshot.width,
      height: screenshot.height,
      region: { ...region },
      scale,
      ...(windowId !== undefined ? { windowId } : {}),
    };
    if (screenshot.bytesBase64 !== undefined) {
      this.hashes.set(frame, this.imageHash(screenshot));
    }
    const frames = this.threads.get(threadId) ?? [];
    this.threads.delete(threadId);
    frames.push(frame);
    if (frames.length > SCREENSHOT_FRAMES_PER_THREAD) {
      frames.splice(0, frames.length - SCREENSHOT_FRAMES_PER_THREAD);
    }
    this.threads.set(threadId, frames);
    while (this.threads.size > SCREENSHOT_FRAME_THREADS) {
      const oldest = this.threads.keys().next().value;
      if (oldest === undefined) break;
      this.threads.delete(oldest);
    }
    return frame;
  }

  latest(threadId: string): ScreenshotFrame | undefined {
    return this.threads.get(threadId)?.at(-1);
  }

  matchLatest(
    threadId: string,
    screenshot: ComputerScreenshot,
    windowId?: string,
  ): ScreenshotFrame | undefined {
    const frame = this.latest(threadId);
    const region = screenshot.region;
    if (
      !frame ||
      !region ||
      frame.windowId !== windowId ||
      frame.width !== screenshot.width ||
      frame.height !== screenshot.height ||
      frame.scale !== (screenshot.scale ?? screenshot.width / region.width) ||
      frame.region.x !== region.x ||
      frame.region.y !== region.y ||
      frame.region.width !== region.width ||
      frame.region.height !== region.height ||
      this.hashes.get(frame) !== this.imageHash(screenshot)
    ) {
      return undefined;
    }
    return frame;
  }

  resolve(threadId: string, screenshotId?: string): ScreenshotFrame {
    const frames = this.threads.get(threadId) ?? [];
    if (screenshotId !== undefined) {
      const frame = frames.find((candidate) => candidate.id === screenshotId);
      if (frame) return frame;
      throw new ComputerTargetError({
        code: "computer_target_not_found",
        message:
          `No screenshot ${JSON.stringify(screenshotId)} is available to point into` +
          (frames.length > 0
            ? `; the screenshots still available are ${frames.map((f) => f.id).join(", ")} (newest last).`
            : ". Take a screenshot first and use its screenshotId."),
        notFound: true,
      });
    }
    const latest = frames.at(-1);
    if (latest) return latest;
    throw new ComputerTargetError({
      code: "computer_target_invalid",
      message:
        "No screenshot to point into: this conversation has not received one yet. " +
        "Take one with computer_screenshot or computer_get_state, then give x/y as pixel " +
        "coordinates in that image.",
    });
  }
}

function describeFrame(frame: ScreenshotFrame): string {
  return `the ${frame.width}x${frame.height} screenshot ${frame.id}`;
}

export function screenshotPointToDesktop(
  frame: ScreenshotFrame,
  x: number,
  y: number,
): ComputerPoint {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > frame.width ||
    y > frame.height
  ) {
    throw new ComputerTargetError({
      code: "computer_target_offscreen",
      message: `Computer target (${x}, ${y}) is outside ${describeFrame(frame)}; x/y are pixel coordinates in that image.`,
      candidates: [],
    });
  }
  return {
    x: clampToSpan(
      Math.round(frame.region.x + x / frame.scale),
      frame.region.x,
      frame.region.width,
    ),
    y: clampToSpan(
      Math.round(frame.region.y + y / frame.scale),
      frame.region.y,
      frame.region.height,
    ),
  };
}

export function screenshotRectToDesktop(frame: ScreenshotFrame, rect: ComputerRect): ComputerRect {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(frame.width, rect.x + rect.width);
  const bottom = Math.min(frame.height, rect.y + rect.height);
  if (!(right > left && bottom > top)) {
    throw new ComputerTargetError({
      code: "computer_target_offscreen",
      message: `The requested region does not overlap ${describeFrame(frame)}; x/y/width/height are pixel coordinates in that image.`,
      candidates: [],
    });
  }
  const x = Math.round(frame.region.x + left / frame.scale);
  const y = Math.round(frame.region.y + top / frame.scale);
  const farX = Math.round(frame.region.x + right / frame.scale);
  const farY = Math.round(frame.region.y + bottom / frame.scale);
  return { x, y, width: Math.max(1, farX - x), height: Math.max(1, farY - y) };
}

export function screenshotDeltaToDesktop(
  frame: ScreenshotFrame,
  deltaX: number,
  deltaY: number,
): { readonly deltaX: number; readonly deltaY: number } {
  return { deltaX: deltaX / frame.scale, deltaY: deltaY / frame.scale };
}

function clampToSpan(value: number, start: number, length: number): number {
  const end = start + Math.max(0, length - 1);
  return Math.min(end, Math.max(start, value));
}
