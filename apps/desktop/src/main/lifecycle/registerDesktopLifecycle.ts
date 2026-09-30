import { app, BrowserWindow } from "electron";
import * as Path from "node:path";
import { isBackendReadinessAborted } from "../../backend/backendReadiness";
import { ensureWindowsShellAppUserModelHelper } from "../../windowsShell/windowsShellAppUserModel";
import { BundleChangedDuringStartupError, type DesktopRuntime } from "../desktopRuntimeTypes";
import { markInstallHandoffSync } from "../updates/updateInstallMarker";
import { reduceDesktopUpdateStateOnInstallFailure } from "../updates/updateMachine";
import { isBrokenPipeError } from "./desktopProcessErrors";
export function registerDesktopLifecycle(desktopRuntime: DesktopRuntime): void {
  app.on("before-quit", (event) => {
    desktopRuntime.writeDesktopLogHeader("before-quit received");
    if (desktopRuntime.desktopShutdownComplete) {
      return;
    }

    if (desktopRuntime.isUpdaterQuitAndInstallInFlight) {
      try {
        if (
          !desktopRuntime.activeUpdateInstallHandoff ||
          !markInstallHandoffSync(
            desktopRuntime.getUpdateInstallMarkerPath(),
            desktopRuntime.activeUpdateInstallHandoff,
          )
        ) {
          throw new Error("Durable update install handoff no longer matches the active attempt.");
        }
      } catch (error) {
        event.preventDefault();
        const failedHandoff = desktopRuntime.activeUpdateInstallHandoff;
        desktopRuntime.clearUpdaterInstallInFlightAfterError();
        const consecutiveFailures = desktopRuntime.recordInstallMarkerFailure(
          new Date().toISOString(),
          failedHandoff,
        );
        desktopRuntime.setUpdateState({
          ...reduceDesktopUpdateStateOnInstallFailure(
            desktopRuntime.updateState,
            "The downloaded update could not be handed to the installer safely.",
          ),
          installFailureCount: consecutiveFailures,
        });
        console.error(
          `[desktop-updater] Refused mismatched install handoff during quit: ${desktopRuntime.formatErrorMessage(error)}`,
        );
        desktopRuntime.recoverDesktopAfterUpdaterInstallFailure();
        return;
      }

      if (desktopRuntime.deferredDesktopQuitIntent.observeUpdaterQuitAttempt()) {
        desktopRuntime.writeDesktopLogHeader(
          "deferred quit preserved through updater quit-and-install attempt",
        );
      }
      desktopRuntime.writeDesktopLogHeader("before-quit allowing updater quit-and-install");
      return;
    }

    if (desktopRuntime.isUpdaterInstallPreparing) {
      desktopRuntime.deferDesktopQuitUntilUpdaterSettles("before-quit");
      event.preventDefault();
      return;
    }

    event.preventDefault();
    void desktopRuntime.confirmRunningChatsThenQuit("before-quit");
  });
  if (desktopRuntime.hasSingleInstanceLock) {
    app
      .whenReady()
      .then(() => {
        desktopRuntime.writeDesktopLogHeader("app ready");
        desktopRuntime.configureAppIdentity();
        if (process.platform === "win32") {
          try {
            ensureWindowsShellAppUserModelHelper(
              Path.join(desktopRuntime.STATE_DIR, "taskbar-icons"),
            );
          } catch (error) {
            console.warn(
              `[desktop] Failed to prepare Windows shell icon helper: ${desktopRuntime.formatErrorMessage(error)}`,
            );
          }
        }
        desktopRuntime.applyInitialMacDockIcon();
        desktopRuntime.registerMacAppearanceIconSync();
        desktopRuntime.refreshMacIconCacheOnVersionChange();
        desktopRuntime.configureMediaPermissions();
        desktopRuntime.initializeDesktopComputer();
        desktopRuntime.configureApplicationMenu();
        try {
          desktopRuntime.registerDesktopProtocol();
        } catch (error) {
          if (error instanceof BundleChangedDuringStartupError) {
            desktopRuntime.restartAfterStartupBundleSwap(error);
            return;
          }
          throw error;
        }
        desktopRuntime.startBundleSwapWatcher();
        void desktopRuntime.bootstrap().catch((error) => {
          desktopRuntime.handleFatalStartupError("bootstrap", error);
        });

        app.on("browser-window-blur", () => {
          desktopRuntime.markDesktopAppBackgrounded();
        });

        app.on("browser-window-focus", () => {
          desktopRuntime.handleDesktopAppForegrounded();
        });

        app.on("activate", () => {
          if (desktopRuntime.desktopStartupBlockedForDatabaseRestore || desktopRuntime.isQuitting) {
            return;
          }
          desktopRuntime.handleDesktopAppForegrounded();
          if (BrowserWindow.getAllWindows().length === 0) {
            if (!desktopRuntime.isDevelopment) {
              desktopRuntime.ensureInitialBackendWindowOpen(desktopRuntime.backendHttpUrl);
              return;
            }
            void desktopRuntime
              .waitForBackendWindowReady(desktopRuntime.backendHttpUrl)
              .catch((error) => {
                if (isBackendReadinessAborted(error)) {
                  return;
                }
                console.warn(
                  "[desktop] backend readiness check timed out during dev activate",
                  error,
                );
              })
              .finally(() => {
                if (!desktopRuntime.mainWindow) {
                  desktopRuntime.mainWindow = desktopRuntime.createWindow();
                }
              });
            return;
          }
          desktopRuntime.focusMainWindow();
        });
      })
      .catch((error) => {
        desktopRuntime.handleFatalStartupError("whenReady", error);
      });
  }
  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    const attributes = [
      `type=${details.type}`,
      `reason=${details.reason}`,
      `exitCode=${details.exitCode}`,
      ...(details.serviceName ? [`service=${details.serviceName}`] : []),
      ...(details.name ? [`name=${desktopRuntime.sanitizeLogValue(details.name)}`] : []),
    ].join(" ");
    desktopRuntime.writeDesktopLogHeader(`child process gone ${attributes}`);
    desktopRuntime.safeConsoleError(`[desktop] child process gone (${attributes})`);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  if (process.platform !== "win32") {
    process.on("uncaughtException", (error: unknown) => {
      if (!isBrokenPipeError(error)) {
        throw error;
      }
      if (desktopRuntime.desktopShutdownPromise) return;
      desktopRuntime.writeDesktopLogHeader("EPIPE received");
      desktopRuntime.requestGracefulAppQuit("EPIPE");
    });

    process.on("SIGINT", () => {
      if (desktopRuntime.desktopShutdownPromise) return;
      desktopRuntime.writeDesktopLogHeader("SIGINT received");
      desktopRuntime.requestGracefulAppQuit("SIGINT");
    });

    process.on("SIGTERM", () => {
      if (desktopRuntime.desktopShutdownPromise) return;
      desktopRuntime.writeDesktopLogHeader("SIGTERM received");
      desktopRuntime.requestGracefulAppQuit("SIGTERM");
    });
  }
}
