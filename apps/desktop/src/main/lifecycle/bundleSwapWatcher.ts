import { app, dialog } from "electron";
import * as Path from "node:path";
import * as OriginalFS from "original-fs";
import {
  BundleChangedDuringStartupError,
  BundleIdentity,
  type DesktopRuntime,
} from "../desktopRuntimeTypes";
import {
  bundleSignatureFromStats,
  isBundleSwapped,
  isWatchableBundlePath,
  type BundleSignature,
} from "../protocol/bundleSwapDetection";

export function createBundleSwapWatcher(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "writeDesktopLogHeader"
    | "requestGracefulAppQuit"
    | "bundleSwapPollTimer"
    | "startupBundleIdentity"
    | "isQuitting"
    | "isUpdaterInstallPreparing"
    | "bundleSwapPromptOpen"
    | "BUNDLE_SWAP_POLL_INTERVAL_MS"
  >,
) {
  function readBundleSignature(bundlePath: string): BundleSignature | null {
    try {
      return bundleSignatureFromStats(OriginalFS.statSync(bundlePath));
    } catch {
      return null;
    }
  }

  function captureStartupBundleIdentity(): BundleIdentity | null {
    if (!app.isPackaged) {
      return null;
    }
    const bundlePath = app.getAppPath();
    if (!isWatchableBundlePath(bundlePath)) {
      return null;
    }
    return { path: bundlePath, signature: readBundleSignature(bundlePath) };
  }

  function restartAfterStartupBundleSwap(error: BundleChangedDuringStartupError): void {
    const baselineSize = error.baseline?.size ?? "unreadable";
    const currentSize = error.current?.size ?? "unreadable";
    desktopRuntime.writeDesktopLogHeader(
      `bundle changed during startup path=${error.bundlePath} size=${baselineSize}->${currentSize}`,
    );
    console.warn("[desktop] Packaged application changed during startup; restarting", error);

    void dialog
      .showMessageBox({
        type: "warning",
        title: "Glade needs to restart",
        message: "Glade changed while it was opening.",
        detail:
          "The current process cannot safely read the replaced application bundle. Restart Glade to finish opening with one consistent version.",
        buttons: ["Restart Glade"],
        defaultId: 0,
      })
      .catch(() => undefined)
      .then(() => {
        app.relaunch();
        desktopRuntime.requestGracefulAppQuit("startup-bundle-swap");
      });
  }

  function startBundleSwapWatcher(): void {
    if (!app.isPackaged || desktopRuntime.bundleSwapPollTimer) {
      return;
    }
    const bundlePath = app.getAppPath();
    if (!isWatchableBundlePath(bundlePath)) {
      return;
    }
    let baseline =
      desktopRuntime.startupBundleIdentity &&
      Path.resolve(desktopRuntime.startupBundleIdentity.path) === Path.resolve(bundlePath)
        ? (desktopRuntime.startupBundleIdentity.signature ?? readBundleSignature(bundlePath))
        : readBundleSignature(bundlePath);
    if (!baseline) {
      return;
    }

    desktopRuntime.bundleSwapPollTimer = setInterval(() => {
      if (
        desktopRuntime.isQuitting ||
        desktopRuntime.isUpdaterInstallPreparing ||
        desktopRuntime.bundleSwapPromptOpen
      ) {
        return;
      }
      const current = readBundleSignature(bundlePath);
      if (!baseline || !isBundleSwapped(baseline, current)) {
        return;
      }
      desktopRuntime.writeDesktopLogHeader(
        `bundle swap detected path=${bundlePath} size=${baseline.size}->${current?.size ?? "unknown"}`,
      );

      baseline = current;
      desktopRuntime.bundleSwapPromptOpen = true;
      void dialog
        .showMessageBox({
          type: "warning",
          title: "Glade was replaced on disk",
          message: "The installed Glade app changed while it was running.",
          detail:
            "The interface keeps running from a safeguarded copy, but parts of the app loaded later can still read the replaced file. Restart now to pick up the new version safely.",
          buttons: ["Restart Now", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          desktopRuntime.bundleSwapPromptOpen = false;
          if (response === 0) {
            app.relaunch();
            desktopRuntime.requestGracefulAppQuit("bundle-swap-restart");
          }
        })
        .catch(() => {
          desktopRuntime.bundleSwapPromptOpen = false;
        });
    }, desktopRuntime.BUNDLE_SWAP_POLL_INTERVAL_MS);
    desktopRuntime.bundleSwapPollTimer.unref();
  }
  return {
    readBundleSignature,
    captureStartupBundleIdentity,
    restartAfterStartupBundleSwap,
    startBundleSwapWatcher,
  };
}
