import { app, BrowserWindow, protocol } from "electron";
import { isBackendReadinessAborted } from "../backend/backendReadiness";
import { createBackendSupervisor } from "../backend/backendSupervisor";
import { allowParkedViewRendering } from "../browser/browserViewParking";
import { startDesktopHost, type DesktopHost } from "../hostRpc/startDesktopHost";
import { resolveCuaBinary } from "../computer/cuaBinary";
import { createComputerPermissions } from "../computer/cuaPermissions";
import * as Path from "node:path";
import {
  DESKTOP_SCHEME,
  desktopIdentity,
  isDevelopment,
  shellEnvironmentSync,
  userDataPath,
  DESKTOP_CONTENT_BLOCKER_PATH,
} from "./desktopEnvironment";
import { createRegisterDesktopIpc } from "./ipc/registerDesktopIpc";
import {
  createDesktopLogging,
  formatErrorMessage,
  safeConsoleError,
  sanitizeLogValue,
} from "./lifecycle/desktopLogging";
import {
  BundleChangedDuringStartupError,
  createDesktopResources,
} from "./lifecycle/desktopResources";
import { createDesktopShutdown } from "./lifecycle/desktopShutdown";
import { createUpdates } from "./updates/createUpdates";
import { createAppIdentity } from "./window/appIdentity";
import { configureMediaPermissions } from "./window/mediaPermissionHandlers";
import { createMainWindow } from "./window/mainWindow";
import { registerSshHostsIpc } from "./ipc/sshHostsIpc";
import { createRemoteHosts } from "../remote/createRemoteHosts";

// Pages in the agent browser must not reach Glade's own backend or dev UI; other loopback ports stay
// reachable so agents can test the user's local servers.
function gladePorts(backendHttpUrl: string): ReadonlySet<number> {
  const ports = new Set<number>();
  for (const url of [backendHttpUrl, process.env.VITE_DEV_SERVER_URL]) {
    const port = url ? Number(URL.parse(url)?.port) : Number.NaN;
    if (port > 0) ports.add(port);
  }
  const configured = Number(process.env.GLADE_PORT);
  if (configured > 0) ports.add(configured);
  return ports;
}

export function createDesktopRuntime(): void {
  const log = createDesktopLogging();
  log.writeDesktopLogHeader(
    `shell environment sync platform=${process.platform} pathHydrated=${shellEnvironmentSync.pathHydrated} durationMs=${shellEnvironmentSync.durationMs}`,
  );
  const resources = createDesktopResources(log, {
    isQuitting: () => lifecycle.isQuitting(),
    markQuitting: () => lifecycle.markQuitting(),
    isInstallPreparing: () => updates.isInstallPreparing(),
    requestGracefulAppQuit: (reason) => lifecycle.requestGracefulAppQuit(reason),
  });
  app.setPath("userData", userDataPath);
  allowParkedViewRendering(process.platform, app.commandLine);
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  const identity = createAppIdentity(resources, () => windows.getMainWindow());
  let desktopHost: DesktopHost | null = null;
  const computerPermissions = createComputerPermissions(process.platform);
  const backend = createBackendSupervisor({
    desktopHost: { connection: () => desktopHost },
    log,
    resources,
    lifecycle: {
      isQuitting: () => lifecycle.isQuitting(),
      requestGracefulAppQuit: (reason) => lifecycle.requestGracefulAppQuit(reason),
    },
    windows: {
      getMainWindow: () => windows.getMainWindow(),
      createWindow: () => windows.createWindow(),
    },
  });
  const updates = createUpdates({
    resources: {
      readAppUpdateYml: resources.readAppUpdateYml,
      resolveEmbeddedWindowsPublisherSubjects: resources.resolveEmbeddedWindowsPublisherSubjects,
    },
    lifecycle: {
      isQuitting: () => lifecycle.isQuitting(),
      setQuitting: (value) => lifecycle.setQuitting(value),
      hasShutdownStarted: () => lifecycle.shutdownInFlight(),
      startBackend: backend.startBackend,
      stopBackendAndWaitForExit: backend.stopBackendAndWaitForExit,
      requestGracefulAppQuit: (reason) => lifecycle.requestGracefulAppQuit(reason),
      writeDesktopLogHeader: log.writeDesktopLogHeader,
    },
    notifications: { clearUnreadNotificationBadge: () => windows.clearUnreadNotificationBadge() },
  });
  const windows = createMainWindow({
    identity,
    resources,
    updates,
    lifecycle: {
      shutdownComplete: () => lifecycle.shutdownComplete(),
      isQuitting: () => lifecycle.isQuitting(),
      confirmRunningChatsThenQuit: (reason) => lifecycle.confirmRunningChatsThenQuit(reason),
      requestGracefulAppQuit: (reason) => lifecycle.requestGracefulAppQuit(reason),
      cancelPending: () => lifecycle.cancelPending(),
      rendererGone: () => lifecycle.rendererGone(),
    },
    log,
    openDesktopLogDirectory: backend.openDesktopLogDirectory,
  });
  const lifecycle = createDesktopShutdown({
    backend,
    computer: { stop: async () => desktopHost?.computer.stop() },
    getMainWindow: windows.getMainWindow,
    updates,
    log,
    resources,
    identity,
  });
  lifecycle.installSignalHandlers();
  const remoteHosts = createRemoteHosts({
    readAppUpdateYml: resources.readAppUpdateYml,
    log: log.writeDesktopLogHeader,
  });
  app.once("will-quit", () => remoteHosts.stop());
  const ipc = createRegisterDesktopIpc({
    windows,
    identity,
    updates,
    control: {
      getWsUrl: backend.getWsUrl,
      resolveQuitConfirmation: lifecycle.resolveQuitConfirmation,
      requestGracefulAppQuit: lifecycle.requestGracefulAppQuit,
      isQuitting: lifecycle.isQuitting,
    },
    desktopHost: () => desktopHost,
    computerPermissions,
  });
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true,
      },
    },
  ]);
  if (hasSingleInstanceLock) identity.repairBrowserProfileBeforeElectronReady(userDataPath);
  identity.configureAppIdentity();
  if (!hasSingleInstanceLock) app.quit();
  else app.on("second-instance", () => windows.focusMainWindow());
  async function bootstrap(): Promise<void> {
    log.writeDesktopLogHeader("bootstrap start");
    updates.configure();

    await backend.reserveBackendEndpoint("bootstrap");
    if (lifecycle.isQuitting()) return;
    try {
      desktopHost = await startDesktopHost({
        gladePorts: () => gladePorts(backend.getHttpUrl()),
        mainWindow: () => windows.getMainWindow(),
        contentBlocker: {
          cache: Path.join(userDataPath, "content-blocker", "engine.bin"),
          setting: DESKTOP_CONTENT_BLOCKER_PATH,
        },
        log: log.writeDesktopLogHeader,
        computer: {
          // Packaged builds keep the driver outside ASAR in Resources; source runs use the copy
          // scripts/fetch-cua-driver.mjs placed in apps/desktop/resources.
          binary: resolveCuaBinary({
            resourcesDir: app.isPackaged
              ? Path.join(process.resourcesPath, "cua-driver")
              : Path.resolve(__dirname, "../resources/cua-driver"),
            platform: process.platform,
            arch: process.arch,
            packaged: app.isPackaged,
          }),
          permissions: computerPermissions,
          hostBundleId: desktopIdentity.bundleId,
          log: log.writeDesktopLogHeader,
        },
      });
    } catch (error) {
      log.writeDesktopLogHeader(`desktop host unavailable message=${formatErrorMessage(error)}`);
    }
    // A quit that began while the host was starting stopped a null host; close this one now.
    if (lifecycle.isQuitting()) {
      await desktopHost?.close();
      return;
    }
    app.once("will-quit", () => void desktopHost?.close());

    ipc.registerIpcHandlers();
    registerSshHostsIpc(remoteHosts);
    log.writeDesktopLogHeader("bootstrap ipc handlers registered");
    backend.startBackend();
    log.writeDesktopLogHeader("bootstrap backend start requested");

    if (isDevelopment) {
      void backend
        .waitForBackendWindowReady(backend.getHttpUrl())
        .then((source) => {
          log.writeDesktopLogHeader(`bootstrap backend ready source=${source}`);
          if (!windows.getMainWindow()) {
            windows.createWindow();
            log.writeDesktopLogHeader("bootstrap main window created");
          }
        })
        .catch((error) => {
          if (isBackendReadinessAborted(error)) {
            return;
          }
          log.writeDesktopLogHeader(
            `bootstrap backend readiness warning message=${formatErrorMessage(error)}`,
          );
          console.warn("[desktop] backend readiness check timed out during dev bootstrap", error);
          if (!windows.getMainWindow()) {
            windows.createWindow();
            log.writeDesktopLogHeader("bootstrap main window created after readiness warning");
          }
        });
      return;
    }

    backend.ensureInitialBackendWindowOpen(backend.getHttpUrl());
  }
  app.on("before-quit", (event) => {
    log.writeDesktopLogHeader("before-quit received");
    if (lifecycle.shutdownComplete()) {
      return;
    }

    if (updates.beforeQuit(event)) return;
    event.preventDefault();
    void lifecycle.confirmRunningChatsThenQuit("before-quit");
  });
  if (hasSingleInstanceLock) {
    app
      .whenReady()
      .then(() => {
        lifecycle.installSignalHandlers();
        log.writeDesktopLogHeader("app ready");
        if (lifecycle.isQuitting()) return;
        identity.configureAppIdentity();
        identity.applyInitialMacDockIcon();
        identity.refreshMacIconCacheOnVersionChange();
        configureMediaPermissions(windows.getMainWindow);
        windows.configureApplicationMenu();
        try {
          resources.registerDesktopProtocol();
        } catch (error) {
          if (error instanceof BundleChangedDuringStartupError) {
            resources.restartAfterStartupBundleSwap(error);
            return;
          }
          throw error;
        }
        resources.startBundleSwapWatcher();
        void bootstrap().catch((error) => {
          resources.handleFatalStartupError("bootstrap", error);
        });

        app.on("browser-window-blur", () => {
          updates.markDesktopAppBackgrounded();
        });

        app.on("browser-window-focus", () => {
          updates.handleDesktopAppForegrounded();
        });

        app.on("activate", () => {
          if (lifecycle.isQuitting()) {
            return;
          }
          updates.handleDesktopAppForegrounded();
          if (BrowserWindow.getAllWindows().length === 0) {
            if (!isDevelopment) {
              backend.ensureInitialBackendWindowOpen(backend.getHttpUrl());
              return;
            }
            void backend
              .waitForBackendWindowReady(backend.getHttpUrl())
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
                if (!windows.getMainWindow()) {
                  windows.createWindow();
                }
              });
            return;
          }
          windows.focusMainWindow();
        });
      })
      .catch((error) => {
        resources.handleFatalStartupError("whenReady", error);
      });
  }
  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    const attributes = [
      `type=${details.type}`,
      `reason=${details.reason}`,
      `exitCode=${details.exitCode}`,
      ...(details.serviceName ? [`service=${details.serviceName}`] : []),
      ...(details.name ? [`name=${sanitizeLogValue(details.name)}`] : []),
    ].join(" ");
    log.writeDesktopLogHeader(`child process gone ${attributes}`);
    safeConsoleError(`[desktop] child process gone (${attributes})`);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
