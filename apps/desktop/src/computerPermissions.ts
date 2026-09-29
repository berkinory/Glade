import { parseComputerHelperMessage, type ComputerHelperMessage } from "./computerHelperProtocol";

// FILE: computerPermissions.ts
// Purpose: Owns the macOS Computer helper lifecycle, permission state, and permission coaching and input release.
// Layer: Desktop main-process service
// Depends on: A signed Swift helper plus narrow filesystem/process adapters.

import * as ChildProcess from "node:child_process";

import * as FS from "node:fs";

import * as Readline from "node:readline";

import type { Readable, Writable } from "node:stream";

import {
  type DesktopComputerPermission,
  type DesktopComputerPermissionGuideState,
  type DesktopComputerPermissionKind,
  type DesktopComputerPlatform,
  type DesktopComputerSettingsPane,
  type DesktopComputerState,
} from "@glade/contracts";

const MAX_HELPER_STDERR_CHARS = 4_096;

// Permission checks run through the serialized command queue, so a wedged
// helper must be killed rather than stall every queued read behind it.
const PERMISSION_COMMAND_TIMEOUT_MS = 10_000;

const GUIDE_GRANT_WATCH_MAX_MS = 10 * 60 * 1000;

type ComputerHelperProcess = ChildProcess.ChildProcessByStdio<Writable | null, Readable, Readable>;

type ComputerPermissionCommand =
  | "--check-permissions"
  | "--request-permissions"
  | "--prepare-permission-setup";

export interface DesktopComputerManagerOptions {
  platform: NodeJS.Platform;
  helperPath: string;
  appDisplayName?: string;
  appBundlePath?: string;
  onState: (state: DesktopComputerState) => void;
  onPermissionGuideState?: (state: DesktopComputerPermissionGuideState) => void;
  now?: () => Date;
  spawn?: typeof ChildProcess.spawn;
  /**
   * Opens System Settings at a privacy pane. Only used by permission setup
   * sessions started inside the manager; renderer-driven guides open the pane
   * through IPC themselves.
   */
  openSettingsPane?: (pane: DesktopComputerSettingsPane) => void;
  /**
   * Closes System Settings after a setup session lands every grant. Only used
   * when the session opened Settings itself; a dismissed or timed-out session
   * never closes an app the user may be using for something else.
   */
  closeSettingsApp?: () => void;
}

function desktopComputerPlatform(platform: NodeJS.Platform): DesktopComputerPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "other";
}

const COMPUTER_PERMISSION_KIND_GUIDE_PANES: Record<
  DesktopComputerPermissionKind,
  DesktopComputerSettingsPane
> = {
  accessibility: "accessibility",
  inputMonitoring: "input-monitoring",
  screenRecording: "screen-recording",
};

// Setup sessions walk panes in this order; the queue build sorts and dedupes
// into it so callers can pass kinds in any order without respawning a pane.
const COMPUTER_PERMISSION_SETUP_ORDER: readonly DesktopComputerPermissionKind[] = [
  "accessibility",
  "inputMonitoring",
  "screenRecording",
];

const COMPUTER_GUIDE_PANE_PERMISSION_KINDS: Record<
  DesktopComputerSettingsPane,
  DesktopComputerPermissionKind
> = {
  accessibility: "accessibility",
  "input-monitoring": "inputMonitoring",
  "screen-recording": "screenRecording",
};
export class DesktopComputerManager {
  readonly #options: Required<Pick<DesktopComputerManagerOptions, "now" | "spawn">> &
    Omit<
      DesktopComputerManagerOptions,
      "now" | "spawn" | "appDisplayName" | "appBundlePath" | "onPermissionGuideState"
    > & {
      appDisplayName: string;
      appBundlePath: string;
      onPermissionGuideState: (state: DesktopComputerPermissionGuideState) => void;
    };

  readonly #platform: DesktopComputerPlatform;

  // Accessibility is only tracked once a caller includes it in a check; before
  // that the Computer state must not pretend to know anything about it.
  #accessibilityPermission: DesktopComputerPermission | undefined = undefined;

  #inputMonitoringPermission: DesktopComputerPermission = "unknown";

  #screenRecordingPermission: DesktopComputerPermission = "unknown";

  #status: DesktopComputerState["status"];

  #message: string | null;

  #permissionProcess: ComputerHelperProcess | null = null;

  #permissionCommandQueue: Promise<void> = Promise.resolve();

  // Read-side freshness only: a grant flip surfaces at the next expiry, and
  // request/setup paths always bypass it. Five seconds keeps a TCC answer
  // honest for display while skipping a helper spawn on every poll.
  readonly #permissionCheckCache = new Map<DesktopComputerPermissionKind, number>();

  readonly #permissionChecks = new Map<string, Promise<boolean>>();

  // An explicit setup failure survives passive grant/health refreshes until
  // another explicit attempt or app restart; it must not become endless waiting.
  #permissionSetupFailure: {
    code: NonNullable<DesktopComputerState["permissionSetupErrorCode"]>;
    message: string;
  } | null = null;

  #disposed = false;

  #guideProcess: ComputerHelperProcess | null = null;

  #guideOutputLines: Readline.Interface | null = null;

  #lastGuideState: DesktopComputerPermissionGuideState | null = null;

  // The coach's own grant check runs inside the long-lived guide helper, and
  // macOS never lets a running process observe a fresh Accessibility grant —
  // so the manager re-checks through a newly spawned helper on a timer and
  // closes the coach itself when the pane flips.
  #activeGuidePane: DesktopComputerSettingsPane | null = null;

  #guideGrantWatch: {
    child: ComputerHelperProcess;
    timer: NodeJS.Timeout;
    startedAt: number;
    pending: boolean;
  } | null = null;

  // A setup session guides each missing pane in turn. A renderer-driven guide
  // leaves this queue empty, so its close never spawns a follow-on coach.
  #guidePaneQueue: DesktopComputerSettingsPane[] = [];

  #guideSessionKinds: readonly DesktopComputerPermissionKind[] = [];

  #guideSessionGeneration = 0;

  #lastEmittedStateJson: string | null = null;

  #guideSessionOpensSettings = false;

  // Whether this session opened System Settings at least once. Only then may
  // a successful drain close it again; a renderer-driven guide or a session
  // that never reached a pane leaves the user's Settings alone.
  #guideSessionOpenedSettings = false;

  constructor(options: DesktopComputerManagerOptions) {
    this.#options = {
      ...options,
      appDisplayName: options.appDisplayName ?? "",
      appBundlePath: options.appBundlePath ?? "",
      onPermissionGuideState: options.onPermissionGuideState ?? (() => undefined),
      now: options.now ?? (() => new Date()),
      spawn: options.spawn ?? ChildProcess.spawn,
    };
    this.#platform = desktopComputerPlatform(options.platform);
    this.#status = this.#platform === "macos" ? "permission-required" : "unsupported";
    this.#message =
      this.#platform === "macos" ? null : "Computer is available only in the macOS desktop app.";
  }

  getState(): DesktopComputerState {
    return {
      platform: this.#platform,
      supported: this.#platform === "macos",
      status: this.#permissionSetupFailure ? "error" : this.#status,
      inputMonitoringPermission: this.#inputMonitoringPermission,
      screenRecordingPermission: this.#screenRecordingPermission,
      ...(this.#accessibilityPermission !== undefined
        ? { accessibilityPermission: this.#accessibilityPermission }
        : {}),
      message: this.#permissionSetupFailure?.message ?? this.#message,
      ...(this.#permissionSetupFailure
        ? { permissionSetupErrorCode: this.#permissionSetupFailure.code }
        : {}),
      appDisplayName: this.#options.appDisplayName,
    };
  }

  async refreshState(
    permissions?: readonly DesktopComputerPermissionKind[],
    options: { readonly force?: boolean } = {},
  ): Promise<DesktopComputerState> {
    if (this.#platform !== "macos" || this.#disposed) return this.getState();
    if (!(await this.#runPermissionCommand("--check-permissions", permissions, !options.force))) {
      return this.getState();
    }
    return this.getState();
  }

  async requestPermissions(
    permissions?: readonly DesktopComputerPermissionKind[],
  ): Promise<DesktopComputerState> {
    if (this.#platform !== "macos" || this.#disposed) return this.getState();
    this.#permissionSetupFailure = null;
    this.#permissionCheckCache.clear();
    if (!(await this.#runPermissionCommand("--request-permissions", permissions))) {
      return this.getState();
    }
    return this.getState();
  }

  /**
   * Backend-driven permission setup: check the requested kinds, then walk the
   * floating guide through each pane still missing a grant, opening System
   * Settings at that pane as each step begins. The guide advances itself —
   * when a fresh check reports a grant, the next missing pane's coach and
   * settings page take over without the user returning to Glade, and when
   * every grant lands the session closes the Settings it opened.
   *
   * No macOS permission prompt is raised here on purpose: the prompt adds the
   * app with its switch off and cannot be re-raised once denied, while the
   * guide uses the pane's toggle or supported drag-and-drop. Registration must
   * first resolve this exact running app. Prompt args from tools never reach a
   * request path either.
   */
  async startPermissionSetup(
    permissions: readonly DesktopComputerPermissionKind[],
  ): Promise<DesktopComputerState> {
    if (this.#platform !== "macos" || this.#disposed) return this.getState();
    if (permissions.length === 0) return this.getState();
    this.hidePermissionGuide();
    const generation = this.#guideSessionGeneration;
    this.#permissionSetupFailure = null;
    this.#permissionCheckCache.clear();
    // Explicit registration preflight plus a grant check, with no TCC mutation
    // or permission prompt. Unresolvable copies never start a polling coach.
    if (
      !(await this.#runPermissionCommand(
        "--prepare-permission-setup",
        permissions,
        false,
        generation,
      ))
    ) {
      return this.getState();
    }
    if (this.#disposed || generation !== this.#guideSessionGeneration) return this.getState();
    this.#guidePaneQueue = [...new Set(permissions)]
      .toSorted(
        (left, right) =>
          COMPUTER_PERMISSION_SETUP_ORDER.indexOf(left) -
          COMPUTER_PERMISSION_SETUP_ORDER.indexOf(right),
      )
      .map((kind) => COMPUTER_PERMISSION_KIND_GUIDE_PANES[kind]);
    this.#guideSessionKinds = [...permissions];
    this.#guideSessionOpensSettings = true;
    this.#guideSessionOpenedSettings = false;
    this.#advancePermissionGuide();
    return this.getState();
  }

  showPermissionGuide(pane: DesktopComputerSettingsPane): void {
    // A renderer-driven guide covers exactly one pane and never auto-advances:
    // any in-flight setup session ends when the renderer takes over the coach.
    // No OS prompt is raised: the inline steps plus the coach are the whole
    // flow, and a denied prompt cannot be re-raised.
    this.#finishGuideSession(false);
    this.#permissionSetupFailure = null;
    this.#spawnPermissionGuide(pane);
  }

  /**
   * Ends a setup session. A successful drain closes the System Settings the
   * session opened; every other ending (dismissal, timeout, renderer takeover,
   * spawn failure) leaves Settings alone.
   */
  #finishGuideSession(success: boolean): void {
    this.#guideSessionGeneration += 1;
    const shouldCloseSettings = success && this.#guideSessionOpenedSettings;
    this.#guidePaneQueue = [];
    this.#guideSessionKinds = [];
    this.#guideSessionOpensSettings = false;
    this.#guideSessionOpenedSettings = false;
    if (shouldCloseSettings) {
      try {
        this.#options.closeSettingsApp?.();
      } catch {
        // Best effort: the grants already landed; a lingering Settings window
        // is an annoyance, not a broken setup.
      }
    }
  }

  #spawnPermissionGuide(pane: DesktopComputerSettingsPane): void {
    if (this.#platform !== "macos" || this.#disposed) return;
    if (!FS.existsSync(this.#options.helperPath)) return;
    this.#stopGuideProcess();
    try {
      const child = this.#options.spawn(
        this.#options.helperPath,
        [
          "--permission-guide",
          "--pane",
          pane,
          "--app-path",
          this.#options.appBundlePath,
          "--app-name",
          this.#options.appDisplayName,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      // A helper that dies mid-write must not surface as an unhandled stream error.
      child.stdin?.on("error", () => undefined);
      this.#guideProcess = child;
      this.#activeGuidePane = pane;
      this.#lastGuideState = null;
      this.#startGuideGrantWatch(child);
      child.once("error", () => {
        if (this.#guideProcess !== child) return;
        this.#guideProcess = null;
        this.#activeGuidePane = null;
        this.#stopGuideGrantWatch(child);
        this.#guideOutputLines?.close();
        this.#guideOutputLines = null;
        this.#lastGuideState = "closed";
        this.#options.onPermissionGuideState("closed");
        this.#finishGuideSession(false);
      });
      this.#guideOutputLines = this.#wireHelperOutput(child, (message) =>
        this.#handleGuideMessage(child, message),
      );
      child.once("exit", () => {
        this.#stopGuideGrantWatch(child);
      });
      // An exiting helper can still have a final structured setup error in
      // stdout. Drain it before disposing the reader or advancing the guide.
      child.once("close", () => {
        if (this.#guideProcess !== child) return;
        this.#guideProcess = null;
        this.#activeGuidePane = null;
        this.#stopGuideGrantWatch(child);
        this.#guideOutputLines?.close();
        this.#guideOutputLines = null;
        const finalState = this.#lastGuideState;
        // Crash or external kill: report closed so the renderer guide stays honest.
        if (finalState !== "closed" && finalState !== "granted") {
          this.#lastGuideState = "closed";
          this.#options.onPermissionGuideState("closed");
        }
        if (this.#guidePaneQueue.length === 0) return;
        if (finalState !== "granted") {
          // A dismissed (or crashed) coach ends the setup session rather than
          // respawning panes the user just waved away.
          this.#finishGuideSession(false);
          return;
        }
        // Recheck before advancing so a pane the user already flipped while the
        // last coach was up never shows a stale guide of its own. A failed
        // recheck ends the session rather than advancing on stale fields.
        const sessionKinds = this.#guideSessionKinds;
        const generation = this.#guideSessionGeneration;
        void this.#runPermissionCommand("--check-permissions", sessionKinds)
          .then((ok) => {
            if (generation !== this.#guideSessionGeneration || this.#disposed) return;
            if (ok) {
              this.#advancePermissionGuide();
              return;
            }
            this.#finishGuideSession(false);
          })
          .catch(() => {
            if (generation === this.#guideSessionGeneration) this.#finishGuideSession(false);
          });
      });
    } catch {
      // The guide is best-effort; the inline steps remain usable without it.
    }
  }

  #panePermission(pane: DesktopComputerSettingsPane): DesktopComputerPermission | undefined {
    switch (pane) {
      case "accessibility":
        return this.#accessibilityPermission;
      case "input-monitoring":
        return this.#inputMonitoringPermission;
      case "screen-recording":
        return this.#screenRecordingPermission;
    }
  }

  // Advances a setup session to the first queued pane still missing its grant.
  #advancePermissionGuide(): void {
    while (
      this.#guidePaneQueue.length > 0 &&
      this.#panePermission(this.#guidePaneQueue[0]!) === "granted"
    ) {
      this.#guidePaneQueue.shift();
    }
    const pane = this.#guidePaneQueue[0];
    if (!pane) {
      // Every queued grant landed: close the Settings this session opened.
      // When nothing was ever queued (all granted up front) the opened flag
      // is false, so a no-op setup closes nothing.
      this.#finishGuideSession(true);
      return;
    }
    if (this.#guideSessionOpensSettings && this.#options.openSettingsPane) {
      try {
        this.#options.openSettingsPane(pane);
      } catch {
        // The coach still follows System Settings when it opens by itself.
      }
      this.#guideSessionOpenedSettings = true;
    }
    this.#spawnPermissionGuide(pane);
  }

  hidePermissionGuide(): void {
    this.#finishGuideSession(false);
    this.#stopGuideProcess();
  }

  #stopGuideProcess(): void {
    const child = this.#guideProcess;
    if (!child) return;
    this.#guideProcess = null;
    this.#activeGuidePane = null;
    this.#stopGuideGrantWatch(child);
    this.#guideOutputLines?.close();
    this.#guideOutputLines = null;
    try {
      child.stdin?.write("close\n");
    } catch {
      // Fall through to the kill below.
    }
    setTimeout(() => {
      child.kill("SIGTERM");
    }, 500).unref();
  }

  /**
   * Polls the guide pane's grant through a freshly spawned helper on each tick:
   * the coach's own in-process check can never see a new Accessibility grant,
   * so without this the coach would stay up after the user flips the toggle.
   * Every tick also re-emits the permission snapshot, which keeps the renderer
   * badges live while a guide is on screen.
   * The grant watch polls every 800ms; dedupe keeps a steady-state guide from
   * spamming unchanged snapshots over IPC on every tick.
   */
  #startGuideGrantWatch(child: ComputerHelperProcess): void {
    this.#stopGuideGrantWatch();
    const timer = setInterval(() => {
      const watch = this.#guideGrantWatch;
      if (this.#guideProcess !== child || !watch || watch.child !== child) {
        this.#stopGuideGrantWatch(child);
        return;
      }
      if (Date.now() - watch.startedAt >= GUIDE_GRANT_WATCH_MAX_MS) {
        this.#stopGuideGrantWatch(child);
        this.#lastGuideState = "closed";
        this.#options.onPermissionGuideState("closed");
        this.#finishGuideSession(false);
        this.#emitState();
        this.#stopGuideProcess();
        return;
      }
      if (watch.pending) return;
      const pane = this.#activeGuidePane;
      if (!pane) return;
      const kinds =
        this.#guideSessionKinds.length > 0
          ? this.#guideSessionKinds
          : [COMPUTER_GUIDE_PANE_PERMISSION_KINDS[pane]];
      watch.pending = true;
      void this.#runPermissionCommand("--check-permissions", kinds)
        .then((ok) => {
          if (!ok || this.#guideProcess !== child || this.#activeGuidePane !== pane) return;
          if (this.#panePermission(pane) !== "granted") return;
          this.#onGuidePaneGranted(child);
        })
        .catch(() => undefined)
        .finally(() => {
          const latest = this.#guideGrantWatch;
          if (latest && latest.child === child) latest.pending = false;
        });
    }, 800);
    timer.unref();
    this.#guideGrantWatch = { child, timer, startedAt: Date.now(), pending: false };
  }

  #stopGuideGrantWatch(child?: ComputerHelperProcess): void {
    const watch = this.#guideGrantWatch;
    if (!watch) return;
    if (child && watch.child !== child) return;
    clearInterval(watch.timer);
    this.#guideGrantWatch = null;
  }

  /**
   * The watch saw the active pane grant while the coach was still up: report
   * the grant, retire the coach, and carry a setup session to its next pane.
   * `#stopGuideProcess` nulls `#guideProcess` before the child exits, so the
   * exit handler will not advance the session — this method does it instead.
   */
  #onGuidePaneGranted(child: ComputerHelperProcess): void {
    if (this.#guideProcess !== child) return;
    this.#stopGuideGrantWatch(child);
    this.#lastGuideState = "granted";
    this.#options.onPermissionGuideState("granted");
    this.#stopGuideProcess();
    if (this.#guidePaneQueue.length === 0) return;
    const sessionKinds = this.#guideSessionKinds;
    const generation = this.#guideSessionGeneration;
    void this.#runPermissionCommand("--check-permissions", sessionKinds)
      .then((ok) => {
        if (generation !== this.#guideSessionGeneration || this.#disposed) return;
        if (ok) {
          this.#advancePermissionGuide();
          return;
        }
        this.#finishGuideSession(false);
      })
      .catch(() => {
        if (generation === this.#guideSessionGeneration) this.#finishGuideSession(false);
      });
  }

  #handleGuideMessage(child: ComputerHelperProcess, message: ComputerHelperMessage): void {
    if (this.#guideProcess !== child) return;
    if (message.type === "error") {
      this.#recordPermissionSetupFailure(message);
      return;
    }
    if (message.type !== "permission-guide") return;
    this.#lastGuideState = message.state;
    this.#options.onPermissionGuideState(message.state);
  }

  #recordPermissionSetupFailure(message: Extract<ComputerHelperMessage, { type: "error" }>): void {
    const code = message.code;
    if (
      code !== "permission_setup_bundle_unavailable" &&
      code !== "permission_setup_registration_unresolved" &&
      code !== "permission_setup_identity_mismatch"
    )
      return;
    this.#permissionSetupFailure = { code, message: message.message };
    this.#permissionCheckCache.clear();
    this.#finishGuideSession(false);
    this.#stopGuideProcess();
    this.#lastGuideState = "closed";
    this.#options.onPermissionGuideState("closed");
    this.#setState("error", message.message);
  }

  dispose(): void {
    this.#disposed = true;
    this.#stopGuideProcess();
    this.#finishGuideSession(false);
    this.#permissionProcess?.kill("SIGTERM");
    this.#permissionProcess = null;
  }

  #emitState(): void {
    const state = this.getState();
    const json = JSON.stringify(state);
    if (json === this.#lastEmittedStateJson) return;
    this.#lastEmittedStateJson = json;
    this.#options.onState(state);
  }

  #setState(status: DesktopComputerState["status"], message: string | null): void {
    const changed = this.#status !== status || this.#message !== message;
    this.#status = status;
    this.#message = message;
    if (changed) this.#emitState();
  }

  #wireHelperOutput(
    child: ComputerHelperProcess,
    onMessage: (message: ComputerHelperMessage) => void,
  ): Readline.Interface {
    const lines = Readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const message = parseComputerHelperMessage(line);
      if (message) onMessage(message);
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length >= MAX_HELPER_STDERR_CHARS) return;
      stderr = `${stderr}${chunk}`.slice(0, MAX_HELPER_STDERR_CHARS);
    });
    child.once("close", (code) => {
      const diagnostic = stderr.trim();
      if (code !== 0 && diagnostic.length > 0) {
        console.warn(`[desktop-computer-helper] Native helper: ${diagnostic}`);
      }
    });
    return lines;
  }

  async #runPermissionCommand(
    command: ComputerPermissionCommand,
    permissions?: readonly DesktopComputerPermissionKind[],
    allowCached = false,
    setupGeneration?: number,
  ): Promise<boolean> {
    const kinds = permissions ?? COMPUTER_PERMISSION_SETUP_ORDER;
    const key = `${allowCached ? "cached" : "fresh"}:${[...new Set(kinds)].toSorted().join(",")}`;
    // The guide, settings, and server may ask simultaneously. Share an actual
    // in-flight probe, but never serve a cached grant to the guide's fresh poll.
    if (command === "--check-permissions") {
      const pending = this.#permissionChecks.get(key);
      if (pending) return pending;
    }
    const run = this.#permissionCommandQueue.then(() => {
      if (setupGeneration !== undefined && setupGeneration !== this.#guideSessionGeneration)
        return false;
      if (
        allowCached &&
        kinds.every((kind) => {
          const at = this.#permissionCheckCache.get(kind);
          return (
            at !== undefined &&
            Date.now() - at < 5_000 &&
            this.#panePermission(COMPUTER_PERMISSION_KIND_GUIDE_PANES[kind]) === "granted"
          );
        })
      )
        return true;
      return this.#executePermissionCommand(command, permissions, setupGeneration);
    });
    this.#permissionCommandQueue = run.then(
      () => undefined,
      () => undefined,
    );
    if (command === "--check-permissions") this.#permissionChecks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.#permissionChecks.get(key) === run) this.#permissionChecks.delete(key);
    }
  }

  #applyPermissionReport(message: Extract<ComputerHelperMessage, { type: "permissions" }>): void {
    for (const kind of COMPUTER_PERMISSION_SETUP_ORDER) {
      if (message[kind] === "denied") this.#permissionCheckCache.delete(kind);
    }
    // Fields absent from the payload were not part of this request; leaving
    // them untouched keeps an accessibility-aware check from erasing the
    // Computer set and vice versa.
    if (message.accessibility !== undefined) {
      this.#accessibilityPermission = message.accessibility;
    }
    if (message.inputMonitoring !== undefined) {
      this.#inputMonitoringPermission = message.inputMonitoring;
    }
    if (message.screenRecording !== undefined) {
      this.#screenRecordingPermission = message.screenRecording;
    }
    this.#status = COMPUTER_PERMISSION_SETUP_ORDER.every(
      (kind) => this.#panePermission(COMPUTER_PERMISSION_KIND_GUIDE_PANES[kind]) === "granted",
    )
      ? "ready"
      : "permission-required";
    this.#message = null;
    this.#emitState();
  }

  #permissionCheckFailed(kinds: readonly DesktopComputerPermissionKind[], message: string): void {
    for (const kind of kinds) {
      this.#permissionCheckCache.delete(kind);
      if (kind === "accessibility") this.#accessibilityPermission = "unknown";
      else if (kind === "inputMonitoring") this.#inputMonitoringPermission = "unknown";
      else this.#screenRecordingPermission = "unknown";
    }
    this.#setState("error", message);
  }

  async #executePermissionCommand(
    command: ComputerPermissionCommand,
    permissions?: readonly DesktopComputerPermissionKind[],
    setupGeneration?: number,
  ): Promise<boolean> {
    if (this.#disposed || this.#platform !== "macos") return false;
    const kinds = permissions ?? COMPUTER_PERMISSION_SETUP_ORDER;
    if (!FS.existsSync(this.#options.helperPath)) {
      this.#permissionCheckFailed(
        kinds,
        "The Computer native helper is missing from this desktop build.",
      );
      return false;
    }
    const permissionArguments = [...new Set(kinds)].flatMap((kind) => ["--permission", kind]);

    return await new Promise<boolean>((resolve) => {
      let child: ComputerHelperProcess;
      try {
        child = this.#options.spawn(
          this.#options.helperPath,
          [
            command,
            ...permissionArguments,
            ...(command === "--check-permissions"
              ? []
              : ["--app-path", this.#options.appBundlePath]),
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (error) {
        this.#permissionCheckFailed(
          kinds,
          `Could not inspect Computer permissions: ${error instanceof Error ? error.message : String(error)}`,
        );
        resolve(false);
        return;
      }
      this.#permissionProcess = child;
      let settled = false;
      const current = () =>
        setupGeneration === undefined || setupGeneration === this.#guideSessionGeneration;
      let report: Extract<ComputerHelperMessage, { type: "permissions" }> | undefined;
      let reportedError: Extract<ComputerHelperMessage, { type: "error" }> | undefined;
      const finish = (ok: boolean, message?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        outputLines.close();
        if (this.#permissionProcess === child) this.#permissionProcess = null;
        if (this.#disposed || !current()) {
          resolve(false);
          return;
        }
        if (reportedError) this.#recordPermissionSetupFailure(reportedError);
        if (ok && report) {
          // Publish only a complete successful report. A partial result or late
          // stdout after timeout must never preserve an old green badge.
          const now = Date.now();
          for (const kind of kinds) {
            if (report[kind] === "granted") this.#permissionCheckCache.set(kind, now);
          }
          this.#applyPermissionReport(report);
        } else {
          this.#permissionCheckFailed(
            kinds,
            message ?? "The Computer helper did not report its permission state.",
          );
        }
        resolve(ok);
      };
      const timeout = setTimeout(() => {
        finish(false, "Checking macOS permissions timed out. Try Set up again.");
        child.kill();
      }, PERMISSION_COMMAND_TIMEOUT_MS);
      const outputLines = this.#wireHelperOutput(child, (message) => {
        if (settled || !current()) return;
        if (message.type === "permissions") {
          report = { ...report, ...message };
        } else if (message.type === "error") {
          reportedError = message;
        }
      });
      child.once("error", (error) => {
        finish(false, `Could not inspect Computer permissions: ${error.message}`);
      });
      child.once("close", (code: number | null) => {
        const completedReport = report;
        const complete =
          completedReport !== undefined &&
          kinds.every((kind) => completedReport[kind] !== undefined);
        finish(
          code === 0 && complete && reportedError === undefined,
          reportedError?.message ??
            (complete ? "The Computer permission check did not finish successfully." : undefined),
        );
      });
    });
  }

  /**
   * Releases synthetic input the OS may still believe is held after a
   * computer-use driver died mid-gesture — a leaked button makes the user's
   * real clicks feel dead system-wide until reboot. The Cua host calls this
   * at retire-time precisely because no daemon may be left to ask; posting
   * button-ups and a flags-clear is a no-op when nothing is held.
   *
   * Runs on the permission queue so it cannot interleave with a permission
   * command's helper spawn, and resolves true only on the helper's
   * `released` payload — a silent helper exit means the leak may stand.
   */
  async releaseHeldInput(): Promise<boolean> {
    const run = this.#permissionCommandQueue.then(() => this.#executeReleaseHeldInput());
    this.#permissionCommandQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  }

  #executeReleaseHeldInput(): Promise<boolean> {
    if (this.#disposed || this.#platform !== "macos") return Promise.resolve(false);
    if (!FS.existsSync(this.#options.helperPath)) {
      this.#setState("error", "The Computer native helper is missing from this desktop build.");
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      let child: ComputerHelperProcess;
      try {
        child = this.#options.spawn(this.#options.helperPath, ["--release-held-input"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        resolve(false);
        return;
      }
      let released = false;
      const timeout = setTimeout(() => {
        child.kill();
        resolve(false);
      }, PERMISSION_COMMAND_TIMEOUT_MS);
      this.#wireHelperOutput(child, (message) => {
        if (message.type === "release-held-input" && message.released === true) {
          released = true;
        }
      });
      child.once("error", () => {
        clearTimeout(timeout);
        resolve(false);
      });
      child.once("close", () => {
        clearTimeout(timeout);
        resolve(released);
      });
    });
  }
}
