import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { ComputerSpaceBroker, ComputerSpaceError } from "./ComputerSpaceBroker.ts";
import { ComputerControlState } from "./ComputerControlState.ts";
import { computerApprovalGate } from "./ComputerApprovalGate.ts";
import { currentComputerTask } from "./computerTaskContext.ts";
import { CursorActivity } from "./cursorActivity.ts";
import { waitForWindow } from "./waitForWindow.ts";
import { observedComputerTargetNode } from "./computerElementIdentity.ts";
import {
  ComputerId,
  ComputerPoint,
  ComputerScreenSize,
  COMPUTER_PROVISION_SUMMARY_MAX_LENGTH,
  COMPUTER_TEXT_MAX_LENGTH,
  type ComputerAccessibilityTreeResult,
  type ComputerActionResult,
  type ComputerApp,
  type ComputerAvailability,
  type ComputerBuildSignature,
  type ComputerCapabilities,
  type ComputerCursorPosition,
  type ComputerEvent,
  type ComputerHealth,
  type ComputerInputModifier,
  type ComputerRect,
  type ComputerScreenshot,
  type ComputerGetScreenSizeResult,
  type ComputerListAppsResult,
  type ComputerListWindowsResult,
  type ComputerProvisionResult,
  type ComputerLaunchAppResult,
  type ComputerPermission,
  type ComputerState,
  type ComputerStatusResult,
  type ComputerTarget,
  type ComputerVerifyStateResult,
  type ComputerWindow,
  type ComputerZoomResult,
  type ThreadComputerState,
} from "@glade/contracts/computer/computer";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ComputerControlMode } from "@glade/contracts/orchestration/orchestration";
import {
  type ComputerGetAuditHistoryInput,
  type ComputerGetAuditHistoryResult,
} from "@glade/contracts/computer/computerAudit";
import { encodeComputerFrame } from "@glade/shared/computerFrame";
import { classifyByFrameFlags, FrameTransport, type FrameSink } from "@glade/shared/frameTransport";

import {
  DesktopOperationQueue,
  withDesktopDeliveryMode,
  assertDesktopOperationActive,
  assertDesktopOperationAdmission,
  withDesktopOperationSignal,
  desktopOperationSignal,
  desktopDeliveryMode,
  withoutDesktopCancellation,
} from "./DesktopOperationQueue.ts";
import {
  clampComputerMessage,
  COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION,
  computerBackendActionResult,
  ComputerBackendError,
  type ComputerAgentDialect,
  type ComputerBackend,
  type ComputerBackendActionResult,
  type ComputerBrowserCallResult,
  type ComputerCaptureRequest,
  type ComputerStreamFrame,
  type ComputerMenuTarget,
  type ComputerResolvedTarget,
  type ComputerTextRange,
} from "./ComputerBackend.ts";
import {
  createComputerCallContext,
  cuaActionSettleMsOverride,
  cuaConditionalSettleEnabled,
  currentComputerCall,
  markComputerCall,
  timedComputerLeg,
  withComputerCallContext,
} from "./computerCallContext.ts";
import {
  rectContainsPoint,
  topmostWindowAtPoint,
  windowsCoveringPoint,
} from "./computerGeometry.ts";
import { decodePngLuma, estimateVerticalTravel, ScrollGearingStore } from "./scrollCalibration.ts";
import { ScrollGearingFile } from "./scrollGearingFile.ts";
import {
  ComputerTargetError,
  activationPointForNode,
  computerTargetCandidates,
  resolveComputerPoint,
  resolveComputerSemanticTarget,
  resolveComputerUniqueTextTarget,
  resolveComputerWindowTarget,
} from "./uiTreeTargeting.ts";
import { ComputerAuditLog, type ComputerAuditEntry } from "./computerAuditLog.ts";
import { ComputerDenylistError, computerDenylistMatch } from "./computerDenylist.ts";
import { CuaActionError } from "./CuaComputerBackend.ts";
import {
  COMPUTER_FOREGROUND_NOT_REQUESTED_CODE,
  COMPUTER_FOREGROUND_USER_INTERACTION_CODE,
  COMPUTER_USER_INTERACTION_QUIET_MS,
  type ComputerForegroundAuthorization,
} from "./computerVisibleUse.ts";
import {
  cuaMaskedActivationEnabled,
  cuaMaskedActivationOptIn,
  maskedActivationOptedIn,
} from "./computerShield.ts";
import { describeComputerUiTree } from "./uiTreeText.ts";
import { clampTextToLength } from "./utf8Truncation.ts";

const COMPUTER_FRAME_QUEUE_LIMIT = 8;
const COMPUTER_FRAME_SOCKET_BUDGET_BYTES = 2 * 1024 * 1024;

// Ownership is released the moment the owner's turn ends (`releaseDesktopControl`, driven by the
// provider runtime's terminal turn and session events), because a takeover mid-turn corrupts the
// owner: its drag is teleported, its typing is retargeted. Idle expiry only covers the case where
// that signal never arrives — a provider process that died without a terminal event — and so is
// deliberately long: a model can think for minutes between two tool calls, and expiring under a
// live turn is the failure this whole mechanism exists to prevent.
const COMPUTER_LEASE_IDLE_MS = 300_000;

// The write is a local file store and a stop is a bounded native round trip, so anything past this
// is wedged — and a wedged enable must fail closed (staying disabled) rather than wedge the caller
// or open authority on an unrecorded preference.
export const COMPUTER_CONTROL_ENABLE_TIMEOUT_MS = 30_000;

const COMPUTER_ACTION_SETTLE_MS = 300;

const COMPUTER_ACTION_OBSERVER_SETTLE_TIMEOUT_MS = 5_000;

// The target application reads the pasteboard off the keystroke asynchronously, so restoring
// immediately would hand it the old contents. There is no observable "the app read it" event, so
// this is a fixed settle like the action-screenshot one above — long enough for the paste to land,
// short enough that a user who reaches for their own clipboard next is not racing us.
const COMPUTER_PASTE_RESTORE_MS = 250;

// Trailing-edge window on the republish that a backend window change triggers. A publish costs one
// availability read, one window read and one screen-size read per thread, and the window read is
// itself what reports a change — so a desktop with a ticking window title (a clock, a download
// percentage, a video player's timer) publishes, observes its own read as a change, and publishes
// again, once per thread, without ever settling.
const COMPUTER_WINDOWS_PUBLISH_DEBOUNCE_MS = 250;

const SCROLL_PROBE_PX = 48;

const SCROLL_PROBE_TRIGGER_PX = SCROLL_PROBE_PX;

const SCROLL_SETTLE_ARRIVAL_TOLERANCE = 0.15;
const SCROLL_SETTLE_ARRIVAL_MIN_PX = 4;

const COMPUTER_ERROR_REPUBLISH_DEBOUNCE_MS = 250;

const COMPUTER_DENYLIST_APP_CACHE_MS = 30_000;

export type ComputerEventListener = (event: ComputerEvent) => void;

interface ThreadComputerRuntimeState {
  version: number;
  lastError: string | null;

  reportedError: string | null;
  inputPause?: NonNullable<ThreadComputerState["inputPause"]>;
  windows: readonly ComputerWindow[];
  screenSize: ComputerScreenSize;
  availability: ComputerAvailability;
  cursor?: ComputerPoint;

  paneSurfaced: boolean;
}

interface DesktopLease {
  readonly threadId: string;
  readonly turnId?: string;
  lastActivityMs: number;
  releaseRequested?: boolean;

  releaseRequestedTurnId?: string | undefined;
}

interface BackgroundControlTarget {
  readonly key: string;
  readonly pid?: number;
  readonly windowId?: string;
}

interface BackgroundLease extends DesktopLease {
  readonly target: BackgroundControlTarget;
}

export interface ComputerManagerOptions {
  readonly backend: ComputerBackend;
  readonly controlStatePath?: string;

  readonly auditLogPath?: string;
  readonly transport?: FrameTransport<string, ComputerStreamFrame>;

  readonly now?: () => number;
  readonly leaseIdleMs?: number;

  readonly actionSettleMs?: number;

  readonly windowsPublishDebounceMs?: number;

  readonly measureScrollTravel?: (
    before: Uint8Array,
    after: Uint8Array,
  ) => number | undefined | Promise<number | undefined>;
}

interface ResolvedPointTarget {
  readonly point: ComputerPoint;
  readonly windowId?: string;
  readonly covering?: readonly ComputerWindow[];
  readonly semantic?: ComputerResolvedTarget;
}

// The point is optional because keyboard actions name a window without one, and with no point there
// is nothing an occlusion check could be about.
type PreparedTarget = Omit<ResolvedPointTarget, "point"> & {
  readonly point?: ComputerPoint;
};

export interface ComputerClickGesture {
  readonly count?: 1 | 2 | 3;
  readonly button?: "left" | "right" | "middle";
}

export interface ComputerCapturedWindow {
  readonly screenshot: ComputerScreenshot;
  readonly windowId?: string;
}

export type ComputerActionObservation =
  | ComputerCapturedWindow
  | { readonly targetWindowClosed: true };

// Refusal raised when another thread owns the desktop. It extends `ComputerBackendError` so every
// existing catch site keeps classifying it, and explicitly discourages immediate retries: time
// spent repeating the same refusal cannot free the other conversation's desktop lease.
export class ComputerLeaseError extends ComputerBackendError {
  readonly code = "computer_controlled_by_other_thread";

  constructor(targetOnly = false) {
    super(
      (targetOnly
        ? "This application or window is controlled by another conversation; "
        : "The shared pointer and focused keyboard are controlled by another conversation; ") +
        "no input was sent. Do not retry this blocked action or switch tools to bypass " +
        "the lease. Wait until that conversation's turn ends. Reading the desktop still " +
        "works. Background actions on independently owned applications remain available.",
      { retryable: false },
    );
    this.name = "ComputerLeaseError";
  }
}

type ForegroundRestoreStatus =
  | "restored"
  | "restore-missed"
  | "already-frontmost"
  | "frontmost-unobservable";

export interface ForegroundRestoreInfo {
  readonly restoredWindowId: string | null;
  readonly restoreStatus: ForegroundRestoreStatus;
}

export class ComputerManager {
  readonly computerId: ComputerId;

  private readonly backend: ComputerBackend;
  private readonly transport: FrameTransport<string, ComputerStreamFrame>;
  private readonly listeners = new Set<ComputerEventListener>();

  private readonly publishChains = new Map<string, Promise<unknown>>();
  private errorRepublishTimer: ReturnType<typeof setTimeout> | undefined;
  private nextStateVersion = -1;
  private readonly screenshotBytes = new WeakMap<ComputerScreenshot, Uint8Array>();
  private readonly threads = new Map<string, ThreadComputerRuntimeState>();
  // Track in-flight calls independently of pane records: agents can own a desktop lease without ever
  // opening a pane.
  private readonly agentCallsInFlight = new Map<string, number>();
  private readonly backgroundLeases = new Map<string, BackgroundLease>();
  private readonly knownAppNames = new Set<string>();

  private readonly threadLabels = new Map<string, string>();
  private readonly backendUnsubscribe?: () => void;
  private readonly now: () => number;
  private readonly leaseIdleMs: number;
  private readonly actionSettleMs: number;
  private readonly windowsPublishDebounceMs: number;
  private readonly measureScrollTravel: (
    before: Uint8Array,
    after: Uint8Array,
  ) => number | undefined | Promise<number | undefined>;

  private readonly scrollGearing = new ScrollGearingStore();
  private readonly scrollGearingFile: ScrollGearingFile;

  private publishAllDepth = 0;
  private windowsPublishPending = false;

  private observerSettle: "unknown" | "supported" | "unsupported" = "unknown";
  private windowsPublishTimer: ReturnType<typeof setTimeout> | undefined;
  private backendHealth: ComputerHealth;
  private lease: DesktopLease | null = null;
  // Passive chat rendering must not install or connect a compositor plugin. Engage the backend only
  // for an explicit desktop use.
  private backendEngaged = false;

  private lastUserDesktopInputAt: number | undefined;

  get agentDialect(): ComputerAgentDialect {
    return this.backend.agentDialect ?? "linux";
  }

  get supportsFocusNeutralSemanticText(): boolean {
    return this.backend.focusNeutralSemanticText === true;
  }

  observedAppNames(): readonly string[] {
    return [...this.knownAppNames];
  }

  private rememberObservedAppNames(windows: readonly ComputerWindow[]): void {
    for (const window of windows) {
      const name = window.appName?.trim();
      if (!name) continue;
      this.knownAppNames.delete(name);
      this.knownAppNames.add(name);
    }
    while (this.knownAppNames.size > 256)
      this.knownAppNames.delete(this.knownAppNames.values().next().value!);
  }

  private get backendCapabilities(): ComputerCapabilities {
    return this.backend.capabilities();
  }
  private readonly operations = new DesktopOperationQueue();
  readonly cursorActivity: CursorActivity;
  readonly spaceBroker: ComputerSpaceBroker;
  private activity: string | null = null;
  // The window ids the last window read saw, kept so a post-action read can be diffed against it
  // without paying for a second one.
  private lastKnownWindowIds: ReadonlySet<string> | undefined;
  // The same cache keyed the other way, so a window id can be resolved to its last reported row
  // without a second backend read.
  private lastKnownWindows = new Map<string, ComputerWindow>();

  private preActionWindowIds: ReadonlySet<string> | undefined;
  private streamAttached = false;
  private streamDesired = false;
  private streamEpoch = 0;
  private streamTransition: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly disabledThreads = new Set<string>();
  private readonly controlState: ComputerControlState;
  private readonly auditLog: ComputerAuditLog;

  private deniedAppsCache:
    | { readonly at: number; readonly apps: readonly ComputerApp[] }
    | undefined;
  private readonly pendingControlWrites = new Map<string, Promise<void>>();
  private readonly suspendedThreads = new Set<string>();
  private readonly authorityRevocations = new Map<string, AbortController>();
  private readonly controlRequests = new Map<string, symbol>();
  private readonly pendingStops = new Map<string, Promise<void>>();
  private physicalState:
    | {
        availability: ComputerAvailability;
        windows?: readonly ComputerWindow[];
        screenSize?: ComputerScreenSize;
      }
    | undefined;
  private physicalRead: Promise<void> | undefined;
  private physicalFailure: string | undefined;
  private refreshPhysicalState(): Promise<void> {
    if (this.physicalRead) return this.physicalRead;
    this.physicalRead = (async () => {
      this.physicalFailure = undefined;
      if (this.backendEngaged) {
        const [availability, windows, screenSize] = await Promise.all([
          this.backend.availability(),
          this.readWindows(),
          this.backend.getScreenSize(),
        ]);
        this.physicalState = { availability, windows, screenSize };
      } else
        this.physicalState = {
          availability: await this.backend.probeAvailability(),
        };
    })()
      .catch((error) => {
        this.physicalFailure = clampComputerMessage(
          errorMessage(error),
          "Computer state is unavailable.",
        );
      })
      .finally(() => {
        this.physicalRead = undefined;
      });
    return this.physicalRead;
  }
  private readonly activeAuthorities = new Map<string, Set<AbortController>>();
  private readonly authorityTurns = new Map<string, string>();

  private controlDisabled(threadId: string): boolean {
    return this.disabledThreads.has(threadId) || this.controlState.get(threadId).disabled;
  }

  canActivateControl(threadId: string, generation = 0): boolean {
    return (
      !this.controlDisabled(threadId) &&
      !this.suspendedThreads.has(threadId) &&
      this.controlState.allows(threadId, generation)
    );
  }

  // Audit failures must not delay or fail a delivered action. Disabled control records nothing,
  // including refusals.
  recordComputerAudit(entry: Omit<ComputerAuditEntry, "ts">): void {
    if (entry.threadId !== undefined && this.controlDisabled(entry.threadId)) return;
    this.auditLog.record(entry);
  }

  getAuditHistory(input: ComputerGetAuditHistoryInput): Promise<ComputerGetAuditHistoryResult> {
    return this.auditLog.readHistory(input);
  }

  // The denylist check for the admission/consent keys, which are the raw strings a tool call declared
  // — an app name, a bundle id, an executable path, or the `pid <n>` fallback consent uses when a pid
  // could not be named. Synchronous by contract: both call sites are consent bookkeeping that cannot
  // await a process enumeration, so the pid fallback resolves only against the last cached inventory
  // rather than paying for a fresh one inside the serialized operation queue.
  private assertDrivenAppAllowed(app: string): void {
    const direct = computerDenylistMatch({ name: app });
    if (direct) throw new ComputerDenylistError(direct.app, direct.matched);
    const pidMatch = /^pid ([1-9]\d*)$/.exec(app.trim().toLowerCase());
    if (pidMatch === null) return;
    const pid = Number(pidMatch[1]);
    const owner = this.deniedAppsCache?.apps.find((candidate) => candidate.pid === pid);
    if (owner === undefined) return;
    const resolved = computerDenylistMatch({
      name: owner.name,
      bundleId: owner.bundleId,
    });
    if (resolved) throw new ComputerDenylistError(resolved.app, resolved.matched);
  }

  private async runningAppsForDenylist(): Promise<readonly ComputerApp[]> {
    const listApps = this.backend.listApps?.bind(this.backend);
    if (listApps === undefined) return this.deniedAppsCache?.apps ?? [];
    const now = this.now();
    const cached = this.deniedAppsCache;
    if (cached !== undefined && now - cached.at < COMPUTER_DENYLIST_APP_CACHE_MS) {
      return cached.apps;
    }
    const apps = await listApps().catch(() => undefined);
    if (apps === undefined) return cached?.apps ?? [];
    this.deniedAppsCache = { at: now, apps };
    return apps;
  }

  private async deniedMatchForWindow(
    window: ComputerWindow,
  ): Promise<ReturnType<typeof computerDenylistMatch>> {
    const direct = computerDenylistMatch({ name: window.appName });
    if (direct) return direct;
    if (window.pid === undefined) return undefined;
    const owner = (await this.runningAppsForDenylist()).find(
      (candidate) => candidate.pid === window.pid,
    );
    if (owner === undefined) return undefined;
    return computerDenylistMatch({
      name: owner.name,
      bundleId: owner.bundleId,
    });
  }

  private async deniedMatchForPid(
    pid: number,
    name: string | undefined,
  ): Promise<ReturnType<typeof computerDenylistMatch>> {
    const direct = computerDenylistMatch({ name });
    if (direct) return direct;
    const owner = (await this.runningAppsForDenylist()).find((candidate) => candidate.pid === pid);
    if (owner === undefined) return undefined;
    return computerDenylistMatch({
      name: owner.name,
      bundleId: owner.bundleId,
    });
  }

  private async assertWindowInputAllowed(
    threadId: string | undefined,
    windowId: string,
  ): Promise<void> {
    if (agentThreadId(threadId) === undefined) return;
    const window = (await this.readWindows()).find((candidate) => candidate.id === windowId);
    if (window === undefined) return;
    await this.assertWindowInputAllowedWindow(threadId, window);
  }

  private async assertWindowInputAllowedWindow(
    threadId: string | undefined,
    window: ComputerWindow,
  ): Promise<void> {
    if (agentThreadId(threadId) === undefined) return;
    const match = await this.deniedMatchForWindow(window);
    if (match) throw new ComputerDenylistError(match.app, match.matched);
    await this.spaceBroker.assertWindowAllowed(
      { threadId: threadId!, turnId: currentComputerTask()?.turnId ?? null },
      window,
    );
  }

  private async assertSpaceAppMutationAllowed(
    threadId: string | undefined,
    pid: number,
  ): Promise<void> {
    const owner = agentThreadId(threadId);
    if (owner === undefined) return;
    await this.spaceBroker.assertAppMutationAllowed(
      { threadId: owner, turnId: currentComputerTask()?.turnId ?? null },
      pid,
    );
  }

  private async assertWindowContentAllowed(windowId: string): Promise<void> {
    const window = (await this.readWindows()).find((candidate) => candidate.id === windowId);
    if (window === undefined) return;
    const match = await this.deniedMatchForWindow(window);
    if (match) throw new ComputerDenylistError(match.app, match.matched);
  }

  // Unscoped content reads — a workspace screenshot, a desktop-wide tree on dialects that answer one
  // — cannot exclude a visible denied surface's pixels or elements, so they refuse while one is
  // shown.
  private async deniedVisibleWindows(): Promise<
    ReadonlyArray<{
      readonly window: ComputerWindow;
      readonly match: NonNullable<ReturnType<typeof computerDenylistMatch>>;
    }>
  > {
    const denied: Array<{
      readonly window: ComputerWindow;
      readonly match: NonNullable<ReturnType<typeof computerDenylistMatch>>;
    }> = [];
    for (const window of await this.readWindows()) {
      if (!window.visible || window.minimized) continue;
      const match = await this.deniedMatchForWindow(window);
      if (match) denied.push({ window, match });
    }
    return denied;
  }

  private async deniedVisibleWindow(): Promise<
    | {
        readonly window: ComputerWindow;
        readonly match: NonNullable<ReturnType<typeof computerDenylistMatch>>;
      }
    | undefined
  > {
    return (await this.deniedVisibleWindows())[0];
  }

  private async windowIsDenied(windowId: string): Promise<boolean> {
    const window = (await this.readWindows()).find((candidate) => candidate.id === windowId);
    return window !== undefined && (await this.deniedMatchForWindow(window)) !== undefined;
  }

  async admitControl(
    threadId: string,
    mode: ComputerControlMode,
    generation = 0,
    explicitInvocation = false,
  ): Promise<boolean> {
    // An invocation queued before Stop still carries the old generation and cannot revive input. The
    // guard must read the generation a pending disable will bump to — the write is serialized
    // asynchronously, so waiting out the in-flight control write is what keeps a stale invocation from
    // slipping the gap.
    if (explicitInvocation && mode === "request" && this.controlDisabled(threadId)) {
      await this.pendingControlWrites.get(threadId)?.catch(() => undefined);
    }
    if (
      explicitInvocation &&
      mode === "request" &&
      this.controlState.get(threadId).generation === generation &&
      !this.suspendedThreads.has(threadId) &&
      this.controlDisabled(threadId)
    ) {
      await this.setControlEnabled(threadId, true);
    }
    const enabled = mode !== "off" && this.canActivateControl(threadId, generation);

    try {
      await this.controlState.recordChatIntent(threadId, enabled && mode === "chat", generation);
    } catch (error) {
      // Fail closed and LOUD: a persist failure means durable intent is unrecorded, so the thread is
      // disabled; without this warning the next turn's silent canContinue=false looks like a stickiness
      // bug.
      console.warn("[computer] admitControl persist failed, disabling thread", {
        threadId,
        mode,
        generation,
      });
      this.disabledThreads.add(threadId);
      throw error;
    }
    return enabled && this.canActivateControl(threadId, generation);
  }

  canContinueChatControl(threadId: string): boolean {
    const state = this.controlState.get(threadId);
    return (
      state.chatGeneration === state.generation &&
      this.canActivateControl(threadId, state.generation)
    );
  }

  async setControlEnabled(
    threadId: string,
    enabled: boolean,
  ): Promise<{ enabled: boolean; generation: number }> {
    const request = Symbol();
    this.controlRequests.set(threadId, request);
    if (enabled) {
      // The durable gate stays closed until the new preference is on disk: `disabledThreads` is held
      // through the write, and a write that hangs past the timeout throws with the gate still held (fail
      // closed), so authority can never open on an unrecorded preference.
      await withControlEnableTimeout(this.pendingControlWrites.get(threadId));
      await withControlEnableTimeout(this.pendingStops.get(threadId));
      if (this.controlRequests.get(threadId) === request) {
        this.disabledThreads.add(threadId);
        const write = this.controlState.set(threadId, false);
        this.pendingControlWrites.set(threadId, write);
        await withControlEnableTimeout(write);
        if (this.controlRequests.get(threadId) === request) {
          this.disabledThreads.delete(threadId);
          if (this.authorityRevocations.get(threadId)?.signal.aborted)
            this.authorityRevocations.delete(threadId);
        }
      }
    } else {
      this.disabledThreads.add(threadId);
      const runtime = this.threads.get(threadId);
      if (runtime) runtime.paneSurfaced = false;
      // Increment immediately, before cleanup or persistence can yield. Old queued requests never regain
      // authority when this thread is re-enabled.
      const write = this.controlState.set(threadId, true);
      this.pendingControlWrites.set(threadId, write);
      // Bounded like the enable path: the disable itself already holds (disabledThreads is synchronous),
      // so a wedged stop cannot strand the RPC — it can only cost the cleanup confirmation.
      const outcomes = await withControlTeardownTimeout(
        Promise.allSettled([write, this.revokeControl(threadId)]),
      );
      const failed = outcomes.find((outcome) => outcome.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    if (this.controlRequests.get(threadId) === request) {
      this.controlRequests.delete(threadId);
      this.pendingControlWrites.delete(threadId);
    }

    if (!this.suspendedThreads.has(threadId)) {
      this.threadRuntime(threadId);
      this.publishCached(threadId);
    }
    return {
      enabled: !this.controlDisabled(threadId) && !this.suspendedThreads.has(threadId),
      generation: this.controlState.get(threadId).generation,
    };
  }

  private revokeControl(threadId: string): Promise<void> {
    // Settle pending approval prompts synchronously: a mid-turn Off must not leave a prompt hanging
    // until the gate's five-minute timeout.
    computerApprovalGate.cancelThread(threadId);
    const revokeReason = new ComputerBackendError(
      "Computer control was revoked for this conversation; no new input may be dispatched.",
      { controlRevoked: true },
    );
    this.authorityRevocations.get(threadId)?.abort(revokeReason);

    for (const controller of this.activeAuthorities.get(threadId) ?? [])
      controller.abort(revokeReason);
    const pending = this.pendingStops.get(threadId);
    if (pending) return pending;
    const stop = (async () => {
      if (
        this.lease?.threadId === threadId ||
        [...this.backgroundLeases.values()].some((lease) => lease.threadId === threadId) ||
        (this.activeAuthorities.get(threadId)?.size ?? 0) > 0
      )
        await this.backend.stopInput?.({
          threadId,
          ...(this.authorityTurns.get(threadId)
            ? { turnId: this.authorityTurns.get(threadId)! }
            : {}),
        });
      await this.releaseDesktopControl(threadId);
    })().finally(() => {
      this.pendingStops.delete(threadId);
    });
    this.pendingStops.set(threadId, stop);
    return stop;
  }

  private assertControlAuthority(owner: string | undefined): void {
    if (owner === undefined) return;
    if (!this.controlDisabled(owner) && !this.suspendedThreads.has(owner)) return;
    throw new ComputerBackendError(
      "Computer control was revoked for this conversation; no input was dispatched.",
      { controlRevoked: true },
    );
  }

  private assertInputNotPaused(owner: string | undefined): void {
    const pausedState = owner ? this.threads.get(owner) : undefined;
    if (pausedState?.inputPause) {
      throw new ComputerBackendError(pausedState.inputPause.message, {
        inputPause: pausedState.inputPause,
      });
    }
  }

  // Check visible-use authorization and recent human input at dispatch time, inside the shared queue.
  // Approval mode alone cannot authorize raising a window.
  private assertForegroundAllowed(
    threadId: string | undefined,
    authorization: ComputerForegroundAuthorization | undefined,
  ): void {
    if (agentThreadId(threadId) === undefined) return;
    if (authorization?.userRequestedVisibleUse !== true) {
      throw new CuaActionError(
        "The user did not ask or allow this app or window to be shown for this task. Stay in " +
          "the background: keep observing and acting through background input. Do not ask " +
          "again in this turn.",
        "not-dispatched",
        COMPUTER_FOREGROUND_NOT_REQUESTED_CODE,
      );
    }
    const lastInput = this.lastUserDesktopInputAt;
    if (lastInput !== undefined && this.now() - lastInput < COMPUTER_USER_INTERACTION_QUIET_MS) {
      throw new CuaActionError(
        "The user was interacting with the desktop moments ago; bringing a window forward " +
          "now would take their focus. Wait for the desktop to be quiet, then retry if the " +
          "task still needs foreground delivery.",
        "not-dispatched",
        COMPUTER_FOREGROUND_USER_INTERACTION_CODE,
      );
    }
  }

  private recordInputPause(owner: string | undefined, error: unknown): void {
    if (
      owner &&
      !this.disposed &&
      !this.suspendedThreads.has(owner) &&
      !this.controlDisabled(owner) &&
      error instanceof ComputerBackendError &&
      error.inputPause
    ) {
      this.threadRuntime(owner).inputPause = error.inputPause;
      this.publishCached(owner);
    }
  }

  // Escape aborts live calls and queued admissions. Interrupted calls must not be retried; subsequent
  // calls can resume without a persistent stop latch.
  async emergencyStopInput(): Promise<void> {
    if (this.disposed) return;

    this.emit({ type: "computer.input-stopped", stopped: true });
    const stopReason = new ComputerBackendError(
      "Computer input was stopped with the Escape key; no new input may be dispatched.",
      { controlRevoked: true },
    );

    for (const authority of this.authorityRevocations.values()) {
      authority.abort(stopReason);
    }
    for (const live of this.activeAuthorities.values()) {
      for (const controller of live) controller.abort(stopReason);
    }
    try {
      await this.backend.stopInput?.();
    } finally {
      this.emit({ type: "computer.input-stopped", stopped: false });
    }
  }

  constructor(options: ComputerManagerOptions) {
    this.backend = options.backend;
    this.spaceBroker = new ComputerSpaceBroker({
      assertActive: assertDesktopOperationActive,
      readSnapshot: async () => {
        if (!this.backend.listSpaces)
          throw new ComputerSpaceError(
            "computer_spaces_unavailable",
            "This backend does not expose managed Space inventory. Drive an exact existing window in place instead.",
          );
        this.engageBackend();
        const inventory = await this.backend.listSpaces();
        const windows = await this.readWindows();
        return { inventory, windows };
      },
    });
    this.controlState = new ComputerControlState(options.controlStatePath);

    this.auditLog = new ComputerAuditLog(options.auditLogPath);

    this.scrollGearingFile = new ScrollGearingFile(
      options.controlStatePath === undefined
        ? undefined
        : join(dirname(options.controlStatePath), "computer-scroll-gearing.json"),
    );
    this.cursorActivity = new CursorActivity((text) => {
      this.activity = text;
      for (const threadId of this.threads.keys()) this.publishCached(threadId);
      return this.backend.setCursorActivity?.(text);
    });
    this.computerId = options.backend.computerId;
    this.now = options.now ?? Date.now;
    this.leaseIdleMs = options.leaseIdleMs ?? COMPUTER_LEASE_IDLE_MS;
    this.actionSettleMs =
      options.actionSettleMs ?? cuaActionSettleMsOverride() ?? COMPUTER_ACTION_SETTLE_MS;
    this.windowsPublishDebounceMs =
      options.windowsPublishDebounceMs ?? COMPUTER_WINDOWS_PUBLISH_DEBOUNCE_MS;
    this.measureScrollTravel = options.measureScrollTravel ?? measureScrollTravelFromPng;
    this.backendHealth = options.backend.health();
    this.transport =
      options.transport ??
      new FrameTransport<string, ComputerStreamFrame>({
        independentStills: true,
        encode: (computerId, frame) =>
          encodeComputerFrame({
            header: {
              computerId,
              sequence: frame.sequence,
              timestampMs: frame.timestampMs,
              keyframe: frame.keyframe,
              codecConfig: frame.codecConfig,
            },
            payload: frame.data,
          }),
        classify: classifyByFrameFlags,
        queueLimit: COMPUTER_FRAME_QUEUE_LIMIT,
        socketBudgetBytes: COMPUTER_FRAME_SOCKET_BUDGET_BYTES,
        subscriberIdPrefix: "computer-frame-subscriber",
      });
    if (options.backend.onEvent) {
      this.backendUnsubscribe = options.backend.onEvent((event) => {
        if (event.type === "windows-changed") {
          this.lastKnownWindowIds = windowIdSet(event.windows);
          this.lastKnownWindows = new Map(event.windows.map((window) => [window.id, window]));
          this.rememberObservedAppNames(event.windows);
          for (const state of this.threads.values()) state.windows = event.windows;
          this.emit({
            type: "computer.windows-changed",
            windows: event.windows,
          });
          this.scheduleWindowsPublish();
        } else if (event.type === "health-changed") {
          this.backendHealth = event.health;
          this.republishAllThreads();
        } else if (event.type === "capabilities-changed") {
          this.republishAllThreads();
        } else if (event.type === "desktop-interrupted") {
          computerApprovalGate.revokeTaskGrants();
        }
      });
    }
  }

  onEvent(listener: ComputerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // The republish is what keeps the pane honest: before this point its snapshot carries no windows
  // and a placeholder screen size, and the frames that are about to arrive are letterboxed against
  // exactly that size. It runs detached because the caller is on its way to the compositor and must
  // not wait for a window enumeration to finish first.
  private engageBackend(): void {
    if (this.backendEngaged || this.disposed) return;
    this.backendEngaged = true;
    void this.publishAllThreads().catch(() => undefined);
  }

  async availability(): Promise<ComputerAvailability> {
    this.engageBackend();
    return await this.backend.availability();
  }

  // Screen Recording can be missing while input remains available. Report failed probes through
  // backend health rather than inventing a missing grant.
  async missingPermissions(): Promise<readonly ComputerPermission[]> {
    try {
      return (await this.backend.missingPermissions?.()) ?? [];
    } catch {
      return [];
    }
  }

  buildSignature(): ComputerBuildSignature | undefined {
    return this.backend.buildSignature?.();
  }

  async getStatus(): Promise<ComputerStatusResult> {
    // Once something real has engaged the backend it gets the establishing read, because the screen
    // exists to report what the desktop really is — but merely opening settings must not be the thing
    // that installs and loads compositor code on a machine where nothing has ever used the feature, so
    // before first engagement it answers from the side-effect-free probe.
    let availability: ComputerAvailability;
    try {
      availability = this.backendEngaged
        ? await this.backend.availability({ refresh: true })
        : await this.backend.probeAvailability();
    } catch (error) {
      availability = {
        kind: "backend-unavailable",
        message: clampComputerMessage(errorMessage(error), "The computer backend failed."),
      };
    }
    return {
      computerId: this.computerId,
      availability: this.correctedAvailability(availability),
      health: this.backendHealth,
      capabilities: this.backendCapabilities,
      provisionable: this.backend.provision !== undefined,
    };
  }

  async provision(): Promise<ComputerProvisionResult> {
    this.engageBackend();
    if (!this.backend.provision) {
      throw new Error("This desktop backend has nothing to install.");
    }

    const summary = clampTextToLength(
      await this.backend.provision(),
      COMPUTER_PROVISION_SUMMARY_MAX_LENGTH,
    );
    return { summary, status: await this.getStatus() };
  }

  // The memory is what lets the post-action observer answer "did this action open a window?" without
  // paying for a read it would otherwise not need: the baseline is whatever the last read already
  // saw.
  private async readWindows(): Promise<readonly ComputerWindow[]> {
    const windows = await this.backend.listWindows();
    this.lastKnownWindowIds = windowIdSet(windows);
    this.lastKnownWindows = new Map(windows.map((window) => [window.id, window]));
    this.rememberObservedAppNames(windows);
    return windows;
  }

  async listWindows(): Promise<ComputerListWindowsResult> {
    this.engageBackend();
    const [availability, windows] = await Promise.all([
      this.backend.availability(),
      this.readWindows(),
    ]);
    return { computerId: this.computerId, windows, availability };
  }

  // One perception read, with the accessibility tree and its prose rendering asked for separately.
  // They were one flag, and every caller that wanted the tree — which is every agent-facing
  // perception read, because the elements list is built from it — also paid to render the whole
  // desktop to text and then discarded it. The walk is the expensive part and is still opt-in; the
  // rendering is cheap but not free, and now happens only for the callers that display it. It lives
  // here rather than in each backend so both display servers benefit from one fix and answer with
  // identically formatted text.
  async getState(
    options: {
      readonly includeScreenshot?: boolean;

      readonly includeText?: boolean;

      readonly includeTree?: boolean;
      readonly windowId?: string;
    } = {},
  ): Promise<ComputerState> {
    this.engageBackend();

    if (options.windowId !== undefined) {
      await this.assertWindowContentAllowed(options.windowId);
    } else if (
      options.includeScreenshot === true ||
      ((options.includeTree === true || options.includeText === true) &&
        this.agentDialect !== "macos")
    ) {
      const denied = await this.deniedVisibleWindow();
      if (denied) throw new ComputerDenylistError(denied.match.app, denied.match.matched);
    }

    const [state, availability] = await Promise.all([
      this.backend.getState({
        ...(options.includeScreenshot !== undefined
          ? { includeScreenshot: options.includeScreenshot }
          : {}),
        includeTree: options.includeTree ?? options.includeText === true,
        ...(options.windowId ? { windowId: options.windowId } : {}),
      }),
      this.backend.availability(),
    ]);

    if (options.windowId) await this.refreshInputPause(options.windowId, state.windows);
    const inputPause =
      (this.lease ? this.threads.get(this.lease.threadId)?.inputPause : undefined) ??
      (options.windowId
        ? [...this.threads.values()].find(
            (thread) => thread.inputPause?.windowId === options.windowId,
          )?.inputPause
        : undefined);
    const withAvailability = {
      ...state,
      availability: this.correctedAvailability(availability),
      ...(inputPause ? { inputPause } : {}),
    };
    if (options.includeText !== true || !withAvailability.root) return withAvailability;
    return {
      ...withAvailability,
      text: describeComputerUiTree(withAvailability.root),
    };
  }

  async captureScreenshot(request: ComputerCaptureRequest): Promise<ComputerScreenshot> {
    this.engageBackend();
    if (request.kind === "window") {
      await this.assertWindowContentAllowed(request.windowId);
    } else {
      const denied = (await this.deniedVisibleWindows()).find(
        (entry) =>
          entry.window.bounds !== undefined && rectsOverlap(entry.window.bounds, request.region),
      );
      if (denied) throw new ComputerDenylistError(denied.match.app, denied.match.matched);
    }
    return await this.backend.captureScreenshot(request);
  }

  // The explicit agent-facing settle wait (`computer_wait` with `settle:true`): validate the exact
  // window, then let the driver's AX observer debounce its surface until quiet — or, when this
  // backend cannot answer `waitForSettle`, fall back to the fixed post-action pause and say so. The
  // wait never sends input, never raises the window, and a refused or failed observer reports through
  // `mode` rather than being retried.
  async waitForSettle(
    windowId: string,
    timeoutMs: number,
  ): Promise<{
    readonly settled: boolean;
    readonly waitedMs: number;
    readonly eventsSeen?: number;
    readonly mode: "observer" | "fixed";
  }> {
    this.engageBackend();
    return this.withComputerCall(async () => {
      markComputerCall("computer_wait_settle");
      const window = (await this.readWindows()).find((entry) => entry.id === windowId);
      if (!window) throw windowNotFoundError(windowId);
      const timeout = Math.max(
        0,
        Math.min(COMPUTER_ACTION_OBSERVER_SETTLE_TIMEOUT_MS * 6, Math.floor(timeoutMs)),
      );
      if (this.observerSettle !== "unsupported" && this.backend.waitForSettle !== undefined) {
        try {
          const outcome = await this.backend.waitForSettle({
            windowId,
            timeoutMs: timeout,
            quietMs: this.actionSettleMs,
          });
          this.observerSettle = "supported";
          currentComputerCall()?.timing?.count(
            outcome.settled ? "settle_observer_settled" : "settle_observer_timeout",
          );
          return { ...outcome, mode: "observer" as const };
        } catch (error) {
          if (settlePermanentlyUnsupported(error)) this.observerSettle = "unsupported";
          else throw error;
        }
      }
      const waitedMs = Math.min(timeout, Math.max(0, this.actionSettleMs));
      await new Promise<void>((resolve) => {
        setTimeout(resolve, waitedMs);
      });
      return { settled: true, waitedMs, mode: "fixed" as const };
    });
  }

  async captureFocusedWindow(
    maxDimension?: number,
    options: { readonly agentFocusOnly?: boolean } = {},
  ): Promise<ComputerCapturedWindow> {
    this.engageBackend();
    const limit = maxDimension === undefined ? {} : { maxDimension };
    const window = await this.focusedCapturableWindow(options.agentFocusOnly === true);
    if (window) {
      const denied = await this.deniedMatchForWindow(window);
      if (denied) throw new ComputerDenylistError(denied.app, denied.matched);
      return {
        screenshot: await this.backend.captureScreenshot({
          kind: "window",
          windowId: window.id,
          ...limit,
        }),
        windowId: window.id,
      };
    }

    const deniedVisible = await this.deniedVisibleWindow();
    if (deniedVisible)
      throw new ComputerDenylistError(deniedVisible.match.app, deniedVisible.match.matched);
    const screenSize = await this.backend.getScreenSize();
    return {
      screenshot: await this.backend.captureScreenshot({
        kind: "region",
        region: {
          x: 0,
          y: 0,
          width: screenSize.width,
          height: screenSize.height,
        },
        ...limit,
      }),
    };
  }

  // Perception failure must not fail an action already delivered. A vanished target must never fall
  // back to the human's focused window; untargeted actions observe the window they actually touched.
  async captureActionScreenshot(
    windowIdHint?: string,
    actionPoint?: ComputerPoint,
    threadId?: string,
    settle = true,
  ): Promise<ComputerActionObservation | undefined> {
    return this.withComputerCall(async () => {
      markComputerCall("computer_observe");
      if (!this.backendCapabilities.capture) return undefined;
      this.engageBackend();
      if (settle && this.actionSettleMs > 0) {
        if (this.actionEffectAlreadyProven()) {
          currentComputerCall()?.timing?.count("settle_skipped");
        } else {
          await timedComputerLeg("settle", () => this.settleAfterAction(windowIdHint));
        }
      }
      return timedComputerLeg("observe", () =>
        this.captureActionObservation(windowIdHint, actionPoint, threadId),
      );
    });
  }

  // The `GLADE_CUA_CONDITIONAL_SETTLE=1` waiver, consulted only when a settle would otherwise run.
  // The proof is consumed either way, so it can never waive a later call's settle.
  private actionEffectAlreadyProven(): boolean {
    if (!cuaConditionalSettleEnabled()) return false;
    const proof = currentComputerCall()?.takeActionProof();
    return proof?.effect === "verified" || proof?.verified === "confirmed";
  }

  private async settleAfterAction(windowId: string | undefined): Promise<void> {
    if (
      windowId !== undefined &&
      this.observerSettle !== "unsupported" &&
      this.backend.waitForSettle !== undefined
    ) {
      try {
        const outcome = await this.backend.waitForSettle({
          windowId,
          timeoutMs: COMPUTER_ACTION_OBSERVER_SETTLE_TIMEOUT_MS,
          quietMs: this.actionSettleMs,
        });
        this.observerSettle = "supported";
        currentComputerCall()?.timing?.count(
          outcome.settled ? "settle_observer_settled" : "settle_observer_timeout",
        );
        return;
      } catch (error) {
        if (settlePermanentlyUnsupported(error)) this.observerSettle = "unsupported";
        currentComputerCall()?.timing?.count("settle_observer_unavailable");
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, this.actionSettleMs);
    });
  }

  private async captureActionObservation(
    windowIdHint: string | undefined,
    actionPoint: ComputerPoint | undefined,
    threadId: string | undefined,
  ): Promise<ComputerActionObservation | undefined> {
    if (windowIdHint !== undefined) {
      // An action's own observation must not become a way to photograph a denied surface: the action
      // already ran, so the miss reports no screenshot rather than refusing the call.
      if (await this.windowIsDenied(windowIdHint)) return undefined;
      try {
        return await this.observeActionCapture(
          {
            screenshot: await this.backend.captureScreenshot({
              kind: "window",
              windowId: windowIdHint,
              maxDimension: COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION,
            }),
            windowId: windowIdHint,
          },
          threadId,
        );
      } catch {
        try {
          const stillListed = (await this.readWindows()).some(
            (window) => window.id === windowIdHint,
          );
          if (!stillListed) return { targetWindowClosed: true };
        } catch {}
        return undefined;
      }
    }
    if (actionPoint) {
      const pointWindowId = await this.windowIdAtActionPoint(actionPoint);
      if (pointWindowId !== undefined) {
        if (await this.windowIsDenied(pointWindowId)) return undefined;
        try {
          return await this.observeActionCapture(
            {
              screenshot: await this.backend.captureScreenshot({
                kind: "window",
                windowId: pointWindowId,
                maxDimension: COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION,
              }),
              windowId: pointWindowId,
            },
            threadId,
          );
        } catch {}
      }
    }
    try {
      return await this.observeActionCapture(
        await this.captureFocusedWindow(COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION, {
          agentFocusOnly: true,
        }),
        threadId,
      );
    } catch {
      return undefined;
    }
  }

  // The observer photographs exactly one window — the one the action named, or the one under its
  // coordinates — so a click that opens a dialog, a menu, or a new browser window photographs the
  // *old* window, which very often did not change a pixel. Diffing the window list against what
  // existed before the action answers it truthfully: a window that was not there before is the
  // outcome, so photograph that instead. Checked against the pre-action window set before the gateway
  // decides whether to reuse a delivered frame. This is best effort — the action already happened,
  // and a perception failure must never turn its success into an error.
  private async observeActionCapture(
    capture: ComputerCapturedWindow,
    _threadId?: string,
  ): Promise<ComputerActionObservation> {
    const observation = capture;
    const appeared = await this.windowOpenedByAction(capture.windowId);
    if (appeared === undefined) return observation;
    // A denied window the action opened — a password prompt, a security dialog — is never photographed
    // either; the original capture stands.
    if ((await this.deniedMatchForWindow(appeared)) !== undefined) return observation;
    try {
      return {
        screenshot: await this.backend.captureScreenshot({
          kind: "window",
          windowId: appeared.id,
          maxDimension: COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION,
        }),
        windowId: appeared.id,
      };
    } catch {
      return observation;
    }
  }

  // A capturable window that did not exist when the running action started, or nothing — including
  // when there is no baseline to compare against, because a guess here would photograph a window the
  // action had no hand in.
  private async windowOpenedByAction(
    excludeWindowId: string | undefined,
  ): Promise<ComputerWindow | undefined> {
    const baseline = this.preActionWindowIds;
    if (baseline === undefined) return undefined;
    let windows: readonly ComputerWindow[];
    try {
      windows = await this.readWindows();
    } catch {
      return undefined;
    }
    const owner = windows.find((window) => window.id === excludeWindowId);

    if (!owner) return undefined;
    return windows
      .filter(
        (window) =>
          !baseline.has(window.id) &&
          window.id !== excludeWindowId &&
          (owner.pid !== undefined
            ? window.pid === owner.pid
            : owner.appName !== undefined && window.appName === owner.appName) &&
          window.bounds !== undefined &&
          window.visible &&
          !window.minimized,
      )
      .toSorted(
        (first, second) =>
          (first.stackingIndex ?? Number.MAX_SAFE_INTEGER) -
          (second.stackingIndex ?? Number.MAX_SAFE_INTEGER),
      )[0];
  }

  // Unresolvable stacking returns nothing rather than a guess; a listing failure does too, because
  // this only feeds perception.
  private async windowIdAtActionPoint(point: ComputerPoint): Promise<string | undefined> {
    try {
      return topmostWindowAtPoint(await this.readWindows(), point)?.id;
    } catch {
      return undefined;
    }
  }

  // Windows without bounds cannot be captured — a backend without `windowBounds` has no geometry — so
  // they are skipped rather than attempted. `agentFocusOnly` stops after the first step: action
  // observation must not drift to the human's active window when the agent's focus is nowhere.
  private async focusedCapturableWindow(
    agentFocusOnly = false,
  ): Promise<ComputerWindow | undefined> {
    const candidates = (await this.readWindows()).filter(
      (window) => window.bounds !== undefined && window.visible && !window.minimized,
    );
    const agentFocused = candidates.find((window) => window.focused);
    if (agentFocused !== undefined || agentFocusOnly) return agentFocused;
    return (
      candidates.find((window) => window.active === true) ??
      candidates.toSorted(
        (first, second) =>
          (first.stackingIndex ?? Number.MAX_SAFE_INTEGER) -
          (second.stackingIndex ?? Number.MAX_SAFE_INTEGER),
      )[0]
    );
  }

  async getScreenSize(): Promise<ComputerGetScreenSizeResult> {
    this.engageBackend();
    const [availability, screenSize] = await Promise.all([
      this.backend.availability(),
      this.backend.getScreenSize(),
    ]);
    return { computerId: this.computerId, screenSize, availability };
  }

  // A verified background backend reserves the launched app; other backends keep the desktop lease
  // because their launch may use shared input state. A background launch must still create a usable
  // window.
  async launchApp(
    threadId: string | undefined,
    app: string,
    args: readonly string[] = [],
    waitForWindowMs = 0,
    options?: { readonly hidden?: boolean },
  ): Promise<ComputerLaunchAppResult> {
    return this.withBackgroundAppControl(threadId, app, async () => {
      markComputerCall("computer_launch_app");
      assertDesktopOperationActive();
      this.assertDrivenAppAllowed(app);
      this.spaceBroker.assertNativeLaunchAllowed(agentThreadId(threadId));
      const result = await timedComputerLeg("dispatch", () =>
        this.backend.launchApp(app, args, options),
      );
      const owner = agentThreadId(threadId);
      if (
        result.focusChangedDuringLaunch === true &&
        owner &&
        desktopDeliveryMode() !== "foreground"
      ) {
        const state = this.threadRuntime(owner);
        state.inputPause = {
          ...(result.window ? { windowId: result.window.id } : {}),
          ...(result.pid !== undefined ? { pid: result.pid } : {}),
          message:
            "The app changed desktop focus while launching. The launch already happened; do not replay it. Observe the app's exact window before continuing background input.",
        };
        this.publishCached(owner);
      }
      this.emitAction(threadId, "computer_launch_app");
      if (!result.window && result.windowStatus !== "no_usable_window" && waitForWindowMs > 0) {
        const readiness = await waitForWindow(
          () => this.readWindows(),
          app,
          waitForWindowMs,
          desktopOperationSignal(),
          {
            ...(result.pid !== undefined ? { pid: result.pid } : {}),
            ...(this.backend.checkInputReady
              ? { checkInputReady: (windowId: string) => this.backend.checkInputReady!(windowId) }
              : {}),
          },
        ).catch(() => {
          assertDesktopOperationActive();
          return {
            window: null,
            windowStatus: "no_usable_window" as const,
            windowReason: "input_unavailable" as const,
          };
        });
        return { ...result, ...readiness };
      }
      return {
        ...result,
        windowStatus: result.windowStatus ?? (result.window ? "ready" : "not_checked"),
      };
    });
  }

  async listApps(): Promise<ComputerListAppsResult> {
    this.engageBackend();
    const listApps = this.backend.listApps?.bind(this.backend);
    if (!listApps) throw new ComputerBackendError("This backend cannot enumerate applications.");
    const [availability, apps] = await Promise.all([this.backend.availability(), listApps()]);
    return { computerId: this.computerId, apps, availability };
  }

  private async admitWindowTarget(
    threadId: string | undefined,
    target: ComputerWindow,
  ): Promise<void> {
    this.assertDrivenAppAllowed(target.appName ?? target.id);
    await this.assertWindowInputAllowedWindow(threadId, target);
  }

  private async resolveWindowTarget(
    threadId: string | undefined,
    windowId: string,
  ): Promise<ComputerWindow> {
    const windows = await timedComputerLeg("resolve", () => this.readWindows());
    const target = windows.find((candidate) => candidate.id === windowId);
    if (!target) throw windowNotFoundError(windowId);
    await this.admitWindowTarget(threadId, target);
    return target;
  }

  async setWindowFrame(
    threadId: string | undefined,
    windowId: string,
    frame: ComputerRect,
  ): Promise<ComputerActionResult> {
    return this.withBackgroundProcessControl(threadId, windowId, async () => {
      const setter = this.backend.setWindowFrame?.bind(this.backend);
      if (!setter) throw new ComputerBackendError("This backend cannot move or resize windows.");
      const target = await this.resolveWindowTarget(threadId, windowId);
      if (target.pid !== undefined) await this.assertSpaceAppMutationAllowed(threadId, target.pid);
      const result = await timedComputerLeg("dispatch", () => setter(windowId, frame));
      return this.actionResult(threadId, "computer_set_window_frame", undefined, result, windowId);
    });
  }

  // Native menus may activate an app, so both window and app targets require visible-use consent and
  // focus restoration.
  async invokeMenu(
    threadId: string | undefined,
    target: ComputerMenuTarget,
    path: readonly string[],
    authorization?: ComputerForegroundAuthorization,
  ): Promise<ComputerActionResult> {
    return this.withForegroundRestore(
      threadId,
      () =>
        withDesktopDeliveryMode("foreground", async () => {
          const invoke = this.backend.invokeMenu?.bind(this.backend);
          if (!invoke) throw new ComputerBackendError("This backend cannot invoke menu items.");
          if ("windowId" in target) {
            const window = await this.resolveWindowTarget(threadId, target.windowId);
            if (window.pid !== undefined)
              await this.assertSpaceAppMutationAllowed(threadId, window.pid);
            const result = await timedComputerLeg("dispatch", () =>
              invoke({ windowId: target.windowId }, path),
            );
            return this.actionResult(
              threadId,
              "computer_invoke_menu",
              undefined,
              result,
              target.windowId,
            );
          }

          const resolved = await timedComputerLeg("resolve", () =>
            this.resolveMenuAppTarget(target),
          );
          const consentKey = "app" in target ? target.app : (resolved.name ?? `pid ${target.pid}`);
          this.assertDrivenAppAllowed(consentKey);
          if (agentThreadId(threadId) !== undefined) {
            const denied = await this.deniedMatchForPid(resolved.pid, resolved.name);
            if (denied) throw new ComputerDenylistError(denied.app, denied.matched);
          }
          await this.assertSpaceAppMutationAllowed(threadId, resolved.pid);
          const result = await timedComputerLeg("dispatch", () =>
            invoke({ pid: resolved.pid }, path),
          );
          return this.actionResult(threadId, "computer_invoke_menu", undefined, result);
        }),
      authorization,
    );
  }

  // An `app` is resolved through the same running-app inventory the consent path consults — exact
  // name or bundle id, case-insensitive — and refuses when nothing matches; a `pid` is passed through
  // with whatever name the inventory has for it, because an unknown pid is the driver's refusal to
  // make, matching set_app_visibility.
  private async resolveMenuAppTarget(
    target: Exclude<ComputerMenuTarget, { readonly windowId: string }>,
  ): Promise<{ readonly pid: number; readonly name?: string }> {
    const listApps = this.backend.listApps?.bind(this.backend);
    if (listApps === undefined) {
      throw new ComputerBackendError(
        "This backend cannot enumerate applications, so a menu target has to name an exact window.",
      );
    }
    if ("pid" in target) {
      if (!Number.isSafeInteger(target.pid) || target.pid <= 0) {
        throw new ComputerTargetError({
          code: "computer_target_invalid",
          message: `"pid" must be a positive integer; got ${JSON.stringify(target.pid)}.`,
        });
      }
      const owner = (await listApps()).find((app) => app.pid === target.pid && app.running);
      return { pid: target.pid, ...(owner !== undefined ? { name: owner.name } : {}) };
    }
    const spelling = target.app.trim();
    const owner = (await listApps()).find(
      (app) =>
        app.running &&
        (app.name.trim().toLowerCase() === spelling.toLowerCase() ||
          (app.bundleId !== undefined && app.bundleId.toLowerCase() === spelling.toLowerCase())),
    );
    if (owner === undefined) throw menuAppNotFoundError(spelling);
    return { pid: owner.pid, name: owner.name };
  }

  // Same lease, window-existence proof, and owning-app consent as a frame move: nothing here
  // activates or switches Spaces.
  async setWindowMinimized(
    threadId: string | undefined,
    windowId: string,
    minimized: boolean,
  ): Promise<ComputerActionResult> {
    return this.withBackgroundProcessControl(threadId, windowId, async () => {
      const setter = this.backend.setWindowMinimized?.bind(this.backend);
      if (!setter)
        throw new ComputerBackendError("This backend cannot minimize or restore windows.");
      const target = await this.resolveWindowTarget(threadId, windowId);
      if (target.pid !== undefined) await this.assertSpaceAppMutationAllowed(threadId, target.pid);
      const result = await timedComputerLeg("dispatch", () => setter(windowId, minimized));
      return this.actionResult(
        threadId,
        "computer_set_window_minimized",
        undefined,
        result,
        windowId,
      );
    });
  }

  async setAppVisibility(
    threadId: string | undefined,
    pid: number,
    hidden: boolean,
  ): Promise<ComputerActionResult & { readonly note?: string }> {
    return this.withDesktopControl(threadId, async () => {
      const setter = this.backend.setAppVisibility?.bind(this.backend);
      if (!setter)
        throw new ComputerBackendError("This backend cannot hide or unhide applications.");
      const named = await timedComputerLeg("resolve", async () => {
        const listApps = this.backend.listApps?.bind(this.backend);
        if (!listApps) return undefined;
        const apps = await listApps().catch(() => undefined);
        return apps?.find((app) => app.pid === pid && app.running)?.name;
      });
      this.assertDrivenAppAllowed(named ?? `pid ${pid}`);
      if (agentThreadId(threadId) !== undefined) {
        const denied = await this.deniedMatchForPid(pid, named);
        if (denied) throw new ComputerDenylistError(denied.app, denied.matched);
      }
      await this.assertSpaceAppMutationAllowed(threadId, pid);
      const result = await timedComputerLeg("dispatch", () => setter(pid, hidden));
      const base = this.actionResult(threadId, "computer_set_app_visibility", undefined, result);

      if (hidden || this.lastKnownWindowIds === undefined) return base;
      if ([...this.lastKnownWindows.values()].some((window) => window.pid === pid)) return base;
      return {
        ...base,
        note:
          "This app has no window in the last desktop listing, so the unhide had nothing to show. " +
          "Create a window with the app-level computer_invoke_menu (name the app or pid, e.g. " +
          '["File", "New Window"]), or bind the driver-owned headless browser with ' +
          "computer_browser_prepare and computer_browser_state.",
      };
    });
  }

  private async assertScopedWindowReadable(windowId: string): Promise<void> {
    const windows = await this.readWindows();
    if (!windows.some((candidate) => candidate.id === windowId))
      throw windowNotFoundError(windowId);
    await this.assertWindowContentAllowed(windowId);
  }

  async verifyState(
    windowId: string,
    expect: readonly Record<string, unknown>[],
  ): Promise<ComputerVerifyStateResult> {
    this.engageBackend();
    const verify = this.backend.verifyState?.bind(this.backend);
    if (!verify) throw new ComputerBackendError("This backend cannot verify window state.");
    await this.assertScopedWindowReadable(windowId);
    return verify(windowId, expect);
  }

  async zoomWindow(windowId: string, region: ComputerRect): Promise<ComputerZoomResult> {
    this.engageBackend();
    const zoom = this.backend.zoomWindow?.bind(this.backend);
    if (!zoom) throw new ComputerBackendError("This backend cannot capture zoomed regions.");
    await this.assertScopedWindowReadable(windowId);
    return zoom(windowId, region);
  }

  async killApp(threadId: string | undefined, windowId: string): Promise<ComputerActionResult> {
    return this.withBackgroundProcessControl(threadId, windowId, async () => {
      const kill = this.backend.killApp?.bind(this.backend);
      if (!kill) throw new ComputerBackendError("This backend cannot terminate applications.");
      // The pid gate runs ahead of admission, as it always has: a window without one reports not-found
      // rather than prompting consent first.
      const windows = await timedComputerLeg("resolve", () => this.readWindows());
      const target = windows.find((candidate) => candidate.id === windowId);
      if (!target?.pid) throw windowNotFoundError(windowId);
      await this.admitWindowTarget(threadId, target);
      await this.assertSpaceAppMutationAllowed(threadId, target.pid);
      const result = await timedComputerLeg("dispatch", () => kill(target.pid!));
      return this.actionResult(threadId, "computer_kill_app", undefined, result, windowId);
    });
  }

  async getAccessibilityTree(windowId?: string): Promise<ComputerAccessibilityTreeResult> {
    this.engageBackend();
    const read = this.backend.getAccessibilityTree?.bind(this.backend);
    if (!read) throw new ComputerBackendError("This backend cannot read the desktop inventory.");
    if (windowId !== undefined) await this.assertScopedWindowReadable(windowId);
    const [availability, snapshot] = await Promise.all([
      this.backend.availability(),
      read(windowId),
    ]);
    return {
      computerId: this.computerId,
      ...snapshot,
      ...(windowId !== undefined ? { windowId } : {}),
      availability,
    };
  }

  // Where the human's pointer sits, in desktop points — a pure read that never takes the control
  // lease or touches the pointer. `windowId`, when given, is a scoping read the same way
  // `getAccessibilityTree`'s is: the window must still exist, and the answer reports whether the
  // point lies inside its bounds.
  async getCursorPosition(windowId?: string): Promise<ComputerCursorPosition> {
    this.engageBackend();
    const read = this.backend.getCursorPosition?.bind(this.backend);
    if (!read) throw new ComputerBackendError("This backend cannot read the cursor position.");
    if (windowId !== undefined) await this.assertScopedWindowReadable(windowId);
    const [availability, point] = await Promise.all([this.backend.availability(), read(windowId)]);
    return { computerId: this.computerId, ...point, availability };
  }

  async getThreadState(threadId: string): Promise<ThreadComputerState> {
    const state = this.suspendedThreads.has(threadId)
      ? (this.threads.get(threadId) ?? this.newThreadRuntime())
      : this.threadRuntime(threadId);
    await this.refreshPhysicalState();
    return (await this.publish(threadId)) ?? this.threadSnapshot(threadId, state);
  }

  async withUserPointTarget<A>(
    point: ComputerPoint,
    action: (target: ComputerTarget) => Promise<A>,
  ): Promise<A> {
    assertDesktopOperationAdmission();
    return this.operations.run(async () => {
      if (this.agentDialect !== "macos") return action(point);
      this.engageBackend();
      const window = topmostWindowAtPoint(await this.readWindows(), point);
      if (!window)
        throw new ComputerTargetError({
          code: "computer_target_not_found",
          message: "No exact window is available at this point.",
        });
      const image = await this.backend.captureScreenshot({
        kind: "window",
        windowId: window.id,
      });
      return action({
        ...point,
        windowId: window.id,
        observedWindowBounds: image.region,
      } as ComputerTarget);
    });
  }

  async click(
    threadId: string | undefined,
    target: ComputerTarget,
    modifiers?: readonly ComputerInputModifier[],
    gesture?: ComputerClickGesture,
  ): Promise<ComputerActionResult> {
    return await this.pointerClick(threadId, target, modifiers, gesture);
  }

  async doubleClick(
    threadId: string | undefined,
    target: ComputerTarget,
    modifiers?: readonly ComputerInputModifier[],
  ): Promise<ComputerActionResult> {
    return await this.click(threadId, target, modifiers, { count: 2 });
  }

  async tripleClick(
    threadId: string | undefined,
    target: ComputerTarget,
    modifiers?: readonly ComputerInputModifier[],
  ): Promise<ComputerActionResult> {
    return await this.click(threadId, target, modifiers, { count: 3 });
  }

  async rightClick(
    threadId: string | undefined,
    target: ComputerTarget,
    modifiers?: readonly ComputerInputModifier[],
  ): Promise<ComputerActionResult> {
    return await this.click(threadId, target, modifiers, { button: "right" });
  }

  private async pointerClick(
    threadId: string | undefined,
    target: ComputerTarget,
    modifiers: readonly ComputerInputModifier[] | undefined,
    gesture: ComputerClickGesture | undefined,
  ): Promise<ComputerActionResult> {
    return this.withBackgroundProcessControl(threadId, target.windowId, async () => {
      markComputerCall("computer_click");
      const inject = this.clickInjector(gesture);
      const resolved = await timedComputerLeg("resolve", () =>
        this.resolvePointTarget(target, threadId),
      );
      await timedComputerLeg("resolve", () => this.prepareResolvedTarget(resolved, threadId));
      const semantic = resolved.semantic;
      if (
        (gesture?.button ?? "left") === "left" &&
        (gesture?.count ?? 1) === 1 &&
        !modifiers?.length &&
        semantic !== undefined &&
        this.backend.supportsAction?.(semantic, "AXPress")
      ) {
        assertDesktopOperationActive();
        // Select one actuator before dispatch. An uncertain AX press must never fall through to a
        // coordinate click (toggles could run twice).
        const nativeAction = this.backend.agentDialect === "macos" ? "AXPress" : "press";
        const result = await timedComputerLeg("dispatch", () =>
          this.backend.performAction(semantic, nativeAction),
        );
        return this.actionResult(
          threadId,
          "computer_click",
          resolved.point,
          result,
          resolved.windowId,
        );
      }
      this.assertTargetCanUseCoordinates(target);
      const result = await this.injectScoped("computer_click", resolved, () =>
        inject(resolved.point, resolved.windowId, modifiers),
      );
      return this.actionResult(
        threadId,
        "computer_click",
        resolved.point,
        result,
        resolved.windowId,
      );
    });
  }

  // Reject unsupported click gestures before target resolution. Separate clicks cannot substitute for
  // the native line-selection gesture.
  private clickInjector(
    gesture: ComputerClickGesture | undefined,
  ): (
    point: ComputerPoint,
    windowId: string | undefined,
    modifiers: readonly ComputerInputModifier[] | undefined,
  ) => Promise<ComputerBackendActionResult | void> {
    const button = gesture?.button ?? "left";
    const count = gesture?.count ?? 1;
    if (button === "left") {
      if (count === 1) {
        return (point, windowId, modifiers) => this.backend.click(point, windowId, modifiers);
      }
      if (count === 2) {
        return (point, windowId, modifiers) => this.backend.doubleClick(point, windowId, modifiers);
      }
      const tripleClick = this.backend.tripleClick?.bind(this.backend);
      if (!tripleClick) throw tripleClickUnsupportedError();
      return (point, windowId, modifiers) => tripleClick(point, windowId, modifiers);
    }
    if (button === "right" && count === 1) {
      return (point, windowId, modifiers) => this.backend.rightClick(point, windowId, modifiers);
    }
    throw clickGestureUnsupportedError(button, count);
  }

  async activateWindow(
    threadId: string | undefined,
    windowId: string,
    authorization?: ComputerForegroundAuthorization,
  ): Promise<ComputerActionResult> {
    return this.withDesktopControl(
      threadId,
      async () => {
        markComputerCall("computer_activate_window");
        const raise = this.backend.raiseWindow?.bind(this.backend);
        if (!raise || !this.backendCapabilities.raise) {
          throw activationUnsupportedError();
        }
        const target = await this.resolveWindowTarget(threadId, windowId);
        if (target.pid !== undefined)
          await this.assertSpaceAppMutationAllowed(threadId, target.pid);
        await timedComputerLeg("dispatch", async () => {
          await raise(windowId);
          // Aiming after the raise, never before: a raise that refuses must not leave the keyboard pointed at
          // a window this call just declined to move.
          assertDesktopOperationActive();
          await this.backend.focusWindow?.(windowId);
        });
        return this.actionResult(
          threadId,
          "computer_activate_window",
          undefined,
          undefined,
          windowId,
        );
      },
      () => this.assertForegroundAllowed(threadId, authorization),
    );
  }

  // Called only from the computer_activate_window tool entry, whose approval covers the whole
  // excursion — including the restore, which never prompts a second time. The steps: record the
  // frontmost window id from the existing topmost-first window listing (no new native surface; a
  // listing of only hidden windows records null with a note) → raise and aim via the existing
  // activate path → run the approved input, if one was given → restore the recorded window via the
  // same raise path → re-observe the target with a fresh listing. A restore that fails is still a
  // successful activation, never a silent one: the result carries a note naming the window that was
  // not put back, and the computer.action event carries the same window plus the restore status.
  async foregroundWithRestore(
    threadId: string | undefined,
    windowId: string,
    input?: () => Promise<unknown>,
    authorization?: ComputerForegroundAuthorization,
  ): Promise<ComputerActionResult & { readonly note?: string }> {
    currentComputerCall()?.timing?.count("foreground_excursion");
    return this.withDesktopControl(
      threadId,
      async () => {
        markComputerCall("computer_activate_window");
        const raise = this.backend.raiseWindow?.bind(this.backend);
        if (!raise || !this.backendCapabilities.raise) {
          throw activationUnsupportedError();
        }
        const windows = await timedComputerLeg("resolve", () => this.readWindows());
        const target = windows.find((candidate) => candidate.id === windowId);
        if (!target) {
          throw windowNotFoundError(windowId);
        }
        const previousId =
          windows.find((candidate) => candidate.visible && !candidate.minimized)?.id ?? null;
        this.assertDrivenAppAllowed(target.appName ?? windowId);
        await this.assertWindowInputAllowedWindow(threadId, target);
        if (target.pid !== undefined)
          await this.assertSpaceAppMutationAllowed(threadId, target.pid);

        const shieldId = await this.engageActivationShield(threadId, target);
        try {
          await timedComputerLeg("dispatch", async () => {
            await raise(windowId);
            // Aiming after the raise, never before: a raise that refuses must not leave the keyboard pointed at
            // a window this call just declined to move.
            assertDesktopOperationActive();
            await this.backend.focusWindow?.(windowId);
          });
          if (input) {
            try {
              assertDesktopOperationActive();
              await input();
            } catch (error) {
              // Input that failed after the raise must not leave the desktop rearranged: restore best-effort,
              // then report the input failure.
              if (previousId !== null && previousId !== windowId) {
                await raise(previousId).catch(() => undefined);
                await this.backend.focusWindow?.(previousId)?.catch(() => undefined);
              }
              throw error;
            }
          }
          let restore: ForegroundRestoreInfo;
          let note: string | undefined;
          if (previousId === null) {
            restore = {
              restoredWindowId: null,
              restoreStatus: "frontmost-unobservable",
            };
            note = "No frontmost window was observable before activation, so nothing was restored.";
          } else if (previousId === windowId) {
            restore = {
              restoredWindowId: null,
              restoreStatus: "already-frontmost",
            };
          } else {
            try {
              assertDesktopOperationActive();
              await raise(previousId);
              await this.backend.focusWindow?.(previousId);
              restore = {
                restoredWindowId: previousId,
                restoreStatus: "restored",
              };
            } catch {
              restore = {
                restoredWindowId: previousId,
                restoreStatus: "restore-missed",
              };
              note =
                `Activated window ${JSON.stringify(windowId)} but could not restore the previously ` +
                `frontmost window ${JSON.stringify(previousId)} to the foreground; the desktop was ` +
                `left with ${JSON.stringify(windowId)} raised.`;
            }
          }
          // A fresh listing so the next read sees the desktop as it was left. Best effort: the activation
          // already succeeded, and a stale listing must not fail it.
          try {
            await this.readWindows();
          } catch {}
          const merged = computerBackendActionResult(this.computerId, "computer_activate_window", {
            windowId,
          });
          this.emitForegroundRestoreAction(threadId, merged, restore, note, shieldId !== undefined);
          return note !== undefined ? { ...merged, note } : merged;
        } finally {
          if (shieldId !== undefined) await this.releaseActivationShield(shieldId);
        }
      },
      () => this.assertForegroundAllowed(threadId, authorization),
    );
  }

  // Restore the human's foreground window after every approved foreground action. A failed restore
  // warns without failing an action that already succeeded.
  async withForegroundRestore<T>(
    threadId: string | undefined,
    action: () => Promise<T>,
    authorization?: ComputerForegroundAuthorization,
  ): Promise<T> {
    currentComputerCall()?.timing?.count("foreground_excursion");
    return this.withDesktopControl(
      threadId,
      async () => {
        const before = await timedComputerLeg("resolve", () => this.readWindows());
        const previousId =
          before.find((candidate) => candidate.visible && !candidate.minimized)?.id ?? null;
        let outcome:
          | { readonly ok: true; readonly value: T }
          | { readonly ok: false; readonly error: unknown };
        try {
          outcome = { ok: true, value: await action() };
        } catch (error) {
          outcome = { ok: false, error };
        }
        if (previousId !== null) {
          const raise = this.backend.raiseWindow?.bind(this.backend);
          if (raise && this.backendCapabilities.raise) {
            let frontmost: string | null | undefined;
            try {
              const after = await timedComputerLeg("resolve", () => this.readWindows());
              frontmost =
                after.find((candidate) => candidate.visible && !candidate.minimized)?.id ?? null;
            } catch {
              frontmost = undefined;
            }
            if (frontmost === undefined) {
              // The post-call read failed, so whether the excursion left the target raised is unknown — the
              // restore cannot run blind, and a possibly stolen frontmost must not pass without a trace.
              console.warn("[computer] foreground call left focus unverified", {
                previousWindowId: previousId,
              });
            } else if (frontmost !== null && frontmost !== previousId) {
              try {
                assertDesktopOperationActive();
                await raise(previousId);
                await this.backend.focusWindow?.(previousId);
              } catch (error) {
                console.warn("[computer] foreground call left focus unrestored", {
                  restoredWindowId: previousId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }
        }
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
      },
      () => {
        this.assertForegroundAllowed(threadId, authorization);
        this.spaceBroker.assertForegroundAllowed(agentThreadId(threadId));
      },
    );
  }

  // Kept separate from emitAction so the existing action path is untouched; the two new fields ride
  // as extras (with the note in the schema's message) because the contract's event shape does not
  // name them yet. `masked` records whether the excursion ran under the activation shield — the
  // disclosure trail for a delivery the operator could not watch directly.
  private emitForegroundRestoreAction(
    threadId: string | undefined,
    result: ComputerActionResult,
    restore: ForegroundRestoreInfo,
    note: string | undefined,
    masked: boolean,
  ): void {
    const attributed = agentThreadId(threadId);
    if (attributed) this.surfacePaneForAgent(attributed);
    this.emit({
      type: "computer.action",
      ...(result.windowId ? { windowId: result.windowId } : {}),
      ...(result.delivery ? { delivery: result.delivery } : {}),
      action: "computer_activate_window",
      ok: true,
      ...(attributed ? { threadId: ThreadId.makeUnsafe(attributed) } : {}),
      ...(restore.restoredWindowId !== null ? { restoredWindowId: restore.restoredWindowId } : {}),
      restoreStatus: restore.restoreStatus,
      ...(masked ? { masked: true } : {}),
      ...(note !== undefined
        ? {
            message: clampComputerMessage(note, "The foreground window could not be restored."),
          }
        : {}),
    } as ComputerEvent);
  }

  // When the opt-in does name the app, the shield becomes mandatory: a backend that cannot show it
  // (missing surface, refused engage, lost reply) fails the activation rather than degrading to an
  // unmasked raise. The shield id is minted here — not by the backend — so a lost engage reply still
  // leaves this side holding the release handle.
  private async engageActivationShield(
    _threadId: string | undefined,
    target: ComputerWindow,
  ): Promise<string | undefined> {
    if (!cuaMaskedActivationEnabled()) return undefined;
    if (this.agentDialect !== "macos") return undefined;
    const optIn = cuaMaskedActivationOptIn();
    if (optIn.size === 0) return undefined;
    const owner =
      target.pid !== undefined
        ? (await this.runningAppsForDenylist()).find((candidate) => candidate.pid === target.pid)
        : undefined;
    if (!maskedActivationOptedIn(optIn, owner?.bundleId)) return undefined;
    const engage = this.backend.engageShield?.bind(this.backend);
    if (!engage || !target.bounds) {
      throw new ComputerBackendError(
        "Masked activation is armed for this app but the activation shield is unavailable; the window was not raised.",
      );
    }
    const appName = target.title?.trim() || target.appName || "this window";
    const label = `Glade is activating ${appName}`;
    const shieldId = `shield-${randomUUID().slice(0, 8)}`;
    try {
      return await timedComputerLeg("shield", () =>
        engage({ shieldId, windowId: target.id, frame: target.bounds!, label }),
      );
    } catch (error) {
      await this.releaseActivationShield(shieldId);
      if (error instanceof ComputerBackendError) throw error;
      throw new ComputerBackendError(
        `The activation shield could not be shown, so the window was not raised: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async releaseActivationShield(shieldId: string): Promise<void> {
    const release = this.backend.releaseShield?.bind(this.backend);
    if (!release) return;
    try {
      await withoutDesktopCancellation(() => release(shieldId));
    } catch (error) {
      console.warn("[computer] activation shield release failed", {
        shieldId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async moveCursor(
    threadId: string | undefined,
    target: ComputerTarget,
  ): Promise<ComputerActionResult> {
    this.assertTargetCanUseCoordinates(target);
    return this.withBackgroundProcessControl(threadId, target.windowId, async () => {
      const resolved = await timedComputerLeg("resolve", () =>
        this.resolvePointTarget(target, threadId),
      );
      await timedComputerLeg("resolve", () => this.revealTarget(resolved));
      const result = await this.injectScoped("computer_move_cursor", resolved, () =>
        this.backend.moveCursor(resolved.point, resolved.windowId),
      );
      return this.actionResult(
        threadId,
        "computer_move_cursor",
        resolved.point,
        result,
        resolved.windowId,
      );
    });
  }

  async drag(
    threadId: string | undefined,
    from: ComputerTarget,
    to: ComputerTarget,
    durationMs = 250,
  ): Promise<ComputerActionResult> {
    this.assertTargetCanUseCoordinates(from);
    this.assertTargetCanUseCoordinates(to);
    return this.withDesktopControl(threadId, async () => {
      const [resolvedFrom, resolvedTo] = await timedComputerLeg("resolve", () =>
        Promise.all([
          this.resolvePointTarget(from, threadId),
          this.resolvePointTarget(to, threadId),
        ]),
      );

      const grabbed = resolvedFrom.windowId ? resolvedFrom : resolvedTo;
      await timedComputerLeg("resolve", () => this.prepareResolvedTarget(grabbed, threadId));
      const result = await this.injectScoped("computer_drag", grabbed, () =>
        this.backend.drag(resolvedFrom.point, resolvedTo.point, durationMs, resolvedFrom.windowId),
      );
      return this.actionResult(
        threadId,
        "computer_drag",
        resolvedTo.point,
        result,
        resolvedTo.windowId ?? resolvedFrom.windowId,
      );
    });
  }

  // Their gesture must never be re-geared — they are watching the result and closing the loop
  // themselves, and a correction applied under their hand would fight them.
  async scroll(
    threadId: string | undefined,
    target: ComputerTarget | null,
    deltaX: number,
    deltaY: number,
  ): Promise<ComputerActionResult> {
    return this.withBackgroundProcessControl(threadId, target?.windowId, async () => {
      const resolved = await timedComputerLeg("resolve", () =>
        this.prepareScrollTarget(target, threadId),
      );
      const result = await this.injectScroll(resolved, deltaX, deltaY, undefined);
      return this.actionResult(
        threadId,
        "computer_scroll",
        resolved?.point,
        result,
        resolved?.windowId,
      );
    });
  }

  // Clients apply different scroll gearing without reporting it. Measure actual travel after
  // delivery; failed perception must not fail a delivered scroll. Probe unmeasured targets before the
  // main gesture so large gearing cannot destroy image overlap needed for calibration.
  async scrollCalibrated(
    threadId: string | undefined,
    target: ComputerTarget | null,
    deltaX: number,
    deltaY: number,
    options: {
      readonly observe: boolean;

      readonly modifiers?: readonly ComputerInputModifier[];
    },
  ): Promise<{
    readonly result: ComputerActionResult;
    readonly observation?: ComputerActionObservation;
  }> {
    return this.withBackgroundProcessControl(threadId, target?.windowId, async () => {
      const attributed = agentThreadId(threadId);
      const cursorPoint =
        target !== null ? undefined : attributed ? this.threads.get(attributed)?.cursor : undefined;
      const preClearFocusId = target !== null ? undefined : await this.agentFocusWindowId();
      const resolved = await timedComputerLeg("resolve", () =>
        this.prepareScrollTarget(target, threadId),
      );

      const observedWindowId =
        resolved?.windowId ??
        (resolved?.point ? await this.windowIdAtActionPoint(resolved.point) : undefined) ??
        (cursorPoint ? await this.windowIdAtActionPoint(cursorPoint) : undefined) ??
        preClearFocusId ??
        (await this.agentFocusWindowId());
      const before = !options.observe
        ? undefined
        : await this.captureForMeasurement(observedWindowId);

      const observedWindow =
        observedWindowId === undefined
          ? undefined
          : (await this.readWindows()).find((window) => window.id === observedWindowId);
      const appKey =
        observedWindow?.appName ??
        (observedWindow?.pid !== undefined ? `pid:${observedWindow.pid}` : undefined);
      const windowKey = (route: string) =>
        observedWindowId === undefined ? undefined : `${observedWindowId}|${route}`;
      const durableKey = (route: string) =>
        appKey === undefined ? undefined : `${appKey}|${route}`;

      const plannedRoute = (legDeltaX: number) =>
        resolved?.semantic !== undefined && legDeltaX === 0 && !options.modifiers?.length
          ? "ax"
          : "wheel";
      // The backend reports which rung actually ran; trust it over the plan.
      const legRoute = (leg: ComputerBackendActionResult | void, planned: string) =>
        leg?.deliveryPath?.startsWith("cua-ax") === true
          ? "ax"
          : leg?.deliveryPath !== undefined
            ? "wheel"
            : planned;
      const measured = (route: string) =>
        this.scrollGearing.has(windowKey(route)) ||
        this.scrollGearingFile.get(durableKey(route)) !== undefined;
      const plan = (route: string, requested: number) =>
        this.scrollGearing.plan(
          windowKey(route),
          requested,
          this.scrollGearingFile.get(durableKey(route)),
        );

      let injectedX = 0;
      let injectedY = 0;
      let after: ComputerCapturedWindow | undefined;
      let traveledY: number | undefined;
      let result: ComputerBackendActionResult | void;
      const routes: string[] = [];
      let reportedGearing: number | undefined;

      if (
        before !== undefined &&
        observedWindowId !== undefined &&
        !measured(plannedRoute(0)) &&
        Math.abs(deltaY) > SCROLL_PROBE_TRIGGER_PX
      ) {
        const probe = Math.sign(deltaY) * SCROLL_PROBE_PX;
        const probeResult = await this.injectScroll(resolved, 0, probe, options.modifiers);
        result = probeResult;

        const probeInjected = probeResult?.scrollDelta?.deltaY ?? probe;
        injectedY += probeInjected;
        const probeRoute = legRoute(probeResult, plannedRoute(0));
        routes.push(probeRoute);
        const probeLeg = await this.settleAndMeasure(
          observedWindowId,
          before,
          probeInjected,
          windowKey(probeRoute),
          durableKey(probeRoute),
        );
        after = probeLeg.capture;

        const covered =
          probeLeg.traveled !== undefined && Math.sign(probeLeg.traveled) === Math.sign(deltaY)
            ? probeLeg.traveled
            : probeInjected;
        const remainder = Math.abs(covered) >= Math.abs(deltaY) ? 0 : deltaY - covered;

        const legX = plan(plannedRoute(deltaX), deltaX);
        const legY = plan(plannedRoute(deltaX), remainder);
        if (legX !== 0 || legY !== 0) {
          const remainderResult = await this.injectScroll(resolved, legX, legY, options.modifiers);
          result = remainderResult;
          injectedX += remainderResult?.scrollDelta?.deltaX ?? legX;
          injectedY += remainderResult?.scrollDelta?.deltaY ?? legY;
          const remainderRoute = legRoute(remainderResult, plannedRoute(deltaX));
          routes.push(remainderRoute);
          if (after) {
            const remainderLeg = await this.settleAndMeasure(
              observedWindowId,
              after,
              remainderResult?.scrollDelta?.deltaY ?? legY,
              windowKey(remainderRoute),
              durableKey(remainderRoute),
            );
            after = remainderLeg.capture ?? after;
            traveledY =
              probeLeg.traveled !== undefined && remainderLeg.traveled !== undefined
                ? probeLeg.traveled + remainderLeg.traveled
                : undefined;
          }
        } else {
          traveledY = probeLeg.traveled;
        }
      } else {
        const route = plannedRoute(deltaX);
        injectedX = plan(route, deltaX);
        injectedY = plan(route, deltaY);
        result = await this.injectScroll(resolved, injectedX, injectedY, options.modifiers);
        injectedX = result?.scrollDelta?.deltaX ?? injectedX;
        injectedY = result?.scrollDelta?.deltaY ?? injectedY;
        const actualRoute = legRoute(result, route);
        routes.push(actualRoute);
        if (before) {
          const leg = await this.settleAndMeasure(
            observedWindowId,
            before,
            injectedY,
            windowKey(actualRoute),
            durableKey(actualRoute),
          );
          after = leg.capture;
          traveledY = leg.traveled;
        }
      }

      const reportRoute = routes[routes.length - 1];
      if (observedWindowId !== undefined && reportRoute !== undefined) {
        const key = windowKey(reportRoute);
        reportedGearing = this.scrollGearing.has(key)
          ? this.scrollGearing.gearing(key)
          : (this.scrollGearingFile.get(durableKey(reportRoute)) ?? 1);
      }

      const base = this.actionResult(
        threadId,
        "computer_scroll",
        resolved?.point,
        result,
        resolved?.windowId,
      );
      return {
        result: {
          ...base,
          scroll: {
            requested: { deltaX, deltaY },
            injected: { deltaX: round2(injectedX), deltaY: round2(injectedY) },
            ...(traveledY === undefined ? {} : { traveledY: round2(traveledY) }),
            ...(reportedGearing === undefined ? {} : { gearing: round2(reportedGearing) }),
            ...(routes.length === 0 ? {} : { routes }),
          },
        },
        ...(after ? { observation: after } : {}),
      };
    });
  }

  private async prepareScrollTarget(
    target: ComputerTarget | null,
    threadId: string | undefined,
  ): Promise<ResolvedPointTarget | null> {
    const resolved = target ? await this.resolveScrollPointTarget(target, threadId) : null;
    await this.prepareResolvedTarget(resolved ?? undefined, threadId);
    return resolved;
  }

  private async resolveScrollPointTarget(
    target: ComputerTarget,
    threadId: string | undefined,
  ): Promise<ResolvedPointTarget> {
    const windowId = target.windowId;
    if (
      windowId === undefined ||
      target.x !== undefined ||
      target.y !== undefined ||
      hasLabelFields(target)
    ) {
      return this.resolvePointTarget(target, threadId);
    }
    await this.assertWindowInputAllowed(threadId, windowId);
    const state = await this.backend.getState({ includeTree: false });
    const match = state.root ? resolveComputerWindowTarget(state.root, windowId) : undefined;
    const windows = match ? undefined : await this.readWindows();
    const window =
      windows?.find((candidate) => candidate.id === windowId) ??
      this.lastKnownWindows.get(windowId);
    if (match) {
      return { point: match.point, windowId };
    }
    if (!window) throw windowNotFoundError(windowId);
    const bounds = window.bounds;
    if (!bounds) {
      throw new ComputerTargetError({
        code: "computer_target_offscreen",
        message:
          `This desktop reports no geometry for window ${JSON.stringify(windowId)}, so a scroll ` +
          "point inside it cannot be chosen. Scroll at x/y coordinates instead.",
      });
    }
    const point = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    return { point, windowId };
  }

  private async injectScroll(
    resolved: ResolvedPointTarget | null,
    deltaX: number,
    deltaY: number,
    modifiers: readonly ComputerInputModifier[] | undefined,
  ): Promise<ComputerBackendActionResult | void> {
    return this.injectScoped("computer_scroll", resolved ?? {}, () =>
      this.backend.scroll(
        resolved?.point ?? null,
        deltaX,
        deltaY,
        resolved?.windowId,
        modifiers,
        resolved?.semantic,
      ),
    );
  }

  // Skip settle only when measured travel proves the learned prediction arrived. Discard
  // off-prediction early measurements and compare the settled capture against the original frame,
  // never the animation tail.
  private async settleAndMeasure(
    windowId: string | undefined,
    from: ComputerCapturedWindow,
    injectedY: number,
    windowKey?: string,
    appKey?: string,
  ): Promise<{
    readonly capture?: ComputerCapturedWindow;
    readonly traveled?: number;
  }> {
    if (this.actionSettleMs > 0 && injectedY !== 0 && cuaConditionalSettleEnabled()) {
      const predictedGearing = this.scrollGearing.has(windowKey)
        ? this.scrollGearing.gearing(windowKey)
        : this.scrollGearingFile.get(appKey);
      if (predictedGearing !== undefined) {
        const expectedY = injectedY * predictedGearing;
        const early = await this.captureForMeasurement(windowId);
        if (early) {
          const traveled = await this.measureLegTravel(
            from.screenshot,
            early.screenshot,
            injectedY,
          );
          if (
            traveled !== undefined &&
            Math.abs(traveled - expectedY) <=
              Math.max(
                SCROLL_SETTLE_ARRIVAL_MIN_PX,
                Math.abs(expectedY) * SCROLL_SETTLE_ARRIVAL_TOLERANCE,
              )
          ) {
            this.learnLegTravel(windowKey ?? windowId, appKey, injectedY, traveled);
            currentComputerCall()?.timing?.count("settle_skipped");
            return { capture: early, traveled };
          }
        }
      }
    }
    if (this.actionSettleMs > 0) {
      await timedComputerLeg("settle", () => this.settleAfterAction(windowId));
    }
    const capture = await this.captureForMeasurement(windowId);
    if (!capture) return {};
    const traveled = await this.measureLegTravel(from.screenshot, capture.screenshot, injectedY);
    this.learnLegTravel(windowKey ?? windowId, appKey, injectedY, traveled);
    return { capture, ...(traveled === undefined ? {} : { traveled }) };
  }

  // The travel one capture pair supports, in logical pixels, or nothing the caller cannot trust. A
  // travel opposing the injection is the correlator locking onto the wrong feature — repetitive
  // content aliases — not a page that scrolled backwards.
  private async measureLegTravel(
    from: ComputerScreenshot,
    to: ComputerScreenshot,
    injectedY: number,
  ): Promise<number | undefined> {
    const measured = await this.measureTravel(from, to);
    return measured !== undefined &&
      measured !== 0 &&
      injectedY !== 0 &&
      Math.sign(measured) !== Math.sign(injectedY)
      ? undefined
      : measured;
  }

  private learnLegTravel(
    key: string | undefined,
    appKey: string | undefined,
    injectedY: number,
    traveled: number | undefined,
  ): void {
    if (traveled === undefined || injectedY === 0) return;
    if (this.scrollGearing.learn(key, injectedY, traveled)) {
      this.scrollGearingFile.learn(appKey, injectedY, traveled);
    }
  }

  private async agentFocusWindowId(): Promise<string | undefined> {
    try {
      return (await this.focusedCapturableWindow(true))?.id;
    } catch {
      return undefined;
    }
  }

  // Measurement-only captures must not become the thread's last delivered frame: they were never
  // shown to the model.
  private async captureForMeasurement(
    windowId: string | undefined,
  ): Promise<ComputerCapturedWindow | undefined> {
    if (!this.backendCapabilities.capture) return undefined;
    this.engageBackend();
    try {
      return await timedComputerLeg("observe", async () => {
        if (windowId === undefined) {
          return await this.captureFocusedWindow(COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION, {
            agentFocusOnly: true,
          });
        }
        return {
          screenshot: await this.backend.captureScreenshot({
            kind: "window",
            windowId,
            maxDimension: COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION,
          }),
          windowId,
        };
      });
    } catch {
      return undefined;
    }
  }

  private measurementBytes(screenshot: ComputerScreenshot): Uint8Array {
    let bytes = this.screenshotBytes.get(screenshot);
    if (!bytes) {
      bytes = Buffer.from(screenshot.bytesBase64, "base64");
      this.screenshotBytes.set(screenshot, bytes);
    }
    return bytes;
  }

  private async measureTravel(
    before: ComputerScreenshot,
    after: ComputerScreenshot,
  ): Promise<number | undefined> {
    if (before.bytesBase64 === after.bytesBase64) return 0;

    const scale = before.scale;
    if (scale === undefined || scale !== after.scale || scale <= 0) return undefined;
    const traveled = await this.measureScrollTravel(
      this.measurementBytes(before),
      this.measurementBytes(after),
    );
    return traveled === undefined ? undefined : traveled / scale;
  }

  async typeText(
    threadId: string | undefined,
    text: string,
    windowId?: string,
  ): Promise<ComputerActionResult> {
    if (this.supportsFocusNeutralSemanticText && windowId) {
      try {
        return await this.typeTextAt(threadId, text, { windowId });
      } catch (error) {
        if (!(error instanceof ComputerTargetError) || !error.unresolvedTextControl) throw error;
      }
      return this.withBackgroundProcessControl(threadId, windowId, async () => {
        const result = await this.runKeyboardDispatch(threadId, windowId, () =>
          this.backend.typeText(text, windowId),
        );
        return this.actionResult(threadId, "computer_type_text", undefined, result, windowId);
      });
    }
    return this.withDesktopControl(threadId, async () => {
      const result = await this.runKeyboardDispatch(threadId, windowId, () =>
        this.backend.typeText(text, windowId),
      );
      return this.actionResult(threadId, "computer_type_text", undefined, result, windowId);
    });
  }

  async typeTextAt(
    threadId: string | undefined,
    text: string,
    target: ComputerTarget,
  ): Promise<ComputerActionResult> {
    if (!this.supportsFocusNeutralSemanticText) {
      throw new ComputerBackendError(
        "This computer backend cannot guarantee focus-neutral semantic text input.",
      );
    }
    if (!target.windowId) {
      throw new ComputerBackendError("Focus-neutral text input requires an exact target window.");
    }
    const windowId = target.windowId;
    return this.withBackgroundWindowControl(threadId, windowId, async () => {
      const resolved = await timedComputerLeg("resolve", () =>
        this.resolveSemanticTarget(target, true),
      );
      assertDesktopOperationActive();
      const result = await timedComputerLeg("dispatch", () =>
        this.backend.typeText(text, windowId, resolved),
      );
      return this.actionResult(threadId, "computer_type_text", resolved.point, result, windowId);
    });
  }

  async pressKey(
    threadId: string | undefined,
    key: string,
    windowId?: string,
    target?: ComputerTarget,
  ): Promise<ComputerActionResult> {
    const exactWindow = this.keyboardTargetWindow(windowId, target);
    return this.withBackgroundProcessControl(threadId, exactWindow, async () => {
      const resolved = target
        ? await this.resolveSemanticTarget(
            { ...target, ...(exactWindow ? { windowId: exactWindow } : {}) },
            true,
          )
        : undefined;
      const result = await this.runKeyboardDispatch(threadId, exactWindow, () =>
        this.backend.pressKey(key, exactWindow, resolved),
      );
      return this.actionResult(
        threadId,
        "computer_press_key",
        resolved?.point,
        result,
        exactWindow,
      );
    });
  }

  async hotkey(
    threadId: string | undefined,
    keys: readonly string[],
    windowId?: string,
    target?: ComputerTarget,
  ): Promise<ComputerActionResult> {
    const exactWindow = this.keyboardTargetWindow(windowId, target);
    return this.withBackgroundProcessControl(threadId, exactWindow, async () => {
      const resolved = target
        ? await this.resolveSemanticTarget(
            { ...target, ...(exactWindow ? { windowId: exactWindow } : {}) },
            true,
          )
        : undefined;
      const result = await this.runKeyboardDispatch(threadId, exactWindow, () =>
        this.backend.hotkey(keys, exactWindow, resolved),
      );

      return this.actionResult(
        threadId,
        "computer_press_key",
        resolved?.point,
        result,
        exactWindow,
      );
    });
  }

  private keyboardTargetWindow(
    windowId: string | undefined,
    target: ComputerTarget | undefined,
  ): string | undefined {
    if (windowId !== undefined && target?.windowId !== undefined && target.windowId !== windowId) {
      throw new ComputerTargetError({
        code: "computer_target_invalid",
        message: "The keyboard window and element target name different windows; nothing was sent.",
      });
    }
    return windowId ?? target?.windowId;
  }

  // The clipboard is the system one the human shares, and it is optional on the backend, so a backend
  // without it refuses the call instead of the tool layer discovering a missing method at dispatch
  // time. Reading it takes the lease even though it mutates nothing: the clipboard is one shared slot
  // that the owning thread is mid-way through using, and a read from a second thread is either racing
  // that write or reading its private payload.
  async readClipboard(threadId: string | undefined): Promise<ComputerActionResult> {
    return this.withDesktopControl(threadId, async () => {
      const read = this.backend.readClipboard?.bind(this.backend);
      if (!read) throw clipboardUnsupportedError();
      const value = await timedComputerLeg("dispatch", read);
      // `ComputerActionResult.value` is contract-bounded well below the backend's byte cap, and an
      // oversized read must not slip out through the unvalidated MCP result path.
      if (value.length > COMPUTER_TEXT_MAX_LENGTH) {
        throw new ComputerBackendError(
          `The desktop clipboard holds ${value.length} characters of text, more than the ${COMPUTER_TEXT_MAX_LENGTH} this tool returns.`,
        );
      }
      return this.actionResult(threadId, "computer_read_clipboard", undefined, {
        value,
      });
    });
  }

  async writeClipboard(threadId: string | undefined, text: string): Promise<ComputerActionResult> {
    return this.withDesktopControl(threadId, async () => {
      const write = this.backend.writeClipboard?.bind(this.backend);
      if (!write) throw clipboardUnsupportedError();
      await timedComputerLeg("dispatch", () => write(text));

      return this.actionResult(threadId, "computer_write_clipboard", undefined, undefined);
    });
  }

  // Bulk paste uses the same keyboard-target policy as typing. Report restoration failure explicitly;
  // non-text clipboard contents cannot be preserved.
  async paste(
    threadId: string | undefined,
    text: string,
    windowId?: string,
  ): Promise<ComputerActionResult & { readonly clipboardRestored: boolean }> {
    return this.withDesktopControl(threadId, async () => {
      const read = this.backend.readClipboard?.bind(this.backend);
      const write = this.backend.writeClipboard?.bind(this.backend);
      if (!read || !write) throw clipboardUnsupportedError();
      const previous = await timedComputerLeg("dispatch", () => read().catch(() => undefined));
      await timedComputerLeg("dispatch", () => write(text));
      let restored = false;
      let result: ComputerBackendActionResult | void;
      try {
        result = await this.runKeyboardDispatch(threadId, windowId, () =>
          this.backend.hotkey(
            this.agentDialect === "macos" ? ["meta", "v"] : ["ctrl", "v"],
            windowId,
          ),
        );
      } finally {
        if (previous !== undefined) {
          await timedComputerLeg(
            "settle",
            () =>
              new Promise<void>((resolve) => {
                setTimeout(resolve, COMPUTER_PASTE_RESTORE_MS);
              }),
          );
          restored = await write(previous).then(
            () => true,
            () => false,
          );
        }
      }
      return {
        ...this.actionResult(threadId, "computer_paste", undefined, result, windowId),

        clipboardRestored: restored,
      };
    });
  }

  async setValue(
    threadId: string | undefined,
    target: ComputerTarget,
    value: string,
  ): Promise<ComputerActionResult> {
    return this.withSemanticControl(threadId, target.windowId, async () => {
      const resolved = await this.prepareSemanticDispatch(target, threadId);
      const result = await timedComputerLeg("dispatch", () =>
        this.backend.setValue(resolved, value),
      );
      return this.actionResult(
        threadId,
        "computer_set_value",
        resolved.point,
        result,
        resolved.node.windowId ?? undefined,
      );
    });
  }

  async performAction(
    threadId: string | undefined,
    target: ComputerTarget,
    action: string,
  ): Promise<ComputerActionResult> {
    return this.withBackgroundProcessControl(threadId, target.windowId, async () => {
      const resolved = await this.prepareSemanticDispatch(target, threadId);
      const result = await timedComputerLeg("dispatch", () =>
        this.backend.performAction(resolved, action),
      );
      return this.actionResult(
        threadId,
        "computer_perform_action",
        resolved.point,
        result,
        resolved.node.windowId ?? undefined,
      );
    });
  }

  // The target is resolved from fresh state so the backend dispatches on a live element token, never
  // on a stale caller-supplied one; the backend's native read-back alone decides `verified`. A
  // `window_id`-only target may resolve to the window's sole writable text control, the same rule
  // `typeTextAt` applies — an ambiguous or read-only match is refused rather than guessed.
  async selectText(
    threadId: string | undefined,
    target: ComputerTarget,
    range: ComputerTextRange,
  ): Promise<ComputerActionResult> {
    return this.withSemanticControl(threadId, target.windowId, async () => {
      const resolved = await this.prepareSemanticDispatch(target, threadId, true);
      const result = await timedComputerLeg("dispatch", () =>
        this.backend.selectText(resolved, range),
      );
      return this.actionResult(
        threadId,
        "computer_select_text",
        resolved.point,
        result,
        resolved.node.windowId ?? undefined,
      );
    });
  }

  // The count is kept whether or not this thread has a runtime record, because the lease's in-flight
  // guard reads it: while it was a field on the record, every thread on a visible-desktop backend
  // counted as idle from the first call to the last, and the desktop could be taken from a thread in
  // the middle of a drag.
  async withAgentActivity<A>(
    threadId: string,
    action: () => Promise<A>,
    signal?: AbortSignal,
    turnId?: string,
    operationKey?: string,
  ): Promise<A> {
    assertDesktopOperationAdmission();
    let authority = this.authorityRevocations.get(threadId);
    if (authority?.signal.aborted) {
      // A revoked broadcast must not poison later calls: mint fresh so a re-armed thread is not stillborn
      // on the previous revocation.
      authority = undefined;
      this.authorityRevocations.delete(threadId);
    }
    if (!authority) {
      authority = new AbortController();
      this.authorityRevocations.set(threadId, authority);
    }
    const admissionSignal = signal ? AbortSignal.any([signal, authority.signal]) : authority.signal;
    const execute = async (): Promise<A> => {
      this.assertControlAuthority(threadId);
      const controller = new AbortController();
      let live = this.activeAuthorities.get(threadId);
      if (!live) {
        live = new Set();
        this.activeAuthorities.set(threadId, live);
      }
      live.add(controller);
      const owner = agentThreadId(threadId);
      if (owner === undefined) {
        try {
          return await withDesktopOperationSignal(controller.signal, action);
        } finally {
          live.delete(controller);
          if (live.size === 0) this.activeAuthorities.delete(threadId);
        }
      }
      if (turnId) this.authorityTurns.set(owner, turnId);
      const depth = (this.agentCallsInFlight.get(owner) ?? 0) + 1;
      this.agentCallsInFlight.set(owner, depth);
      if (depth === 1) this.publishCached(owner);
      try {
        return await withDesktopOperationSignal(controller.signal, action);
      } finally {
        live.delete(controller);
        if (live.size === 0) this.activeAuthorities.delete(threadId);
        const remaining = Math.max(0, (this.agentCallsInFlight.get(owner) ?? 1) - 1);
        if (remaining === 0) {
          this.agentCallsInFlight.delete(owner);
          this.releaseBackgroundControl(owner, undefined, true);
          if (
            this.lease?.threadId !== owner &&
            ![...this.backgroundLeases.values()].some((lease) => lease.threadId === owner)
          ) {
            this.authorityTurns.delete(owner);
          }
          if (this.lease?.threadId === owner && this.lease.releaseRequested) {
            const requestedTurnId = this.lease.releaseRequestedTurnId;

            const stillMatches =
              requestedTurnId === undefined
                ? this.lease.turnId === undefined
                : this.lease.turnId === requestedTurnId;
            if (stillMatches) {
              await withoutDesktopCancellation(() =>
                this.releaseDesktopControl(owner, requestedTurnId),
              );
            } else {
              delete this.lease.releaseRequested;
              delete this.lease.releaseRequestedTurnId;
              this.publishCached(owner);
            }
          } else {
            this.publishCached(owner);
          }
        } else {
          this.agentCallsInFlight.set(owner, remaining);
        }
      }
    };

    return this.withComputerCall(() =>
      operationKey
        ? this.operations.runScoped(operationKey, execute, admissionSignal)
        : this.operations.run(execute, admissionSignal),
    );
  }

  // Absent means "no browser route": the gateway must not advertise the tools at all, which is also
  // the honest answer a desktop-only backend gives.
  get supportsBrowser(): boolean {
    return this.backend.browser !== undefined;
  }

  // Browser work shares the turn's authority revocation and caller signal with desktop work, but not
  // the desktop lease, the desktop coordinate space, the frame tap, or the post-unlock observation
  // gate: targets are opaque session-scoped capabilities minted by the driver, and every result —
  // including a deliberate `status:"refused"` reply — is driver-produced. Calls for one thread
  // serialize on a browser lane keyed to the thread so lifecycle transitions (prepare, navigate, end)
  // cannot interleave mid-flight.
  async browserCall(
    threadId: string,
    turnId: string | undefined,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    beforeDispatch?: () => Promise<void>,
  ): Promise<ComputerBrowserCallResult> {
    const browser = this.backend.browser;
    if (!browser)
      throw new ComputerBackendError("This computer backend does not provide browser automation.", {
        retryable: false,
      });
    return this.withAgentActivity(
      threadId,
      async () => {
        const operationSignal = desktopOperationSignal();
        if (!operationSignal)
          throw new ComputerBackendError(
            "Computer browser call ran outside an operation context.",
            { retryable: false },
          );
        operationSignal.throwIfAborted();

        if (beforeDispatch) await beforeDispatch();
        operationSignal.throwIfAborted();
        if (name === "browser_prepare" && args.windowed === true)
          this.spaceBroker.assertForegroundAllowed(threadId);
        const invoke = () =>
          browser.call({
            name,
            args,
            task: { threadId, ...(turnId ? { turnId } : {}) },
            mutation: name !== "get_browser_state",
            signal: operationSignal,
          });

        return beforeDispatch && name === "browser_prepare" && args.windowed === true
          ? withDesktopDeliveryMode("foreground", invoke)
          : invoke();
      },
      signal,
      turnId,
      `browser:${threadId}`,
    );
  }

  private withComputerCall<A>(run: () => Promise<A>): Promise<A> {
    if (currentComputerCall() !== undefined) return run();
    const context = createComputerCallContext();
    if (context === undefined) return run();
    return withComputerCallContext(context, async () => {
      try {
        return await run();
      } catch (error) {
        context.timing?.markFailed();
        throw error;
      } finally {
        context.timing?.finish();
      }
    });
  }

  private canUseBackgroundTarget(): boolean {
    return (
      this.backend.exactTargetBackgroundInput === true && desktopDeliveryMode() !== "foreground"
    );
  }

  private withSemanticControl<A>(
    threadId: string | undefined,
    windowId: string | undefined,
    action: () => Promise<A>,
  ): Promise<A> {
    return windowId && this.canUseBackgroundTarget()
      ? this.withBackgroundWindowControl(threadId, windowId, action)
      : this.withDesktopControl(threadId, action);
  }

  private withBackgroundProcessControl<A>(
    threadId: string | undefined,
    windowId: string | undefined,
    action: () => Promise<A>,
  ): Promise<A> {
    if (!windowId || !this.canUseBackgroundTarget())
      return this.withDesktopControl(threadId, action);
    return this.withBackgroundResourceControl(
      threadId,
      async () => {
        const window = await this.resolveWindowTarget(threadId, windowId);
        if (window.pid === undefined || window.pid <= 0) {
          throw new ComputerBackendError(
            "Background input needs a verified application process for the exact window.",
          );
        }
        return { key: `process:${window.pid}`, pid: window.pid };
      },
      action,
    );
  }

  private withBackgroundAppControl(
    threadId: string | undefined,
    app: string,
    action: () => Promise<ComputerLaunchAppResult>,
  ): Promise<ComputerLaunchAppResult> {
    if (!this.canUseBackgroundTarget()) return this.withDesktopControl(threadId, action);
    return this.withBackgroundResourceControl(
      threadId,
      async () => {
        this.assertDrivenAppAllowed(app);
        const apps = await this.backend.listApps?.();
        const spelling = app.trim().toLowerCase();
        const matches =
          apps?.filter((candidate) =>
            [candidate.name, candidate.bundleId, candidate.launchPath].some(
              (name) => name?.toLowerCase() === spelling,
            ),
          ) ?? [];
        // Never guess which process LaunchServices will choose among several running instances of the same
        // app.
        const running = matches.filter((candidate) => candidate.running && candidate.pid > 0);
        if (running.length > 1) {
          throw new ComputerBackendError(
            "Several running applications match this launch. Use an exact existing window instead.",
          );
        }
        const target = running[0] ?? matches[0];
        return target?.running
          ? { key: `process:${target.pid}`, pid: target.pid }
          : {
              key: `application:${(target?.bundleId ?? target?.launchPath ?? target?.name ?? spelling).toLowerCase()}`,
            };
      },
      async (target) => {
        const result = await action();

        const held = this.backgroundLeases.get(target.key);
        const pid = result.pid ?? result.window?.pid;
        if (held && held.threadId === agentThreadId(threadId) && pid !== undefined && pid > 0) {
          this.backgroundLeases.set(target.key, { ...held, target: { ...target, pid } });
        }
        return result;
      },
    );
  }

  private withBackgroundResourceControl<A>(
    threadId: string | undefined,
    resolve: () => Promise<BackgroundControlTarget>,
    action: (target: BackgroundControlTarget) => Promise<A>,
  ): Promise<A> {
    assertDesktopOperationAdmission();
    const owner = agentThreadId(threadId);
    if (owner === undefined) this.lastUserDesktopInputAt = this.now();

    return this.operations.run(async () => {
      this.assertControlAuthority(owner);
      this.assertInputNotPaused(owner);
      const target = await resolve();
      assertDesktopOperationActive();
      this.claimBackgroundControl(owner, target);
      this.engageBackend();
      try {
        return await this.withComputerCall(() => action(target));
      } catch (error) {
        this.recordInputPause(owner, error);
        throw error;
      }
    });
  }

  private claimBackgroundControl(owner: string | undefined, target: BackgroundControlTarget): void {
    if (owner === undefined) return;
    const now = this.now();
    if (this.lease && this.lease.threadId !== owner && !this.isLeaseStale(this.lease, now)) {
      throw new ComputerLeaseError();
    }
    if (this.lease && this.isLeaseStale(this.lease, now)) {
      this.authorityTurns.delete(this.lease.threadId);
      this.lease = null;
    }
    for (const [key, lease] of this.backgroundLeases) {
      if (this.isLeaseStale(lease, now)) {
        this.backgroundLeases.delete(key);
        this.clearEvictedBackgroundOwner(lease.threadId);
        continue;
      }
      const sameProcess = target.pid !== undefined && target.pid === lease.target.pid;
      const conflict =
        target.key === key || (sameProcess && (!target.windowId || !lease.target.windowId));
      if (conflict && lease.threadId !== owner) throw new ComputerLeaseError(true);
    }
    const claiming = currentComputerTask();
    const turnId =
      (claiming?.threadId === owner ? claiming.turnId : undefined) ??
      this.authorityTurns.get(owner);
    const held = this.backgroundLeases.get(target.key);
    this.backgroundLeases.set(target.key, {
      threadId: owner,
      target,
      ...(turnId ? { turnId } : {}),
      lastActivityMs: now,
      ...(held?.threadId === owner && held.turnId === turnId && held.releaseRequested
        ? { releaseRequested: true, releaseRequestedTurnId: held.releaseRequestedTurnId }
        : {}),
    });
    if (held?.threadId !== owner) this.publishOwnershipCached();
  }

  private publishOwnershipCached(): void {
    for (const threadId of this.threads.keys()) this.publishCached(threadId);
  }

  private clearEvictedBackgroundOwner(owner: string): void {
    if (
      this.lease?.threadId === owner ||
      [...this.backgroundLeases.values()].some((lease) => lease.threadId === owner)
    )
      return;
    this.authorityTurns.delete(owner);
    const state = this.threads.get(owner);
    if (state) state.paneSurfaced = false;
    this.publishOwnershipCached();
  }

  private releaseBackgroundControl(owner: string, turnId?: string, onlyRequested = false): void {
    let changed = false;
    for (const [key, lease] of this.backgroundLeases) {
      if (lease.threadId !== owner || (turnId && lease.turnId && lease.turnId !== turnId)) continue;
      if (
        onlyRequested &&
        (!lease.releaseRequested || lease.releaseRequestedTurnId !== lease.turnId)
      )
        continue;
      if ((this.agentCallsInFlight.get(owner) ?? 0) > 0) {
        lease.releaseRequested = true;
        lease.releaseRequestedTurnId = turnId ?? lease.turnId;
      } else {
        this.backgroundLeases.delete(key);
        changed = true;
      }
    }
    if (
      this.lease?.threadId !== owner &&
      ![...this.backgroundLeases.values()].some((lease) => lease.threadId === owner)
    ) {
      const state = this.threads.get(owner);
      if (state) state.paneSurfaced = false;
    }
    if (changed) this.publishOwnershipCached();
  }

  private withBackgroundWindowControl<A>(
    threadId: string | undefined,
    windowId: string,
    action: () => Promise<A>,
  ): Promise<A> {
    if (desktopDeliveryMode() === "foreground") return this.withDesktopControl(threadId, action);
    assertDesktopOperationAdmission();
    const owner = agentThreadId(threadId);

    if (owner === undefined) this.lastUserDesktopInputAt = this.now();
    return this.operations.runScoped(windowId, async () => {
      this.assertControlAuthority(owner);
      this.assertInputNotPaused(owner);
      const target = await this.resolveWindowTarget(threadId, windowId);
      assertDesktopOperationActive();
      this.claimBackgroundControl(owner, {
        key: `window:${windowId}`,
        windowId,
        ...(target.pid !== undefined ? { pid: target.pid } : {}),
      });
      this.engageBackend();
      try {
        return await this.withComputerCall(action);
      } catch (error) {
        this.recordInputPause(owner, error);
        throw error;
      }
    });
  }

  // Take or renew the exclusive desktop lease for a mutating agent action, or refuse the action
  // because another conversation holds it. There is no explicit acquire tool because there is nothing
  // sensible for a model to do with one — it would either forget to release, or treat a refusal to
  // acquire as a different failure from a refusal to act. The human is not a competing agent: they
  // are the person the desktop belongs to, so pane input neither takes the lease nor is ever refused
  // by it.
  private withDesktopControl<A>(
    threadId: string | undefined,
    action: () => Promise<A>,
    beforeClaim?: () => void,
  ): Promise<A> {
    assertDesktopOperationAdmission();
    const owner = agentThreadId(threadId);

    if (owner === undefined) this.lastUserDesktopInputAt = this.now();
    if (
      owner &&
      this.lease &&
      this.lease.threadId !== owner &&
      !this.isLeaseStale(this.lease, this.now())
    ) {
      return Promise.reject(new ComputerLeaseError());
    }
    return this.operations.run(async () => {
      this.assertControlAuthority(owner);
      // Readiness first: a paused thread is refused before it can take the lease, clear focus, or
      // announce itself — all of which claimDesktopControl would otherwise do ahead of a refusal that
      // sends nothing.
      this.assertInputNotPaused(owner);
      // Admission belongs before the lease claim: even clearFocusWindow and cursor setup may cold-start a
      // native process. A refused foreground call must not start it, take the lease, or publish a driving
      // session. Run inside the queue so recent human input is checked at dispatch.
      beforeClaim?.();
      await this.claimDesktopControl(threadId);
      assertDesktopOperationActive();
      try {
        return await this.withComputerCall(action);
      } catch (error) {
        this.recordInputPause(owner, error);
        throw error;
      }
    });
  }

  private async refreshInputPause(
    windowId: string,
    windows: readonly ComputerWindow[],
  ): Promise<void> {
    if (!this.backend.checkInputReady) return;
    const observingThread = currentComputerTask()?.threadId;
    const observedWindow = windows.find((window) => window.id === windowId);
    const paused = [...this.threads.entries()].filter(
      ([threadId, state]) =>
        (observingThread === undefined || observingThread === threadId) &&
        state.inputPause &&
        (!state.inputPause.windowId ||
          state.inputPause.windowId === windowId ||
          (state.inputPause.pid !== undefined &&
            observedWindow?.pid === state.inputPause.pid &&
            observedWindow.visible &&
            !observedWindow.minimized &&
            observedWindow.onCurrentSpace !== false) ||
          (state.inputPause.pid === undefined &&
            !windows.some((window) => window.id === state.inputPause?.windowId))),
    );
    if (paused.length === 0) return;
    const snapshots = paused.map(([threadId, state]) => ({
      threadId,
      state,
      pause: state.inputPause,
      // The generation this pause was observed under. A disable/re-enable between the snapshot and the
      // clear must not launder an old pause away.
      generation: this.controlState.get(threadId).generation,
    }));
    try {
      await this.backend.checkInputReady(windowId);
    } catch {
      return;
    }
    assertDesktopOperationActive();
    for (const { threadId, state, pause, generation } of snapshots) {
      if (this.threads.get(threadId) !== state || state.inputPause !== pause) continue;

      if (!this.canActivateControl(threadId, generation)) continue;
      delete state.inputPause;
      state.lastError = null;
      this.publishCached(threadId);
    }
  }

  private async claimDesktopControl(threadId: string | undefined): Promise<void> {
    this.engageBackend();
    const owner = agentThreadId(threadId);
    if (owner === undefined) return;

    this.preActionWindowIds =
      this.lastKnownWindowIds ?? (await this.readWindows().then(windowIdSet, () => undefined));
    const now = this.now();
    for (const [key, lease] of this.backgroundLeases) {
      if (this.isLeaseStale(lease, now)) {
        this.backgroundLeases.delete(key);
        this.clearEvictedBackgroundOwner(lease.threadId);
      } else if (lease.threadId !== owner) throw new ComputerLeaseError();
    }
    const held = this.lease;
    const heldStale = held !== null && this.isLeaseStale(held, now);
    if (held && held.threadId !== owner && !heldStale) {
      throw new ComputerLeaseError();
    }
    // A dead lease's turn stamp is dead with it: an anonymous re-claim must not inherit it, and an
    // evicted owner's entry can never be useful again.
    if (heldStale) {
      this.authorityTurns.delete(held.threadId);
      // The evicted owner's surfaced surface died with its control period. Clearing here because its
      // release returns early on the lease-owner check in releaseDesktopControl, never reaching the reset
      // there.
      const evicted = this.threads.get(held.threadId);
      if (evicted) evicted.paneSurfaced = false;
    }
    const changed = held?.threadId !== owner;
    assertDesktopOperationActive();
    if (changed) {
      await this.backend.clearFocusWindow?.();
      assertDesktopOperationActive();
    }

    const claimingTask = currentComputerTask();
    const stampedTurnId =
      (claimingTask && agentThreadId(claimingTask.threadId) === owner
        ? claimingTask.turnId
        : undefined) ?? this.authorityTurns.get(owner);
    this.lease = {
      threadId: owner,
      ...(stampedTurnId ? { turnId: stampedTurnId } : {}),
      lastActivityMs: now,
      ...(!changed && held?.releaseRequested
        ? {
            releaseRequested: true,
            releaseRequestedTurnId: held.releaseRequestedTurnId,
          }
        : {}),
    };
    if (heldStale) {
      this.recordLeaseLifecycle("stale-reclaimed", held, {
        idleMs: now - held.lastActivityMs,
        nextThreadId: owner,
      });
    }
    if (changed || heldStale || held?.turnId !== this.lease.turnId) {
      this.recordLeaseLifecycle("acquired", this.lease);
    }
    if (changed) {
      await this.announceDrivingAgent(owner);

      await this.publishAllThreads();
    }
  }

  // Lifecycle evidence contains identities and timing, never input or titles.
  private recordLeaseLifecycle(
    event: "acquired" | "release-requested" | "released" | "stale-reclaimed",
    lease: DesktopLease,
    detail?: { readonly idleMs: number; readonly nextThreadId: string },
  ): void {
    console.info("[computer] desktop lease", {
      ts: new Date(this.now()).toISOString(),
      event,
      threadId: lease.threadId,
      ...(lease.turnId ? { turnId: lease.turnId } : {}),
      ...detail,
    });
  }

  // Names the thread driving the desktop so a backend that draws an agent cursor can label it. Best
  // effort: a missing or failed label is a cosmetic loss, and must never turn into a refused action.
  private async announceDrivingAgent(threadId: string | null): Promise<void> {
    this.cursorActivity.setOwner(threadId);
    if (!this.backend.setDrivingAgent) return;
    const label = threadId === null ? null : (this.threadLabels.get(threadId) ?? null);
    await this.backend.setDrivingAgent(label).catch(() => undefined);
  }

  setThreadLabel(threadId: string, label: string | null): void {
    const owner = agentThreadId(threadId);
    if (owner === undefined) return;
    const trimmed = label?.trim();
    if (trimmed) {
      if (this.threadLabels.get(owner) === trimmed) return;
      this.threadLabels.delete(owner);
      this.threadLabels.set(owner, trimmed);
      for (const id of this.threadLabels.keys()) {
        if (this.threadLabels.size <= 256) break;
        if (id === owner || id === this.lease?.threadId || this.agentCallsInFlight.has(id))
          continue;
        this.threadLabels.delete(id);
      }
    } else {
      if (!this.threadLabels.delete(owner)) return;
    }

    if (this.lease?.threadId === owner) void this.announceDrivingAgent(owner);
  }

  // Release the desktop the moment the owning thread stops being able to drive it — its turn reached
  // a terminal state, or its provider session exited. This is the lease's primary release path; idle
  // expiry only covers a runtime that died without reporting either. A terminal event names its turn
  // so a late completion cannot release a lease already renewed by a newer turn.
  async releaseDesktopControl(threadId: string, turnId?: string): Promise<void> {
    const owner = agentThreadId(threadId);
    if (owner === undefined) return;
    this.spaceBroker.release(owner, turnId);
    this.releaseBackgroundControl(owner, turnId);

    const cleanupTurnId =
      turnId ??
      (!this.controlDisabled(owner) &&
      !this.suspendedThreads.has(owner) &&
      this.lease?.threadId === owner
        ? this.lease.turnId
        : this.authorityTurns.get(owner));
    // Preview teardown must not block lifecycle ingestion or an in-flight operation's finalizer. In
    // particular, awaiting it on the deferred path would prevent the operation from draining and leave
    // the lease held.
    void Promise.resolve()
      .then(() => this.backend.endTask?.(owner, cleanupTurnId))
      .catch((error: unknown) => {
        void this.recordThreadError(owner, `Preview cleanup failed: ${errorMessage(error)}`).catch(
          () => undefined,
        );
      });
    if (this.lease?.threadId !== owner) {
      if (
        (this.agentCallsInFlight.get(owner) ?? 0) === 0 &&
        ![...this.backgroundLeases.values()].some((lease) => lease.threadId === owner) &&
        (!turnId || this.authorityTurns.get(owner) === turnId)
      )
        this.authorityTurns.delete(owner);
      this.publishCached(owner);
      return;
    }
    if (turnId && this.lease.turnId && this.lease.turnId !== turnId) return;
    if ((this.agentCallsInFlight.get(owner) ?? 0) > 0) {
      if (!this.lease.releaseRequested) {
        this.recordLeaseLifecycle("release-requested", this.lease);
      }
      this.lease.releaseRequested = true;

      this.lease.releaseRequestedTurnId = turnId ?? this.lease.turnId;
      return;
    }
    const releasedTurnId = this.lease.turnId;
    await this.operations.run(async () => {
      if (this.lease?.threadId !== owner) return;

      if (this.lease.turnId !== releasedTurnId) return;
      await this.backend.clearFocusWindow?.();
      this.recordLeaseLifecycle("released", this.lease);
      this.lease = null;
      // The released turn is no longer this thread's authority: a later turnId-less caller must claim
      // anonymously, not inherit a stale stamp a duplicate release could still match.
      this.authorityTurns.delete(owner);
      const runtime = this.threads.get(owner);
      if (runtime) runtime.paneSurfaced = false;
      await this.announceDrivingAgent(null);
    });
    await this.publishAllThreads();
  }

  private isLeaseStale(lease: DesktopLease, now: number): boolean {
    if (now - lease.lastActivityMs < this.leaseIdleMs) return false;
    return (this.agentCallsInFlight.get(lease.threadId) ?? 0) === 0;
  }

  async recordThreadError(threadId: string, message: string): Promise<void> {
    const state = this.threads.get(threadId);
    if (!state) return;
    state.reportedError = clampComputerMessage(
      message,
      "The computer backend reported an error without a message.",
    );
    await this.publish(threadId).catch(() => undefined);
  }

  subscribeFrames(sink: FrameSink): () => void {
    this.engageBackend();
    const unsubscribe = this.transport.subscribe(this.computerId, sink);
    this.streamDesired = true;
    this.streamEpoch += 1;
    void this.reconcileStream().catch((error) => this.recordError(error));
    return () => {
      unsubscribe();
      if (this.transport.streamSubscriberCount(this.computerId) === 0) {
        this.streamDesired = false;
        this.streamEpoch += 1;
        void this.reconcileStream().catch((error) => this.recordError(error));
      }
    };
  }

  async requestKeyframe(): Promise<void> {
    if (!this.streamAttached || this.transport.streamSubscriberCount(this.computerId) === 0) return;
    const epoch = this.streamEpoch;
    await this.enqueueStreamTransition(async () => {
      if (!this.isStreamWanted(epoch) || !this.streamAttached) return;
      if (this.backend.requestKeyframe) {
        await this.backend.requestKeyframe();
        if (!this.isStreamWanted(epoch)) return;
        return;
      }
      await this.backend.detachStream();
      this.streamAttached = false;
      if (!this.isStreamWanted(epoch)) {
        this.transport.reset(this.computerId);
        return;
      }
      this.transport.reset(this.computerId);
      await this.backend.attachStream((frame) => this.handleFrame(frame));
      if (!this.isStreamWanted(epoch)) {
        this.streamAttached = false;
        this.transport.reset(this.computerId);
        await this.backend.detachStream();
        return;
      }
      this.streamAttached = true;
    });
  }

  async flushStreamTransitions(): Promise<void> {
    await this.streamTransition;
  }

  async handleThreadRemoved(threadId: string): Promise<void> {
    this.spaceBroker.release(threadId);
    // Cancel first, synchronously, before the suspend below can yield: removal revokes authority, and a
    // prompt admitted a millisecond earlier must settle now rather than at the gate's timeout.
    computerApprovalGate.cancelThread(threadId);
    this.suspendedThreads.add(threadId);
    // A rejected stop (e.g. preview cleanup failing inside the release) must not skip removal — a
    // removed thread that keeps its lease can reappear as the desktop's owner until the idle backstop
    // fires. Bounded: a wedged in-flight op must not stall removal forever — the suspend and the
    // deletions are already held, only the drain is lost.
    await withControlTeardownTimeout(this.revokeControl(threadId)).catch(() => undefined);
    this.publishChains.delete(threadId);
    this.threads.delete(threadId);
    this.threadLabels.delete(threadId);
    this.authorityTurns.delete(threadId);
    this.authorityRevocations.delete(threadId);
    this.activeAuthorities.delete(threadId);
    // Deleted after the thread state, so the resulting publish cannot recreate it: a removed thread
    // must not reappear as a lease holder. A rejected or wedged release must not stall removal either —
    // the idle backstop owns the lease.
    await withControlTeardownTimeout(this.releaseDesktopControl(threadId)).catch(() => undefined);
    // Browser sessions are thread-scoped, not lease-scoped: a browser-only thread may never have held
    // the desktop lease, so teardown cannot ride the release.
    await withControlTeardownTimeout(
      this.backend.browser?.endThread?.(threadId) ?? Promise.resolve(),
    ).catch(() => undefined);
  }

  async handleThreadRestored(threadId: string): Promise<void> {
    // A pending stop's rejection (e.g. preview cleanup that failed during the release) must not keep a
    // restored thread suspended forever — the suspension exists to block input while teardown runs, and
    // a rejected teardown is still a settled teardown.
    await this.pendingStops.get(threadId)?.catch(() => undefined);
    this.suspendedThreads.delete(threadId);
    this.authorityRevocations.delete(threadId);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.spaceBroker.dispose();
    this.cursorActivity.dispose();
    // Teardown cannot depend on the host still answering: an unreachable endpoint means the input path
    // it owned is already gone, so the wait is bounded like every other teardown leg.
    await withControlTeardownTimeout(this.backend.stopInput?.() ?? Promise.resolve()).catch(
      () => undefined,
    );
    // close() aborts live work synchronously before its drain awaits, so a wedged operation can only
    // cost the drain — never the abort or the teardown that follows.
    await withControlTeardownTimeout(this.operations.close()).catch(() => undefined);
    if (this.windowsPublishTimer !== undefined) clearTimeout(this.windowsPublishTimer);
    this.windowsPublishTimer = undefined;
    this.windowsPublishPending = false;
    if (this.errorRepublishTimer !== undefined) clearTimeout(this.errorRepublishTimer);
    this.errorRepublishTimer = undefined;
    this.streamDesired = false;
    this.streamEpoch += 1;
    await this.enqueueStreamTransition(async () => {
      if (this.streamAttached) {
        this.streamAttached = false;
        this.transport.reset(this.computerId);
        await this.backend.detachStream();
      }
    }).catch(() => undefined);
    this.backendUnsubscribe?.();
    await this.backend.dispose();
    this.listeners.clear();
    await this.auditLog.flush();
  }

  private async reconcileStream(): Promise<void> {
    await this.enqueueStreamTransition(async () => {
      if (this.disposed || !this.streamDesired) {
        if (!this.streamAttached) return;
        this.streamAttached = false;
        this.transport.reset(this.computerId);
        await this.backend.detachStream();
        return;
      }
      if (this.streamAttached) return;
      const epoch = this.streamEpoch;
      await this.backend.attachStream((frame) => this.handleFrame(frame));
      if (!this.isStreamWanted(epoch)) {
        await this.backend.detachStream();
        this.transport.reset(this.computerId);
        return;
      }
      this.streamAttached = true;
    });
  }

  private enqueueStreamTransition(action: () => Promise<void>): Promise<void> {
    const next = this.streamTransition.then(action);
    this.streamTransition = next.catch(() => undefined);
    return next;
  }

  private handleFrame(frame: ComputerStreamFrame): void {
    if (this.disposed || (!this.streamDesired && !this.streamAttached)) return;
    this.transport.publish(this.computerId, frame);
  }

  private assertTargetCanUseCoordinates(target: ComputerTarget): void {
    if (observedComputerTargetNode(target)) {
      throw new ComputerTargetError({
        code: "computer_target_refused",
        message:
          "This observed element does not support the requested exact pointer action. Use an advertised semantic action or explicitly target a current screenshot; no coordinate fallback was sent.",
      });
    }
  }

  private async resolvePointTarget(
    target: ComputerTarget,
    threadId: string | undefined,
  ): Promise<ResolvedPointTarget> {
    if (hasCoordinates(target) && !hasLabelFields(target)) {
      this.spaceBroker.assertTargetBound(agentThreadId(threadId), target.windowId);
      const point = await this.resolveCoordinatePoint(target);
      if (target.windowId === undefined) {
        // The compositor routes a bare point to whatever is topmost at it, so the denylist answers the same
        // question the occlusion rules already ask: which window would actually take this input. When
        // stacking cannot pick one — several windows cover the point and the list carries no order — the
        // check closes against every covering window: the denied surface might be the one input reaches.
        const windows = await this.readWindows();
        const topmost = topmostWindowAtPoint(windows, point);
        if (topmost !== undefined) {
          await this.assertWindowInputAllowed(threadId, topmost.id);
        } else {
          for (const window of windows) {
            if (!window.visible || window.minimized) continue;
            if (!rectContainsPoint(window.bounds, point)) continue;
            await this.assertWindowInputAllowedWindow(threadId, window);
          }
        }
        return { point };
      }
      const occlusion = await this.scopedPointOcclusion(point, target.windowId);
      await this.assertWindowInputAllowed(threadId, target.windowId);

      if (agentThreadId(threadId) !== undefined) {
        const suspects =
          occlusion.covering.length > 0
            ? occlusion.covering
            : occlusion.ranked
              ? []
              : occlusion.windows.filter(
                  (window) =>
                    window.id !== target.windowId &&
                    window.visible &&
                    !window.minimized &&
                    rectContainsPoint(window.bounds, point),
                );
        for (const window of suspects) {
          await this.assertWindowInputAllowedWindow(threadId, window);
        }
      }
      return { point, windowId: target.windowId, covering: occlusion.covering };
    }
    if (hasSemanticFields(target)) {
      const resolved = await this.resolveSemanticTarget(target);
      if (resolved.node.windowId) {
        await this.assertWindowInputAllowed(threadId, resolved.node.windowId);
      }
      return {
        point: resolved.point,
        semantic: resolved,
        ...(resolved.node.windowId ? { windowId: resolved.node.windowId } : {}),
      };
    }
    throw new ComputerTargetError({
      code: "computer_target_invalid",
      message: "Computer actions require x/y coordinates or a labelled target.",
    });
  }

  private async resolveCoordinatePoint(target: ComputerTarget): Promise<ComputerPoint> {
    if (target.windowId && hasCoordinates(target)) {
      const window = (await this.readWindows()).find((window) => window.id === target.windowId);
      const bounds = window?.bounds;
      const observed = (target as ComputerTarget & { observedWindowBounds?: ComputerRect })
        .observedWindowBounds;
      if (window && !bounds)
        throw new ComputerTargetError({
          code: "computer_target_offscreen",
          message: "The target window exposes no geometry.",
        });
      if (
        !bounds ||
        (observed &&
          (bounds.x !== observed.x ||
            bounds.y !== observed.y ||
            bounds.width !== observed.width ||
            bounds.height !== observed.height))
      )
        throw new ComputerTargetError({
          code: "computer_target_not_found",
          message:
            "The exact window closed or moved since this screenshot. Observe again before acting.",
        });
      if (
        target.x < bounds.x ||
        target.y < bounds.y ||
        target.x >= bounds.x + bounds.width ||
        target.y >= bounds.y + bounds.height
      )
        throw new ComputerTargetError({
          code: "computer_target_offscreen",
          message: "The coordinate is outside the exact target window.",
        });
      return { x: target.x, y: target.y };
    }
    try {
      return resolveComputerPoint(target, await this.backend.getScreenSize());
    } catch (error) {
      if (!(error instanceof ComputerTargetError) || error.code !== "computer_target_offscreen") {
        throw error;
      }
      const state = await this.backend
        .getState({
          includeTree: true,
          ...(target.windowId ? { windowId: target.windowId } : {}),
        })
        .catch(() => undefined);
      throw new ComputerTargetError({
        code: error.code,
        message: error.message,
        candidates: state?.root ? computerTargetCandidates(state.root) : [],
      });
    }
  }

  // Input is routed to the named window regardless of what covers that coordinate, so a point outside
  // its bounds would deliver a click to a part of the window that does not exist — the one failure
  // mode scoping is meant to remove. The covering list comes from the same window read, so the raise
  // path downstream never has to repeat it.
  private async scopedPointOcclusion(
    point: ComputerPoint,
    windowId: string,
  ): Promise<{
    readonly covering: readonly ComputerWindow[];
    readonly windows: readonly ComputerWindow[];
    readonly ranked: boolean;
  }> {
    const windows = await this.readWindows();
    const window = windows.find((candidate) => candidate.id === windowId);
    if (!window) throw windowNotFoundError(windowId);
    const bounds = window.bounds;
    if (!bounds) {
      throw new ComputerTargetError({
        code: "computer_target_offscreen",
        message:
          `This desktop reports no geometry for window ${JSON.stringify(windowId)}, so a coordinate ` +
          "cannot be checked against it. Drop window_id to click whatever is topmost at that point, " +
          "or target the control by label instead.",
      });
    }
    if (!rectContainsPoint(bounds, point)) {
      throw new ComputerTargetError({
        code: "computer_target_offscreen",
        message:
          `Computer target (${point.x}, ${point.y}) is outside window ${JSON.stringify(windowId)}, ` +
          `which covers ${bounds.width}x${bounds.height} at (${bounds.x}, ${bounds.y}). ` +
          "Pass a coordinate inside those bounds, or drop window_id to click whatever is topmost.",
      });
    }
    return {
      covering: windowsCoveringPoint(windows, windowId, point),
      windows,
      ranked: window.stackingIndex !== undefined,
    };
  }

  // Raise before focus so delivered input is visible. A failed raise refuses only when another window
  // actually occludes the requested point.
  private async prepareResolvedTarget(
    target: PreparedTarget | undefined,
    threadId: string | undefined,
  ): Promise<void> {
    const windowId = target?.windowId;
    this.spaceBroker.assertTargetBound(agentThreadId(threadId), windowId);
    if (windowId !== undefined) await this.assertWindowInputAllowed(threadId, windowId);
    if (windowId === undefined) {
      assertDesktopOperationActive();
      await this.backend.clearFocusWindow?.();
      return;
    }
    await this.revealTarget(target);
    assertDesktopOperationActive();
    await this.backend.focusWindow?.(windowId);
  }

  // Restack without changing keyboard aim, including on a hover.
  private async revealTarget(target: PreparedTarget | undefined): Promise<void> {
    if (this.backend.agentDialect === "macos") return;
    const windowId = target?.windowId;
    if (windowId === undefined) return;
    assertDesktopOperationActive();
    const raiseFailure = await this.raiseTargetWindow(windowId);
    if (raiseFailure !== undefined && target?.point) {
      const covering = target.covering ?? (await this.coveringWindowsAt(target.point, windowId));
      if (covering.length > 0) {
        throw occludedTargetError(windowId, target.point, covering, raiseFailure);
      }
    }
  }

  // Keyboard input carries no coordinate to scope it, so without a window it lands wherever the
  // seat's focus already is — usually where the last click put it, which is what a click-then-type
  // sequence depends on. Focus is therefore never cleared here; only an explicit window moves it, and
  // a stale id fails before any key is sent rather than typing into another application.
  private async prepareKeyboardTarget(
    windowId: string | undefined,
    threadId: string | undefined,
  ): Promise<void> {
    this.spaceBroker.assertTargetBound(agentThreadId(threadId), windowId);
    if (windowId === undefined) return;
    const windows = await this.readWindows();
    const window = windows.find((candidate) => candidate.id === windowId);
    if (window === undefined) {
      throw windowNotFoundError(windowId);
    }
    if (this.canUseBackgroundTarget()) {
      await this.admitWindowTarget(threadId, window);
      return;
    }
    await this.prepareResolvedTarget({ windowId }, threadId);
  }

  private async runKeyboardDispatch(
    threadId: string | undefined,
    windowId: string | undefined,
    dispatch: () => Promise<ComputerBackendActionResult | void>,
  ): Promise<ComputerBackendActionResult | void> {
    await timedComputerLeg("resolve", () => this.prepareKeyboardTarget(windowId, threadId));
    assertDesktopOperationActive();
    return timedComputerLeg("dispatch", dispatch);
  }

  private async prepareSemanticDispatch(
    target: ComputerTarget,
    threadId: string | undefined,
    allowUniqueTextTarget = false,
  ): Promise<ComputerResolvedTarget> {
    const resolved = await timedComputerLeg("resolve", () =>
      this.resolveSemanticTarget(target, allowUniqueTextTarget),
    );
    if (this.canUseBackgroundTarget() && target.windowId) {
      await this.assertWindowInputAllowed(threadId, target.windowId);
    } else {
      await timedComputerLeg("resolve", () =>
        this.prepareResolvedTarget(semanticPointTarget(resolved), threadId),
      );
    }
    assertDesktopOperationActive();
    return resolved;
  }

  private async raiseTargetWindow(windowId: string): Promise<string | undefined> {
    const raise = this.backend.raiseWindow?.bind(this.backend);
    if (!raise) return "this backend exposes no stacking control";
    try {
      await raise(windowId);
      return undefined;
    } catch (error) {
      return errorMessage(error);
    }
  }

  // The compositor refuses instead of retargeting, so a refusal is the one failure that guarantees
  // nothing was delivered — worth saying, because the caller's alternative reading is that the
  // control is broken. It reports only which call it declined, so the cause has to be supplied here.
  private async injectScoped<T>(
    action: string,
    target: PreparedTarget,
    inject: () => Promise<T>,
  ): Promise<T> {
    try {
      assertDesktopOperationActive();
      // The new-window baseline is taken here — after targeting, immediately before inject — rather than
      // only at lease claim: the targeting reads above refreshed the window cache, so diffing against
      // anything older would report windows this action never opened. The claim-time baseline stays as
      // the fallback for inputs that never pass through here.
      if (this.lastKnownWindowIds !== undefined) {
        this.preActionWindowIds = this.lastKnownWindowIds;
      }
      return await timedComputerLeg("dispatch", inject);
    } catch (error) {
      const windowId = target.windowId;
      const point = target.point;
      if (windowId === undefined || !point) throw error;
      if (!(error instanceof ComputerBackendError) || error.rejectedOperation === undefined) {
        throw error;
      }
      throw refusedInjectionError(action, windowId, point);
    }
  }

  private async coveringWindowsAt(
    point: ComputerPoint,
    windowId: string,
  ): Promise<readonly ComputerWindow[]> {
    const windows = await this.readWindows().catch(() => []);
    return windowsCoveringPoint(windows, windowId, point);
  }

  private async resolveSemanticTarget(
    target: ComputerTarget,
    allowUniqueTextTarget = false,
  ): Promise<ComputerResolvedTarget> {
    const unnamedTarget = target.label === undefined && target.role === undefined;

    if (unnamedTarget && (!allowUniqueTextTarget || !target.windowId)) {
      throw new ComputerTargetError({
        code: "computer_target_invalid",
        message:
          "This target does not name a control: window_id or coordinates alone match everything in scope. " +
          "Pass label (optionally with role and window_id) to pick a control, or use x/y coordinates " +
          "with the pointer tools. Only computer_scroll takes window_id alone, scrolling that window itself.",
      });
    }
    // A semantic resolve walks the accessibility tree before any input check runs, and a denied app's
    // tree is itself refused — ambiguity and not-found errors otherwise carry its labels back as
    // candidates. macOS only answers scoped trees, so an unscoped walk there is already empty; a
    // desktop-wide tree on other dialects refuses while a denied window is visible.
    if (target.windowId !== undefined) {
      await this.assertWindowContentAllowed(target.windowId);
    } else if (this.agentDialect !== "macos") {
      const denied = await this.deniedVisibleWindow();
      if (denied) throw new ComputerDenylistError(denied.match.app, denied.match.matched);
    }
    const observedNode = observedComputerTargetNode(target);
    if (observedNode) {
      if (!observedNode.windowId || observedNode.windowId !== target.windowId) {
        throw new ComputerTargetError({
          code: "computer_target_invalid",
          message: "The observed element and target name different windows; nothing was sent.",
        });
      }

      return { target, node: observedNode, point: activationPointForNode(observedNode) };
    }
    let state = await this.backend.getState({
      includeTree: true,
      reuseRecentTree: true,
      ...(target.windowId ? { windowId: target.windowId } : {}),
    });
    if (!state.root) {
      throw new ComputerTargetError({
        code: "computer_target_not_found",
        message: "Computer accessibility state did not include a target tree.",
        notFound: true,
      });
    }
    const resolve = (root: NonNullable<ComputerState["root"]>): ComputerResolvedTarget => ({
      target,
      ...(unnamedTarget
        ? resolveComputerUniqueTextTarget(root, target.windowId!, allowUniqueTextTarget)
        : resolveComputerSemanticTarget(root, target, allowUniqueTextTarget)),
    });
    try {
      return resolve(state.root);
    } catch (caughtError) {
      let error = caughtError;

      if (error instanceof ComputerTargetError && error.code === "computer_target_not_found") {
        state = await this.backend.getState({
          includeTree: true,
          ...(target.windowId ? { windowId: target.windowId } : {}),
        });
        try {
          if (state.root) return resolve(state.root);
        } catch (freshError) {
          if (freshError instanceof ComputerTargetError) error = freshError;
        }
      }

      if (
        error instanceof ComputerTargetError &&
        error.code === "computer_target_not_found" &&
        state.root?.truncated === true
      ) {
        throw new ComputerTargetError({
          code: error.code,
          message: `${error.message} The accessibility tree was truncated; use computer_get_state with label_contains to narrow the list and check whether the control is present.`,
          candidates: error.candidates,
          notFound: true,
        });
      }
      throw error;
    }
  }

  private actionResult(
    threadId: string | undefined,
    action: string,
    point: ComputerPoint | undefined,
    result: ComputerBackendActionResult | void,
    windowId?: string,
  ): ComputerActionResult {
    const merged = computerBackendActionResult(this.computerId, action, {
      ...(point ? { point } : {}),
      ...(windowId !== undefined ? { windowId } : {}),
      ...(result === undefined ? {} : result),
    });

    const call = currentComputerCall();
    call?.timing?.setOperation(action);
    call?.recordActionProof(result);
    this.emitAction(threadId, action, merged);

    const attributed = agentThreadId(threadId);
    const state = attributed ? this.threads.get(attributed) : undefined;
    if (attributed && state && merged.point) {
      state.cursor = merged.point;
      this.publishCached(attributed);
    }
    return merged;
  }

  private emitAction(
    threadId: string | undefined,
    action: string,
    result?: ComputerActionResult,
  ): void {
    const attributed = agentThreadId(threadId);
    if (attributed) this.surfacePaneForAgent(attributed);
    this.emit({
      type: "computer.action",
      ...(result?.windowId ? { windowId: result.windowId } : {}),
      ...(result?.delivery ? { delivery: result.delivery } : {}),
      action,
      ok: true,
      ...(attributed ? { threadId: ThreadId.makeUnsafe(attributed) } : {}),
    });
  }

  private surfacePaneForAgent(threadId: string): void {
    // A removed thread must not resurrect: an action resolving after the thread's deletion would
    // otherwise recreate its runtime record and emit pane requests for a thread that no longer exists.
    if (this.suspendedThreads.has(threadId)) return;
    const state = this.threadRuntime(threadId);
    if (state.paneSurfaced) return;
    state.paneSurfaced = true;

    this.emit({
      type: "computer.open-pane-requested",
      threadId: ThreadId.makeUnsafe(threadId),
    });
  }

  private publishCached(threadId: string): ThreadComputerState | undefined {
    const state = this.threads.get(threadId);
    if (!state || this.disposed) return undefined;
    state.version = ++this.nextStateVersion;
    const snapshot = this.threadSnapshot(threadId, state);
    state.reportedError = null;
    this.emit({ type: "computer.thread-state", state: snapshot });
    return snapshot;
  }

  private async publish(threadId: string): Promise<ThreadComputerState | undefined> {
    const previous = this.publishChains.get(threadId) ?? Promise.resolve();
    const next = previous.then(() => this.publishNow(threadId));
    const settled = next.catch(() => undefined);
    this.publishChains.set(threadId, settled);
    try {
      return await next;
    } finally {
      if (this.publishChains.get(threadId) === settled) this.publishChains.delete(threadId);
    }
  }

  private async publishNow(threadId: string): Promise<ThreadComputerState | undefined> {
    const state = this.threads.get(threadId);
    if (!state) return undefined;
    try {
      if (!this.physicalState && !this.physicalFailure) await this.refreshPhysicalState();
      if (this.physicalFailure) throw new Error(this.physicalFailure);
      const physical = this.physicalState;
      if (physical) {
        state.availability = physical.availability;
        if (physical.windows) state.windows = physical.windows;
        if (physical.screenSize) state.screenSize = physical.screenSize;
      }
      state.lastError = null;
    } catch (error) {
      state.lastError = clampComputerMessage(
        errorMessage(error),
        "The computer backend reported an error without a message.",
      );
    }
    if (this.disposed || this.threads.get(threadId) !== state) return undefined;
    state.version = ++this.nextStateVersion;
    const snapshot = this.threadSnapshot(threadId, state);

    state.reportedError = null;
    this.emit({ type: "computer.thread-state", state: snapshot });
    return snapshot;
  }

  private async publishAllThreads(): Promise<void> {
    await this.refreshPhysicalState();
    this.publishAllDepth += 1;
    try {
      for (const threadId of this.threads.keys()) await this.publish(threadId);
    } finally {
      this.publishAllDepth -= 1;
      if (this.publishAllDepth === 0 && this.windowsPublishPending) {
        this.windowsPublishPending = false;
        this.scheduleWindowsPublish();
      }
    }
  }

  private scheduleWindowsPublish(): void {
    if (this.disposed) return;
    if (this.publishAllDepth > 0) {
      this.windowsPublishPending = true;
      return;
    }
    if (this.windowsPublishTimer !== undefined) return;
    this.windowsPublishTimer = setTimeout(() => {
      this.windowsPublishTimer = undefined;
      if (this.disposed) return;
      void this.publishAllThreads().catch(() => undefined);
    }, this.windowsPublishDebounceMs);
    this.windowsPublishTimer.unref?.();
  }

  private republishAllThreads(): void {
    if (this.disposed) return;
    for (const [threadId, state] of this.threads) {
      state.version = ++this.nextStateVersion;
      this.emit({
        type: "computer.thread-state",
        state: this.threadSnapshot(threadId, state),
      });
    }
  }

  private newThreadRuntime(): ThreadComputerRuntimeState {
    return {
      version: ++this.nextStateVersion,
      lastError: null,
      reportedError: null,
      windows: [],
      screenSize: { width: 1, height: 1 },
      availability: {
        kind: "backend-unavailable",
        message: "Computer state has not been queried yet",
      },
      paneSurfaced: false,
    };
  }

  private threadRuntime(threadId: string): ThreadComputerRuntimeState {
    let state = this.threads.get(threadId);
    if (!state) {
      state = this.newThreadRuntime();
      this.threads.set(threadId, state);
    } else {
      this.threads.delete(threadId);
      this.threads.set(threadId, state);
    }
    for (const [id, candidate] of this.threads) {
      if (this.threads.size <= 256) break;
      if (
        id === threadId ||
        id === this.lease?.threadId ||
        this.agentCallsInFlight.has(id) ||
        this.publishChains.has(id) ||
        candidate.paneSurfaced ||
        candidate.inputPause
      )
        continue;
      this.threads.delete(id);
      this.threadLabels.delete(id);
    }
    return state;
  }

  private threadSnapshot(threadId: string, state: ThreadComputerRuntimeState): ThreadComputerState {
    const backgroundOwners = new Set(
      [...this.backgroundLeases.values()].map((lease) => lease.threadId),
    );
    const controlOwner =
      this.lease?.threadId ?? (backgroundOwners.has(threadId) ? threadId : undefined);
    return {
      threadId: ThreadId.makeUnsafe(threadId),
      controlGeneration: this.controlState.get(threadId).generation,
      version: state.version,
      computerId: this.computerId,
      windows: state.windows,
      screenSize: state.screenSize,
      ...(state.cursor ? { cursor: state.cursor } : {}),
      agentActive: (this.agentCallsInFlight.get(threadId) ?? 0) > 0,
      ...(this.activity && this.lease?.threadId === threadId ? { activity: this.activity } : {}),
      ...(state.inputPause ? { inputPause: state.inputPause } : {}),
      controlledByOtherThread: this.lease !== null && this.lease.threadId !== threadId,
      ...(backgroundOwners.size > 1 ? { sharedPreviewUnavailable: true } : {}),
      ...(controlOwner
        ? {
            controlOwnerThreadId: ThreadId.makeUnsafe(controlOwner),
            controlOwnerLabel: (this.threadLabels.get(controlOwner) ?? "Agent").slice(0, 512),
          }
        : {}),
      availability: this.correctedAvailability(state.availability),
      health: this.backendHealth,
      capabilities: this.backendCapabilities,
      lastError: state.reportedError ?? state.lastError,
    };
  }

  private correctedAvailability(availability: ComputerAvailability): ComputerAvailability {
    if (!this.backendEngaged) return availability;
    if (this.backendHealth.status === "connected" || availability.kind !== "available") {
      return availability;
    }
    return {
      kind: "backend-unavailable",
      message: healthUnavailableMessage(this.backendHealth),
    };
  }

  private isStreamWanted(epoch: number): boolean {
    return (
      !this.disposed &&
      this.streamDesired &&
      this.streamEpoch === epoch &&
      this.transport.streamSubscriberCount(this.computerId) > 0
    );
  }

  private recordError(error: unknown): void {
    const message = clampComputerMessage(
      errorMessage(error),
      "The computer backend reported an error without a message.",
    );
    for (const state of this.threads.values()) state.reportedError = message;
    // Written without a publish, a stream attach failure never reached the panel it explains.
    // Debounced, because this can fire per frame or per call during an outage.
    if (this.threads.size === 0) return;
    this.errorRepublishTimer ??= setTimeout(() => {
      this.errorRepublishTimer = undefined;
      for (const threadId of this.threads.keys()) {
        void this.publish(threadId).catch(() => undefined);
      }
    }, COMPUTER_ERROR_REPUBLISH_DEBOUNCE_MS);
    this.errorRepublishTimer.unref?.();
  }

  private emit(event: ComputerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }
}

async function measureScrollTravelFromPng(
  before: Uint8Array,
  after: Uint8Array,
): Promise<number | undefined> {
  const [decodedBefore, decodedAfter] = await Promise.all([
    decodePngLuma(before),
    decodePngLuma(after),
  ]);
  if (!decodedBefore || !decodedAfter) return undefined;
  return estimateVerticalTravel(decodedBefore, decodedAfter);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Whether a `waitForSettle` failure means this backend can never answer it. Only the two
// name-resolution refusals count: a driver older than the observer revision reports "Unknown tool:
// …", and a desktop host whose allowlist predates it throws "Unsupported computer host request."
// Neither can change for the backend's life, so the refusal is cached.
function settlePermanentlyUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("Unknown tool:") || message === "Unsupported computer host request.";
}

function windowIdSet(windows: readonly ComputerWindow[]): ReadonlySet<string> {
  return new Set(windows.map((window) => window.id));
}

function rectsOverlap(first: ComputerRect, second: ComputerRect): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}

function agentThreadId(threadId: string | undefined): string | undefined {
  const trimmed = threadId?.trim();
  return trimmed ? trimmed : undefined;
}

function healthUnavailableMessage(health: ComputerHealth): string {
  const reason =
    health.status === "reconnecting"
      ? "Reconnecting to the desktop."
      : "The desktop backend is not connected.";
  return clampComputerMessage(
    health.lastFailure ? `${reason} Last failure: ${health.lastFailure.message}` : reason,
    reason,
  );
}

function windowNotFoundError(windowId: string): ComputerTargetError {
  return new ComputerTargetError({
    code: "computer_target_not_found",
    message:
      `No desktop window has id ${JSON.stringify(windowId)}. ` +
      "Call computer_list_windows for the current window ids.",
    notFound: true,
  });
}

function menuAppNotFoundError(app: string): ComputerTargetError {
  return new ComputerTargetError({
    code: "computer_target_not_found",
    message:
      `No running application matches ${JSON.stringify(app)}. ` +
      "Call computer_list_apps for the running apps and their pids, then name one by app or pid.",
    notFound: true,
  });
}

function semanticPointTarget(resolved: ComputerResolvedTarget): PreparedTarget {
  return {
    point: resolved.point,
    ...(resolved.node.windowId ? { windowId: resolved.node.windowId } : {}),
  };
}

// The input would land in another application, and a warning read after the fact cannot undo a
// click that already fired — the live failure this exists for was a model clicking a buried window
// repeatedly and concluding the button was broken. The message names what is in the way and both
// ways out, so the next call is a correct one rather than a retry.
function occludedTargetError(
  windowId: string,
  point: ComputerPoint,
  covering: readonly ComputerWindow[],
  reason: string,
): ComputerTargetError {
  const blockers = covering
    .slice(0, 4)
    .map((window) => `${JSON.stringify(window.title || window.id)} (${window.id})`)
    .join(", ");
  return new ComputerTargetError({
    code: "computer_target_occluded",
    message:
      `Window ${JSON.stringify(windowId)} is covered at (${point.x}, ${point.y}) by ${blockers}, ` +
      `and this desktop could not raise it: ${reason}. The input would go to the covering window. ` +
      "Aim at a part of the target window that nothing covers, or move the covering window out of " +
      "the way first; or drop window_id to act on whatever is topmost at that point.",
  });
}

function refusedInjectionError(
  action: string,
  windowId: string,
  point: ComputerPoint,
): ComputerTargetError {
  return new ComputerTargetError({
    code: "computer_target_refused",
    message:
      `The desktop refused to deliver ${action} to window ${JSON.stringify(windowId)} at ` +
      `(${point.x}, ${point.y}), so no input was sent. The window is not accepting input at that ` +
      "point: a window's bounds include invisible resize and shadow margins, and the window may " +
      "also have closed since it was listed. Aim nearer the middle of the control, target it by " +
      "label instead of a coordinate, or drop window_id to act on whatever is topmost there.",
  });
}

function tripleClickUnsupportedError(): ComputerBackendError {
  return new ComputerBackendError(
    "This desktop backend cannot send a triple click. Select the line another way — " +
      "click at its start and shift-click at its end, or use the application's own " +
      "select-all shortcut with computer_press_key.",
  );
}

function clickGestureUnsupportedError(
  button: "right" | "middle",
  count: 1 | 2 | 3,
): ComputerBackendError {
  return new ComputerBackendError(
    `This desktop backend cannot send a ${button} click with count ${count}. ` +
      "Supported gestures are a left click with count 1-3 and a single right click.",
  );
}

function activationUnsupportedError(): ComputerBackendError {
  return new ComputerBackendError(
    "This desktop backend cannot bring a window forward. Ask the user to click the window " +
      "they want in front, or aim the action at it with window_id instead.",
  );
}

function clipboardUnsupportedError(): ComputerBackendError {
  return new ComputerBackendError("This computer backend does not support clipboard access.");
}

function hasCoordinates(target: ComputerTarget): target is ComputerTarget & ComputerPoint {
  return typeof target.x === "number" && typeof target.y === "number";
}

function hasLabelFields(target: ComputerTarget): boolean {
  return target.label !== undefined || target.role !== undefined;
}

function hasSemanticFields(target: ComputerTarget): boolean {
  return hasLabelFields(target) || target.windowId !== undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof ComputerBackendError || error instanceof ComputerTargetError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function withControlEnableTimeout<A>(action: Promise<A> | undefined): Promise<A | undefined> {
  if (action === undefined) return Promise.resolve(undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ComputerBackendError(
          "Enabling computer control timed out; control stays disabled for this conversation.",
        ),
      );
    }, COMPUTER_CONTROL_ENABLE_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([action, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

// The disable/removal/dispose side of the same bound: a wedged native call wedges the operation
// tail, and without a deadline every teardown that waits on it hangs forever — the in-memory gates
// are already held, so the bounded wait can only lose cleanup confirmation, never authority.
function withControlTeardownTimeout<A>(action: Promise<A>): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ComputerBackendError(
          "Computer control teardown timed out waiting on a wedged operation; the in-memory gate stays held.",
        ),
      );
    }, COMPUTER_CONTROL_ENABLE_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([action, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
