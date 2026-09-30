import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import {
  type MigrationRuntimeIdentityMismatch,
  type MigrationSchemaTooNewStartupBlock,
} from "@glade/shared/platform/migrationRecovery";
import { app, dialog, shell } from "electron";
import { BASE_DIR, isDevelopment } from "../main/desktopEnvironment";
import type { DesktopLog } from "../main/lifecycle/desktopLogging";
import { formatErrorMessage } from "../main/lifecycle/desktopLogging";
import {
  MigrationConsentHandoff,
  hasPendingDesktopMigrationRecovery,
  hasVerifiedDesktopMigrationRestore,
  recoverDesktopMigrationIfRequired,
  requiresDesktopMigrationRecovery,
  resolveDesktopMigrationRecoveryPaths,
  resolveDesktopMigrationRestoreCandidate,
  restoreDesktopMigrationBackup,
  type DesktopMigrationRecoveryDecision,
  type DesktopMigrationRecoveryOutcome,
  type DesktopMigrationRecoveryPaths,
} from "./desktopMigrationRecovery";
import {
  embeddedDesktopMigrationRuntimeSourceDigest,
  inspectDesktopMigrationRuntimeIdentity,
} from "./migrationBundleIdentity";

interface RecoveryResources {
  resolveAppRoot(): string;
  resolveBackendCwd(): string;
}
interface RecoveryBackend {
  backendNodeArgs(): string[];
  openDesktopLogDirectory(): Promise<void>;
}
interface RecoveryUpdates {
  getState(): DesktopUpdateState;
  canInstallUpdateFromRecovery(): boolean;
  installLatestUpdateForMigrationRecovery(): Promise<string | null>;
}
export function createDesktopRecoveryCoordinator(
  resources: RecoveryResources,
  backend: RecoveryBackend,
  updates: RecoveryUpdates,
  requestGracefulAppQuit: (reason: string) => void,
  log: DesktopLog,
) {
  let desktopStartupBlockedForDatabaseRestore = false;
  const consent = new MigrationConsentHandoff();
  function restoreBackup(paths: DesktopMigrationRecoveryPaths) {
    return restoreDesktopMigrationBackup({
      executablePath: process.execPath,
      nodeArgs: backend.backendNodeArgs(),
      paths,
      cwd: resources.resolveBackendCwd(),
      env: process.env,
    });
  }
  async function requireCurrentDesktopMigrationBundle(): Promise<boolean> {
    try {
      const mismatch = inspectDesktopMigrationRuntimeIdentity({
        appRoot: resources.resolveAppRoot(),
        isPackaged: app.isPackaged,
        embeddedDigest: embeddedDesktopMigrationRuntimeSourceDigest(),
      });
      return mismatch ? rejectDesktopMigrationBundleMismatch(mismatch) : true;
    } catch (error) {
      return rejectUnverifiableDesktopMigrationBundle(error);
    }
  }

  async function rejectUnverifiableDesktopMigrationBundle(error: unknown): Promise<false> {
    const message = formatErrorMessage(error);
    log.writeDesktopLogHeader(`migration bundle source check failed message=${message}`);
    await dialog.showMessageBox({
      type: "error",
      title: "Glade could not verify its server build",
      message: "The migration source could not be checked safely.",
      detail: `${message}\n\nRebuild with bun run build:desktop before starting Glade. The database was not opened.`,
      buttons: ["Quit"],
      defaultId: 0,
      noLink: true,
    });
    requestGracefulAppQuit("migration bundle source check failed");
    return false;
  }

  async function rejectDesktopMigrationBundleMismatch(
    mismatch: MigrationRuntimeIdentityMismatch,
  ): Promise<false> {
    log.writeDesktopLogHeader(
      `migration bundle source mismatch expected=${mismatch.expectedDigest} actual=${mismatch.actualDigest}`,
    );
    await dialog.showMessageBox({
      type: "error",
      title: "Glade's server build is stale",
      message: "The built migration code does not match this checkout.",
      detail:
        `Expected ${mismatch.expectedDigest}, but the desktop bundle contains ` +
        `${mismatch.actualDigest}.\n\nRebuild with bun run build:desktop before starting Glade. The database was not opened.`,
      buttons: ["Quit"],
      defaultId: 0,
      noLink: true,
    });
    requestGracefulAppQuit("stale migration bundle");
    return false;
  }

  function desktopMigrationRecoveryPaths(): DesktopMigrationRecoveryPaths {
    return resolveDesktopMigrationRecoveryPaths({
      baseDir: BASE_DIR,
      appRoot: resources.resolveAppRoot(),
      isDevelopment: isDevelopment,
    });
  }

  function isDesktopMigrationRecoveryPending(): boolean {
    try {
      return requiresDesktopMigrationRecovery(desktopMigrationRecoveryPaths());
    } catch (error) {
      // An unreadable marker path must not break crash supervision.
      log.writeDesktopLogHeader(
        `migration recovery marker check failed message=${formatErrorMessage(error)}`,
      );
      return false;
    }
  }

  function formatRecoveryOptionList(options: ReadonlyArray<string>): string {
    if (options.length <= 1) return options[0] ?? "";
    return `${options.slice(0, -1).join(", ")} or ${options[options.length - 1]}`;
  }

  async function handleDesktopMigrationRecovery(): Promise<DesktopMigrationRecoveryOutcome> {
    const paths = desktopMigrationRecoveryPaths();
    desktopStartupBlockedForDatabaseRestore = true;
    const outcome = await recoverDesktopMigrationIfRequired({
      requiresRecovery: () => requiresDesktopMigrationRecovery(paths),
      markerRemains: () => hasPendingDesktopMigrationRecovery(paths),
      choose: async ({ previousFailure }) => {
        // The user is here because Glade cannot open its database, so the in-app update button is
        // unreachable by definition. A newer build is often the actual fix, and this dialog is the only
        // surface left to offer it from: installing it in place when the updater can reach the feed, and
        // handing over the download page otherwise.
        const releaseUrl = updates.getState().releaseUrl;
        const canInstallUpdate = updates.canInstallUpdateFromRecovery();
        const restoreFailed = previousFailure?.attempt === "restore";
        const choices: Array<{
          readonly label: string;
          readonly detail: string;
          readonly decision: DesktopMigrationRecoveryDecision;
        }> = [
          restoreFailed
            ? {
                label: "Try restore again",
                detail: "retry the verified backup restore",
                decision: "restore",
              }
            : {
                label: "Restore backup and restart",
                detail: "restore the verified pre-migration backup and restart",
                decision: "restore",
              },
        ];
        if (canInstallUpdate) {
          choices.push({
            label: "Update Glade and restart",
            detail: "install the newest Glade release, which may already contain the fix",
            decision: "install-update",
          });
        }
        if (releaseUrl !== null) {
          choices.push({
            label: "Download latest release",
            detail: `${canInstallUpdate ? "download that release" : "download the latest Glade release"} in a browser`,
            decision: "open-release-page",
          });
        }
        choices.push({
          label: "Quit",
          detail: "quit without opening the database",
          decision: "quit",
        });

        const options = formatRecoveryOptionList(choices.map((choice) => choice.detail));
        const result = await dialog.showMessageBox({
          type: previousFailure === null ? "warning" : "error",
          title:
            previousFailure === null
              ? "Glade needs to recover its database"
              : restoreFailed
                ? "Migration recovery failed"
                : "Glade could not update itself",
          message:
            previousFailure === null
              ? "Glade stopped a database migration before it could finish safely."
              : restoreFailed
                ? "The saved database backup could not be restored."
                : "The newest Glade release could not be installed.",
          detail: `${previousFailure === null ? "" : `${previousFailure.message}\n\n`}You can ${options}. No provider or chat process will start until recovery succeeds.`,
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
      restore: () => restoreBackup(paths),
      requestRestart: () => app.relaunch(),
      requestQuit: (reason) => requestGracefulAppQuit(reason),
      formatError: formatErrorMessage,
      log: log.writeDesktopLogHeader,
    });
    if (outcome === "continue") {
      desktopStartupBlockedForDatabaseRestore = false;
    }
    return outcome;
  }

  function schemaTooNewRestoreDetail(
    block: MigrationSchemaTooNewStartupBlock,
    restoreCandidate: ReturnType<typeof resolveDesktopMigrationRestoreCandidate>,
  ): string {
    if (restoreCandidate) {
      return (
        `Glade verified the exact pre-migration backup at:\n${restoreCandidate.backupPath}\n\n` +
        `Its tracker ends at migration ${restoreCandidate.backupMigrationId}; its shared lineage is compatible ` +
        "with this build, and it passed SQLite integrity checking."
      );
    }

    if (block.recovery.kind === "restore-available") {
      return "The recorded backup does not match this desktop database exactly, so Glade will not restore it.";
    }

    switch (block.recovery.reason) {
      case "missing-provenance":
        return "No completed migration backup record exists for this database, so Glade cannot choose a backup safely.";
      case "invalid-provenance":
        return "The completed migration backup record does not describe this exact database state.";
      case "invalid-backup":
        return "The exact recorded backup is missing, unreadable, or failed SQLite integrity checking.";
      case "incompatible-backup":
        return "The exact recorded backup has a schema or migration lineage this Glade build cannot open safely.";
    }
  }

  async function handleDesktopSchemaTooNewRecovery(
    block: MigrationSchemaTooNewStartupBlock,
  ): Promise<void> {
    const paths = desktopMigrationRecoveryPaths();
    const restoreCandidate = resolveDesktopMigrationRestoreCandidate(paths, block);
    desktopStartupBlockedForDatabaseRestore = true;

    await recoverDesktopMigrationIfRequired({
      requiresRecovery: () => true,
      markerRemains: () =>
        restoreCandidate === null ||
        !hasVerifiedDesktopMigrationRestore(paths, restoreCandidate.backupPath),
      choose: async ({ previousFailure }) => {
        const restoreFailed = previousFailure?.attempt === "restore";
        const canInstallUpdate = updates.canInstallUpdateFromRecovery();
        const releaseUrl = updates.getState().releaseUrl;
        const choices: Array<{
          readonly label: string;
          readonly decision: DesktopMigrationRecoveryDecision;
        }> = [];

        if (restoreCandidate) {
          choices.push({
            label: restoreFailed ? "Try restore again" : "Restore backup and restart",
            decision: "restore",
          });
        }
        if (canInstallUpdate) {
          choices.push({ label: "Update Glade and restart", decision: "install-update" });
        }
        if (releaseUrl !== null) {
          choices.push({ label: "Download latest release", decision: "open-release-page" });
        }
        choices.push(
          { label: "Open logs", decision: "open-logs" },
          { label: "Quit", decision: "quit" },
        );

        const result = await dialog.showMessageBox({
          type: previousFailure === null ? "warning" : "error",
          title:
            previousFailure === null
              ? "This database is newer than Glade"
              : restoreFailed
                ? "Database restore failed"
                : "Glade could not update itself",
          message:
            previousFailure === null
              ? `Database migration ${block.databaseMigrationId} is newer than this build supports (${block.latestSupportedMigrationId}).`
              : restoreFailed
                ? "The verified database backup could not be restored."
                : "The newest Glade release could not be installed.",
          detail:
            `${previousFailure === null ? "" : `${previousFailure.message}\n\n`}` +
            `${schemaTooNewRestoreDetail(block, restoreCandidate)}\n\n` +
            "The backend and provider processes will remain stopped until you update, restore, or quit.",
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
      openLogs: backend.openDesktopLogDirectory,
      restore: async () => {
        if (!restoreCandidate) {
          throw new Error("No exact compatible migration backup is available.");
        }
        await restoreDesktopMigrationBackup({
          executablePath: process.execPath,
          nodeArgs: backend.backendNodeArgs(),
          paths,
          cwd: resources.resolveBackendCwd(),
          env: process.env,
          expectedBackupPath: restoreCandidate.backupPath,
          expectedProvenancePath: restoreCandidate.provenancePath,
          verifyRestore: () =>
            hasVerifiedDesktopMigrationRestore(paths, restoreCandidate.backupPath),
          restoreVerificationFailure:
            "Migration restore completed without exact completed-provenance verification.",
        });
      },
      requestRestart: () => app.relaunch(),
      requestQuit: (reason) => requestGracefulAppQuit(reason),
      formatError: formatErrorMessage,
      log: log.writeDesktopLogHeader,
    });
  }
  return {
    requireCurrentDesktopMigrationBundle,
    desktopMigrationRecoveryPaths,
    isDesktopMigrationRecoveryPending,
    handleDesktopMigrationRecovery,
    handleDesktopSchemaTooNewRecovery,
    isStartupBlocked: () => desktopStartupBlockedForDatabaseRestore,
    blockStartup: () => {
      desktopStartupBlockedForDatabaseRestore = true;
    },
    takeMigrationConsent: () => consent.take(),
    approveMigrationConsent: (token: string) => consent.approve(token),
  };
}
