import { type MigrationSchemaTooNewStartupBlock } from "@glade/shared/platform/migrationRecovery";
import { app, dialog, shell } from "electron";
import { type DesktopRuntime } from "../main/desktopRuntimeTypes";
import {
  hasVerifiedDesktopMigrationRestore,
  recoverDesktopMigrationIfRequired,
  resolveDesktopMigrationRestoreCandidate,
  restoreDesktopMigrationBackup,
  type DesktopMigrationRecoveryDecision,
} from "./desktopMigrationRecovery";

export function createSchemaRecovery(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "desktopMigrationRecoveryPaths"
    | "desktopStartupBlockedForDatabaseRestore"
    | "canInstallUpdateFromRecovery"
    | "updateState"
    | "installLatestUpdateForMigrationRecovery"
    | "openDesktopLogDirectory"
    | "backendNodeArgs"
    | "resolveBackendCwd"
    | "requestGracefulAppQuit"
    | "formatErrorMessage"
    | "writeDesktopLogHeader"
  >,
) {
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
    const paths = desktopRuntime.desktopMigrationRecoveryPaths();
    const restoreCandidate = resolveDesktopMigrationRestoreCandidate(paths, block);
    desktopRuntime.desktopStartupBlockedForDatabaseRestore = true;

    await recoverDesktopMigrationIfRequired({
      requiresRecovery: () => true,
      markerRemains: () =>
        restoreCandidate === null ||
        !hasVerifiedDesktopMigrationRestore(paths, restoreCandidate.backupPath),
      choose: async ({ previousFailure }) => {
        const restoreFailed = previousFailure?.attempt === "restore";
        const canInstallUpdate = desktopRuntime.canInstallUpdateFromRecovery();
        const releaseUrl = desktopRuntime.updateState.releaseUrl;
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
      installUpdate: desktopRuntime.installLatestUpdateForMigrationRecovery,
      openReleasePage: () => {
        const releaseUrl = desktopRuntime.updateState.releaseUrl;
        if (releaseUrl !== null) void shell.openExternal(releaseUrl);
      },
      openLogs: desktopRuntime.openDesktopLogDirectory,
      restore: async () => {
        if (!restoreCandidate) {
          throw new Error("No exact compatible migration backup is available.");
        }
        await restoreDesktopMigrationBackup({
          executablePath: process.execPath,
          nodeArgs: desktopRuntime.backendNodeArgs(),
          paths,
          cwd: desktopRuntime.resolveBackendCwd(),
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
      requestQuit: (reason) => desktopRuntime.requestGracefulAppQuit(reason),
      formatError: desktopRuntime.formatErrorMessage,
      log: desktopRuntime.writeDesktopLogHeader,
    });
  }
  return { handleDesktopSchemaTooNewRecovery };
}
