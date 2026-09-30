import { errorMessage } from "@glade/shared/text/errorMessages";
import {
  NULL_BOOT_OWNERSHIP,
  orphanedBootUdids,
  processIsAlive,
  type BootOwnershipStore,
} from "./bootOwnership.ts";
import {
  DEVICE_GLADE_BOOT_LIMIT,
  type DeviceAttachPhase,
  type DeviceAvailability,
  type DeviceBootResult,
  type DeviceDescribeUiResult,
  type DeviceDescriptor,
  type DeviceEvent,
  type DeviceHardwareButton,
  type DeviceInstallAppResult,
  type DeviceLaunchAppResult,
  type DeviceListResult,
  type DeviceOpenPaneReason,
  type DeviceScreenshotResult,
  type DeviceStartRecordingResult,
  type DeviceStopRecordingResult,
  type DeviceUiNode,
  type ThreadDeviceState,
} from "@glade/contracts/device/device";
import { ThreadId } from "@glade/contracts/core/baseSchemas";

import {
  DeviceBackendError,
  type DeviceBackend,
  type DeviceKeyEvent,
  type DeviceSwipeGesture,
} from "./DeviceBackend.ts";
import { DeviceFrameTransport, type DeviceFrameSink } from "./deviceFrameTransport.ts";
import {
  DeviceUiTargetError,
  SCROLL_SWIPE_DURATION_MS,
  findTarget,
  planScrollStep,
  visibleLabels,
  type DeviceUiTarget,
  type DeviceUiTargetMatch,
} from "./uiTreeTargeting.ts";

const DEVICE_IDLE_SHUTDOWN_MS = 10 * 60 * 1000;

const DEVICE_ATTACH_DEADLINE_MS = 60_000;

const DEVICE_ATTACH_RETRY_MS = 750;

const DISPLAY_TIMEOUT_MESSAGE =
  "The simulator booted but never published a screen to capture. Shut it down and start it again; " +
  "if that keeps happening, the runtime may need reinstalling from Xcode's Platforms settings.";

// All of these mean "not ready yet" rather than "will never work": the display has not been
// published, the device is mid-boot, or the helper's descriptor belongs to a boot that is being
// replaced. A refusal that is not one of these (no such device, a broken capability, a helper that
// will not compile) is reported immediately, because retrying it for a minute only delays the
// truth.
function isTransientAttachFailure(error: unknown): boolean {
  if (error instanceof DeviceBackendError && error.retryable) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /framebuffer surface|display has no|is not booted|not attached|no display/iu.test(message);
}

const DEVICE_DEFAULT_MAX_SCROLLS = 8;

export type DeviceEventListener = (event: DeviceEvent) => void;

export interface DeviceManagerOptions {
  readonly backend: DeviceBackend;
  readonly transport?: DeviceFrameTransport;
  readonly idleShutdownMs?: number;
  readonly bootLimit?: number;

  readonly bootOwnership?: BootOwnershipStore;
  readonly attachDeadlineMs?: number;
  readonly attachRetryMs?: number;
  readonly setTimeout?: (handler: () => void, ms: number) => NodeJS.Timeout;
  readonly clearTimeout?: (handle: NodeJS.Timeout) => void;
  readonly now?: () => number;
}

interface ThreadAttachment {
  version: number;
  attachedDeviceUdid: string | null;
  agentActiveCount: number;
  lastError: string | null;

  attachPhase: DeviceAttachPhase | null;

  attachToken: number;

  paneSurfacedUdid: string | null;
}

export class DeviceManager {
  private readonly backend: DeviceBackend;
  private readonly transport: DeviceFrameTransport;
  private readonly idleShutdownMs: number;
  private readonly bootLimit: number;
  private readonly bootOwnership: BootOwnershipStore;
  private readonly attachDeadlineMs: number;
  private readonly attachRetryMs: number;
  private readonly schedule: (handler: () => void, ms: number) => NodeJS.Timeout;
  private readonly cancel: (handle: NodeJS.Timeout) => void;
  private readonly now: () => number;

  private readonly threads = new Map<string, ThreadAttachment>();

  private lastDiscovery: {
    readonly availability: DeviceAvailability;
    readonly devices: readonly DeviceDescriptor[];
  } | null = null;

  private readonly gladeBooted = new Set<string>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private activeStreamUdid: string | null = null;
  private desiredStreamUdid: string | null = null;

  private streamTransition: Promise<void> = Promise.resolve();
  private readonly recording = new Set<string>();
  private readonly listeners = new Set<DeviceEventListener>();
  private disposed = false;

  constructor(options: DeviceManagerOptions) {
    this.backend = options.backend;
    this.transport = options.transport ?? new DeviceFrameTransport();
    this.idleShutdownMs = options.idleShutdownMs ?? DEVICE_IDLE_SHUTDOWN_MS;
    this.bootLimit = options.bootLimit ?? DEVICE_GLADE_BOOT_LIMIT;
    this.bootOwnership = options.bootOwnership ?? NULL_BOOT_OWNERSHIP;
    this.attachDeadlineMs = options.attachDeadlineMs ?? DEVICE_ATTACH_DEADLINE_MS;
    this.attachRetryMs = options.attachRetryMs ?? DEVICE_ATTACH_RETRY_MS;
    this.schedule = options.setTimeout ?? ((handler, ms) => setTimeout(handler, ms));
    this.cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle));
    this.now = options.now ?? Date.now;
  }

  private async recordBootOwnership(): Promise<void> {
    await this.bootOwnership.write([...this.gladeBooted]).catch(() => undefined);
  }

  // Shut down simulators a previous run booted and never got to clean up. Called once at startup. A
  // clean quit leaves an empty record, so this is a no-op; a crash leaves udids behind, and without
  // this they would linger forever, because the next run sees them as user-booted and therefore
  // outside the cap, the idle sweep and the quit-time shutdown alike. Returns the udids it shut down
  // so the caller can log them: silently killing a simulator the user can see would be its own
  // surprise.
  async reclaimOrphanedBoots(
    isProcessAlive: (pid: number) => boolean = processIsAlive,
  ): Promise<readonly string[]> {
    const recorded = await this.bootOwnership.read().catch(() => null);
    if (recorded === null || recorded.udids.length === 0) return [];

    const devices = await this.backend.listDevices({ includeShutdown: false }).catch(() => []);
    const orphans = orphanedBootUdids(
      recorded,
      devices.map((device) => device.udid),
      isProcessAlive,
    );
    for (const udid of orphans) {
      await this.backend.shutdown(udid).catch(() => undefined);
    }

    if (!isProcessAlive(recorded.pid)) await this.bootOwnership.clear().catch(() => undefined);
    return orphans;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = this.schedule(() => resolve(), ms);
      timer.unref?.();
    });
  }

  onEvent(listener: DeviceEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async availability(): Promise<DeviceAvailability> {
    return await this.backend.availability();
  }

  async list(options: { readonly includeShutdown?: boolean } = {}): Promise<DeviceListResult> {
    const availability = await this.backend.availability();
    const devices = await this.discover(availability, options);
    return { devices, availability };
  }

  // Discovery is gated only on the platform, never on full availability. Requiring `available` here
  // deadlocked a fresh machine: the picker stayed empty because the helper was unbuilt, and the
  // helper stayed unbuilt because attaching needs a udid from the picker.
  private async discover(
    availability: DeviceAvailability,
    options: { readonly includeShutdown?: boolean } = {},
  ): Promise<readonly DeviceDescriptor[]> {
    if (availability.kind === "unsupported-platform") return [];

    const devices = await this.backend.listDevices(options).catch(() => []);
    return devices.map((device) => this.describe(device));
  }

  async getThreadState(threadId: string): Promise<ThreadDeviceState> {
    return await this.snapshot(threadId);
  }

  async gladeBootedDevices(): Promise<readonly DeviceDescriptor[]> {
    const devices = await this.backend.listDevices({ includeShutdown: true }).catch(() => []);
    this.reconcileGladeBooted(devices);
    return devices
      .filter((device) => this.gladeBooted.has(device.udid))
      .map((device) => this.describe(device));
  }

  // External shutdowns bypass Glade bookkeeping. Reconcile the boot cap from the current device
  // listing so phantom devices cannot consume slots.
  private reconcileGladeBooted(devices: readonly DeviceDescriptor[]): void {
    const running = new Set(
      devices
        .filter((device) => device.state === "booted" || device.state === "booting")
        .map((device) => device.udid),
    );
    for (const udid of this.gladeBooted) {
      if (running.has(udid)) continue;
      this.gladeBooted.delete(udid);
      this.clearIdleTimer(udid);
    }
  }

  async boot(udid: string): Promise<DeviceBootResult> {
    const devices = await this.backend.listDevices({ includeShutdown: true }).catch(() => []);

    this.reconcileGladeBooted(devices);
    const known = devices.find((device) => device.udid === udid) ?? null;

    if (known?.state === "booted") {
      return { kind: "booted", device: this.describe(known) };
    }
    if (this.gladeBooted.size >= this.bootLimit) {
      return {
        kind: "boot-limit-reached",
        limit: this.bootLimit,
        gladeBooted: await this.gladeBootedDevices(),
      };
    }

    this.gladeBooted.add(udid);
    let device: DeviceDescriptor;
    try {
      device = await this.backend.boot(udid);
    } catch (cause) {
      this.gladeBooted.delete(udid);
      throw cause;
    }

    await this.recordBootOwnership();

    this.clearIdleTimer(udid);
    await this.publishAllThreads();
    return { kind: "booted", device: { ...device, bootSource: "glade" } };
  }

  async shutdown(udid: string): Promise<void> {
    await this.stopRecordingIfActive(udid).catch(() => undefined);
    await this.stopStream(udid);
    await this.backend.shutdown(udid);
    this.gladeBooted.delete(udid);
    await this.recordBootOwnership();
    this.clearIdleTimer(udid);

    for (const [threadId, attachment] of this.threads) {
      if (attachment.attachedDeviceUdid !== udid) continue;
      attachment.attachedDeviceUdid = null;
      attachment.attachPhase = null;
      // Stops a retry loop still waiting on this device's display: it is not coming, and the loop would
      // otherwise time out into a misleading error.
      attachment.attachToken += 1;
      await this.publish(threadId);
    }
    await this.publishAllThreads();
  }

  async attach(threadId: string, udid: string): Promise<ThreadDeviceState> {
    const attachment = this.threadState(threadId);
    const previous = attachment.attachedDeviceUdid;

    attachment.attachedDeviceUdid = udid;
    attachment.lastError = null;
    attachment.attachPhase = "connecting";
    const token = (attachment.attachToken += 1);
    if (previous !== null && previous !== udid) await this.releaseDevice(previous, "switched");
    this.clearIdleTimer(udid);

    if (this.activeStreamUdid === udid || this.desiredStreamUdid === udid) {
      attachment.attachPhase = null;
      return await this.publish(threadId);
    }

    const state = await this.publish(threadId);
    void this.bringStreamUp(threadId, udid, token);
    return state;
  }

  private async bringStreamUp(threadId: string, udid: string, token: number): Promise<void> {
    const deadline = this.now() + this.attachDeadlineMs;
    let sawTransientFailure = false;

    while (!this.disposed) {
      const attachment = this.threads.get(threadId);

      if (!attachment || attachment.attachToken !== token) return;

      try {
        const started = await this.startStream(udid);
        if (!started) return;
        if (attachment.attachPhase === null && attachment.lastError === null) return;
        attachment.attachPhase = null;
        attachment.lastError = null;
        await this.publish(threadId);
        return;
      } catch (error) {
        if (!isTransientAttachFailure(error)) {
          attachment.attachPhase = null;
          attachment.lastError = errorMessage(error);
          await this.publish(threadId);
          return;
        }

        const phase: DeviceAttachPhase = /is not booted/iu.test(errorMessage(error))
          ? "booting"
          : "waiting-for-display";
        if (attachment.attachPhase !== phase) {
          attachment.attachPhase = phase;
          await this.publish(threadId);
        }
        sawTransientFailure = true;
      }

      if (this.now() >= deadline) break;
      await this.delay(this.attachRetryMs);
    }

    const attachment = this.threads.get(threadId);
    if (!attachment || attachment.attachToken !== token) return;
    attachment.attachPhase = null;

    if (sawTransientFailure && !this.disposed) attachment.lastError = DISPLAY_TIMEOUT_MESSAGE;
    await this.publish(threadId);
  }

  // Auto-opening the pane is only useful if there is something to watch: before this, an agent's
  // launch opened a pane still asking the user to pick a simulator, so they stared at a black phone
  // while the agent worked. Never steals: a thread already attached to a different device keeps it,
  // because that attachment reflects a deliberate choice by the user and the agent's device is still
  // reachable through the picker. Idempotent, so repeated launches on the same device cost nothing.
  async ensureThreadAttached(threadId: string, udid: string): Promise<void> {
    const attached = this.threadState(threadId).attachedDeviceUdid;
    if (attached === udid) return;
    if (attached !== null) return;
    await this.attach(threadId, udid);
  }

  async detach(threadId: string): Promise<ThreadDeviceState> {
    const attachment = this.threadState(threadId);
    const udid = attachment.attachedDeviceUdid;
    attachment.attachedDeviceUdid = null;
    attachment.attachPhase = null;
    // Abandons any attach still retrying in the background, so it cannot resurrect a phase or an error
    // on a thread that is no longer watching.
    attachment.attachToken += 1;
    if (udid !== null) await this.releaseDevice(udid);
    return await this.publish(threadId);
  }

  async handleThreadRemoved(threadId: string): Promise<void> {
    if (!this.threads.has(threadId)) return;
    await this.detach(threadId);
    this.threads.delete(threadId);
  }

  subscribeFrames(udid: string, sink: DeviceFrameSink): () => void {
    const unsubscribe = this.transport.subscribe(udid, sink);
    void this.startStream(udid).catch(() => undefined);
    return () => {
      unsubscribe();

      if (this.transport.deviceSubscriberCount(udid) === 0) {
        void this.stopStream(udid).catch(() => undefined);
      }
    };
  }

  async tap(udid: string, x: number, y: number): Promise<void> {
    await this.backend.tap(udid, x, y);
  }

  async tapElement(
    udid: string,
    target: DeviceUiTarget,
    options: { readonly maxScrolls?: number | undefined } = {},
  ): Promise<DeviceUiTargetMatch> {
    const match = await this.scrollToElement(udid, target, options);
    await this.backend.tap(udid, match.point.x, match.point.y);
    return match;
  }

  // The swipe-describe-check loop lives here rather than in the agent because it is motor control,
  // not judgement: an agent driving it by hand guesses distances, overshoots, and re-describes
  // between every attempt. Long lists are virtualized, so UIKit only materializes the rows near the
  // viewport: Settings genuinely has no "Developer" node until scrolling gets close to it.
  async scrollToElement(
    udid: string,
    target: DeviceUiTarget,
    options: { readonly maxScrolls?: number | undefined } = {},
  ): Promise<DeviceUiTargetMatch> {
    const maxScrolls = options.maxScrolls ?? DEVICE_DEFAULT_MAX_SCROLLS;
    let tree = await this.describeUi(udid);
    let match = this.locate(tree.root, target);
    let previousPosition: string | null = null;

    for (let scrolls = 0; scrolls < maxScrolls; scrolls += 1) {
      const step =
        match === null ? this.pageDownStep(tree.root) : planScrollStep(match.node, tree.root);
      if (step === null) return match as DeviceUiTargetMatch;

      await this.backend.swipe(udid, step);
      tree = await this.describeUi(udid);
      match = this.locate(tree.root, target);

      const position = match === null ? this.treeFingerprint(tree.root) : `y:${match.node.frame.y}`;
      if (previousPosition !== null && position === previousPosition) {
        throw new DeviceUiTargetError(
          match === null
            ? `No element labelled ${JSON.stringify(target.label)} appeared after scrolling to the end of the screen.`
            : `Scrolling stopped moving ${JSON.stringify(target.label)} after ${scrolls + 1} ` +
                `swipe${scrolls === 0 ? "" : "s"}; the list appears to be at its end and the element is still out of reach.`,
          match === null ? visibleLabels(tree.root) : [],
          match === null,
        );
      }
      previousPosition = position;
    }

    if (match !== null && planScrollStep(match.node, tree.root) === null) return match;
    throw new DeviceUiTargetError(
      `Could not bring ${JSON.stringify(target.label)} into view within ${maxScrolls} swipes. ` +
        `Raise maxSwipes, or scroll manually with device_swipe if it sits in a nested scroll area.`,
      match === null ? visibleLabels(tree.root) : [],
      match === null,
    );
  }

  private locate(root: DeviceUiNode, target: DeviceUiTarget): DeviceUiTargetMatch | null {
    try {
      return findTarget(root, target);
    } catch (error) {
      if (error instanceof DeviceUiTargetError && error.notFound) return null;
      throw error;
    }
  }

  private pageDownStep(root: DeviceUiNode): DeviceSwipeGesture {
    const midX = root.frame.x + root.frame.width / 2;
    const centre = root.frame.y + root.frame.height / 2;
    const distance = root.frame.height * 0.6;
    return {
      fromX: midX,
      fromY: centre + distance / 2,
      toX: midX,
      toY: centre - distance / 2,
      durationMs: SCROLL_SWIPE_DURATION_MS,
    };
  }

  private treeFingerprint(root: DeviceUiNode): string {
    return visibleLabels(root).join("|");
  }

  async swipe(udid: string, gesture: DeviceSwipeGesture): Promise<void> {
    await this.backend.swipe(udid, gesture);
  }

  async typeText(udid: string, text: string): Promise<void> {
    await this.backend.typeText(udid, text);
  }

  async keyEvent(udid: string, event: DeviceKeyEvent): Promise<void> {
    await this.backend.keyEvent(udid, event);
  }

  async pressButton(udid: string, button: DeviceHardwareButton): Promise<void> {
    await this.backend.pressButton(udid, button);
  }

  async install(udid: string, appPath: string): Promise<DeviceInstallAppResult> {
    return await this.backend.install(udid, appPath);
  }

  async launch(
    udid: string,
    bundleId: string,
    launchArguments?: readonly string[],
  ): Promise<DeviceLaunchAppResult> {
    return await this.backend.launch(udid, bundleId, launchArguments);
  }

  async openUrl(udid: string, url: string): Promise<void> {
    await this.backend.openUrl(udid, url);
  }

  async screenshot(
    udid: string,
    options: { readonly save?: boolean; readonly maxInlineBytes?: number } = {},
  ): Promise<DeviceScreenshotResult> {
    return await this.backend.screenshot(udid, options);
  }

  async startRecording(udid: string): Promise<DeviceStartRecordingResult> {
    const alreadyTracked = this.recording.has(udid);
    this.recording.add(udid);
    try {
      return await this.backend.startRecording(udid);
    } catch (error) {
      if (!alreadyTracked) this.recording.delete(udid);
      throw error;
    }
  }

  async stopRecording(udid: string): Promise<DeviceStopRecordingResult> {
    const result = await this.backend.stopRecording(udid);
    this.recording.delete(udid);
    return result;
  }

  async describeUi(udid: string): Promise<DeviceDescribeUiResult> {
    return await this.backend.describeUi(udid);
  }

  async withAgentActivity<A>(threadId: string, action: () => Promise<A>): Promise<A> {
    const attachment = this.threadState(threadId);
    attachment.agentActiveCount += 1;

    if (attachment.agentActiveCount === 1) await this.publish(threadId, { reuseDiscovery: true });
    try {
      return await action();
    } finally {
      attachment.agentActiveCount = Math.max(0, attachment.agentActiveCount - 1);
      if (attachment.agentActiveCount === 0) await this.publish(threadId, { reuseDiscovery: true });
    }
  }

  requestOpenPane(threadId: string, udid: string, reason: DeviceOpenPaneReason): void {
    this.threadState(threadId).paneSurfacedUdid = udid;
    this.emit({
      type: "device.open-pane-requested",
      threadId: ThreadId.makeUnsafe(threadId),
      udid,
      reason,
    });
  }

  // Put the agent's device in front of the user: attach the thread to it so the pane has something to
  // stream, then ask the pane to open. An agent working on an app that is already running never
  // installs or launches anything, so gating on those left the user watching a blank right side for
  // the whole turn while the agent tapped through their app. Interactions arrive every few seconds,
  // so this is a no-op once the pane has been surfaced for that device on that thread: repeating the
  // request would emit an event per tap and could yank a user who navigated away back to the pane.
  async surfaceDeviceForAgent(
    threadId: string,
    udid: string,
    reason: DeviceOpenPaneReason,
  ): Promise<void> {
    if (this.threadState(threadId).paneSurfacedUdid === udid) return;
    await this.ensureThreadAttached(threadId, udid).catch(() => undefined);
    this.requestOpenPane(threadId, udid, reason);
  }

  async recordThreadError(threadId: string, message: string): Promise<void> {
    this.threadState(threadId).lastError = message;
    await this.publish(threadId, { reuseDiscovery: true });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, timer] of this.idleTimers) this.cancel(timer);
    this.idleTimers.clear();

    const recording = Array.from(this.recording);
    const booted = Array.from(this.gladeBooted);
    this.desiredStreamUdid = null;
    await this.queueStreamReconciliation().catch(() => undefined);
    for (const udid of recording) await this.stopRecordingIfActive(udid).catch(() => undefined);
    for (const udid of booted) {
      await this.backend.shutdown(udid).catch(() => undefined);
      this.gladeBooted.delete(udid);
    }
    // Nothing is ours any more, so a later start must not adopt these.
    await this.bootOwnership.clear().catch(() => undefined);
    this.listeners.clear();
    await this.backend.dispose().catch(() => undefined);
  }

  private threadState(threadId: string): ThreadAttachment {
    let attachment = this.threads.get(threadId);
    if (!attachment) {
      attachment = {
        version: 0,
        attachedDeviceUdid: null,
        agentActiveCount: 0,
        lastError: null,
        attachPhase: null,
        attachToken: 0,
        paneSurfacedUdid: null,
      };
      this.threads.set(threadId, attachment);
    }
    return attachment;
  }

  private describe(device: DeviceDescriptor): DeviceDescriptor {
    const bootSource = this.gladeBooted.has(device.udid) ? "glade" : device.bootSource;
    const geometry = this.backend.geometry(device.udid) ?? device.geometry;
    if (bootSource === device.bootSource && geometry === device.geometry) return device;
    return { ...device, bootSource, ...(geometry ? { geometry } : {}) };
  }

  private isAttachedAnywhere(udid: string): boolean {
    for (const [, attachment] of this.threads) {
      if (attachment.attachedDeviceUdid === udid) return true;
    }
    return false;
  }

  private async startStream(udid: string): Promise<boolean> {
    if (this.disposed) return false;
    this.desiredStreamUdid = udid;
    await this.queueStreamReconciliation();
    return this.activeStreamUdid === udid;
  }

  private async clearStreamStartupState(udid: string): Promise<void> {
    const cleared: string[] = [];
    for (const [threadId, attachment] of this.threads) {
      if (
        attachment.attachedDeviceUdid !== udid ||
        (attachment.lastError === null && attachment.attachPhase === null)
      ) {
        continue;
      }
      attachment.lastError = null;
      attachment.attachPhase = null;
      cleared.push(threadId);
    }
    for (const threadId of cleared) await this.publish(threadId);
  }

  // There is no "emit an IDR now" call in the helper, and the encoder's natural keyframe interval is
  // seconds away, so a decoder that has lost sync would otherwise sit frozen. Cached frames are
  // dropped first so a late subscriber cannot be primed with a keyframe from the previous generation.
  async requestKeyframe(udid: string): Promise<void> {
    if (this.activeStreamUdid !== udid || this.disposed) return;
    this.desiredStreamUdid = null;
    await this.queueStreamReconciliation();
    if (
      this.disposed ||
      this.desiredStreamUdid !== null ||
      this.transport.deviceSubscriberCount(udid) === 0
    ) {
      return;
    }
    await this.startStream(udid);
  }

  private async stopStream(udid: string): Promise<void> {
    if (this.desiredStreamUdid === udid) {
      this.desiredStreamUdid = null;
    } else if (this.desiredStreamUdid !== null || this.activeStreamUdid !== udid) {
      return;
    }
    await this.queueStreamReconciliation();
  }

  private queueStreamReconciliation(): Promise<void> {
    const transition = this.streamTransition.then(() => this.reconcileStream());
    this.streamTransition = transition.catch(() => undefined);
    return transition;
  }

  private async reconcileStream(): Promise<void> {
    while (true) {
      const desired = this.disposed ? null : this.desiredStreamUdid;
      if (this.activeStreamUdid === desired) return;
      if (this.activeStreamUdid !== null) {
        const active = this.activeStreamUdid;
        this.activeStreamUdid = null;
        this.transport.resetDevice(active);
        await this.backend.detachStream(active);
        continue;
      }
      if (desired === null) return;

      try {
        await this.backend.attachStream(desired, (frame) => {
          if (this.desiredStreamUdid === desired || this.activeStreamUdid === desired) {
            this.transport.publish(desired, frame);
          }
        });
      } catch (error) {
        if (!this.disposed && this.desiredStreamUdid === desired) {
          this.desiredStreamUdid = null;
          throw error;
        }
        continue;
      }

      if (this.disposed || this.desiredStreamUdid !== desired) {
        this.transport.resetDevice(desired);
        await this.backend.detachStream(desired);
        continue;
      }
      this.activeStreamUdid = desired;
      await this.clearStreamStartupState(desired);
    }
  }

  // The cap is three Glade-booted devices, and each one costs a couple of GB of RAM, so trying three
  // simulators in a row filled every slot with devices nobody was looking at and made the fourth pick
  // prompt for a shutdown the user had effectively already asked for. A plain detach still uses the
  // idle timer, because coming back to a device you just closed is common and re-booting it costs a
  // minute. User-booted devices are never touched by either path.
  private async releaseDevice(
    udid: string,
    reason: "detached" | "switched" = "detached",
  ): Promise<void> {
    await this.stopRecordingIfActive(udid).catch(() => undefined);
    if (this.isAttachedAnywhere(udid)) return;
    if (this.transport.deviceSubscriberCount(udid) === 0) {
      await this.stopStream(udid).catch(() => undefined);
    }
    if (!this.gladeBooted.has(udid)) return;
    if (reason === "switched") {
      this.clearIdleTimer(udid);

      await this.shutdown(udid).catch(() => undefined);
      return;
    }
    this.clearIdleTimer(udid);
    const timer = this.schedule(() => {
      this.idleTimers.delete(udid);
      void this.shutdownIfStillIdle(udid);
    }, this.idleShutdownMs);
    // A pending idle shutdown must not keep the process alive at exit; quit shuts these devices down
    // anyway.
    timer.unref?.();
    this.idleTimers.set(udid, timer);
  }

  private async stopRecordingIfActive(udid: string): Promise<void> {
    if (!this.recording.has(udid)) return;
    await this.stopRecording(udid);
  }

  private async shutdownIfStillIdle(udid: string): Promise<void> {
    if (this.disposed) return;

    if (this.isAttachedAnywhere(udid) || !this.gladeBooted.has(udid)) return;
    await this.shutdown(udid).catch(() => undefined);
  }

  private clearIdleTimer(udid: string): void {
    const timer = this.idleTimers.get(udid);
    if (!timer) return;
    this.cancel(timer);
    this.idleTimers.delete(udid);
  }

  private async snapshot(
    threadId: string,
    options: { readonly reuseDiscovery?: boolean } = {},
  ): Promise<ThreadDeviceState> {
    const attachment = this.threadState(threadId);
    let discovery = options.reuseDiscovery ? this.lastDiscovery : null;
    if (discovery === null) {
      const availability = await this.backend.availability();
      const devices = await this.discover(availability, { includeShutdown: true });
      discovery = { availability, devices };
      this.lastDiscovery = discovery;
    }
    const { availability, devices } = discovery;
    return {
      threadId: threadId as ThreadDeviceState["threadId"],
      version: attachment.version,
      attachedDeviceUdid: attachment.attachedDeviceUdid as ThreadDeviceState["attachedDeviceUdid"],
      devices,
      agentActive: attachment.agentActiveCount > 0,
      availability,
      lastError: attachment.lastError,
      attachPhase: attachment.attachPhase,
    };
  }

  private async publish(
    threadId: string,
    options: { readonly reuseDiscovery?: boolean } = {},
  ): Promise<ThreadDeviceState> {
    const attachment = this.threadState(threadId);
    attachment.version += 1;
    const state = await this.snapshot(threadId, options);
    this.emit({ type: "device.thread-state", state });
    return state;
  }

  private async publishAllThreads(): Promise<void> {
    for (const [threadId] of this.threads) await this.publish(threadId);
  }

  private emit(event: DeviceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // One bad listener must not stop the rest from seeing device events.
      }
    }
  }
}
