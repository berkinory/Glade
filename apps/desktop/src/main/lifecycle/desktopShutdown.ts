import { app, type BrowserWindow, dialog } from "electron";
import { runAfterDesktopShutdown } from "../../backend/backendShutdown";
import { APP_DISPLAY_NAME } from "../desktopEnvironment";
import { DESKTOP_IPC_CHANNELS } from "../ipc/ipcChannels";
import { formatErrorMessage, type DesktopLog } from "./desktopLogging";
import {
  makeRunningChatsQuitGuard,
  shouldPromptForRunningChatsBeforeQuit,
} from "./runningChatsQuitGuard";
// A signal must end the process even when teardown stalls: the backend's graceful stop alone may
// take 20 s and the Cua host waits behind its own pending transitions. Past this the app exits;
// the backend sees its stdin close and finishes stopping on its own.
const SIGNAL_QUIT_DEADLINE_MS = 5_000;

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
interface StoppableDomain {
  stop(): Promise<void>;
}
export interface ShutdownDependencies {
  backend: ShutdownBackend;
  computer: StoppableDomain;
  getMainWindow(): BrowserWindow | null;
  updates: ShutdownUpdates;
  log: DesktopLog;
  resources: DisposableDomain;
  identity: DisposableDomain;
}
export function createDesktopShutdown({
  backend,
  computer,
  getMainWindow,
  updates,
  log,
  resources,
  identity,
}: ShutdownDependencies) {
  let desktopShutdownPromise: Promise<void> | null = null;
  let isQuitting = false;
  let desktopShutdownComplete = false;
  let signalDeadline: ReturnType<typeof setTimeout> | null = null;
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
    // The Cua daemon is a child of this process; quitting waits for it like the backend.
    const shutdown = runAfterDesktopShutdown(
      Promise.all([backend.stopBackendAndWaitForExit(), computer.stop()]).then(() => undefined),
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
  // SIGINT and SIGTERM skip the running-chats prompt and are bounded, even when a quit started
  // earlier is still waiting.
  function quitOnSignal(signal: "SIGINT" | "SIGTERM"): void {
    if (signalDeadline) return;
    log.writeDesktopLogHeader(`${signal} received`);
    signalDeadline = setTimeout(() => {
      log.writeDesktopLogHeader(
        `${signal} teardown did not finish within ${SIGNAL_QUIT_DEADLINE_MS} ms; exiting now`,
      );
      app.exit(0);
    }, SIGNAL_QUIT_DEADLINE_MS);
    requestGracefulAppQuit(signal);
  }
  const signalListeners = {
    SIGINT: () => quitOnSignal("SIGINT"),
    SIGTERM: () => quitOnSignal("SIGTERM"),
  };
  // Electron installs its own SIGINT/SIGTERM handlers during startup, after the main script has
  // registered Node's. Its handler turns the signal into a plain before-quit (and the running-chats
  // prompt), then restores the default action. Node re-installs its handler only when a signal's
  // listener count rises from zero, so call this again once the app is ready.
  function installSignalHandlers(): void {
    if (process.platform === "win32") return;
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const others = process.rawListeners(signal).filter((l) => l !== signalListeners[signal]);
      process.removeAllListeners(signal);
      process.on(signal, signalListeners[signal]);
      for (const listener of others) process.on(signal, listener as NodeJS.SignalsListener);
    }
  }
  return {
    confirmRunningChatsThenQuit,
    installSignalHandlers,
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
