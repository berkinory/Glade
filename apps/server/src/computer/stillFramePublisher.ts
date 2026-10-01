import type { ComputerFrameListener, ComputerStreamFrame } from "./ComputerBackend.ts";
import { createHash } from "node:crypto";

// One, because the point of a retry here is to ride out a single transient capture failure;
// anything past that is a broken capture path, and the timer will ask again in a moment anyway.
const MAX_FORCE_RETRIES = 1;

const DEFAULT_STILL_INTERVAL_MS = 500;

const MIN_STILL_INTERVAL_MS = 100;

export function resolveStillIntervalMs(intervalMs: number | undefined): number {
  return Math.max(MIN_STILL_INTERVAL_MS, intervalMs ?? DEFAULT_STILL_INTERVAL_MS);
}

function frameDigest(bytes: Uint8Array): string {
  return `${bytes.byteLength}:${createHash("sha1").update(bytes).digest("hex")}`;
}

class StillFrameDedupe {
  #publishedDigest: string | undefined;
  #pendingForce = false;

  deferForce(): void {
    this.#pendingForce = true;
  }

  takeForce(explicit: boolean): boolean {
    const force = explicit || this.#pendingForce;
    this.#pendingForce = false;
    return force;
  }

  get forcePending(): boolean {
    return this.#pendingForce;
  }

  shouldPublish(bytes: Uint8Array, force: boolean): boolean {
    const digest = frameDigest(bytes);
    if (!force && digest === this.#publishedDigest) return false;
    this.#publishedDigest = digest;
    return true;
  }

  // Called whenever the receiver changes or goes away: a re-attached pane has seen nothing, so the
  // memory of what the last one saw must not suppress its first frame.
  reset(): void {
    this.#publishedDigest = undefined;
    this.#pendingForce = false;
  }
}

export interface StillFramePublisherOptions {
  readonly capture: (force: boolean) => Promise<Uint8Array | undefined>;
  // Checked before every publish so a backend whose capture grant is missing never spends a round
  // trip discovering that twice a second.
  readonly isCaptureAvailable: () => boolean;

  readonly prepare?: () => Promise<void>;

  readonly emit: (frame: ComputerStreamFrame) => void;
  readonly now: () => number;
  readonly intervalMs: number;
}

export class StillFramePublisher {
  private readonly options: StillFramePublisherOptions;

  private readonly dedupe = new StillFrameDedupe();

  private listener: ComputerFrameListener | undefined;
  private attachmentGeneration = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private nextSequence = 1;
  private forceRetries = 0;

  constructor(options: StillFramePublisherOptions) {
    this.options = options;
  }

  async attach(listener: ComputerFrameListener): Promise<void> {
    const generation = ++this.attachmentGeneration;
    this.listener = undefined;
    this.clearTimer();
    this.dedupe.reset();
    await this.options.prepare?.();

    if (this.attachmentGeneration !== generation) return;
    this.listener = listener;
    await this.publish({ force: true });
    if (this.attachmentGeneration !== generation) return;
    this.timer = setInterval(() => {
      void this.publish();
    }, this.options.intervalMs);
    this.timer.unref?.();
  }

  async detach(): Promise<void> {
    this.attachmentGeneration += 1;
    this.listener = undefined;
    this.clearTimer();
    this.dedupe.reset();
  }

  async requestKeyframe(): Promise<void> {
    if (!this.listener) return;
    // A keyframe is asked for because the receiver has nothing to draw, so it publishes even when the
    // target is byte-identical to the last frame.
    await this.publish({ force: true });
  }

  async publish(options: { readonly force?: boolean } = {}): Promise<void> {
    const listener = this.listener;
    const generation = this.attachmentGeneration;
    if (!listener || !this.options.isCaptureAvailable()) return;
    if (this.inFlight) {
      // The in-flight capture then deduped against the digest it had just published and sent nothing, so
      // the receiver that asked precisely because it had no picture stayed blank until the target
      // happened to change.
      if (options.force) {
        this.forceRetries = 0;
        this.dedupe.deferForce();
      }
      return;
    }
    this.inFlight = true;

    if (options.force === true) this.forceRetries = 0;
    const force = this.dedupe.takeForce(options.force === true);
    try {
      const bytes = await this.options.capture(force);
      if (bytes === undefined) return;
      if (this.attachmentGeneration !== generation) return;

      if (!this.dedupe.shouldPublish(bytes, force)) return;
      this.forceRetries = 0;
      const frame: ComputerStreamFrame = {
        sequence: this.nextSequence++,
        timestampMs: this.options.now(),

        keyframe: true,
        codecConfig: false,
        data: bytes,
      };
      listener(frame);
      this.options.emit(frame);
    } catch {
      // A transient capture failure must not tear down a subscribed stream, and a bounded number of
      // retries must not become an unbounded one: past the budget the force is dropped and the timer
      // cadence takes over.
      if (
        this.attachmentGeneration === generation &&
        force &&
        this.forceRetries < MAX_FORCE_RETRIES
      ) {
        this.forceRetries += 1;
        this.dedupe.deferForce();
      }
    } finally {
      this.inFlight = false;

      if (this.dedupe.forcePending && this.listener) {
        void this.publish();
      }
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
