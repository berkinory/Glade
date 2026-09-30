import * as Crypto from "node:crypto";
import * as Path from "node:path";
import { isBackendReadinessAborted } from "../../backend/backendReadiness";
import { BrowserSessionRestore } from "../../browser/automation/browserSessionRestore";
import { createCookieSessionBackend } from "../../browser/automation/electronCookieSession";
import { BROWSER_SESSION_PARTITION } from "../../browser/browserSessionPolicy";

import { type DesktopRuntime } from "../desktopRuntimeTypes";

export function createDesktopBootstrap(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "writeDesktopLogHeader"
    | "requireCurrentDesktopMigrationBundle"
    | "configureAutoUpdater"
    | "handleDesktopMigrationRecovery"
    | "backendAuthToken"
    | "reserveBackendEndpoint"
    | "browserSessionRestore"
    | "BASE_DIR"
    | "browserOsKeyStore"
    | "BROWSER_SESSION_RESTORE_TIMEOUT_MS"
    | "registerIpcHandlers"
    | "ensureBrowserHostPipeServer"
    | "startCuaHost"
    | "startBackend"
    | "isDevelopment"
    | "waitForBackendWindowReady"
    | "backendHttpUrl"
    | "mainWindow"
    | "createWindow"
    | "formatErrorMessage"
    | "ensureInitialBackendWindowOpen"
  >,
) {
  async function bootstrap(): Promise<void> {
    desktopRuntime.writeDesktopLogHeader("bootstrap start");
    if (!(await desktopRuntime.requireCurrentDesktopMigrationBundle())) {
      return;
    }

    desktopRuntime.configureAutoUpdater();

    const migrationRecoveryOutcome = await desktopRuntime.handleDesktopMigrationRecovery();
    if (migrationRecoveryOutcome !== "continue") {
      return;
    }

    desktopRuntime.backendAuthToken = Crypto.randomBytes(24).toString("hex");
    await desktopRuntime.reserveBackendEndpoint("bootstrap");

    desktopRuntime.browserSessionRestore = new BrowserSessionRestore(
      Path.join(desktopRuntime.BASE_DIR, "browser-session-restore"),
      createCookieSessionBackend(BROWSER_SESSION_PARTITION),
      desktopRuntime.browserOsKeyStore,
    );
    try {
      let restoreTimer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          desktopRuntime.browserSessionRestore
            .initialize()
            .finally(() => clearTimeout(restoreTimer)),
          new Promise<never>((_, reject) => {
            restoreTimer = setTimeout(
              () => reject(new Error("Browser session restoration timed out.")),
              desktopRuntime.BROWSER_SESSION_RESTORE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(restoreTimer);
      }
    } catch {
      console.warn(
        "[Glade browser] Secure session restoration is unavailable; no saved session cookies were restored.",
      );
    }

    desktopRuntime.registerIpcHandlers();
    desktopRuntime.writeDesktopLogHeader("bootstrap ipc handlers registered");
    try {
      await desktopRuntime.ensureBrowserHostPipeServer();
    } catch (error) {
      console.warn("[Glade browser] Failed to start browser host pipe", error);
    }
    await desktopRuntime.startCuaHost();
    desktopRuntime.startBackend();
    desktopRuntime.writeDesktopLogHeader("bootstrap backend start requested");

    if (desktopRuntime.isDevelopment) {
      void desktopRuntime
        .waitForBackendWindowReady(desktopRuntime.backendHttpUrl)
        .then((source) => {
          desktopRuntime.writeDesktopLogHeader(`bootstrap backend ready source=${source}`);
          if (!desktopRuntime.mainWindow) {
            desktopRuntime.mainWindow = desktopRuntime.createWindow();
            desktopRuntime.writeDesktopLogHeader("bootstrap main window created");
          }
        })
        .catch((error) => {
          if (isBackendReadinessAborted(error)) {
            return;
          }
          desktopRuntime.writeDesktopLogHeader(
            `bootstrap backend readiness warning message=${desktopRuntime.formatErrorMessage(error)}`,
          );
          console.warn("[desktop] backend readiness check timed out during dev bootstrap", error);
          if (!desktopRuntime.mainWindow) {
            desktopRuntime.mainWindow = desktopRuntime.createWindow();
            desktopRuntime.writeDesktopLogHeader(
              "bootstrap main window created after readiness warning",
            );
          }
        });
      return;
    }

    desktopRuntime.ensureInitialBackendWindowOpen(desktopRuntime.backendHttpUrl);
  }
  return { bootstrap };
}
