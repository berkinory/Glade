import { COMPUTER_PERMISSIONS } from "@glade/shared/computer/computerGrants";
import { MODEL_SCREEN_IMAGE_MAX_DIMENSION } from "@glade/shared/computer/modelImageBudget";
import { app, BrowserWindow, globalShortcut, nativeImage, powerMonitor, shell } from "electron";
import * as ChildProcess from "node:child_process";
import * as Path from "node:path";
import { type DesktopRuntime } from "../main/desktopRuntimeTypes";
import { readAgentCursorPreference } from "./agentCursorPreference";
import { registerComputerDesktopLifecycle } from "./computerDesktopLifecycle";
import { notifyBackendComputerEmergencyStop } from "./computerEmergencyStopNotice";
import { ComputerFrameTap } from "./computerFrameTap";
import { DesktopComputerManager } from "./computerPermissions";
import {
  COMPUTER_SETTINGS_PANE_URLS,
  sendComputerPermissionGuideState,
  sendComputerState,
} from "./computerPermissionsIpc";
import { ComputerShield } from "./computerShield";
import { CuaDriverHost } from "./cua/cuaDriverHost";
import { sweepOrphanedCuaDrivers } from "./cua/cuaHostPolicy";

import { EscapeKillSwitchMonitor } from "./cua/escapeKillSwitchMonitor";
import { createLinuxCuaDriverHost } from "./cua/linuxCuaDriverHost";
import {
  LinuxEscapeKillSwitchMonitor,
  linuxEscapeSession,
} from "./cua/linuxEscapeKillSwitchMonitor";

export function createDesktopComputerSetup(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "computerManager"
    | "resolveComputerHelperPath"
    | "APP_DISPLAY_NAME"
    | "resolveComputerAppBundlePath"
    | "mainWindow"
    | "cuaDriverHost"
    | "backendHttpUrl"
    | "DESKTOP_BACKEND_SHUTDOWN_TOKEN"
    | "safeConsoleError"
    | "cuaHostEndpoint"
    | "disposeComputerDesktopLifecycle"
    | "linuxEscapeKillSwitchMonitor"
    | "resolveAppRoot"
    | "desktopIdentity"
    | "DESKTOP_BROWSER_HOST_CAPABILITY"
    | "escapeKillSwitchMonitor"
    | "AGENT_CURSOR_PREFERENCE_PATH"
  >,
) {
  function canSendComputerEvent(window: BrowserWindow | null): window is BrowserWindow {
    return Boolean(
      window &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      !window.webContents.isLoadingMainFrame(),
    );
  }

  function sendComputerEvent(
    window: BrowserWindow | null,
    send: (webContents: BrowserWindow["webContents"]) => void,
  ): boolean {
    if (!canSendComputerEvent(window)) return false;
    send(window.webContents);
    return true;
  }

  function initializeDesktopComputer(): void {
    if (desktopRuntime.computerManager) return;
    desktopRuntime.computerManager = new DesktopComputerManager({
      platform: process.platform,
      helperPath: desktopRuntime.resolveComputerHelperPath(),
      appDisplayName: desktopRuntime.APP_DISPLAY_NAME,
      appBundlePath: desktopRuntime.resolveComputerAppBundlePath(),
      openSettingsPane: (pane) => {
        const paneUrl = COMPUTER_SETTINGS_PANE_URLS[pane];
        if (paneUrl) void shell.openExternal(paneUrl).catch(() => undefined);
      },

      closeSettingsApp: () => {
        try {
          const child = ChildProcess.execFile("/usr/bin/osascript", [
            "-e",
            'tell application "System Settings" to quit',
            "-e",
            'tell application "System Preferences" to quit',
          ]);
          child.on("error", () => undefined);
        } catch {}
      },
      onState: (state) => {
        sendComputerEvent(desktopRuntime.mainWindow, (webContents) =>
          sendComputerState(webContents, state),
        );
      },
      onPermissionGuideState: (state) => {
        sendComputerEvent(desktopRuntime.mainWindow, (webContents) =>
          sendComputerPermissionGuideState(webContents, state),
        );
      },
    });
  }

  function stopComputerInputFromEscape(): void {
    // Native interruption owns the drain. The backend notice only relays the interrupted state; a slow
    // provider must not delay the local stop.
    if (!desktopRuntime.cuaDriverHost?.emergencyStopInput()) return;
    notifyBackendComputerEmergencyStop({
      backendHttpUrl: desktopRuntime.backendHttpUrl,
      shutdownToken: desktopRuntime.DESKTOP_BACKEND_SHUTDOWN_TOKEN,
      onError: (message) => desktopRuntime.safeConsoleError(`[desktop] ${message}`),
    });
  }

  async function attachCuaHost(host: CuaDriverHost): Promise<void> {
    desktopRuntime.cuaHostEndpoint = await host.listen();
    desktopRuntime.cuaDriverHost = host;
    desktopRuntime.disposeComputerDesktopLifecycle = registerComputerDesktopLifecycle(
      powerMonitor,
      host,
      (error) => desktopRuntime.safeConsoleError("[desktop] computer input pause failed", error),
    );
  }

  async function startCuaHost(): Promise<void> {
    if (
      (process.platform !== "darwin" && process.platform !== "linux") ||
      desktopRuntime.cuaDriverHost
    )
      return;
    sweepOrphanedCuaDrivers();
    if (process.platform === "linux") {
      desktopRuntime.linuxEscapeKillSwitchMonitor ??= new LinuxEscapeKillSwitchMonitor({
        shortcutRegistry: globalShortcut,
        sessionType: linuxEscapeSession(
          app.commandLine.getSwitchValue("ozone-platform") ||
            app.commandLine.getSwitchValue("ozone-platform-hint") ||
            process.env.ELECTRON_OZONE_PLATFORM_HINT,
        ),
        onEscape: stopComputerInputFromEscape,
        onStateChange: (state) => desktopRuntime.cuaDriverHost?.inputMonitorStateChanged(state),
        onError: (message) =>
          desktopRuntime.safeConsoleError(`[desktop] Escape monitor: ${message}`),
      });
      await attachCuaHost(
        createLinuxCuaDriverHost({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appRoot: desktopRuntime.resolveAppRoot(),
          bundleId: desktopRuntime.desktopIdentity.bundleId,
          capability: desktopRuntime.DESKTOP_BROWSER_HOST_CAPABILITY,
          inputMonitor: desktopRuntime.linuxEscapeKillSwitchMonitor,
          ownPids: () => new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)]),
        }),
      );
      return;
    }
    const host = new CuaDriverHost({
      onInputMonitorArmedChange: (armed) => desktopRuntime.escapeKillSwitchMonitor?.setArmed(armed),
      inputMonitorState: () =>
        desktopRuntime.escapeKillSwitchMonitor?.state ?? {
          ready: false,
          error: "input_monitor_starting",
        },
      activateInputMonitor: async () => {
        await desktopRuntime.escapeKillSwitchMonitor?.activate();
      },
      binaryPath: app.isPackaged
        ? Path.join(process.resourcesPath, "cua-driver", "cua-driver")
        : Path.join(
            desktopRuntime.resolveAppRoot(),
            "apps/desktop/resources/cua-driver/cua-driver",
          ),
      bundleId: desktopRuntime.desktopIdentity.bundleId,
      capability: desktopRuntime.DESKTOP_BROWSER_HOST_CAPABILITY,
      // Computer use must never bind the app hosting it: the integrated browser's webviews live in this
      // app's own renderer pids.
      ownPids: () => new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]),

      cursorStyle: () => readAgentCursorPreference(desktopRuntime.AGENT_CURSOR_PREFERENCE_PATH),
      checkPermissions: async (options) => {
        initializeDesktopComputer();
        const state = await desktopRuntime.computerManager!.refreshState(COMPUTER_PERMISSIONS, {
          force: options?.force === true,
        });
        if (
          state.status === "error" &&
          (state.accessibilityPermission === "unknown" ||
            state.inputMonitoringPermission === "unknown" ||
            state.screenRecordingPermission === "unknown")
        ) {
          throw new Error(state.message ?? "The native helper could not verify macOS permissions.");
        }
        if (
          host.isInputMonitorRequested &&
          state.inputMonitoringPermission === "granted" &&
          desktopRuntime.escapeKillSwitchMonitor?.state.error === "input-monitoring-required"
        ) {
          await desktopRuntime.escapeKillSwitchMonitor.activate(true);
        }
        return {
          accessibility: state.accessibilityPermission === "granted",
          inputMonitoring: state.inputMonitoringPermission === "granted",
          screenRecording: state.screenRecordingPermission === "granted",
        };
      },
      setup: async () => {
        initializeDesktopComputer();
        await desktopRuntime.computerManager!.startPermissionSetup(COMPUTER_PERMISSIONS);
      },
      releaseHeldInput: async () => {
        initializeDesktopComputer();
        await desktopRuntime.computerManager!.releaseHeldInput();
      },
      frameTap: new ComputerFrameTap({
        helperPath: desktopRuntime.resolveComputerHelperPath(),
        send: (channel, frame) => {
          if (
            desktopRuntime.mainWindow &&
            !desktopRuntime.mainWindow.isDestroyed() &&
            !desktopRuntime.mainWindow.webContents.isDestroyed()
          ) {
            desktopRuntime.mainWindow.webContents.send(channel, frame);
          }
        },
        onError: (error) =>
          desktopRuntime.safeConsoleError("[desktop] computer frame tap failed", error),
      }),
      // Always wired — the server decides per call whether the armed flag + per-app opt-in name a masked
      // activation, and a missing surface must fail closed there rather than degrade to an unmasked
      // raise.
      shield: new ComputerShield({
        helperPath: desktopRuntime.resolveComputerHelperPath(),
        onError: (error) =>
          desktopRuntime.safeConsoleError("[desktop] computer shield failed", error),
      }),
      normalizeOverview: (result) => {
        const image = result.content?.find((part) => part.type === "image" && part.data);
        if (!image?.data) return result;
        const native = nativeImage.createFromBuffer(Buffer.from(image.data, "base64"));
        const size = native.getSize();
        if (Math.max(size.width, size.height) <= MODEL_SCREEN_IMAGE_MAX_DIMENSION) return result;
        const ratio = MODEL_SCREEN_IMAGE_MAX_DIMENSION / Math.max(size.width, size.height);
        const scaled = native.resize({
          width: Math.round(size.width * ratio),
          height: Math.round(size.height * ratio),
          quality: "best",
        });
        image.data = scaled.toPNG().toString("base64");
        return result;
      },
    });
    await attachCuaHost(host);

    if (!desktopRuntime.escapeKillSwitchMonitor) {
      desktopRuntime.escapeKillSwitchMonitor = new EscapeKillSwitchMonitor({
        helperPath: desktopRuntime.resolveComputerHelperPath(),
        onPhysicalInput: (event) => {
          desktopRuntime.cuaDriverHost?.physicalInput(event);
        },
        onStateChange: (state) => desktopRuntime.cuaDriverHost?.inputMonitorStateChanged(state),
        onEscape: stopComputerInputFromEscape,
        onError: (message) =>
          desktopRuntime.safeConsoleError(`[desktop] Escape monitor: ${message}`),
      });
    }
  }
  return { initializeDesktopComputer, startCuaHost };
}
