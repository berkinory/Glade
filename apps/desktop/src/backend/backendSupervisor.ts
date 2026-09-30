import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { CUA_HOST_SOCKET_ENV } from "@glade/shared/computer/cuaDriverProtocol";
import { GLADE_DESKTOP_BUNDLE_ID_ENV } from "@glade/shared/platform/desktopIdentity";
import type { MigrationSchemaTooNewStartupBlock } from "@glade/shared/platform/migrationRecovery";
import {
  MIGRATION_DIVERGENCE_CONSENT_ENV,
  MIGRATION_RUNTIME_SOURCE_DIGEST_ENV,
} from "@glade/shared/platform/migrationRecovery";
import { NetService } from "@glade/shared/platform/Net";
import { applyShellEnvironmentHydrationMarker } from "@glade/shared/platform/shell";
import { DEVICE_HELPER_SOURCE_DIR_ENV } from "@glade/shared/workspace/deviceHelperCache";
import * as Effect from "effect/Effect";
import { app, BrowserWindow, dialog, shell } from "electron";
import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import {
  GLADE_BROWSER_HOST_PIPE_PATH,
  resolveBrowserHostPipeBackendEnv,
} from "../browser/browserUsePipeServer";
import {
  BACKEND_FORCE_KILL_DELAY_MS,
  BACKEND_LOG_FILE_NAME,
  BACKEND_MAX_OLD_SPACE_ENV_KEYS,
  BACKEND_SHUTDOWN_TIMEOUT_MS,
  BASE_DIR,
  DESKTOP_BACKEND_SHUTDOWN_TOKEN,
  DESKTOP_BROWSER_HOST_CAPABILITY,
  DESKTOP_BROWSER_HOST_CAPABILITY_FD,
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
import { isBrokenPipeError } from "../main/lifecycle/desktopProcessErrors";
import type { ServedStaticRoot } from "../main/lifecycle/desktopResources";
import type { DesktopMigrationRecoveryOutcome } from "../storage/desktopMigrationRecovery";
import {
  invalidMigrationStartupRecoveryChoices,
  recoverDesktopMigrationIfRequired,
} from "../storage/desktopMigrationRecovery";
import { embeddedDesktopMigrationRuntimeSourceDigest } from "../storage/migrationBundleIdentity";
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
interface BackendRecovery {
  takeMigrationConsent(): string | null;
  approveMigrationConsent(token: string): void;
  blockStartup(): void;
  isStartupBlocked(): boolean;
  isDesktopMigrationRecoveryPending(): boolean;
  handleDesktopMigrationRecovery(): Promise<DesktopMigrationRecoveryOutcome>;
  handleDesktopSchemaTooNewRecovery(block: MigrationSchemaTooNewStartupBlock): Promise<void>;
}
interface BackendUpdates {
  getState(): DesktopUpdateState;
  canInstallUpdateFromRecovery(): boolean;
  installLatestUpdateForMigrationRecovery(): Promise<string | null>;
}
interface BackendWindows {
  getMainWindow(): BrowserWindow | null;
  createWindow(): BrowserWindow;
}
interface BackendBrowser {
  isHostAvailable(): boolean;
}
interface BackendComputer {
  getHostEndpoint(): string | undefined;
  suspend(): Promise<void>;
  resume(): void;
}
export interface BackendDependencies {
  log: DesktopLog;
  resources: BackendResources;
  lifecycle: BackendLifecycle;
  recovery: BackendRecovery;
  updates: BackendUpdates;
  windows: BackendWindows;
  browser: BackendBrowser;
  computer: BackendComputer;
}
export function createBackendSupervisor({
  log,
  resources,
  lifecycle,
  recovery,
  updates,
  windows,
  browser,
  computer,
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
    const migrationSourceDigest = embeddedDesktopMigrationRuntimeSourceDigest();
    const migrationDivergenceConsent = recovery.takeMigrationConsent();
    const env: NodeJS.ProcessEnv = {
      ...resolveBrowserHostPipeBackendEnv(
        process.env,
        browser.isHostAvailable() ? GLADE_BROWSER_HOST_PIPE_PATH : null,
        browser.isHostAvailable() ? DESKTOP_BROWSER_HOST_CAPABILITY_FD : null,
      ),

      ...(servedStaticRoot?.snapshotted ? { GLADE_STATIC_DIR: servedStaticRoot.dir } : {}),
      ...(app.isPackaged
        ? { [DEVICE_HELPER_SOURCE_DIR_ENV]: Path.join(process.resourcesPath, "device-helper") }
        : {}),
      ...(migrationSourceDigest
        ? { [MIGRATION_RUNTIME_SOURCE_DIGEST_ENV]: migrationSourceDigest }
        : {}),
      ...(migrationDivergenceConsent
        ? { [MIGRATION_DIVERGENCE_CONSENT_ENV]: migrationDivergenceConsent }
        : {}),
      ...(computer.getHostEndpoint() ? { [CUA_HOST_SOCKET_ENV]: computer.getHostEndpoint() } : {}),
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
      migrationRecoveryMarkerPresent: recovery.isDesktopMigrationRecoveryPending(),
    });

    switch (response.kind) {
      case "ignore":
        return;
      case "recover-migration":
        // The marker is written mid-session by the migration that just killed the backend, so bootstrap's
        // one-shot check never saw it. Recovery owns the process from here; respawning would only repeat
        // the failed migration.
        log.writeDesktopLogHeader(
          `migration recovery marker detected after backend failure reason=${sanitizeLogValue(reason)}`,
        );
        safeConsoleError(
          `[desktop] backend failed with a pending migration recovery (${reason}); opening recovery`,
        );
        void runMidSessionMigrationRecovery(reason);
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

  async function runMidSessionMigrationRecovery(reason: string): Promise<void> {
    const outcome = await recovery.handleDesktopMigrationRecovery();
    if (outcome !== "continue") return;

    await restartBackendAfterCrash(reason);
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
      if (block.kind === "migration-schema-too-new") {
        await recovery.handleDesktopSchemaTooNewRecovery(block.block);
        return;
      }

      if (block.kind === "migration-startup-block-invalid") {
        recovery.blockStartup();
        await recoverDesktopMigrationIfRequired({
          requiresRecovery: () => true,
          markerRemains: () => true,
          choose: async ({ previousFailure }) => {
            const releaseUrl = updates.getState().releaseUrl;
            const choices = invalidMigrationStartupRecoveryChoices({
              canInstallUpdate: updates.canInstallUpdateFromRecovery(),
              canOpenReleasePage: releaseUrl !== null,
            });
            const result = await dialog.showMessageBox({
              type: "error",
              title:
                previousFailure === null
                  ? "Glade could not verify migration recovery"
                  : "Glade could not update itself",
              message:
                previousFailure === null
                  ? "The backend stopped for database safety, but its recovery details were invalid."
                  : "The newest Glade release could not be installed.",
              detail:
                `${previousFailure === null ? "" : `${previousFailure.message}\n\n`}` +
                "Glade will keep the backend and provider processes stopped. The recovery record is not trusted, so restoring from it is disabled; choose one of the safe actions below.",
              buttons: choices.map((choice) => choice.label),
              defaultId: 0,
              cancelId: choices.length - 1,
              noLink: true,
            });
            return choices[result.response]?.decision ?? "quit";
          },
          installUpdate: updates.installLatestUpdateForMigrationRecovery,
          openReleasePage: () => {
            const releaseUrl = updates.getState().releaseUrl;
            if (releaseUrl !== null) void shell.openExternal(releaseUrl);
          },
          openLogs: openDesktopLogDirectory,
          restore: async () => {
            throw new Error("Invalid migration recovery details cannot authorize a restore.");
          },
          requestRestart: () => undefined,
          requestQuit: (reason) => lifecycle.requestGracefulAppQuit(reason),
          formatError: formatErrorMessage,
          log: log.writeDesktopLogHeader,
        });
        return;
      }

      if (block.kind === "migration-divergence-consent-required") {
        const challenge = block.challenge;
        const result = await dialog.showMessageBox({
          type: "warning",
          title: "Glade found a different database migration history",
          message: `Migration ${challenge.firstDivergedId} does not match this build.`,
          detail:
            `The database records "${challenge.recordedName}", while this build expects ` +
            `"${challenge.expectedName}". Continuing will first save an exact backup in:\n` +
            `${challenge.backupDirectory}\n\nGlade will then rewrite tracker rows from migration ` +
            `${challenge.firstDivergedId} and replay through ${challenge.targetVersion}. ` +
            "Older builds may no longer be able to open the upgraded database. No provider or chat process will start until you choose.",
          buttons: ["Back up and continue", "Quit"],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (result.response === 0) {
          recovery.approveMigrationConsent(challenge.consentToken);
          backendLifecycleDialogInFlight = null;
          await restartBackendAfterCrash("approved migration lineage repair", "lifecycle");
        } else {
          lifecycle.requestGracefulAppQuit("migration lineage repair declined");
        }
        return;
      }

      if (block.kind === "migration-runtime-identity-mismatch") {
        await dialog.showMessageBox({
          type: "error",
          title: "Glade's server build does not match",
          message: "The desktop and server migration code came from different builds.",
          detail: app.isPackaged
            ? "Update or reinstall Glade before starting it again. The database was not opened."
            : "Rebuild with bun run build:desktop before starting Glade again. The database was not opened.",
          buttons: ["Quit"],
          defaultId: 0,
          noLink: true,
        });
        lifecycle.requestGracefulAppQuit("migration bundle identity mismatch");
        return;
      }

      if (block.kind === "migration-recovery-required") {
        const result = await dialog.showMessageBox({
          type: "warning",
          title: "Glade needs to recover its database",
          message: "A database migration did not finish safely.",
          detail:
            "Restart Glade to open the verified backup recovery flow. Provider and chat processes will remain stopped until recovery completes.",
          buttons: ["Restart and recover", "Quit"],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (result.response === 0) {
          app.relaunch();
          lifecycle.requestGracefulAppQuit("migration recovery required");
        } else {
          lifecycle.requestGracefulAppQuit("migration recovery declined");
        }
        return;
      }

      const processDetail =
        block.ownerPid === null
          ? "Another Glade server is already using this database."
          : `Another Glade server (process ${block.ownerPid}) is already using this database.`;
      const result = await dialog.showMessageBox({
        type: "warning",
        title: "Glade is already running elsewhere",
        message: "Your local Glade data is in use by another process.",
        detail: `${processDetail}\n\nStop the other Glade app or development server, then try again. Your data has not been changed.`,
        buttons: ["Try again", "Quit"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response === 0) {
        // Let a fast failed retry present the block again instead of racing this dialog task's finalizer
        // and leaving the window inert.
        backendLifecycleDialogInFlight = null;
        await restartBackendAfterCrash("database lifecycle lock retry", "lifecycle");
      } else {
        lifecycle.requestGracefulAppQuit("database lifecycle lock");
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
    // Recovery owns the database until it clears the marker. Callers that restart the backend after an
    // unrelated failure — a given-up update install, say — must not hand it a database the user is
    // being asked how to repair.
    if (recovery.isStartupBlocked()) {
      log.writeDesktopLogHeader("backend start suppressed while migration recovery is pending");
      return;
    }

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
      // packaged log setup is unavailable. The fourth pipe carries the browser-host capability and must
      // never be inherited.
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    const capabilityPipe = child.stdio[DESKTOP_BROWSER_HOST_CAPABILITY_FD];
    if (capabilityPipe && "end" in capabilityPipe) {
      capabilityPipe.on("error", (error) => {
        if (!isBrokenPipeError(error)) {
          safeConsoleError("[desktop] failed to deliver browser host capability", error);
        }
      });
      capabilityPipe.end(DESKTOP_BROWSER_HOST_CAPABILITY);
    } else {
      child.kill();
      scheduleBackendRestart("browser host capability pipe was unavailable");
      return;
    }
    const listeningDetector = new ServerListeningDetector();
    const startupBlockDetector = new BackendStartupBlockDetector();
    const outputTailDetector = new BackendOutputTailDetector();
    backendListeningDetector = listeningDetector;
    backendProcess = child;
    computer.resume();
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
    await computer.suspend();
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
