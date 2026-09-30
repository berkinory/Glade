import { app } from "electron";
import * as ChildProcess from "node:child_process";
import {
  requireWindowsBackendExit,
  retainLiveBackendAfterShutdownFailure,
  runAfterDesktopShutdown,
  stopPosixBackendAndWait,
  stopWindowsBackendAndWait,
} from "../../backend/backendShutdown";
import { shutdownBrowserServices } from "../../browser/automation/browserShutdown";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import {
  quitConfirmationPresentationForPlatform,
  shouldPromptForRunningChatsBeforeQuit,
} from "./runningChatsQuitGuard";

export function createDesktopShutdown(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "cancelBackendReadinessWait"
    | "backendListeningDetector"
    | "restartTimer"
    | "backendProcess"
    | "cuaDriverHost"
    | "backendHttpUrl"
    | "DESKTOP_BACKEND_SHUTDOWN_TOKEN"
    | "BACKEND_FORCE_KILL_DELAY_MS"
    | "BACKEND_SHUTDOWN_TIMEOUT_MS"
    | "POSIX_BACKEND_TERMINATE_DELAY_MS"
    | "POSIX_BACKEND_FORCE_KILL_DELAY_MS"
    | "POSIX_BACKEND_SHUTDOWN_TIMEOUT_MS"
    | "disposeComputerDesktopLifecycle"
    | "escapeKillSwitchMonitor"
    | "linuxEscapeKillSwitchMonitor"
    | "cuaHostEndpoint"
    | "browserHostPipeServer"
    | "formatErrorMessage"
    | "writeDesktopLogHeader"
    | "mainWindow"
    | "desktopShutdownPromise"
    | "isQuitting"
    | "clearUpdateBackgroundBlurTimer"
    | "clearUpdateCheckTimeoutTimer"
    | "clearUpdatePollTimer"
    | "computerManager"
    | "browserManager"
    | "browserVaultCapture"
    | "browserVault"
    | "browserSessionRestore"
    | "restoreStdIoCapture"
    | "desktopShutdownComplete"
    | "runningChatsQuitGuard"
    | "IPC"
    | "isUpdaterInstallPreparing"
    | "deferDesktopQuitUntilUpdaterSettles"
  >,
) {
  function takeBackendProcessForShutdown(): ChildProcess.ChildProcess | null {
    desktopRuntime.cancelBackendReadinessWait();
    desktopRuntime.backendListeningDetector = null;
    if (desktopRuntime.restartTimer) {
      clearTimeout(desktopRuntime.restartTimer);
      desktopRuntime.restartTimer = null;
    }

    const child = desktopRuntime.backendProcess;
    desktopRuntime.backendProcess = null;
    return child;
  }

  async function stopBackendAndWaitForExit(): Promise<void> {
    await desktopRuntime.cuaDriverHost?.suspend();
    const child = takeBackendProcessForShutdown();
    if (!child) return;
    const backendChild = child;
    if (backendChild.exitCode !== null || backendChild.signalCode !== null) return;

    if (process.platform === "win32") {
      try {
        const result = await stopWindowsBackendAndWait({
          child: backendChild,
          backendHttpUrl: desktopRuntime.backendHttpUrl,
          shutdownToken: desktopRuntime.DESKTOP_BACKEND_SHUTDOWN_TOKEN,
          forceKillDelayMs: desktopRuntime.BACKEND_FORCE_KILL_DELAY_MS,
          timeoutMs: desktopRuntime.BACKEND_SHUTDOWN_TIMEOUT_MS,
        });
        requireWindowsBackendExit(result);
      } catch (error) {
        desktopRuntime.backendProcess = retainLiveBackendAfterShutdownFailure(
          desktopRuntime.backendProcess,
          backendChild,
        );
        throw error;
      }
      return;
    }

    try {
      await stopPosixBackendAndWait({
        child: backendChild,
        backendHttpUrl: desktopRuntime.backendHttpUrl,
        shutdownToken: desktopRuntime.DESKTOP_BACKEND_SHUTDOWN_TOKEN,
        terminateDelayMs: desktopRuntime.POSIX_BACKEND_TERMINATE_DELAY_MS,
        forceKillDelayMs: desktopRuntime.POSIX_BACKEND_FORCE_KILL_DELAY_MS,
        timeoutMs: desktopRuntime.POSIX_BACKEND_SHUTDOWN_TIMEOUT_MS,
      });
    } catch (error) {
      desktopRuntime.backendProcess = retainLiveBackendAfterShutdownFailure(
        desktopRuntime.backendProcess,
        backendChild,
      );
      throw error;
    }
  }

  async function disposeBrowserHostPipeServerForShutdown(reason: string): Promise<void> {
    desktopRuntime.disposeComputerDesktopLifecycle?.();
    desktopRuntime.disposeComputerDesktopLifecycle = undefined;
    desktopRuntime.escapeKillSwitchMonitor?.dispose();
    desktopRuntime.escapeKillSwitchMonitor = undefined;
    desktopRuntime.linuxEscapeKillSwitchMonitor?.dispose();
    desktopRuntime.linuxEscapeKillSwitchMonitor = undefined;
    await desktopRuntime.cuaDriverHost?.dispose();
    desktopRuntime.cuaDriverHost = undefined;
    desktopRuntime.cuaHostEndpoint = undefined;
    const pipeServer = desktopRuntime.browserHostPipeServer;
    desktopRuntime.browserHostPipeServer = null;
    if (!pipeServer) return;

    try {
      await pipeServer.dispose();
    } catch (error: unknown) {
      const message = desktopRuntime.formatErrorMessage(error);
      desktopRuntime.writeDesktopLogHeader(
        `${reason} browser host pipe dispose failed message=${message}`,
      );
      console.warn(`[desktop] Failed to dispose browser host pipe during ${reason}: ${message}`);
    }
  }

  function hideDesktopWindowForImmediateQuit(): void {
    const window = desktopRuntime.mainWindow;
    if (!window || window.isDestroyed()) {
      return;
    }
    try {
      if (process.platform === "win32") {
        window.setSkipTaskbar(true);
      }
      window.hide();
    } catch (error: unknown) {
      desktopRuntime.writeDesktopLogHeader(
        `hide window for quit failed message=${desktopRuntime.formatErrorMessage(error)}`,
      );
    }
  }

  async function shutdownDesktopRuntime(reason: string): Promise<void> {
    if (desktopRuntime.desktopShutdownPromise) {
      return desktopRuntime.desktopShutdownPromise;
    }

    desktopRuntime.isQuitting = true;
    hideDesktopWindowForImmediateQuit();
    desktopRuntime.writeDesktopLogHeader(`${reason} shutdown start`);
    const shutdown = runAfterDesktopShutdown(
      stopBackendAndWaitForExit(),
      async () => {
        desktopRuntime.clearUpdateBackgroundBlurTimer();
        desktopRuntime.clearUpdateCheckTimeoutTimer();
        desktopRuntime.clearUpdatePollTimer();
        desktopRuntime.cancelBackendReadinessWait();
        desktopRuntime.computerManager?.dispose();
        desktopRuntime.computerManager = null;
        await shutdownBrowserServices({
          revokeHost: () => disposeBrowserHostPipeServerForShutdown(reason),
          closePages: () => desktopRuntime.browserManager.dispose(),
          stopCapture: () => desktopRuntime.browserVaultCapture.dispose(),
          clearKeys: () => desktopRuntime.browserVault.dispose(),
        });
        await desktopRuntime.browserSessionRestore?.shutdown();
        desktopRuntime.restoreStdIoCapture?.();
        desktopRuntime.desktopShutdownComplete = true;
        desktopRuntime.writeDesktopLogHeader(`${reason} shutdown complete`);
      },
      { runAfterShutdownFailure: true },
    );
    desktopRuntime.desktopShutdownPromise = shutdown;

    try {
      await shutdown;
    } catch (error) {
      if (desktopRuntime.desktopShutdownPromise === shutdown) {
        desktopRuntime.desktopShutdownPromise = null;
      }
      throw error;
    }
  }

  function isMainRendererAvailable(): boolean {
    return Boolean(
      desktopRuntime.mainWindow &&
      !desktopRuntime.mainWindow.isDestroyed() &&
      !desktopRuntime.mainWindow.webContents.isDestroyed() &&
      !desktopRuntime.mainWindow.webContents.isCrashed(),
    );
  }

  async function confirmRunningChatsThenQuit(reason: string): Promise<void> {
    if (
      !shouldPromptForRunningChatsBeforeQuit(reason) ||
      desktopRuntime.runningChatsQuitGuard.hasAllowedQuit() ||
      desktopRuntime.isQuitting ||
      desktopRuntime.desktopShutdownPromise !== null ||
      desktopRuntime.desktopShutdownComplete
    ) {
      requestGracefulAppQuit(reason);
      return;
    }

    const window = desktopRuntime.mainWindow;
    const presentation = quitConfirmationPresentationForPlatform();
    const allowed = await desktopRuntime.runningChatsQuitGuard.askRenderer({
      send: (request) => {
        if (!isMainRendererAvailable() || !window) {
          throw new Error("Renderer unavailable.");
        }
        if (window.isMinimized()) {
          window.restore();
        }
        window.show();
        window.focus();
        window.webContents.send(desktopRuntime.IPC.quitConfirmationRequest, request);
      },
      isRendererAvailable: isMainRendererAvailable,
      presentation,
    });
    if (!allowed) {
      desktopRuntime.writeDesktopLogHeader(`${reason} stayed because chats are still running`);
      return;
    }
    requestGracefulAppQuit(reason);
  }

  function requestGracefulAppQuit(reason: string): void {
    if (desktopRuntime.isUpdaterInstallPreparing) {
      desktopRuntime.deferDesktopQuitUntilUpdaterSettles(reason);
      return;
    }

    void runAfterDesktopShutdown(shutdownDesktopRuntime(reason), () => app.quit()).catch(
      (error: unknown) => {
        const message = desktopRuntime.formatErrorMessage(error);
        desktopRuntime.writeDesktopLogHeader(`${reason} shutdown failed message=${message}`);
        console.warn(`[desktop] Shutdown failed during ${reason}: ${message}`);
        app.exit(1);
      },
    );
  }
  return { stopBackendAndWaitForExit, confirmRunningChatsThenQuit, requestGracefulAppQuit };
}
