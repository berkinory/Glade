import { CUA_HOST_SOCKET_ENV } from "@glade/shared/computer/cuaDriverProtocol";
import { GLADE_DESKTOP_BUNDLE_ID_ENV } from "@glade/shared/platform/desktopIdentity";
import {
  MIGRATION_DIVERGENCE_CONSENT_ENV,
  MIGRATION_RUNTIME_SOURCE_DIGEST_ENV,
} from "@glade/shared/platform/migrationRecovery";
import { applyShellEnvironmentHydrationMarker } from "@glade/shared/platform/shell";
import { DEVICE_HELPER_SOURCE_DIR_ENV } from "@glade/shared/workspace/deviceHelperCache";
import { app, dialog, shell } from "electron";
import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import {
  GLADE_BROWSER_HOST_PIPE_PATH,
  resolveBrowserHostPipeBackendEnv,
} from "../browser/browserUsePipeServer";
import { BackendStartTrigger, type DesktopRuntime } from "../main/desktopRuntimeTypes";
import { isBrokenPipeError } from "../main/lifecycle/desktopProcessErrors";
import {
  invalidMigrationStartupRecoveryChoices,
  recoverDesktopMigrationIfRequired,
} from "../storage/desktopMigrationRecovery";
import { embeddedDesktopMigrationRuntimeSourceDigest } from "../storage/migrationBundleIdentity";
import { resolveBackendNodeArgs } from "./backendNodeOptions";
import { captureBackendProcessOutput } from "./backendProcessOutput";
import { BackendStartupBlockDetector, type BackendStartupBlock } from "./backendStartupBlock";
import {
  BACKEND_MAX_CONSECUTIVE_START_FAILURES,
  BackendOutputTailDetector,
  summarizeBackendFailureOutput,
} from "./backendSupervisionPolicy";
import { ServerListeningDetector } from "./serverListeningDetector";

export function createBackendSupervisor(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "BACKEND_MAX_OLD_SPACE_ENV_KEYS"
    | "resolveServedStaticRoot"
    | "migrationConsentHandoff"
    | "browserHostPipeServer"
    | "DESKTOP_BROWSER_HOST_CAPABILITY_FD"
    | "cuaHostEndpoint"
    | "desktopIdentity"
    | "backendPort"
    | "BASE_DIR"
    | "backendAuthToken"
    | "DESKTOP_BACKEND_SHUTDOWN_TOKEN"
    | "shellEnvironmentSync"
    | "backendSupervision"
    | "isQuitting"
    | "restartTimer"
    | "isDesktopMigrationRecoveryPending"
    | "writeDesktopLogHeader"
    | "sanitizeLogValue"
    | "safeConsoleError"
    | "handleDesktopMigrationRecovery"
    | "lastBackendFailureDetail"
    | "LOG_DIR"
    | "BACKEND_LOG_FILE_NAME"
    | "formatErrorMessage"
    | "backendLifecycleDialogInFlight"
    | "requestGracefulAppQuit"
    | "handleDesktopSchemaTooNewRecovery"
    | "desktopStartupBlockedForDatabaseRestore"
    | "updateState"
    | "canInstallUpdateFromRecovery"
    | "installLatestUpdateForMigrationRecovery"
    | "backendProcess"
    | "cancelBackendReadinessWait"
    | "backendInitialWindowOpenInFlight"
    | "reserveBackendEndpoint"
    | "ensureInitialBackendWindowOpen"
    | "backendHttpUrl"
    | "resolveBackendEntry"
    | "resolveBackendCwd"
    | "DESKTOP_BROWSER_HOST_CAPABILITY"
    | "backendListeningDetector"
    | "cuaDriverHost"
    | "writeBackendSessionBoundary"
    | "backendLogSink"
  >,
) {
  function backendNodeArgs(): string[] {
    const configuredMaxOldSpaceMb =
      desktopRuntime.BACKEND_MAX_OLD_SPACE_ENV_KEYS.map((key) => process.env[key]).find(
        (value) => value !== undefined && value.trim().length > 0,
      ) ?? null;
    return resolveBackendNodeArgs({
      configuredMaxOldSpaceMb,
      existingNodeOptions: process.env.NODE_OPTIONS,
      totalMemoryBytes: OS.totalmem(),
    });
  }

  function backendEnv(): NodeJS.ProcessEnv {
    const servedStaticRoot = desktopRuntime.resolveServedStaticRoot();
    const migrationSourceDigest = embeddedDesktopMigrationRuntimeSourceDigest();
    const migrationDivergenceConsent = desktopRuntime.migrationConsentHandoff.take();
    const env: NodeJS.ProcessEnv = {
      ...resolveBrowserHostPipeBackendEnv(
        process.env,
        desktopRuntime.browserHostPipeServer ? GLADE_BROWSER_HOST_PIPE_PATH : null,
        desktopRuntime.browserHostPipeServer
          ? desktopRuntime.DESKTOP_BROWSER_HOST_CAPABILITY_FD
          : null,
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
      ...(desktopRuntime.cuaHostEndpoint
        ? { [CUA_HOST_SOCKET_ENV]: desktopRuntime.cuaHostEndpoint }
        : {}),
      [GLADE_DESKTOP_BUNDLE_ID_ENV]: desktopRuntime.desktopIdentity.bundleId,
      GLADE_MODE: "desktop",
      GLADE_NO_BROWSER: "1",
      GLADE_PORT: String(desktopRuntime.backendPort),
      GLADE_HOME: desktopRuntime.BASE_DIR,
      GLADE_AUTH_TOKEN: desktopRuntime.backendAuthToken,
      GLADE_DESKTOP_SHUTDOWN_TOKEN: desktopRuntime.DESKTOP_BACKEND_SHUTDOWN_TOKEN,
    };
    // The backend runs the same login-shell probe at startup and does not begin listening until it
    // returns, so an unmarked child serializes a second ~1s hydration behind ours. Written explicitly
    // in both directions: an inherited marker must never suppress a probe when our own hydration failed
    // and the child's PATH is the raw launch one.
    return applyShellEnvironmentHydrationMarker(
      env,
      desktopRuntime.shellEnvironmentSync.pathHydrated,
    );
  }

  function scheduleBackendRestart(reason: string): void {
    const response = desktopRuntime.backendSupervision.respondToStartFailure({
      quitting: desktopRuntime.isQuitting,
      restartPending: desktopRuntime.restartTimer !== null,
      migrationRecoveryMarkerPresent: desktopRuntime.isDesktopMigrationRecoveryPending(),
    });

    switch (response.kind) {
      case "ignore":
        return;
      case "recover-migration":
        // The marker is written mid-session by the migration that just killed the backend, so bootstrap's
        // one-shot check never saw it. Recovery owns the process from here; respawning would only repeat
        // the failed migration.
        desktopRuntime.writeDesktopLogHeader(
          `migration recovery marker detected after backend failure reason=${desktopRuntime.sanitizeLogValue(reason)}`,
        );
        desktopRuntime.safeConsoleError(
          `[desktop] backend failed with a pending migration recovery (${reason}); opening recovery`,
        );
        void runMidSessionMigrationRecovery(reason);
        return;
      case "give-up":
        desktopRuntime.writeDesktopLogHeader(
          `backend supervision gave up failures=${response.failures} reason=${desktopRuntime.sanitizeLogValue(reason)}`,
        );
        desktopRuntime.safeConsoleError(
          `[desktop] backend failed to start ${response.failures} times in a row (${reason}); no further restarts will be attempted`,
        );
        presentBackendStartupGiveUp(reason);
        return;
      case "retry":
        desktopRuntime.safeConsoleError(
          `[desktop] backend exited unexpectedly (${reason}); restarting in ${response.delayMs}ms (attempt ${response.attempt}/${BACKEND_MAX_CONSECUTIVE_START_FAILURES})`,
        );
        desktopRuntime.restartTimer = setTimeout(() => {
          desktopRuntime.restartTimer = null;
          void restartBackendAfterCrash(reason);
        }, response.delayMs);
        return;
    }
  }

  async function runMidSessionMigrationRecovery(reason: string): Promise<void> {
    const outcome = await desktopRuntime.handleDesktopMigrationRecovery();
    if (outcome !== "continue") return;

    await restartBackendAfterCrash(reason);
  }

  function backendFailureDialogDetail(reason: string): string {
    const summary = summarizeBackendFailureOutput(desktopRuntime.lastBackendFailureDetail ?? "");
    const cause = summary.length > 0 ? summary : reason;
    return [
      cause,
      "Glade paused automatic restarts so a failing backend can't keep respawning in the background.",
      `Log file:\n${Path.join(desktopRuntime.LOG_DIR, desktopRuntime.BACKEND_LOG_FILE_NAME)}`,
    ].join("\n\n");
  }

  async function openDesktopLogDirectory(): Promise<void> {
    try {
      await FS.promises.mkdir(desktopRuntime.LOG_DIR, { recursive: true });
      const errorMessage = await shell.openPath(desktopRuntime.LOG_DIR);
      if (errorMessage.trim().length > 0) {
        throw new Error(errorMessage);
      }
    } catch (error) {
      desktopRuntime.safeConsoleError(
        `[desktop] failed to open log directory: ${desktopRuntime.formatErrorMessage(error)}`,
      );
    }
  }

  function presentBackendStartupGiveUp(reason: string): void {
    if (desktopRuntime.isQuitting || desktopRuntime.backendLifecycleDialogInFlight) return;

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
          desktopRuntime.backendLifecycleDialogInFlight = null;
          await restartBackendAfterCrash("manual retry after backend startup failure", "lifecycle");
          return;
        }

        desktopRuntime.requestGracefulAppQuit("backend failed to start");
        return;
      }
    })().finally(() => {
      if (desktopRuntime.backendLifecycleDialogInFlight === task) {
        desktopRuntime.backendLifecycleDialogInFlight = null;
      }
    });
    desktopRuntime.backendLifecycleDialogInFlight = task;
  }

  function handleBackendStartupBlock(block: BackendStartupBlock): void {
    if (desktopRuntime.isQuitting || desktopRuntime.backendLifecycleDialogInFlight) return;

    const task = (async () => {
      if (block.kind === "migration-schema-too-new") {
        await desktopRuntime.handleDesktopSchemaTooNewRecovery(block.block);
        return;
      }

      if (block.kind === "migration-startup-block-invalid") {
        desktopRuntime.desktopStartupBlockedForDatabaseRestore = true;
        await recoverDesktopMigrationIfRequired({
          requiresRecovery: () => true,
          markerRemains: () => true,
          choose: async ({ previousFailure }) => {
            const releaseUrl = desktopRuntime.updateState.releaseUrl;
            const choices = invalidMigrationStartupRecoveryChoices({
              canInstallUpdate: desktopRuntime.canInstallUpdateFromRecovery(),
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
          installUpdate: desktopRuntime.installLatestUpdateForMigrationRecovery,
          openReleasePage: () => {
            const releaseUrl = desktopRuntime.updateState.releaseUrl;
            if (releaseUrl !== null) void shell.openExternal(releaseUrl);
          },
          openLogs: openDesktopLogDirectory,
          restore: async () => {
            throw new Error("Invalid migration recovery details cannot authorize a restore.");
          },
          requestRestart: () => undefined,
          requestQuit: (reason) => desktopRuntime.requestGracefulAppQuit(reason),
          formatError: desktopRuntime.formatErrorMessage,
          log: desktopRuntime.writeDesktopLogHeader,
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
          desktopRuntime.migrationConsentHandoff.approve(challenge.consentToken);
          desktopRuntime.backendLifecycleDialogInFlight = null;
          await restartBackendAfterCrash("approved migration lineage repair", "lifecycle");
        } else {
          desktopRuntime.requestGracefulAppQuit("migration lineage repair declined");
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
        desktopRuntime.requestGracefulAppQuit("migration bundle identity mismatch");
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
          desktopRuntime.requestGracefulAppQuit("migration recovery required");
        } else {
          desktopRuntime.requestGracefulAppQuit("migration recovery declined");
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
        desktopRuntime.backendLifecycleDialogInFlight = null;
        await restartBackendAfterCrash("database lifecycle lock retry", "lifecycle");
      } else {
        desktopRuntime.requestGracefulAppQuit("database lifecycle lock");
      }
    })().finally(() => {
      if (desktopRuntime.backendLifecycleDialogInFlight === task) {
        desktopRuntime.backendLifecycleDialogInFlight = null;
      }
    });
    desktopRuntime.backendLifecycleDialogInFlight = task;
  }

  async function restartBackendAfterCrash(
    reason: string,
    trigger: BackendStartTrigger = "crash-restart",
  ): Promise<void> {
    if (desktopRuntime.isQuitting || desktopRuntime.backendProcess) {
      return;
    }

    if (trigger === "lifecycle") {
      desktopRuntime.backendSupervision.reset();
    }

    desktopRuntime.cancelBackendReadinessWait();

    desktopRuntime.backendInitialWindowOpenInFlight = null;
    try {
      await desktopRuntime.reserveBackendEndpoint("backend restart");
    } catch (error) {
      scheduleBackendRestart(
        `failed to reserve restart port after ${reason}: ${desktopRuntime.formatErrorMessage(error)}`,
      );
      return;
    }

    startBackend(trigger);
    desktopRuntime.ensureInitialBackendWindowOpen(desktopRuntime.backendHttpUrl);
  }

  function startBackend(trigger: BackendStartTrigger = "lifecycle"): void {
    if (desktopRuntime.isQuitting || desktopRuntime.backendProcess) return;
    // Recovery owns the database until it clears the marker. Callers that restart the backend after an
    // unrelated failure — a given-up update install, say — must not hand it a database the user is
    // being asked how to repair.
    if (desktopRuntime.desktopStartupBlockedForDatabaseRestore) {
      desktopRuntime.writeDesktopLogHeader(
        "backend start suppressed while migration recovery is pending",
      );
      return;
    }

    if (trigger === "lifecycle") {
      desktopRuntime.backendSupervision.reset();
    }

    const backendEntry = desktopRuntime.resolveBackendEntry();
    if (!FS.existsSync(backendEntry)) {
      scheduleBackendRestart(`missing server entry at ${backendEntry}`);
      return;
    }

    const child = ChildProcess.spawn(process.execPath, [...backendNodeArgs(), backendEntry], {
      cwd: desktopRuntime.resolveBackendCwd(),

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
    const capabilityPipe = child.stdio[desktopRuntime.DESKTOP_BROWSER_HOST_CAPABILITY_FD];
    if (capabilityPipe && "end" in capabilityPipe) {
      capabilityPipe.on("error", (error) => {
        if (!isBrokenPipeError(error)) {
          desktopRuntime.safeConsoleError(
            "[desktop] failed to deliver browser host capability",
            error,
          );
        }
      });
      capabilityPipe.end(desktopRuntime.DESKTOP_BROWSER_HOST_CAPABILITY);
    } else {
      child.kill();
      scheduleBackendRestart("browser host capability pipe was unavailable");
      return;
    }
    const listeningDetector = new ServerListeningDetector();
    const startupBlockDetector = new BackendStartupBlockDetector();
    const outputTailDetector = new BackendOutputTailDetector();
    desktopRuntime.backendListeningDetector = listeningDetector;
    desktopRuntime.backendProcess = child;
    desktopRuntime.cuaDriverHost?.resume();
    let backendSessionClosed = false;
    const closeBackendSession = (details: string) => {
      if (backendSessionClosed) return;
      backendSessionClosed = true;
      desktopRuntime.writeBackendSessionBoundary("END", details);
    };
    desktopRuntime.writeBackendSessionBoundary(
      "START",
      `pid=${child.pid ?? "unknown"} port=${desktopRuntime.backendPort} cwd=${desktopRuntime.resolveBackendCwd()}`,
    );
    const backendLogDestination = desktopRuntime.backendLogSink;
    const backendOutputCapture = captureBackendProcessOutput({
      stdout: child.stdout,
      stderr: child.stderr,
      ...(backendLogDestination ? { writeLog: (chunk) => backendLogDestination.write(chunk) } : {}),
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
        if (desktopRuntime.backendListeningDetector === listeningDetector) {
          desktopRuntime.backendSupervision.recordReadiness();
        }
      },
      () => undefined,
    );

    child.on("error", (error) => {
      if (desktopRuntime.backendListeningDetector === listeningDetector) {
        listeningDetector.fail(error);
        desktopRuntime.backendListeningDetector = null;
      }
      if (desktopRuntime.backendProcess === child) {
        desktopRuntime.backendProcess = null;
      }
      closeBackendSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
      desktopRuntime.lastBackendFailureDetail = error.message;
      scheduleBackendRestart(error.message);
    });

    child.on("exit", (code, signal) => {
      if (desktopRuntime.backendListeningDetector === listeningDetector) {
        listeningDetector.fail(
          new Error(
            `backend exited before logging readiness (code=${code ?? "null"} signal=${signal ?? "null"})`,
          ),
        );
        desktopRuntime.backendListeningDetector = null;
      }
      if (desktopRuntime.backendProcess === child) {
        desktopRuntime.backendProcess = null;
      }
      void backendOutputCapture.drained.then(() => {
        closeBackendSession(
          `pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
        );
        if (desktopRuntime.isQuitting) return;
        const startupBlock = startupBlockDetector.read();
        if (startupBlock) {
          handleBackendStartupBlock(startupBlock);
          return;
        }
        const reason = `code=${code ?? "null"} signal=${signal ?? "null"}`;
        desktopRuntime.lastBackendFailureDetail = outputTailDetector.read();
        scheduleBackendRestart(reason);
      });
    });
  }
  return { backendNodeArgs, openDesktopLogDirectory, startBackend };
}
