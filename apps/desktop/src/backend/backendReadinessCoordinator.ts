import { NetService } from "@glade/shared/platform/Net";
import * as Effect from "effect/Effect";
import { BrowserWindow } from "electron";
import { type DesktopRuntime } from "../main/desktopRuntimeTypes";
import { isBackendReadinessAborted, waitForHttpReady } from "./backendReadiness";
import { waitForBackendStartupReady } from "./backendStartupReadiness";
import { openInitialBackendWindow } from "./initialBackendWindowOpen";

export function createBackendReadinessCoordinator(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "backendReadinessAbortController"
    | "backendPort"
    | "backendHttpUrl"
    | "backendWsUrl"
    | "backendAuthToken"
    | "writeDesktopLogHeader"
    | "backendListeningDetector"
    | "isDevelopment"
    | "mainWindow"
    | "createWindow"
    | "backendInitialWindowOpenInFlight"
    | "formatErrorMessage"
  >,
) {
  async function waitForBackendHttpReady(
    baseUrl: string,
    options?: Parameters<typeof waitForHttpReady>[1],
  ): Promise<void> {
    cancelBackendReadinessWait();
    const controller = new AbortController();
    desktopRuntime.backendReadinessAbortController = controller;

    try {
      await waitForHttpReady(baseUrl, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      if (desktopRuntime.backendReadinessAbortController === controller) {
        desktopRuntime.backendReadinessAbortController = null;
      }
    }
  }

  function cancelBackendReadinessWait(): void {
    desktopRuntime.backendReadinessAbortController?.abort();
    desktopRuntime.backendReadinessAbortController = null;
  }

  async function reserveBackendEndpoint(reason: string): Promise<void> {
    desktopRuntime.backendPort = await Effect.service(NetService).pipe(
      Effect.flatMap((net) => net.reserveLoopbackPort()),
      Effect.provide(NetService.layer),
      Effect.runPromise,
    );
    desktopRuntime.backendHttpUrl = `http://127.0.0.1:${desktopRuntime.backendPort}`;
    desktopRuntime.backendWsUrl = `ws://127.0.0.1:${desktopRuntime.backendPort}/?token=${encodeURIComponent(desktopRuntime.backendAuthToken)}`;
    process.env.GLADE_DESKTOP_WS_URL = desktopRuntime.backendWsUrl;
    desktopRuntime.writeDesktopLogHeader(
      `${reason} resolved backend endpoint port=${desktopRuntime.backendPort}`,
    );
  }

  async function waitForBackendWindowReady(baseUrl: string): Promise<"listening" | "http"> {
    return await waitForBackendStartupReady({
      listeningPromise: desktopRuntime.backendListeningDetector?.promise ?? null,
      waitForHttpReady: () =>
        waitForBackendHttpReady(baseUrl, {
          path: "/health",

          timeoutMs: null,
          isReady: async (response) => {
            if (!response.ok) {
              return false;
            }
            try {
              const payload = (await response.json()) as {
                startupReady?: unknown;
              };
              return payload.startupReady === true;
            } catch {
              return false;
            }
          },
        }),
      cancelHttpWait: cancelBackendReadinessWait,
    });
  }

  function ensureInitialBackendWindowOpen(baseUrl: string): void {
    openInitialBackendWindow({
      isDevelopment: desktopRuntime.isDevelopment,
      baseUrl,
      hasExistingWindow: () =>
        (desktopRuntime.mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null) !== null,
      createWindow: () => {
        desktopRuntime.mainWindow = desktopRuntime.createWindow();
      },
      getReadinessInFlight: () => desktopRuntime.backendInitialWindowOpenInFlight,
      setReadinessInFlight: (promise) => {
        desktopRuntime.backendInitialWindowOpenInFlight = promise;
      },
      waitForBackendWindowReady,
      writeLog: desktopRuntime.writeDesktopLogHeader,
      isReadinessAborted: isBackendReadinessAborted,
      formatErrorMessage: desktopRuntime.formatErrorMessage,
      warn: (message, error) => {
        console.warn(message, error);
      },
    });
  }
  return {
    cancelBackendReadinessWait,
    reserveBackendEndpoint,
    waitForBackendWindowReady,
    ensureInitialBackendWindowOpen,
  };
}
