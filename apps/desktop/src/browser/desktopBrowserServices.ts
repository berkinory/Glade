import { app } from "electron";
import { type DesktopRuntime } from "../main/desktopRuntimeTypes";
import { BrowserHostPipeServer, GLADE_BROWSER_HOST_PIPE_PATH } from "./browserUsePipeServer";

export function createDesktopBrowserServices(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "browserPerfInterval"
    | "browserPerfLoggingEnabled"
    | "browserManager"
    | "GLADE_BROWSER_LABEL"
    | "BROWSER_PERF_SAMPLE_INTERVAL_MS"
    | "browserHostPipeServer"
    | "browserVault"
    | "browserVaultCapture"
    | "DESKTOP_BROWSER_HOST_CAPABILITY"
    | "mainWindow"
    | "IPC"
  >,
) {
  function startBrowserPerformanceLogging(): void {
    if (desktopRuntime.browserPerfInterval || !desktopRuntime.browserPerfLoggingEnabled) {
      return;
    }

    desktopRuntime.browserPerfInterval = setInterval(() => {
      const snapshot = desktopRuntime.browserManager.getPerformanceSnapshot();
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

      console.info(`[${desktopRuntime.GLADE_BROWSER_LABEL} perf]`, {
        ...snapshot.counters,
        trackedProcessIds: snapshot.trackedProcessIds,
        processes: processMetrics,
      });
    }, desktopRuntime.BROWSER_PERF_SAMPLE_INTERVAL_MS);
    desktopRuntime.browserPerfInterval.unref();
  }

  async function ensureBrowserHostPipeServer(): Promise<void> {
    if (desktopRuntime.browserHostPipeServer || !GLADE_BROWSER_HOST_PIPE_PATH) {
      return;
    }
    const server = new BrowserHostPipeServer(desktopRuntime.browserManager, {
      vault: desktopRuntime.browserVault,
      vaultCapture: desktopRuntime.browserVaultCapture,
      capability: desktopRuntime.DESKTOP_BROWSER_HOST_CAPABILITY,
      requestOpenPanel: (threadId) => {
        if (!threadId) return;
        desktopRuntime.mainWindow?.webContents.send(desktopRuntime.IPC.browser.requestOpenPanel, {
          threadId,
        });
      },
    });
    await server.start();
    desktopRuntime.browserHostPipeServer = server;
  }
  return { startBrowserPerformanceLogging, ensureBrowserHostPipeServer };
}
