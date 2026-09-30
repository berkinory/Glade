import { COMPUTER_PERMISSIONS } from "@glade/shared/computer/computerGrants";
import { MODEL_SCREEN_IMAGE_MAX_DIMENSION } from "@glade/shared/computer/modelImageBudget";
import { app, BrowserWindow, globalShortcut, nativeImage, powerMonitor, shell } from "electron";
import * as ChildProcess from "node:child_process";
import * as Path from "node:path";
import {
  AGENT_CURSOR_PREFERENCE_PATH,
  APP_DISPLAY_NAME,
  DESKTOP_BACKEND_SHUTDOWN_TOKEN,
  DESKTOP_BROWSER_HOST_CAPABILITY,
  desktopIdentity,
} from "../main/desktopEnvironment";
import { safeConsoleError } from "../main/lifecycle/desktopLogging";
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
interface ComputerResources {
  resolveComputerHelperPath(): string;
  resolveComputerAppBundlePath(): string;
  resolveAppRoot(): string;
}
export function createDesktopComputerSetup(
  resources: ComputerResources,
  getMainWindow: () => BrowserWindow | null,
  getBackendHttpUrl: () => string,
) {
  let computerManager: DesktopComputerManager | null = null;
  let cuaDriverHost: CuaDriverHost | undefined;
  let cuaHostEndpoint: string | undefined;
  let disposeComputerDesktopLifecycle: (() => void) | undefined;
  let escapeKillSwitchMonitor: EscapeKillSwitchMonitor | undefined;
  let linuxEscapeKillSwitchMonitor: LinuxEscapeKillSwitchMonitor | undefined;
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
    if (computerManager) return;
    computerManager = new DesktopComputerManager({
      platform: process.platform,
      helperPath: resources.resolveComputerHelperPath(),
      appDisplayName: APP_DISPLAY_NAME,
      appBundlePath: resources.resolveComputerAppBundlePath(),
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
        sendComputerEvent(getMainWindow(), (webContents) => sendComputerState(webContents, state));
      },
      onPermissionGuideState: (state) => {
        sendComputerEvent(getMainWindow(), (webContents) =>
          sendComputerPermissionGuideState(webContents, state),
        );
      },
    });
  }

  function stopComputerInputFromEscape(): void {
    // Native interruption owns the drain. The backend notice only relays the interrupted state; a slow
    // provider must not delay the local stop.
    if (!cuaDriverHost?.emergencyStopInput()) return;
    notifyBackendComputerEmergencyStop({
      backendHttpUrl: getBackendHttpUrl(),
      shutdownToken: DESKTOP_BACKEND_SHUTDOWN_TOKEN,
      onError: (message) => safeConsoleError(`[desktop] ${message}`),
    });
  }

  async function attachCuaHost(host: CuaDriverHost): Promise<void> {
    cuaHostEndpoint = await host.listen();
    cuaDriverHost = host;
    disposeComputerDesktopLifecycle = registerComputerDesktopLifecycle(
      powerMonitor,
      host,
      (error) => safeConsoleError("[desktop] computer input pause failed", error),
    );
  }

  async function startCuaHost(): Promise<void> {
    if ((process.platform !== "darwin" && process.platform !== "linux") || cuaDriverHost) return;
    sweepOrphanedCuaDrivers();
    if (process.platform === "linux") {
      linuxEscapeKillSwitchMonitor ??= new LinuxEscapeKillSwitchMonitor({
        shortcutRegistry: globalShortcut,
        sessionType: linuxEscapeSession(
          app.commandLine.getSwitchValue("ozone-platform") ||
            app.commandLine.getSwitchValue("ozone-platform-hint") ||
            process.env.ELECTRON_OZONE_PLATFORM_HINT,
        ),
        onEscape: stopComputerInputFromEscape,
        onStateChange: (state) => cuaDriverHost?.inputMonitorStateChanged(state),
        onError: (message) => safeConsoleError(`[desktop] Escape monitor: ${message}`),
      });
      await attachCuaHost(
        createLinuxCuaDriverHost({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appRoot: resources.resolveAppRoot(),
          bundleId: desktopIdentity.bundleId,
          capability: DESKTOP_BROWSER_HOST_CAPABILITY,
          inputMonitor: linuxEscapeKillSwitchMonitor,
          ownPids: () => new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)]),
        }),
      );
      return;
    }
    const host = new CuaDriverHost({
      onInputMonitorArmedChange: (armed) => escapeKillSwitchMonitor?.setArmed(armed),
      inputMonitorState: () =>
        escapeKillSwitchMonitor?.state ?? {
          ready: false,
          error: "input_monitor_starting",
        },
      activateInputMonitor: async () => {
        await escapeKillSwitchMonitor?.activate();
      },
      binaryPath: app.isPackaged
        ? Path.join(process.resourcesPath, "cua-driver", "cua-driver")
        : Path.join(resources.resolveAppRoot(), "apps/desktop/resources/cua-driver/cua-driver"),
      bundleId: desktopIdentity.bundleId,
      capability: DESKTOP_BROWSER_HOST_CAPABILITY,
      // Computer use must never bind the app hosting it: the integrated browser's webviews live in this
      // app's own renderer pids.
      ownPids: () => new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]),

      cursorStyle: () => readAgentCursorPreference(AGENT_CURSOR_PREFERENCE_PATH),
      checkPermissions: async (options) => {
        initializeDesktopComputer();
        const state = await computerManager!.refreshState(COMPUTER_PERMISSIONS, {
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
          escapeKillSwitchMonitor?.state.error === "input-monitoring-required"
        ) {
          await escapeKillSwitchMonitor.activate(true);
        }
        return {
          accessibility: state.accessibilityPermission === "granted",
          inputMonitoring: state.inputMonitoringPermission === "granted",
          screenRecording: state.screenRecordingPermission === "granted",
        };
      },
      setup: async () => {
        initializeDesktopComputer();
        await computerManager!.startPermissionSetup(COMPUTER_PERMISSIONS);
      },
      releaseHeldInput: async () => {
        initializeDesktopComputer();
        await computerManager!.releaseHeldInput();
      },
      frameTap: new ComputerFrameTap({
        helperPath: resources.resolveComputerHelperPath(),
        send: (channel, frame) => {
          const window = getMainWindow();
          if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send(channel, frame);
          }
        },
        onError: (error) => safeConsoleError("[desktop] computer frame tap failed", error),
      }),
      // Always wired — the server decides per call whether the armed flag + per-app opt-in name a masked
      // activation, and a missing surface must fail closed there rather than degrade to an unmasked
      // raise.
      shield: new ComputerShield({
        helperPath: resources.resolveComputerHelperPath(),
        onError: (error) => safeConsoleError("[desktop] computer shield failed", error),
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

    if (!escapeKillSwitchMonitor) {
      escapeKillSwitchMonitor = new EscapeKillSwitchMonitor({
        helperPath: resources.resolveComputerHelperPath(),
        onPhysicalInput: (event) => {
          cuaDriverHost?.physicalInput(event);
        },
        onStateChange: (state) => cuaDriverHost?.inputMonitorStateChanged(state),
        onEscape: stopComputerInputFromEscape,
        onError: (message) => safeConsoleError(`[desktop] Escape monitor: ${message}`),
      });
    }
  }
  async function disposeHost(): Promise<void> {
    disposeComputerDesktopLifecycle?.();
    disposeComputerDesktopLifecycle = undefined;
    escapeKillSwitchMonitor?.dispose();
    escapeKillSwitchMonitor = undefined;
    linuxEscapeKillSwitchMonitor?.dispose();
    linuxEscapeKillSwitchMonitor = undefined;
    await cuaDriverHost?.dispose();
    cuaDriverHost = undefined;
    cuaHostEndpoint = undefined;
  }
  return {
    initializeDesktopComputer,
    startCuaHost,
    getManager: () => computerManager,
    getHost: () => cuaDriverHost,
    getHostEndpoint: () => cuaHostEndpoint,
    suspend: async () => {
      await cuaDriverHost?.suspend();
    },
    resume: () => cuaDriverHost?.resume(),
    dispose: async () => {
      computerManager?.dispose();
      computerManager = null;
      await disposeHost();
    },
  };
}
