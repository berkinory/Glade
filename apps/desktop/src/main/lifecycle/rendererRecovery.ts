import { BrowserWindow, dialog } from "electron";
import * as Path from "node:path";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import {
  RENDERER_MAX_AUTOMATIC_RELOADS,
  type RendererCrashResponse,
} from "./rendererCrashRecovery";

export function createRendererRecovery(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "runningChatsQuitGuard"
    | "writeDesktopLogHeader"
    | "safeConsoleError"
    | "rendererCrashPolicy"
    | "isQuitting"
    | "rendererCrashDialogInFlight"
    | "LOG_DIR"
    | "DESKTOP_LOG_FILE_NAME"
    | "openDesktopLogDirectory"
    | "requestGracefulAppQuit"
  >,
) {
  function attachRendererCrashRecovery(window: BrowserWindow): void {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const clearReloadTimer = (): void => {
      if (reloadTimer === null) return;
      clearTimeout(reloadTimer);
      reloadTimer = null;
    };

    window.webContents.on("render-process-gone", (_event, details) => {
      // A renderer that dies while hosting the quit-confirmation ask can never answer it — declining
      // would abandon a requested quit and (worse) show the recovery prompt below, leaving a dead-UI app
      // alive forever.
      const quitAskPending = desktopRuntime.runningChatsQuitGuard.hasPendingAsk();
      desktopRuntime.runningChatsQuitGuard.allowPending();
      const description = `reason=${details.reason} exitCode=${details.exitCode}`;
      desktopRuntime.writeDesktopLogHeader(`renderer process gone ${description}`);
      desktopRuntime.safeConsoleError(`[desktop] renderer process gone (${description})`);

      const response = desktopRuntime.rendererCrashPolicy.respondToCrash({
        reason: details.reason,
        quitting: desktopRuntime.isQuitting || quitAskPending,
        nowMs: Date.now(),
      });

      switch (response.kind) {
        case "ignore":
          return;
        case "reload":
          desktopRuntime.writeDesktopLogHeader(
            `renderer reload scheduled attempt=${response.attempt}/${RENDERER_MAX_AUTOMATIC_RELOADS} delayMs=${response.delayMs}`,
          );
          clearReloadTimer();
          reloadTimer = setTimeout(() => {
            reloadTimer = null;
            if (desktopRuntime.isQuitting || window.isDestroyed()) return;
            window.webContents.reload();
          }, response.delayMs);
          return;
        case "prompt":
          desktopRuntime.writeDesktopLogHeader(
            `renderer recovery prompt cause=${response.cause} crashes=${response.crashes}`,
          );
          presentRendererCrashRecovery(window, details.reason, response);
          return;
      }
    });

    // A hung renderer is not a crash — Chromium keeps the process alive — so it never reaches the
    // listener above. Logging both edges makes a freeze that the user reports as "the app died"
    // distinguishable from an actual crash in the same log.
    window.webContents.on("unresponsive", () => {
      desktopRuntime.writeDesktopLogHeader("renderer unresponsive");
    });
    window.webContents.on("responsive", () => {
      desktopRuntime.writeDesktopLogHeader("renderer responsive");
    });

    window.webContents.on("did-start-loading", () => {
      desktopRuntime.runningChatsQuitGuard.cancelPending();
    });

    window.on("closed", clearReloadTimer);
  }

  function presentRendererCrashRecovery(
    window: BrowserWindow,
    reason: string,
    response: Extract<RendererCrashResponse, { kind: "prompt" }>,
  ): void {
    if (desktopRuntime.isQuitting || desktopRuntime.rendererCrashDialogInFlight) return;

    const message =
      response.cause === "reload-budget-exhausted"
        ? `Glade's window crashed ${response.crashes} times in a row.`
        : "Glade's window stopped unexpectedly.";
    const detail = [
      `The window's renderer process exited (${reason}).`,
      response.cause === "reload-budget-exhausted"
        ? "Glade paused automatic reloads so a repeating crash can't keep reloading in the background."
        : "This exit reason repeats on reload, so Glade did not retry automatically.",
      `Log file:\n${Path.join(desktopRuntime.LOG_DIR, desktopRuntime.DESKTOP_LOG_FILE_NAME)}`,
    ].join("\n\n");

    const task = (async () => {
      for (;;) {
        const result = await dialog.showMessageBox({
          type: "error",
          title: "Glade's window stopped",
          message,
          detail,
          buttons: ["Reload", "Open logs", "Quit"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });

        if (result.response === 1) {
          await desktopRuntime.openDesktopLogDirectory();
          continue;
        }

        if (result.response === 0) {
          desktopRuntime.rendererCrashPolicy.reset();
          if (!window.isDestroyed()) {
            window.webContents.reload();
          }
          return;
        }

        desktopRuntime.requestGracefulAppQuit("renderer crashed");
        return;
      }
    })().finally(() => {
      if (desktopRuntime.rendererCrashDialogInFlight === task) {
        desktopRuntime.rendererCrashDialogInFlight = null;
      }
    });
    desktopRuntime.rendererCrashDialogInFlight = task;
  }
  return { attachRendererCrashRecovery };
}
