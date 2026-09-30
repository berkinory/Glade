import { isKeyboardShortcutsHelpChord } from "@glade/shared/browser/browserShortcuts";
import { app, safeStorage, type BrowserWindow } from "electron";
import * as Path from "node:path";
import {
  BASE_DIR,
  BROWSER_PERF_SAMPLE_INTERVAL_MS,
  BROWSER_SESSION_RESTORE_TIMEOUT_MS,
  DESKTOP_BROWSER_HOST_CAPABILITY,
  GLADE_BROWSER_LABEL,
} from "../main/desktopEnvironment";
import { DESKTOP_IPC_CHANNELS } from "../main/ipc/ipcChannels";
import { formatErrorMessage } from "../main/lifecycle/desktopLogging";
import { BrowserSessionRestore } from "./automation/browserSessionRestore";
import { shutdownBrowserServices } from "./automation/browserShutdown";
import { BrowserVault } from "./automation/browserVault";
import { BrowserVaultCapture } from "./automation/browserVaultCapture";
import { createCookieSessionBackend } from "./automation/electronCookieSession";
import { sendBrowserAnnotationEvent, sendBrowserCopyLink, sendBrowserState } from "./browserIpc";
import { DesktopBrowserManager } from "./browserManager";
import { BROWSER_SESSION_PARTITION } from "./browserSessionPolicy";
import { BrowserHostPipeServer, GLADE_BROWSER_HOST_PIPE_PATH } from "./browserUsePipeServer";
interface BrowserWindows {
  getMainWindow(): BrowserWindow | null;
}
interface BrowserMenu {
  dispatchMenuAction(action: string): void;
  resolveMenuTargetWindow(): BrowserWindow | null;
  handleDesktopPhysicalZoomShortcut(
    event: Electron.Event,
    input: Electron.Input,
    target: Electron.WebContents,
  ): boolean;
  handleDesktopZoomShortcut(
    event: Electron.Event,
    input: Electron.Input,
    target: Electron.WebContents,
  ): boolean;
}
export function createDesktopBrowserServices(windows: BrowserWindows, menu: BrowserMenu) {
  const browserPerfLoggingEnabled = process.env.GLADE_BROWSER_PERF === "1";
  let browserPerfInterval: NodeJS.Timeout | null = null;
  const annotationGuestPreload = Path.join(__dirname, "guestPreload.js");
  const browserOsKeyStore = {
    available: async () => {
      await app.whenReady();
      return (
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")
      );
    },
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value),
  };
  const browserVault = new BrowserVault(Path.join(BASE_DIR, "browser-vault"), browserOsKeyStore);
  let browserSessionRestore: BrowserSessionRestore | undefined = undefined;
  const browserVaultCapture = new BrowserVaultCapture(browserVault);
  const browserManager = new DesktopBrowserManager({
    onRuntimeReady: (runtime) => browserVaultCapture.register(runtime),
    onHumanControl: (threadId) => browserVaultCapture.noteHumanActivity(threadId),
    annotationPreloadPath: annotationGuestPreload,
    beforeInputEvent: (event, input) => {
      if (
        isKeyboardShortcutsHelpChord(
          {
            type: input.type,
            key: input.key,
            code: input.code,
            meta: input.meta,
            ctrl: input.control,
            shift: input.shift,
            alt: input.alt,
            repeat: input.isAutoRepeat,
          },
          {
            isMac: process.platform === "darwin",
            isWindows: process.platform === "win32",
          },
        )
      ) {
        event.preventDefault();
        menu.dispatchMenuAction("show-shortcuts");
        return true;
      }

      const target = menu.resolveMenuTargetWindow()?.webContents;
      if (!target) return false;
      return (
        menu.handleDesktopPhysicalZoomShortcut(event, input, target) ||
        menu.handleDesktopZoomShortcut(event, input, target)
      );
    },
  });
  let browserHostPipeServer: BrowserHostPipeServer | null = null;
  browserManager.subscribe((state) => {
    sendBrowserState(windows.getMainWindow()?.webContents, state);
  });
  browserManager.subscribeCopyLink((event) => {
    sendBrowserCopyLink(windows.getMainWindow()?.webContents, event);
  });
  browserManager.subscribeAnnotationEvents((event) => {
    sendBrowserAnnotationEvent(windows.getMainWindow()?.webContents, event);
  });
  function startBrowserPerformanceLogging(): void {
    if (browserPerfInterval || !browserPerfLoggingEnabled) {
      return;
    }

    browserPerfInterval = setInterval(() => {
      const snapshot = browserManager.getPerformanceSnapshot();
      const trackedProcessIds = new Set(snapshot.trackedProcessIds);
      const processMetrics = app
        .getAppMetrics()
        .filter((metric) => trackedProcessIds.has(metric.pid))
        .map((metric) => ({
          pid: metric.pid,
          type: metric.type,
          cpu: Number(metric.cpu.percentCPUUsage.toFixed(1)),
          memMb: Math.round(metric.memory.workingSetSize / 1024),
          name: metric.name,
        }));

      console.info(`[${GLADE_BROWSER_LABEL} perf]`, {
        ...snapshot.counters,
        trackedProcessIds: snapshot.trackedProcessIds,
        processes: processMetrics,
      });
    }, BROWSER_PERF_SAMPLE_INTERVAL_MS);
    browserPerfInterval.unref();
  }

  async function ensureBrowserHostPipeServer(): Promise<void> {
    if (browserHostPipeServer || !GLADE_BROWSER_HOST_PIPE_PATH) {
      return;
    }
    const server = new BrowserHostPipeServer(browserManager, {
      vault: browserVault,
      vaultCapture: browserVaultCapture,
      capability: DESKTOP_BROWSER_HOST_CAPABILITY,
      requestOpenPanel: (threadId) => {
        if (!threadId) return;
        windows.getMainWindow()?.webContents.send(DESKTOP_IPC_CHANNELS.browser.requestOpenPanel, {
          threadId,
        });
      },
    });
    await server.start();
    browserHostPipeServer = server;
  }
  async function restoreSessions(): Promise<void> {
    browserSessionRestore = new BrowserSessionRestore(
      Path.join(BASE_DIR, "browser-session-restore"),
      createCookieSessionBackend(BROWSER_SESSION_PARTITION),
      browserOsKeyStore,
    );
    try {
      let restoreTimer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          browserSessionRestore.initialize().finally(() => clearTimeout(restoreTimer)),
          new Promise<never>((_, reject) => {
            restoreTimer = setTimeout(
              () => reject(new Error("Browser session restoration timed out.")),
              BROWSER_SESSION_RESTORE_TIMEOUT_MS,
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
  }
  async function dispose(reason: string): Promise<void> {
    if (browserPerfInterval) clearInterval(browserPerfInterval);
    browserPerfInterval = null;
    await shutdownBrowserServices({
      revokeHost: async () => {
        const server = browserHostPipeServer;
        browserHostPipeServer = null;
        if (!server) return;
        try {
          await server.dispose();
        } catch (error) {
          console.warn(
            `[desktop] Failed to dispose browser host pipe during ${reason}: ${formatErrorMessage(error)}`,
          );
        }
      },
      closePages: () => browserManager.dispose(),
      stopCapture: () => browserVaultCapture.dispose(),
      clearKeys: () => browserVault.dispose(),
    });
    await browserSessionRestore?.shutdown();
  }
  return {
    startBrowserPerformanceLogging,
    ensureBrowserHostPipeServer,
    restoreSessions,
    dispose,
    isHostAvailable: () => browserHostPipeServer !== null,
    getManager: () => browserManager,
    getVault: () => browserVault,
    getGuestPreloadPath: () => annotationGuestPreload,
  };
}
