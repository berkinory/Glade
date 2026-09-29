import { parseComputerHelperMessage } from "./computerHelperProtocol";

import * as ChildProcess from "node:child_process";
import { EventEmitter } from "node:events";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi, type Mock } from "vitest";

import { DesktopComputerManager } from "./computerPermissions";

type FakeChildProcess = ChildProcess.ChildProcessWithoutNullStreams & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
};

function createFakeChildProcess(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  return child;
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("Computer permission probe freshness", () => {
  function fixture() {
    const children: FakeChildProcess[] = [];
    const onState = vi.fn();
    const spawn = vi.fn(() => {
      const child = createFakeChildProcess();
      children.push(child);
      return child;
    });
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      spawn: spawn as unknown as typeof ChildProcess.spawn,
      onState,
    });
    function reply(index: number, permissions: Record<string, string>, code = 0) {
      const child = children[index]!;
      child.stdout.end(`${JSON.stringify({ type: "permissions", ...permissions })}\n`);
      child.stderr.end();
      child.emit("close", code, null);
    }
    return { manager, children, spawn, reply, onState };
  }

  it("shares simultaneous checks and cached grants across Computer and Computer scopes", async () => {
    const f = fixture();
    try {
      const first = f.manager.refreshState(["accessibility", "screenRecording", "inputMonitoring"]);
      const concurrent = f.manager.refreshState([
        "screenRecording",
        "inputMonitoring",
        "accessibility",
      ]);
      const subset = f.manager.refreshState();
      await flushPromises();
      expect(f.spawn).toHaveBeenCalledTimes(1);
      f.reply(0, {
        accessibility: "granted",
        screenRecording: "granted",
        inputMonitoring: "granted",
      });
      await Promise.all([first, concurrent, subset]);
      await f.manager.refreshState();
      expect(f.spawn).toHaveBeenCalledTimes(1);
      const forced = f.manager.refreshState(["accessibility"], { force: true });
      await flushPromises();
      expect(f.spawn).toHaveBeenCalledTimes(2);
      f.reply(1, { accessibility: "denied" });
      expect(await forced).toMatchObject({ accessibilityPermission: "denied" });
      const recovery = f.manager.refreshState(["accessibility"]);
      await flushPromises();
      f.reply(2, { accessibility: "granted" });
      expect(await recovery).toMatchObject({ accessibilityPermission: "granted" });
    } finally {
      f.manager.dispose();
    }
  });

  it("does not keep old green badges when the helper returns only part of the requested grants", async () => {
    const f = fixture();
    try {
      const first = f.manager.refreshState();
      await flushPromises();
      f.reply(0, { inputMonitoring: "granted", screenRecording: "granted" });
      await first;
      const incomplete = f.manager.refreshState(undefined, { force: true });
      await flushPromises();
      f.reply(1, { screenRecording: "granted" });
      expect(await incomplete).toMatchObject({
        status: "error",
        inputMonitoringPermission: "unknown",
        screenRecordingPermission: "unknown",
      });
      const recovery = f.manager.refreshState();
      await flushPromises();
      f.reply(2, {
        accessibility: "granted",
        inputMonitoring: "granted",
        screenRecording: "granted",
      });
      expect(await recovery).toMatchObject({
        inputMonitoringPermission: "granted",
        screenRecordingPermission: "granted",
      });
    } finally {
      f.manager.dispose();
    }
  });

  it("rejects a failed helper even if it printed a complete grant report", async () => {
    const f = fixture();
    try {
      const check = f.manager.refreshState(["accessibility"]);
      await flushPromises();
      f.reply(0, { accessibility: "granted" }, 1);
      expect(await check).toMatchObject({ status: "error", accessibilityPermission: "unknown" });
      expect(
        f.onState.mock.calls.some(([state]) => state.accessibilityPermission === "granted"),
      ).toBe(false);
    } finally {
      f.manager.dispose();
    }
  });

  it("ignores late grants after a timed-out helper and allows a fresh recovery check", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    try {
      const check = f.manager.refreshState(["accessibility"]);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await check).toMatchObject({ status: "error", accessibilityPermission: "unknown" });
      expect(f.children[0]!.kill).toHaveBeenCalled();
      f.reply(0, { accessibility: "granted" });
      expect(f.manager.getState().accessibilityPermission).toBe("unknown");
      const recovery = f.manager.refreshState(["accessibility"]);
      await flushPromises();
      f.reply(1, { accessibility: "granted" });
      expect(await recovery).toMatchObject({ accessibilityPermission: "granted" });
    } finally {
      f.manager.dispose();
      vi.useRealTimers();
    }
  });

  it("does not let an obsolete setup error cancel its replacement", async () => {
    const f = fixture();
    try {
      const obsolete = f.manager.startPermissionSetup(["accessibility"]);
      await flushPromises();
      const replacement = f.manager.startPermissionSetup(["screenRecording"]);
      f.children[0]!.stdout.end(
        `${JSON.stringify({
          type: "error",
          code: "permission_setup_registration_unresolved",
          message: "old error",
        })}\n`,
      );
      f.children[0]!.stderr.end();
      f.children[0]!.emit("close", 1, null);
      await obsolete;
      await flushPromises();
      f.reply(1, { screenRecording: "granted" });
      expect(await replacement).toMatchObject({
        screenRecordingPermission: "granted",
        message: null,
      });
      expect(f.manager.getState().permissionSetupErrorCode).toBeUndefined();
      expect(f.spawn).toHaveBeenCalledTimes(2);
    } finally {
      f.manager.dispose();
    }
  });

  it("does not reopen a dismissed setup after its registration probe completes", async () => {
    const f = fixture();
    try {
      const setup = f.manager.startPermissionSetup(["accessibility", "screenRecording"]);
      await flushPromises();
      f.manager.hidePermissionGuide();
      f.reply(0, { accessibility: "denied", screenRecording: "denied" });
      await setup;
      expect(f.spawn).toHaveBeenCalledTimes(1);
    } finally {
      f.manager.dispose();
    }
  });
});

describe("desktop Computer platform state", () => {
  it("checks and requests the default Computer permission set through the helper", async () => {
    const checkChild = createFakeChildProcess();
    const requestChild = createFakeChildProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(checkChild)
      .mockReturnValueOnce(requestChild) as unknown as typeof ChildProcess.spawn;
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      appBundlePath: "/Applications/Glade Test.app",
      spawn,
      onState: vi.fn(),
    });

    const check = manager.refreshState();
    await flushPromises();
    // Default checks include each Computer grant explicitly.
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
    checkChild.stdout.end(
      `${JSON.stringify({
        type: "permissions",
        accessibility: "granted",
        inputMonitoring: "denied",
        screenRecording: "granted",
      })}\n`,
    );
    checkChild.stderr.end();
    checkChild.emit("close", 0, null);
    expect(await check).toMatchObject({
      inputMonitoringPermission: "denied",
      screenRecordingPermission: "granted",
    });
    // The default permission set includes Accessibility.
    expect((await check).accessibilityPermission).toBe("granted");

    const request = manager.requestPermissions();
    await flushPromises();
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
    expect(await request).toMatchObject({
      inputMonitoringPermission: "granted",
      screenRecordingPermission: "granted",
    });
    manager.dispose();
  });

  it("passes an explicit permission set as --permission selectors", async () => {
    const checkChild = createFakeChildProcess();
    const spawn = vi.fn().mockReturnValueOnce(checkChild) as unknown as typeof ChildProcess.spawn;
    const manager = new DesktopComputerManager({
      platform: "darwin",
      helperPath: process.execPath,
      spawn,
      onState: vi.fn(),
    });

    const check = manager.refreshState(["accessibility", "inputMonitoring", "screenRecording"]);
    await flushPromises();
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
    checkChild.stdout.end(
      `${JSON.stringify({
        type: "permissions",
        accessibility: "denied",
        inputMonitoring: "granted",
        screenRecording: "granted",
      })}\n`,
    );
    checkChild.stderr.end();
    checkChild.emit("close", 0, null);
    expect(await check).toMatchObject({
      accessibilityPermission: "denied",
      inputMonitoringPermission: "granted",
      screenRecordingPermission: "granted",
    });
    manager.dispose();
  });
});

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
      // Wait for the 500 ms SIGTERM delay to elapse.
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
    // No macOS prompt is ever raised by a guide: the inline steps plus the
    // coach are the whole flow. A denied prompt cannot be re-raised, while the
    // Settings page (toggle, or drag-and-drop where the list accepts it)
    // always works.
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
      // Renderer parity: the OS request never fires. Later watch ticks
      // re-check via --check-permissions (deduped while in flight).
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
    // Accessibility grants never reach an already-running process, so the
    // coach's own poll stays false; the manager's fresh-helper watch must
    // detect the grant and retire the coach instead. Mock timers drive the
    // 800ms tick deterministically; in-flight dedup keeps overlapping ticks
    // from queueing a second check while the first is still pending.
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
    // In-flight dedup: the second 800ms tick must not spawn a second helper
    // while the first check has not answered yet; once it resolves, the next
    // tick may poll again.
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
      // Second tick fires while the first check is still pending: no new spawn.
      await vi.advanceTimersByTimeAsync(800);
      await flushPromises();
      expect(checkChildren).toHaveLength(1);
      releaseFirstCheck();
      await flushPromises();
      await flushPromises();
      // Pending cleared: the next tick polls again.
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
    // The grant watch must not poll forever: after 10 minutes without a grant
    // it stops, emits closed honestly via the existing guide-state plumbing,
    // and pushes the current snapshot via the existing onState path. No new IPC.
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
      // Bound cleared on stop: further time never re-emits.
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
      // Callers may pass kinds out of order with dupes: the queue build sorts
      // into [accessibility, inputMonitoring, screenRecording] and dedupes, so
      // a single queue with its shift-only consumer still walks each pane once.
      await manager.startPermissionSetup(["screenRecording", "accessibility", "screenRecording"]);
      await flushPromises();
      // Only the first missing pane is up: its settings page and its coach.
      // No macOS prompt ever fires.
      expect(openSettingsPane).toHaveBeenLastCalledWith("accessibility");
      expect(requests).toEqual([]);
      expect(guideChildren).toHaveLength(1);

      // The grant watch sees Accessibility flip: the first coach closes and the
      // session advances to Screen Recording on its own.
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
      // The session is done: two panes opened, two coaches, no OS prompts, and
      // the Settings the session opened is closed again.
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
      // The session is still mid-walk: Settings stays open.
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
      // The user dismisses the first coach: the exit is not a grant, so the
      // session must stop rather than open the next pane over their dismissal.
      // A dismissed session never closes the user's Settings either.
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
      // A spawn-level failure (EACCES/ENOENT) emits `error` without `exit`.
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
