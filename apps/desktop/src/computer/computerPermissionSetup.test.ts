import * as ChildProcess from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  FakeChildProcess,
  createFakeChildProcess,
  flushPromises,
} from "./computerPermissionFixture";
import { DesktopComputerManager } from "./computerPermissions";
describe("Computer setup registration failures", () => {
  const setupFailure = {
    type: "error",
    code: "permission_setup_registration_unresolved",
    message: "Move this app to Applications and reopen it before granting access.",
  };

  it("stops before opening Settings or a coach and preserves the error through passive refresh", async () => {
    const captureDirectory = mkdtempSync(join(tmpdir(), "glade-permissions-registration-"));
    const calls: string[][] = [];
    let registrationFails = true;
    const spawn = vi.fn((_file: string, args: readonly string[]) => {
      calls.push([...args]);
      const child = createFakeChildProcess();
      setImmediate(() => {
        child.stdout.end(
          `${JSON.stringify(args[0] === "--prepare-permission-setup" && registrationFails ? setupFailure : { type: "permissions", accessibility: "granted", inputMonitoring: "granted", screenRecording: "granted" })}\n`,
        );
        child.stderr.end();
        child.emit("close", 0, null);
      });
      return child;
    });
    const openSettingsPane = vi.fn();
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appBundlePath: "/Applications/Glade Test.app",
      appDisplayName: "Glade Test",
      spawn: spawn as unknown as typeof ChildProcess.spawn,
      openSettingsPane,
      onState: vi.fn(),
    });
    try {
      const failed = await manager.startPermissionSetup([
        "accessibility",
        "screenRecording",
        "inputMonitoring",
      ]);
      expect(failed).toMatchObject({
        status: "error",
        message: setupFailure.message,
        permissionSetupErrorCode: setupFailure.code,
      });
      expect(calls[0]).toEqual([
        "--prepare-permission-setup",
        "--permission",
        "accessibility",
        "--permission",
        "screenRecording",
        "--permission",
        "inputMonitoring",
        "--app-path",
        "/Applications/Glade Test.app",
      ]);
      expect(openSettingsPane).not.toHaveBeenCalled();
      const refreshed = await manager.refreshState([
        "accessibility",
        "screenRecording",
        "inputMonitoring",
      ]);
      expect(refreshed).toMatchObject({
        status: "error",
        message: setupFailure.message,
        permissionSetupErrorCode: setupFailure.code,
      });
      expect(calls.map((args) => args[0])).toEqual([
        "--prepare-permission-setup",
        "--check-permissions",
      ]);
      registrationFails = false;
      expect(
        (
          await manager.startPermissionSetup([
            "accessibility",
            "screenRecording",
            "inputMonitoring",
          ])
        ).message,
      ).toBeNull();
      expect(manager.getState().permissionSetupErrorCode).toBeUndefined();
      expect(openSettingsPane).not.toHaveBeenCalled();
    } finally {
      manager.dispose();
      rmSync(captureDirectory, { recursive: true, force: true });
    }
  });

  it("drains an exiting coach registration failure and cancels its poll", async () => {
    vi.useFakeTimers();
    const captureDirectory = mkdtempSync(join(tmpdir(), "glade-permissions-coach-registration-"));
    const child = createFakeChildProcess();
    const spawn = vi.fn(() => child);
    const onPermissionGuideState = vi.fn();
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appBundlePath: "/Applications/Glade Test.app",
      appDisplayName: "Glade Test",
      spawn: spawn as unknown as typeof ChildProcess.spawn,
      onState: vi.fn(),
      onPermissionGuideState,
    });
    try {
      manager.showPermissionGuide("screen-recording");
      child.emit("exit", 1, null);
      child.stdout.end(`${JSON.stringify(setupFailure)}\n`);
      child.stderr.end();
      child.emit("close", 1, null);
      await vi.advanceTimersByTimeAsync(1);
      expect(manager.getState()).toMatchObject({ status: "error", message: setupFailure.message });
      expect(onPermissionGuideState).toHaveBeenLastCalledWith("closed");
      expect(child.stdin.read()?.toString()).toBe("close\n");
      await vi.advanceTimersByTimeAsync(2_500);
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      manager.dispose();
      vi.useRealTimers();
      rmSync(captureDirectory, { recursive: true, force: true });
    }
  });
});

describe("Computer permission setup sessions", () => {
  function createSessionManager(state: {
    accessibility: string;
    screenRecording: string;
    inputMonitoring: string;
  }): {
    manager: DesktopComputerManager;
    guideChildren: FakeChildProcess[];
    requests: string[];
    openSettingsPane: Mock;
    closeSettingsApp: Mock;
    onPermissionGuideState: Mock;
    dispose: () => void;
  } {
    const captureDirectory = mkdtempSync(join(tmpdir(), "glade-permissions-session-"));
    const guideChildren: FakeChildProcess[] = [];
    const requests: string[] = [];
    const openSettingsPane = vi.fn();
    const closeSettingsApp = vi.fn();
    const onPermissionGuideState = vi.fn();
    const spawn = vi.fn().mockImplementation((_file: string, args: readonly string[]) => {
      if (args.includes("--permission-guide")) {
        const child = createFakeChildProcess();
        guideChildren.push(child);
        return child;
      }
      const child = createFakeChildProcess();
      if (args.includes("--request-permissions")) requests.push(args.join(" "));
      setImmediate(() => {
        child.stdout.end(`${JSON.stringify({ type: "permissions", ...state })}\n`);
        child.stderr.end();
        child.emit("close", 0, null);
      });
      return child;
    });
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appDisplayName: "Glade Test",
      appBundlePath: "/Applications/Glade Test.app",
      spawn,
      openSettingsPane,
      closeSettingsApp,
      onState: vi.fn(),
      onPermissionGuideState,
    });
    return {
      manager,
      guideChildren,
      requests,
      openSettingsPane,
      closeSettingsApp,
      onPermissionGuideState,
      dispose: () => {
        manager.dispose();
        rmSync(captureDirectory, { recursive: true, force: true });
      },
    };
  }

  it("walks each missing pane in sequence with no OS prompt, then closes Settings", async () => {
    const state = { accessibility: "denied", screenRecording: "denied", inputMonitoring: "denied" };
    const { manager, guideChildren, requests, openSettingsPane, closeSettingsApp, dispose } =
      createSessionManager(state);
    try {
      await manager.startPermissionSetup(["screenRecording", "accessibility", "screenRecording"]);
      await flushPromises();

      expect(openSettingsPane).toHaveBeenLastCalledWith("accessibility");
      expect(requests).toEqual([]);
      expect(guideChildren).toHaveLength(1);

      state.accessibility = "granted";
      await vi.waitFor(() => expect(guideChildren).toHaveLength(2), { timeout: 4000 });
      expect(guideChildren[0]!.stdin.read()?.toString().trimEnd()).toBe("close");
      expect(openSettingsPane).toHaveBeenLastCalledWith("screen-recording");
      expect(requests).toEqual([]);

      state.screenRecording = "granted";
      await vi.waitFor(
        () => expect(guideChildren[1]!.stdin.read()?.toString().trimEnd()).toBe("close"),
        { timeout: 4000 },
      );
      await flushPromises();

      expect(openSettingsPane).toHaveBeenCalledTimes(2);
      expect(guideChildren).toHaveLength(2);
      expect(closeSettingsApp).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it("skips panes that are already granted", async () => {
    const state = {
      accessibility: "granted",
      screenRecording: "denied",
      inputMonitoring: "denied",
    };
    const { manager, guideChildren, requests, openSettingsPane, closeSettingsApp, dispose } =
      createSessionManager(state);
    try {
      await manager.startPermissionSetup(["accessibility", "screenRecording"]);
      await flushPromises();
      expect(openSettingsPane).toHaveBeenCalledExactlyOnceWith("screen-recording");
      expect(requests).toEqual([]);
      expect(guideChildren).toHaveLength(1);

      expect(closeSettingsApp).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("ends the session when the coach is dismissed instead of respawning", async () => {
    const state = { accessibility: "denied", screenRecording: "denied", inputMonitoring: "denied" };
    const { manager, guideChildren, requests, closeSettingsApp, onPermissionGuideState, dispose } =
      createSessionManager(state);
    try {
      await manager.startPermissionSetup(["accessibility", "screenRecording"]);
      await flushPromises();
      expect(guideChildren).toHaveLength(1);

      guideChildren[0]!.emit("exit", 0, null);
      guideChildren[0]!.stdout.end();
      guideChildren[0]!.stderr.end();
      guideChildren[0]!.emit("close", 0, null);
      await flushPromises();
      await new Promise<void>((resolve) => setTimeout(resolve, 900));
      expect(onPermissionGuideState).toHaveBeenLastCalledWith("closed");
      expect(guideChildren).toHaveLength(1);
      expect(requests).toEqual([]);
      expect(closeSettingsApp).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("reports closed and ends the session when the guide helper fails to spawn", async () => {
    const state = { accessibility: "denied", screenRecording: "denied", inputMonitoring: "denied" };
    const { manager, guideChildren, requests, closeSettingsApp, onPermissionGuideState, dispose } =
      createSessionManager(state);
    try {
      await manager.startPermissionSetup(["accessibility", "screenRecording"]);
      await flushPromises();
      expect(guideChildren).toHaveLength(1);

      guideChildren[0]!.emit("error", new Error("spawn EACCES"));
      await flushPromises();
      await new Promise<void>((resolve) => setTimeout(resolve, 900));
      expect(onPermissionGuideState).toHaveBeenLastCalledWith("closed");
      expect(guideChildren).toHaveLength(1);
      expect(requests).toEqual([]);
      expect(closeSettingsApp).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("opens and closes nothing when every grant is already held", async () => {
    const { manager, guideChildren, openSettingsPane, closeSettingsApp, dispose } =
      createSessionManager({
        accessibility: "granted",
        screenRecording: "granted",
        inputMonitoring: "granted",
      });
    try {
      await manager.startPermissionSetup(["accessibility", "screenRecording"]);
      await flushPromises();
      expect(guideChildren).toHaveLength(0);
      expect(openSettingsPane).not.toHaveBeenCalled();
      expect(closeSettingsApp).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});
