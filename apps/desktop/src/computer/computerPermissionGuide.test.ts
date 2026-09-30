import * as ChildProcess from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, type Mock } from "vitest";
import { parseComputerHelperMessage } from "./computerHelperProtocol";
import {
  FakeChildProcess,
  createFakeChildProcess,
  flushPromises,
} from "./computerPermissionFixture";
import { DesktopComputerManager } from "./computerPermissions";
describe("Computer helper protocol", () => {
  it("rejects malformed or unknown helper output", () => {
    expect(parseComputerHelperMessage("not-json")).toBeNull();
    expect(parseComputerHelperMessage(JSON.stringify({ type: "captured", path: "/tmp/x" }))).toBe(
      null,
    );
    expect(parseComputerHelperMessage(JSON.stringify({ type: "surprise" }))).toBeNull();
  });

  it("serializes permission commands and waits for stdout to drain", async () => {
    const checkChild = createFakeChildProcess();
    const requestChild = createFakeChildProcess();
    const freshCheckChild = createFakeChildProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(checkChild)
      .mockReturnValueOnce(requestChild)
      .mockReturnValueOnce(freshCheckChild) as unknown as typeof ChildProcess.spawn;
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appBundlePath: "/Applications/Glade Test.app",
      spawn,
      onState: vi.fn(),
    });

    const check = manager.refreshState();
    const request = manager.requestPermissions();
    await flushPromises();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [
        "--check-permissions",
        "--permission",
        "accessibility",
        "--permission",
        "inputMonitoring",
        "--permission",
        "screenRecording",
      ],
      expect.any(Object),
    );

    checkChild.emit("exit", 0, null);
    checkChild.stdout.end(
      `${JSON.stringify({
        type: "permissions",
        accessibility: "granted",
        inputMonitoring: "denied",
        screenRecording: "denied",
      })}\n`,
    );
    checkChild.stderr.end();
    checkChild.emit("close", 0, null);
    await flushPromises();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [
        "--request-permissions",
        "--permission",
        "accessibility",
        "--permission",
        "inputMonitoring",
        "--permission",
        "screenRecording",
        "--app-path",
        "/Applications/Glade Test.app",
      ],
      expect.any(Object),
    );

    requestChild.stdout.end(
      `${JSON.stringify({
        type: "permissions",
        accessibility: "granted",
        inputMonitoring: "granted",
        screenRecording: "granted",
      })}\n`,
    );
    requestChild.stderr.end();
    requestChild.emit("close", 0, null);
    await flushPromises();
    freshCheckChild.stdout.end(
      `${JSON.stringify({
        type: "permissions",
        accessibility: "granted",
        inputMonitoring: "granted",
        screenRecording: "granted",
      })}\n`,
    );
    freshCheckChild.stderr.end();
    freshCheckChild.emit("close", 0, null);

    await Promise.all([check, request]);
    expect(manager.getState()).toMatchObject({
      inputMonitoringPermission: "granted",
      screenRecordingPermission: "granted",
    });
  });
});

describe("Computer permission guide", () => {
  async function createGuideManager(): Promise<{
    manager: DesktopComputerManager;
    guideChild: FakeChildProcess;
    onPermissionGuideState: Mock;
    spawn: Mock;
    dispose: () => void;
  }> {
    const captureDirectory = mkdtempSync(join(tmpdir(), "glade-permissions-guide-"));
    const guideChild = createFakeChildProcess();
    const spawn = vi.fn().mockReturnValueOnce(guideChild);
    const onPermissionGuideState = vi.fn();
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appDisplayName: "Glade Test",
      appBundlePath: "/Applications/Glade Test.app",
      spawn,
      onState: vi.fn(),
      onPermissionGuideState,
    });
    manager.showPermissionGuide("input-monitoring");
    await flushPromises();
    return {
      manager,
      guideChild,
      onPermissionGuideState,
      spawn,
      dispose: () => {
        manager.dispose();
        rmSync(captureDirectory, { recursive: true, force: true });
      },
    };
  }

  function lastStdinLine(child: FakeChildProcess): string {
    return child.stdin.read()?.toString().trimEnd() ?? "";
  }

  it("spawns the helper in permission-guide mode with the right arguments", async () => {
    const { guideChild, dispose, spawn } = await createGuideManager();
    try {
      expect(lastStdinLine(guideChild)).toBe("");
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [
          "--permission-guide",
          "--pane",
          "input-monitoring",
          "--app-path",
          "/Applications/Glade Test.app",
          "--app-name",
          "Glade Test",
        ],
        expect.any(Object),
      );
    } finally {
      dispose();
    }
  });

  it("forwards guide state events to the renderer", async () => {
    const { guideChild, onPermissionGuideState, dispose } = await createGuideManager();
    try {
      guideChild.stdout.write(`${JSON.stringify({ type: "permission-guide", state: "shown" })}\n`);
      await flushPromises();
      expect(onPermissionGuideState).not.toHaveBeenCalledWith("shown");
      guideChild.stdout.write(
        `${JSON.stringify({ type: "permission-guide", state: "granted" })}\n`,
      );
      await flushPromises();
      expect(onPermissionGuideState).toHaveBeenCalledWith("granted");
    } finally {
      dispose();
    }
  });

  it("writes close and SIGTERMs the guide when hidden", async () => {
    const { manager, guideChild, dispose } = await createGuideManager();
    try {
      manager.hidePermissionGuide();
      await flushPromises();
      expect(guideChild.stdin.read()?.toString().trimEnd()).toBe("close");
      expect(guideChild.kill).not.toHaveBeenCalled();

      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      expect(guideChild.kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      dispose();
    }
  });

  it("forwards a crash/exit as closed when no final state was emitted", async () => {
    const { guideChild, onPermissionGuideState, dispose } = await createGuideManager();
    try {
      guideChild.stdout.write(`${JSON.stringify({ type: "permission-guide", state: "shown" })}\n`);
      await flushPromises();
      guideChild.emit("exit", 1, null);
      guideChild.stdout.end();
      guideChild.stderr.end();
      guideChild.emit("close", 1, null);
      await flushPromises();
      expect(onPermissionGuideState).toHaveBeenLastCalledWith("closed");
    } finally {
      dispose();
    }
  });

  it("never raises an OS prompt when a guide opens", async () => {
    // No macOS prompt is ever raised by a guide: the inline steps plus the coach are the whole flow. A
    // denied prompt cannot be re-raised, while the Settings page (toggle, or drag-and-drop where the
    // list accepts it) always works.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const captureDirectory = mkdtempSync(join(tmpdir(), "glade-permissions-guide-ax-"));
    const guideChild = createFakeChildProcess();
    const spawn = vi.fn().mockImplementation((_file: string, args: readonly string[]) => {
      if (args.includes("--permission-guide")) return guideChild;
      const requestChild = createFakeChildProcess();
      setImmediate(() => {
        requestChild.stdout.end(
          `${JSON.stringify({ type: "permissions", accessibility: "denied" })}\n`,
        );
        requestChild.stderr.end();
        requestChild.emit("close", 0, null);
      });
      return requestChild;
    });
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appDisplayName: "Glade Test",
      appBundlePath: "/Applications/Glade Test.app",
      spawn,
      onState: vi.fn(),
      onPermissionGuideState: vi.fn(),
    });
    try {
      manager.showPermissionGuide("accessibility");
      await flushPromises();
      expect(spawn).not.toHaveBeenCalledWith(
        process.execPath,
        ["--request-permissions", "--permission", "accessibility"],
        expect.any(Object),
      );
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        expect.arrayContaining(["--permission-guide", "--pane", "accessibility"]),
        expect.any(Object),
      );

      const requestCalls = () =>
        spawn.mock.calls.filter(([, args]) =>
          (args as readonly string[]).includes("--request-permissions"),
        );
      expect(requestCalls()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(800);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(800);
      await flushPromises();
      expect(requestCalls()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      manager.dispose();
      rmSync(captureDirectory, { recursive: true, force: true });
    }
  });

  it("closes the guide when a fresh check sees the grant the coach cannot", async () => {
    // Accessibility grants never reach an already-running process, so the coach's own poll stays false;
    // the manager's fresh-helper watch must detect the grant and retire the coach instead.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const captureDirectory = mkdtempSync(join(tmpdir(), "glade-permissions-guide-watch-"));
    const guideChild = createFakeChildProcess();
    const spawn = vi.fn().mockImplementation((_file: string, args: readonly string[]) => {
      if (args.includes("--permission-guide")) return guideChild;
      const checkChild = createFakeChildProcess();
      setImmediate(() => {
        checkChild.stdout.end(
          `${JSON.stringify({ type: "permissions", accessibility: "granted" })}\n`,
        );
        checkChild.stderr.end();
        checkChild.emit("close", 0, null);
      });
      return checkChild;
    });
    const onPermissionGuideState = vi.fn();
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appDisplayName: "Glade Test",
      appBundlePath: "/Applications/Glade Test.app",
      spawn,
      onState: vi.fn(),
      onPermissionGuideState,
    });
    try {
      manager.showPermissionGuide("accessibility");
      await flushPromises();
      expect(onPermissionGuideState).not.toHaveBeenCalledWith("granted");
      await vi.advanceTimersByTimeAsync(800);
      await flushPromises();
      await flushPromises();
      expect(onPermissionGuideState).toHaveBeenCalledWith("granted");
      expect(lastStdinLine(guideChild)).toBe("close");
    } finally {
      vi.useRealTimers();
      manager.dispose();
      rmSync(captureDirectory, { recursive: true, force: true });
    }
  });

  it("skips overlapping watch ticks while a grant check is in flight", async () => {
    // In-flight dedup: the second 800ms tick must not spawn a second helper while the first check has
    // not answered yet; once it resolves, the next tick may poll again.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const captureDirectory = mkdtempSync(join(tmpdir(), "glade-permissions-guide-dedup-"));
    const guideChild = createFakeChildProcess();
    const checkChildren: FakeChildProcess[] = [];
    let releaseFirstCheck!: () => void;
    const firstCheckGate = new Promise<void>((resolve) => {
      releaseFirstCheck = resolve;
    });
    const spawn = vi.fn().mockImplementation((_file: string, args: readonly string[]) => {
      if (args.includes("--permission-guide")) return guideChild;
      const checkChild = createFakeChildProcess();
      checkChildren.push(checkChild);
      if (checkChildren.length === 1) {
        void firstCheckGate.then(() => {
          checkChild.stdout.end(
            `${JSON.stringify({ type: "permissions", inputMonitoring: "denied" })}\n`,
          );
          checkChild.stderr.end();
          checkChild.emit("close", 0, null);
        });
      } else {
        setImmediate(() => {
          checkChild.stdout.end(
            `${JSON.stringify({ type: "permissions", inputMonitoring: "denied" })}\n`,
          );
          checkChild.stderr.end();
          checkChild.emit("close", 0, null);
        });
      }
      return checkChild;
    });
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appDisplayName: "Glade Test",
      appBundlePath: "/Applications/Glade Test.app",
      spawn,
      onState: vi.fn(),
      onPermissionGuideState: vi.fn(),
    });
    try {
      manager.showPermissionGuide("input-monitoring");
      await flushPromises();
      await vi.advanceTimersByTimeAsync(800);
      await flushPromises();
      expect(checkChildren).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(800);
      await flushPromises();
      expect(checkChildren).toHaveLength(1);
      releaseFirstCheck();
      await flushPromises();
      await flushPromises();

      await vi.advanceTimersByTimeAsync(800);
      await flushPromises();
      await flushPromises();
      expect(checkChildren).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      manager.dispose();
      rmSync(captureDirectory, { recursive: true, force: true });
    }
  });

  it("closes an ungranted guide after the 10-minute watch bound", async () => {
    // The grant watch must not poll forever: after 10 minutes without a grant it stops, emits closed
    // honestly via the existing guide-state plumbing, and pushes the current snapshot via the existing
    // onState path. No new IPC.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const captureDirectory = mkdtempSync(join(tmpdir(), "glade-permissions-guide-bound-"));
    const guideChild = createFakeChildProcess();
    const onState = vi.fn();
    const spawn = vi.fn().mockImplementation((_file: string, args: readonly string[]) => {
      if (args.includes("--permission-guide")) return guideChild;
      const checkChild = createFakeChildProcess();
      setImmediate(() => {
        checkChild.stdout.end(
          `${JSON.stringify({ type: "permissions", accessibility: "denied" })}\n`,
        );
        checkChild.stderr.end();
        checkChild.emit("close", 0, null);
      });
      return checkChild;
    });
    const onPermissionGuideState = vi.fn();
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appDisplayName: "Glade Test",
      appBundlePath: "/Applications/Glade Test.app",
      spawn,
      onState,
      onPermissionGuideState,
    });
    try {
      manager.showPermissionGuide("accessibility");
      await flushPromises();
      expect(onPermissionGuideState).not.toHaveBeenCalledWith("closed");
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      await flushPromises();
      await flushPromises();
      expect(onPermissionGuideState).toHaveBeenCalledWith("closed");
      expect(lastStdinLine(guideChild)).toBe("close");
      const closedCalls = onPermissionGuideState.mock.calls.filter(
        ([state]) => state === "closed",
      ).length;

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      await flushPromises();
      expect(onPermissionGuideState.mock.calls.filter(([state]) => state === "closed").length).toBe(
        closedCalls,
      );
    } finally {
      vi.useRealTimers();
      manager.dispose();
      rmSync(captureDirectory, { recursive: true, force: true });
    }
  });
});
