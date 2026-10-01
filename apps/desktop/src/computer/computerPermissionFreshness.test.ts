import * as ChildProcess from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  FakeChildProcess,
  createFakeChildProcess,
  flushPromises,
} from "./computerPermissionFixture";
import { DesktopComputerManager } from "./computerPermissions";
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
