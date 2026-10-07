import { GLADE_DESKTOP_BUNDLE_ID_ENV } from "@glade/shared/platform/desktopIdentity";
import { NetService } from "@glade/shared/platform/Net";
import { applyShellEnvironmentHydrationMarker } from "@glade/shared/platform/shell";
import * as Effect from "effect/Effect";
import { BrowserWindow, dialog, shell } from "electron";
import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import {
  BACKEND_FORCE_KILL_DELAY_MS,
  BACKEND_LOG_FILE_NAME,
  BACKEND_MAX_OLD_SPACE_ENV_KEYS,
  BACKEND_SHUTDOWN_TIMEOUT_MS,
  BASE_DIR,
  DESKTOP_BACKEND_SHUTDOWN_TOKEN,
  desktopIdentity,
  isDevelopment,
  LOG_DIR,
  POSIX_BACKEND_FORCE_KILL_DELAY_MS,
  POSIX_BACKEND_SHUTDOWN_TIMEOUT_MS,
  POSIX_BACKEND_TERMINATE_DELAY_MS,
  shellEnvironmentSync,
} from "../main/desktopEnvironment";
import type { DesktopLog } from "../main/lifecycle/desktopLogging";
import {
  formatErrorMessage,
  safeConsoleError,
  sanitizeLogValue,
} from "../main/lifecycle/desktopLogging";
import type { ServedStaticRoot } from "../main/lifecycle/desktopResources";
import { resolveBackendNodeArgs } from "./backendNodeOptions";
import { captureBackendProcessOutput } from "./backendProcessOutput";
import { isBackendReadinessAborted, waitForHttpReady } from "./backendReadiness";
import {
  requireWindowsBackendExit,
  retainLiveBackendAfterShutdownFailure,
  stopPosixBackendAndWait,
  stopWindowsBackendAndWait,
} from "./backendShutdown";
import { BackendStartupBlockDetector, type BackendStartupBlock } from "./backendStartupBlock";
import { waitForBackendStartupReady } from "./backendStartupReadiness";
import {
  BACKEND_MAX_CONSECUTIVE_START_FAILURES,
  BackendOutputTailDetector,
  BackendSupervisionPolicy,
  summarizeBackendFailureOutput,
} from "./backendSupervisionPolicy";
import { openInitialBackendWindow } from "./initialBackendWindowOpen";
import { ServerListeningDetector } from "./serverListeningDetector";

export type BackendStartTrigger = "lifecycle" | "crash-restart";
interface BackendResources {
  resolveServedStaticRoot(): ServedStaticRoot | null;
  resolveBackendEntry(): string;
  resolveBackendCwd(): string;
}
interface BackendLifecycle {
  isQuitting(): boolean;
  requestGracefulAppQuit(reason: string): void;
}
interface BackendWindows {
  getMainWindow(): BrowserWindow | null;
  createWindow(): BrowserWindow;
}
export interface BackendDependencies {
  log: DesktopLog;
  resources: BackendResources;
  lifecycle: BackendLifecycle;
  windows: BackendWindows;
}
export function createBackendSupervisor({
  log,
  resources,
  lifecycle,
  windows,
}: BackendDependencies) {
  let backendReadinessAbortController: AbortController | null = null;
  let backendPort = 0;
  let backendHttpUrl = "";
  let backendWsUrl = "";
  const backendAuthToken = Crypto.randomBytes(24).toString("hex");
  let backendListeningDetector: ServerListeningDetector | null = null;
  let backendInitialWindowOpenInFlight: Promise<void> | null = null;
  let backendLifecycleDialogInFlight: Promise<void> | null = null;
  const backendSupervision = new BackendSupervisionPolicy();
  let restartTimer: NodeJS.Timeout | null = null;
  let lastBackendFailureDetail: string | null = null;
  let backendProcess: ChildProcess.ChildProcess | null = null;
  function backendNodeArgs(): string[] {
    const configuredMaxOldSpaceMb =
      BACKEND_MAX_OLD_SPACE_ENV_KEYS.map((key) => process.env[key]).find(
        (value) => value !== undefined && value.trim().length > 0,
      ) ?? null;
    return resolveBackendNodeArgs({
      configuredMaxOldSpaceMb,
      existingNodeOptions: process.env.NODE_OPTIONS,
      totalMemoryBytes: OS.totalmem(),
    });
  }

  function backendEnv(): NodeJS.ProcessEnv {
    const servedStaticRoot = resources.resolveServedStaticRoot();
    const env: NodeJS.ProcessEnv = {
      ...(servedStaticRoot?.snapshotted ? { GLADE_STATIC_DIR: servedStaticRoot.dir } : {}),
      [GLADE_DESKTOP_BUNDLE_ID_ENV]: desktopIdentity.bundleId,
      GLADE_MODE: "desktop",
      GLADE_NO_BROWSER: "1",
      GLADE_PORT: String(backendPort),
      GLADE_HOME: BASE_DIR,
      GLADE_AUTH_TOKEN: backendAuthToken,
      GLADE_DESKTOP_SHUTDOWN_TOKEN: DESKTOP_BACKEND_SHUTDOWN_TOKEN,
    };
    // The backend runs the same login-shell probe at startup and does not begin listening until it
    // returns, so an unmarked child serializes a second ~1s hydration behind ours. Written explicitly
    // in both directions: an inherited marker must never suppress a probe when our own hydration failed
    // and the child's PATH is the raw launch one.
    return applyShellEnvironmentHydrationMarker(env, shellEnvironmentSync.pathHydrated);
  }

  function scheduleBackendRestart(reason: string): void {
    const response = backendSupervision.respondToStartFailure({
      quitting: lifecycle.isQuitting(),
      restartPending: restartTimer !== null,
    });

    switch (response.kind) {
      case "ignore":
        return;
      case "give-up":
        log.writeDesktopLogHeader(
          `backend supervision gave up failures=${response.failures} reason=${sanitizeLogValue(reason)}`,
        );
        safeConsoleError(
          `[desktop] backend failed to start ${response.failures} times in a row (${reason}); no further restarts will be attempted`,
        );
        presentBackendStartupGiveUp(reason);
        return;
      case "retry":
        safeConsoleError(
          `[desktop] backend exited unexpectedly (${reason}); restarting in ${response.delayMs}ms (attempt ${response.attempt}/${BACKEND_MAX_CONSECUTIVE_START_FAILURES})`,
        );
        restartTimer = setTimeout(() => {
          restartTimer = null;
          void restartBackendAfterCrash(reason);
        }, response.delayMs);
        return;
    }
  }

  function backendFailureDialogDetail(reason: string): string {
    const summary = summarizeBackendFailureOutput(lastBackendFailureDetail ?? "");
    const cause = summary.length > 0 ? summary : reason;
    return [
      cause,
      "Glade paused automatic restarts so a failing backend can't keep respawning in the background.",
      `Log file:\n${Path.join(LOG_DIR, BACKEND_LOG_FILE_NAME)}`,
    ].join("\n\n");
  }

  async function openDesktopLogDirectory(): Promise<void> {
    try {
      await FS.promises.mkdir(LOG_DIR, { recursive: true });
      const errorMessage = await shell.openPath(LOG_DIR);
      if (errorMessage.trim().length > 0) {
        throw new Error(errorMessage);
      }
    } catch (error) {
      safeConsoleError(`[desktop] failed to open log directory: ${formatErrorMessage(error)}`);
    }
  }

  function presentBackendStartupGiveUp(reason: string): void {
    if (lifecycle.isQuitting() || backendLifecycleDialogInFlight) return;

    const detail = backendFailureDialogDetail(reason);
    const task = (async () => {
      for (;;) {
        const result = await dialog.showMessageBox({
          type: "error",
          title: "Glade's backend didn't start",
          message: `Glade's backend failed to start ${BACKEND_MAX_CONSECUTIVE_START_FAILURES} times in a row.`,
          detail,
          buttons: ["Try again", "Open logs", "Quit"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });

        if (result.response === 1) {
          await openDesktopLogDirectory();
          continue;
        }

        if (result.response === 0) {
          backendLifecycleDialogInFlight = null;
          await restartBackendAfterCrash("manual retry after backend startup failure", "lifecycle");
          return;
        }

        lifecycle.requestGracefulAppQuit("backend failed to start");
        return;
      }
    })().finally(() => {
      if (backendLifecycleDialogInFlight === task) {
        backendLifecycleDialogInFlight = null;
      }
    });
    backendLifecycleDialogInFlight = task;
  }

  function handleBackendStartupBlock(block: BackendStartupBlock): void {
    if (lifecycle.isQuitting() || backendLifecycleDialogInFlight) return;

    const task = (async () => {
      const ownerKnown = block.ownerPid !== null;
      const processDetail = ownerKnown
        ? `Another Glade server (process ${block.ownerPid}) is already using this database.`
        : "Glade could not verify who holds the database lock. It may be left over from an interrupted startup, or another Glade server may still be using it.";
      for (;;) {
        const result = await dialog.showMessageBox({
          type: "warning",
          title: ownerKnown
            ? "Glade is already running elsewhere"
            : "Glade could not verify database ownership",
          message: ownerKnown
            ? "Your local Glade data is in use by another process."
            : "Glade could not safely open your local data.",
          detail: [
            processDetail,
            "Close any other Glade app or development server using this data, then try again. If this keeps happening, open the logs to see the underlying lock error. Your data has not been changed.",
            `Log file:\n${Path.join(LOG_DIR, BACKEND_LOG_FILE_NAME)}`,
          ].join("\n\n"),
          buttons: ["Try again", "Open logs", "Quit"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (result.response === 1) {
          await openDesktopLogDirectory();
          continue;
        }
        if (result.response === 0) {
          // Let a fast failed retry present the block again instead of racing this dialog task's finalizer
          // and leaving the window inert.
          backendLifecycleDialogInFlight = null;
          await restartBackendAfterCrash("database lifecycle lock retry", "lifecycle");
        } else {
          lifecycle.requestGracefulAppQuit("database lifecycle lock");
        }
        return;
      }
    })().finally(() => {
      if (backendLifecycleDialogInFlight === task) {
        backendLifecycleDialogInFlight = null;
      }
    });
    backendLifecycleDialogInFlight = task;
  }

  async function restartBackendAfterCrash(
    reason: string,
    trigger: BackendStartTrigger = "crash-restart",
  ): Promise<void> {
    if (lifecycle.isQuitting() || backendProcess) {
      return;
    }

    if (trigger === "lifecycle") {
      backendSupervision.reset();
    }

    cancelBackendReadinessWait();

    backendInitialWindowOpenInFlight = null;
    try {
      await reserveBackendEndpoint("backend restart");
    } catch (error) {
      scheduleBackendRestart(
        `failed to reserve restart port after ${reason}: ${formatErrorMessage(error)}`,
      );
      return;
    }

    startBackend(trigger);
    ensureInitialBackendWindowOpen(backendHttpUrl);
  }

  function startBackend(trigger: BackendStartTrigger = "lifecycle"): void {
    if (lifecycle.isQuitting() || backendProcess) return;
    if (trigger === "lifecycle") {
      backendSupervision.reset();
    }

    const backendEntry = resources.resolveBackendEntry();
    if (!FS.existsSync(backendEntry)) {
      scheduleBackendRestart(`missing server entry at ${backendEntry}`);
      return;
    }

    const child = ChildProcess.spawn(process.execPath, [...backendNodeArgs(), backendEntry], {
      cwd: resources.resolveBackendCwd(),

      env: {
        ...backendEnv(),
        ELECTRON_RUN_AS_NODE: "1",
        GLADE_SERVER_ENTRY: backendEntry,
        GLADE_DESKTOP_PARENT_STDIN: "1",
      },
      // Keep output piped in every environment so startup blockers and readiness are observable even when
      // packaged log setup is unavailable.
      stdio: ["pipe", "pipe", "pipe"],
    });
    const listeningDetector = new ServerListeningDetector();
    const startupBlockDetector = new BackendStartupBlockDetector();
    const outputTailDetector = new BackendOutputTailDetector();
    backendListeningDetector = listeningDetector;
    backendProcess = child;
    let backendSessionClosed = false;
    const closeBackendSession = (details: string) => {
      if (backendSessionClosed) return;
      backendSessionClosed = true;
      log.writeBackendSessionBoundary("END", details);
    };
    log.writeBackendSessionBoundary(
      "START",
      `pid=${child.pid ?? "unknown"} port=${backendPort} cwd=${resources.resolveBackendCwd()}`,
    );

    const backendOutputCapture = captureBackendProcessOutput({
      stdout: child.stdout,
      stderr: child.stderr,
      writeLog: log.writeBackendOutput,
      writeStdout: (chunk) => {
        process.stdout.write(chunk);
      },
      writeStderr: (chunk) => {
        process.stderr.write(chunk);
      },
      detectors: [listeningDetector, startupBlockDetector, outputTailDetector],
    });

    // A successful spawn only proves that Electron created the process. Reset the crash backoff and the
    // circuit breaker after the backend actually listens; otherwise a startup error becomes a permanent
    // 500 ms restart loop.
    void listeningDetector.promise.then(
      () => {
        if (backendListeningDetector === listeningDetector) {
          backendSupervision.recordReadiness();
        }
      },
      () => undefined,
    );

    child.on("error", (error) => {
      if (backendListeningDetector === listeningDetector) {
        listeningDetector.fail(error);
        backendListeningDetector = null;
      }
      if (backendProcess === child) {
        backendProcess = null;
      }
      closeBackendSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
      lastBackendFailureDetail = error.message;
      scheduleBackendRestart(error.message);
    });

    child.on("exit", (code, signal) => {
      if (backendListeningDetector === listeningDetector) {
        listeningDetector.fail(
          new Error(
            `backend exited before logging readiness (code=${code ?? "null"} signal=${signal ?? "null"})`,
          ),
        );
        backendListeningDetector = null;
      }
      if (backendProcess === child) {
        backendProcess = null;
      }
      void backendOutputCapture.drained.then(() => {
        closeBackendSession(
          `pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
        );
        if (lifecycle.isQuitting()) return;
        const startupBlock = startupBlockDetector.read();
        if (startupBlock) {
          handleBackendStartupBlock(startupBlock);
          return;
        }
        const reason = `code=${code ?? "null"} signal=${signal ?? "null"}`;
        lastBackendFailureDetail = outputTailDetector.read();
        scheduleBackendRestart(reason);
      });
    });
  }

  async function waitForBackendHttpReady(
    baseUrl: string,
    options?: Parameters<typeof waitForHttpReady>[1],
  ): Promise<void> {
    cancelBackendReadinessWait();
    const controller = new AbortController();
    backendReadinessAbortController = controller;

    try {
      await waitForHttpReady(baseUrl, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      if (backendReadinessAbortController === controller) {
        backendReadinessAbortController = null;
      }
    }
  }

  function cancelBackendReadinessWait(): void {
    backendReadinessAbortController?.abort();
    backendReadinessAbortController = null;
  }

  async function reserveBackendEndpoint(reason: string): Promise<void> {
    backendPort = await Effect.service(NetService).pipe(
      Effect.flatMap((net) => net.reserveLoopbackPort()),
      Effect.provide(NetService.layer),
      Effect.runPromise,
    );
    backendHttpUrl = `http://127.0.0.1:${backendPort}`;
    backendWsUrl = `ws://127.0.0.1:${backendPort}/?token=${encodeURIComponent(backendAuthToken)}`;
    process.env.GLADE_DESKTOP_WS_URL = backendWsUrl;
    log.writeDesktopLogHeader(`${reason} resolved backend endpoint port=${backendPort}`);
  }

  async function waitForBackendWindowReady(baseUrl: string): Promise<"listening" | "http"> {
    return await waitForBackendStartupReady({
      listeningPromise: backendListeningDetector?.promise ?? null,
      waitForHttpReady: () =>
        waitForBackendHttpReady(baseUrl, {
          path: "/health",

          timeoutMs: null,
          isReady: async (response) => {
            if (!response.ok) {
              return false;
            }
            try {
              const payload = (await response.json()) as {
                startupReady?: unknown;
              };
              return payload.startupReady === true;
            } catch {
              return false;
            }
          },
        }),
      cancelHttpWait: cancelBackendReadinessWait,
    });
  }

  function ensureInitialBackendWindowOpen(baseUrl: string): void {
    openInitialBackendWindow({
      isDevelopment: isDevelopment,
      baseUrl,
      hasExistingWindow: () =>
        (windows.getMainWindow() ?? BrowserWindow.getAllWindows()[0] ?? null) !== null,
      createWindow: () => {
        windows.createWindow();
      },
      getReadinessInFlight: () => backendInitialWindowOpenInFlight,
      setReadinessInFlight: (promise) => {
        backendInitialWindowOpenInFlight = promise;
      },
      waitForBackendWindowReady,
      writeLog: log.writeDesktopLogHeader,
      isReadinessAborted: isBackendReadinessAborted,
      formatErrorMessage: formatErrorMessage,
      warn: (message, error) => {
        console.warn(message, error);
      },
    });
  }
  function takeBackendProcessForShutdown(): ChildProcess.ChildProcess | null {
    cancelBackendReadinessWait();
    backendListeningDetector = null;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }

    const child = backendProcess;
    backendProcess = null;
    return child;
  }
  async function stopBackendAndWaitForExit(): Promise<void> {
    const child = takeBackendProcessForShutdown();
    if (!child) return;
    const backendChild = child;
    if (backendChild.exitCode !== null || backendChild.signalCode !== null) return;

    if (process.platform === "win32") {
      try {
        const result = await stopWindowsBackendAndWait({
          child: backendChild,
          backendHttpUrl: backendHttpUrl,
          shutdownToken: DESKTOP_BACKEND_SHUTDOWN_TOKEN,
          forceKillDelayMs: BACKEND_FORCE_KILL_DELAY_MS,
          timeoutMs: BACKEND_SHUTDOWN_TIMEOUT_MS,
        });
        requireWindowsBackendExit(result);
      } catch (error) {
        backendProcess = retainLiveBackendAfterShutdownFailure(backendProcess, backendChild);
        throw error;
      }
      return;
    }

    try {
      await stopPosixBackendAndWait({
        child: backendChild,
        backendHttpUrl: backendHttpUrl,
        shutdownToken: DESKTOP_BACKEND_SHUTDOWN_TOKEN,
        terminateDelayMs: POSIX_BACKEND_TERMINATE_DELAY_MS,
        forceKillDelayMs: POSIX_BACKEND_FORCE_KILL_DELAY_MS,
        timeoutMs: POSIX_BACKEND_SHUTDOWN_TIMEOUT_MS,
      });
    } catch (error) {
      backendProcess = retainLiveBackendAfterShutdownFailure(backendProcess, backendChild);
      throw error;
    }
  }
  return {
    backendNodeArgs,
    openDesktopLogDirectory,
    startBackend,
    cancelBackendReadinessWait,
    reserveBackendEndpoint,
    waitForBackendWindowReady,
    ensureInitialBackendWindowOpen,
    stopBackendAndWaitForExit,
    getHttpUrl: () => backendHttpUrl,
    getWsUrl: () => backendWsUrl,
  };
}
