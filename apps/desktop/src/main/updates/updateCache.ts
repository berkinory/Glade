import { app } from "electron";
import * as FS from "node:fs";
import * as OS from "node:os";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import {
  clearInstallMarker,
  readInstallMarker,
  resolveInstallMarkerOutcome,
  writeInstallMarker,
  type UpdateInstallMarker,
} from "./updateInstallMarker";
import { reduceDesktopUpdateStateOnInstallRestartFailure } from "./updateMachine";
import {
  resolveElectronUpdaterLegacyZipPath,
  resolveElectronUpdaterPendingCacheDir,
} from "./updatePendingCache";

export function createUpdateCache(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "configuredUpdaterCacheDirName"
    | "formatErrorMessage"
    | "getUpdateInstallMarkerPath"
    | "automaticUpdateActivitySuppressed"
    | "setUpdateState"
    | "updateState"
    | "logMacUpdateDiagnostics"
    | "updateDownloadInFlight"
    | "pendingUpdateCacheClearQueue"
  >,
) {
  function getUpdaterCachePathArgs(): {
    cacheDirName: string | null;
    platform: NodeJS.Platform;
    homeDir: string;
    localAppData: string | null;
    xdgCacheHome: string | null;
  } {
    return {
      cacheDirName: desktopRuntime.configuredUpdaterCacheDirName,
      platform: process.platform,
      homeDir: OS.homedir(),
      localAppData: process.env.LOCALAPPDATA ?? null,
      xdgCacheHome: process.env.XDG_CACHE_HOME ?? null,
    };
  }

  function getPendingUpdateCacheDir(): string | null {
    return resolveElectronUpdaterPendingCacheDir(getUpdaterCachePathArgs());
  }

  function clearLegacyUpdaterZipAfterVerifiedInstall(): void {
    const legacyZipPath = resolveElectronUpdaterLegacyZipPath(getUpdaterCachePathArgs());
    if (!legacyZipPath) {
      return;
    }
    try {
      FS.rmSync(legacyZipPath, { force: true });
      console.info("[desktop-updater] Cleared legacy top-level update.zip after verified install.");
    } catch (error) {
      console.warn(
        `[desktop-updater] Failed to clear legacy top-level update.zip: ${desktopRuntime.formatErrorMessage(error)}`,
      );
    }
  }

  function quarantineInstallMarker(reason: string): void {
    console.warn(`[desktop-updater] Discarding update install marker (${reason}).`);
    try {
      clearInstallMarker(desktopRuntime.getUpdateInstallMarkerPath());
    } catch (error) {
      console.warn(
        `[desktop-updater] Failed to delete quarantined update install marker: ${desktopRuntime.formatErrorMessage(error)}`,
      );
    }
  }

  function processInstallMarkerOnStartup(): void {
    const filePath = desktopRuntime.getUpdateInstallMarkerPath();
    const readResult = readInstallMarker(filePath);
    if (readResult.status === "missing") {
      return;
    }
    if (readResult.status === "invalid") {
      quarantineInstallMarker(`invalid or unreadable: ${readResult.error}`);
      return;
    }

    const marker = readResult.marker;
    const nowIso = new Date().toISOString();
    const outcome = resolveInstallMarkerOutcome(marker, app.getVersion(), nowIso);
    if (outcome === "success") {
      console.info(
        `[desktop-updater] Update to ${marker.toVersion} installed successfully (from ${marker.fromVersion})`,
      );
      try {
        clearInstallMarker(filePath);
      } catch (error) {
        console.warn(
          `[desktop-updater] Failed to clear successful update install marker: ${desktopRuntime.formatErrorMessage(error)}`,
        );
      }
      clearLegacyUpdaterZipAfterVerifiedInstall();
      return;
    }
    if (outcome === "stale" || outcome === "invalid") {
      quarantineInstallMarker(outcome);
      return;
    }

    let consecutiveFailures = marker.consecutiveFailures;
    if (outcome === "failure") {
      consecutiveFailures += 1;
      const failedMarker: UpdateInstallMarker = {
        ...marker,
        phase: "failed",
        consecutiveFailures,
        lastFailureAt: nowIso,
      };
      try {
        writeInstallMarker(filePath, failedMarker);
      } catch (error) {
        console.error(
          `[desktop-updater] Failed to persist restart install failure: ${desktopRuntime.formatErrorMessage(error)}`,
        );
      }
    }

    desktopRuntime.automaticUpdateActivitySuppressed = true;
    const message = `Glade restarted, but update ${marker.toVersion} was not installed. Try again.`;
    desktopRuntime.setUpdateState(
      reduceDesktopUpdateStateOnInstallRestartFailure(
        desktopRuntime.updateState,
        marker.toVersion,
        consecutiveFailures,
        message,
      ),
    );
    console.error(
      `[desktop-updater] UPDATE INSTALL FAILED: still running ${app.getVersion()} after attempting ${marker.toVersion}; consecutive failures=${consecutiveFailures}. Automatic update checks are suppressed until the user retries.`,
    );
    void desktopRuntime.logMacUpdateDiagnostics("startup install verification failure");
  }

  async function clearPendingUpdateCache(reason: string): Promise<void> {
    const pendingDir = getPendingUpdateCacheDir();
    if (!pendingDir || desktopRuntime.updateDownloadInFlight) {
      return;
    }
    try {
      await FS.promises.rm(pendingDir, { recursive: true, force: true });
      console.info(`[desktop-updater] Cleared pending update cache (${reason}).`);
    } catch (error) {
      console.warn(
        `[desktop-updater] Failed to clear pending update cache (${reason}): ${desktopRuntime.formatErrorMessage(error)}`,
      );
    }
  }

  function clearPendingUpdateCacheWhenSafe(reason: string): void {
    desktopRuntime.pendingUpdateCacheClearQueue.request(
      reason,
      desktopRuntime.updateDownloadInFlight,
      (safeReason) => {
        void clearPendingUpdateCache(safeReason);
      },
    );
  }
  return {
    processInstallMarkerOnStartup,
    clearPendingUpdateCache,
    clearPendingUpdateCacheWhenSafe,
  };
}
