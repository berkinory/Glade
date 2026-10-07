import { app, type BrowserWindow, dialog } from "electron";
import { runAfterDesktopShutdown } from "../../backend/backendShutdown";
import { APP_DISPLAY_NAME } from "../desktopEnvironment";
import { DESKTOP_IPC_CHANNELS } from "../ipc/ipcChannels";
import { formatErrorMessage, type DesktopLog } from "./desktopLogging";
import {
  makeRunningChatsQuitGuard,
  quitConfirmationPresentationForPlatform,
  shouldPromptForRunningChatsBeforeQuit,
} from "./runningChatsQuitGuard";
interface ShutdownBackend {
  stopBackendAndWaitForExit(): Promise<void>;
  cancelBackendReadinessWait(): void;
}
interface ShutdownUpdates {
  isInstallPreparing(): boolean;
  deferQuit(reason: string): void;
  clearTimers(): void;
}
interface DisposableDomain {
  dispose(): void;
}
export interface ShutdownDependencies {
  backend: ShutdownBackend;
  getMainWindow(): BrowserWindow | null;
  updates: ShutdownUpdates;
  log: DesktopLog;
  resources: DisposableDomain;
  identity: DisposableDomain;
}
export function createDesktopShutdown({
  backend,
  getMainWindow,
  updates,
  log,
  resources,
  identity,
}: ShutdownDependencies) {
  let desktopShutdownPromise: Promise<void> | null = null;
  let isQuitting = false;
  let desktopShutdownComplete = false;
  const runningChatsQuitGuard = makeRunningChatsQuitGuard();
  function hideDesktopWindowForImmediateQuit(): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    try {
      if (process.platform === "win32") {
        window.setSkipTaskbar(true);
      }
      window.hide();
    } catch (error: unknown) {
      log.writeDesktopLogHeader(`hide window for quit failed message=${formatErrorMessage(error)}`);
    }
  }
  async function shutdownDesktopRuntime(reason: string): Promise<void> {
    if (desktopShutdownPromise) {
      return desktopShutdownPromise;
    }

    isQuitting = true;
    hideDesktopWindowForImmediateQuit();
    log.writeDesktopLogHeader(`${reason} shutdown start`);
    const shutdown = runAfterDesktopShutdown(
      backend.stopBackendAndWaitForExit(),
      async () => {
        updates.clearTimers();
        backend.cancelBackendReadinessWait();
        resources.dispose();
        identity.dispose();
        log.dispose();
        desktopShutdownComplete = true;
        log.writeDesktopLogHeader(`${reason} shutdown complete`);
      },
      { runAfterShutdownFailure: true },
    );
    desktopShutdownPromise = shutdown;

    try {
      await shutdown;
    } catch (error) {
      if (desktopShutdownPromise === shutdown) {
        desktopShutdownPromise = null;
      }
      throw error;
    }
  }
  function isMainRendererAvailable(): boolean {
    const window = getMainWindow();
    return Boolean(
      window &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      !window.webContents.isCrashed(),
    );
  }
  async function confirmQuitWithoutRenderer(): Promise<boolean> {
    const quitButtonIndex = 1;
    const result = await dialog.showMessageBox({
      type: "warning",
      title: `Quit ${APP_DISPLAY_NAME}?`,
      message: `Quit ${APP_DISPLAY_NAME}?`,
      detail: `${APP_DISPLAY_NAME} couldn't check for running chats because its window isn't responding. Quitting stops any chat that is still running.`,
      buttons: ["Cancel", "Quit"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === quitButtonIndex;
  }
  async function confirmRunningChatsThenQuit(reason: string): Promise<void> {
    if (
      !shouldPromptForRunningChatsBeforeQuit(reason) ||
      runningChatsQuitGuard.hasAllowedQuit() ||
      isQuitting ||
      desktopShutdownPromise !== null ||
      desktopShutdownComplete
    ) {
      requestGracefulAppQuit(reason);
      return;
    }

    const window = getMainWindow();
    const presentation = quitConfirmationPresentationForPlatform();
    const allowed = await runningChatsQuitGuard.askRenderer({
      send: (request) => {
        if (!isMainRendererAvailable() || !window) {
          throw new Error("Renderer unavailable.");
        }
        if (window.isMinimized()) {
          window.restore();
        }
        window.show();
        window.focus();
        window.webContents.send(DESKTOP_IPC_CHANNELS.quitConfirmationRequest, request);
      },
      isRendererAvailable: isMainRendererAvailable,
      confirmWithoutRenderer: confirmQuitWithoutRenderer,
      presentation,
    });
    if (!allowed) {
      log.writeDesktopLogHeader(`${reason} stayed because chats are still running`);
      return;
    }
    requestGracefulAppQuit(reason);
  }
  function requestGracefulAppQuit(reason: string): void {
    if (updates.isInstallPreparing()) {
      updates.deferQuit(reason);
      return;
    }

    void runAfterDesktopShutdown(shutdownDesktopRuntime(reason), () => app.quit()).catch(
      (error: unknown) => {
        const message = formatErrorMessage(error);
        log.writeDesktopLogHeader(`${reason} shutdown failed message=${message}`);
        console.warn(`[desktop] Shutdown failed during ${reason}: ${message}`);
        app.exit(1);
      },
    );
  }
  return {
    confirmRunningChatsThenQuit,
    requestGracefulAppQuit,
    isQuitting: () => isQuitting,
    setQuitting: (value: boolean) => {
      isQuitting = value;
    },
    markQuitting: () => {
      isQuitting = true;
    },
    shutdownComplete: () => desktopShutdownComplete,
    markShutdownComplete: (value: boolean) => {
      desktopShutdownComplete = value;
    },
    shutdownInFlight: () => desktopShutdownPromise !== null,
    cancelPending: () => runningChatsQuitGuard.cancelPending(),
    rendererGone: () => runningChatsQuitGuard.rendererGone(),
    resolveQuitConfirmation: (payload: unknown) => runningChatsQuitGuard.receiveResponse(payload),
  };
}
