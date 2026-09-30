import { type MigrationRuntimeIdentityMismatch } from "@glade/shared/platform/migrationRecovery";
import { app, dialog, shell } from "electron";
import { type DesktopRuntime } from "../main/desktopRuntimeTypes";
import {
  hasPendingDesktopMigrationRecovery,
  recoverDesktopMigrationIfRequired,
  requiresDesktopMigrationRecovery,
  resolveDesktopMigrationRecoveryPaths,
  restoreDesktopMigrationBackup,
  type DesktopMigrationRecoveryDecision,
  type DesktopMigrationRecoveryOutcome,
  type DesktopMigrationRecoveryPaths,
} from "./desktopMigrationRecovery";
import {
  embeddedDesktopMigrationRuntimeSourceDigest,
  inspectDesktopMigrationRuntimeIdentity,
} from "./migrationBundleIdentity";

export function createDesktopRecoveryCoordinator(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "resolveAppRoot"
    | "formatErrorMessage"
    | "writeDesktopLogHeader"
    | "requestGracefulAppQuit"
    | "BASE_DIR"
    | "isDevelopment"
    | "desktopStartupBlockedForDatabaseRestore"
    | "updateState"
    | "canInstallUpdateFromRecovery"
    | "installLatestUpdateForMigrationRecovery"
    | "backendNodeArgs"
    | "resolveBackendCwd"
  >,
) {
  async function requireCurrentDesktopMigrationBundle(): Promise<boolean> {
    try {
      const mismatch = inspectDesktopMigrationRuntimeIdentity({
        appRoot: desktopRuntime.resolveAppRoot(),
        isPackaged: app.isPackaged,
        embeddedDigest: embeddedDesktopMigrationRuntimeSourceDigest(),
      });
      return mismatch ? rejectDesktopMigrationBundleMismatch(mismatch) : true;
    } catch (error) {
      return rejectUnverifiableDesktopMigrationBundle(error);
    }
  }

  async function rejectUnverifiableDesktopMigrationBundle(error: unknown): Promise<false> {
    const message = desktopRuntime.formatErrorMessage(error);
    desktopRuntime.writeDesktopLogHeader(`migration bundle source check failed message=${message}`);
    await dialog.showMessageBox({
      type: "error",
      title: "Glade could not verify its server build",
      message: "The migration source could not be checked safely.",
      detail: `${message}\n\nRebuild with bun run build:desktop before starting Glade. The database was not opened.`,
      buttons: ["Quit"],
      defaultId: 0,
      noLink: true,
    });
    desktopRuntime.requestGracefulAppQuit("migration bundle source check failed");
    return false;
  }

  async function rejectDesktopMigrationBundleMismatch(
    mismatch: MigrationRuntimeIdentityMismatch,
  ): Promise<false> {
    desktopRuntime.writeDesktopLogHeader(
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
    desktopRuntime.requestGracefulAppQuit("stale migration bundle");
    return false;
  }

  function desktopMigrationRecoveryPaths(): DesktopMigrationRecoveryPaths {
    return resolveDesktopMigrationRecoveryPaths({
      baseDir: desktopRuntime.BASE_DIR,
      appRoot: desktopRuntime.resolveAppRoot(),
      isDevelopment: desktopRuntime.isDevelopment,
    });
  }

  function isDesktopMigrationRecoveryPending(): boolean {
    try {
      return requiresDesktopMigrationRecovery(desktopMigrationRecoveryPaths());
    } catch (error) {
      // An unreadable marker path must not break crash supervision.
      desktopRuntime.writeDesktopLogHeader(
        `migration recovery marker check failed message=${desktopRuntime.formatErrorMessage(error)}`,
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
    desktopRuntime.desktopStartupBlockedForDatabaseRestore = true;
    const outcome = await recoverDesktopMigrationIfRequired({
      requiresRecovery: () => requiresDesktopMigrationRecovery(paths),
      markerRemains: () => hasPendingDesktopMigrationRecovery(paths),
      choose: async ({ previousFailure }) => {
        // The user is here because Glade cannot open its database, so the in-app update button is
        // unreachable by definition. A newer build is often the actual fix, and this dialog is the only
        // surface left to offer it from: installing it in place when the updater can reach the feed, and
        // handing over the download page otherwise.
        const releaseUrl = desktopRuntime.updateState.releaseUrl;
        const canInstallUpdate = desktopRuntime.canInstallUpdateFromRecovery();
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
      installUpdate: desktopRuntime.installLatestUpdateForMigrationRecovery,
      openReleasePage: () => {
        const releaseUrl = desktopRuntime.updateState.releaseUrl;
        if (releaseUrl !== null) void shell.openExternal(releaseUrl);
      },
      restore: () =>
        restoreDesktopMigrationBackup({
          executablePath: process.execPath,
          nodeArgs: desktopRuntime.backendNodeArgs(),
          paths,
          cwd: desktopRuntime.resolveBackendCwd(),
          env: process.env,
        }),
      requestRestart: () => app.relaunch(),
      requestQuit: (reason) => desktopRuntime.requestGracefulAppQuit(reason),
      formatError: desktopRuntime.formatErrorMessage,
      log: desktopRuntime.writeDesktopLogHeader,
    });
    if (outcome === "continue") {
      desktopRuntime.desktopStartupBlockedForDatabaseRestore = false;
    }
    return outcome;
  }
  return {
    requireCurrentDesktopMigrationBundle,
    desktopMigrationRecoveryPaths,
    isDesktopMigrationRecoveryPending,
    handleDesktopMigrationRecovery,
  };
}
