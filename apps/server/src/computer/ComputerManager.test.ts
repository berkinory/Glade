import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ComputerEvent,
  ComputerUiNode,
  ComputerWindow,
  ThreadComputerState,
} from "@glade/contracts/computer/computer";

import {
  COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION,
  ComputerBackendError,
} from "./ComputerBackend.ts";

import { COMPUTER_CONTROL_ENABLE_TIMEOUT_MS, ComputerManager } from "./ComputerManager.ts";

import { FakeComputerBackend } from "./FakeComputerBackend.ts";
import type { FrameSink } from "@glade/shared/frameTransport";

class RecordingSink implements FrameSink {
  readonly received: Uint8Array[] = [];
  open = true;

  send = (bytes: Uint8Array): void => {
    this.received.push(bytes);
  };
  bufferedAmount = (): number => 0;
  isOpen = (): boolean => this.open;
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function coveredCalculatorWindows(): readonly ComputerWindow[] {
  return [
    {
      id: "fake-browser",
      title: "Browser",
      bounds: { x: 0, y: 0, width: 1_920, height: 1_080 },
      focused: true,
      minimized: false,
      visible: true,
      stackingIndex: 0,
      occludedBy: [],
    },
    {
      id: "fake-calculator",
      title: "Calculator",
      bounds: { x: 1_050, y: 120, width: 420, height: 620 },
      focused: false,
      minimized: false,
      visible: true,
      stackingIndex: 1,
      occludedBy: ["fake-browser"],
    },
  ];
}

function semanticTextRoot(windowIds: readonly string[]): ComputerUiNode {
  return {
    role: "desktop",
    label: null,
    value: null,
    description: "Semantic text test desktop",
    frame: { x: 0, y: 0, width: 1_920, height: 1_080 },
    activationPoint: null,
    onScreen: true,
    windowId: null,
    children: windowIds.map((windowId, index) => ({
      role: "AXWindow",
      label: `Window ${index + 1}`,
      value: null,
      description: null,
      frame: { x: index * 400, y: 0, width: 360, height: 300 },
      activationPoint: null,
      onScreen: true,
      windowId,
      children: [
        {
          role: "AXTextArea",
          label: null,
          value: "",
          description: null,
          frame: { x: index * 400 + 20, y: 40, width: 320, height: 220 },
          activationPoint: { x: index * 400 + 180, y: 150 },
          onScreen: true,
          windowId,
          children: [],
        },
      ],
    })),
  };
}

function backgroundTargetBackend() {
  const ids = ["editor-a", "editor-b", "editor-a-other"];
  const windows = ids.map(
    (id, index): ComputerWindow => ({
      id,
      title: id,
      appName: index === 1 ? "Editor B" : "Editor A",
      pid: index === 1 ? 220 : 110,
      bounds: { x: index * 400, y: 0, width: 360, height: 300 },
      focused: false,
      minimized: false,
      visible: true,
    }),
  );
  return Object.assign(
    new FakeComputerBackend({
      windows,
      root: semanticTextRoot(ids),
      apps: [
        { pid: 110, name: "Editor A", bundleId: "app.editor.a", running: true, active: false },
        { pid: 220, name: "Editor B", bundleId: "app.editor.b", running: true, active: false },
      ],
    }),
    {
      exactTargetBackgroundInput: true,
      focusNeutralSemanticText: true,
      agentDialect: "macos" as const,
    },
  );
}

describe("ComputerManager background task ownership", () => {
  it("lets separate apps progress while protecting one app's keyboard and modal state", async () => {
    const backend = backgroundTargetBackend();
    const manager = new ComputerManager({ backend });
    try {
      await manager.click("a", { windowId: "editor-a", x: 20, y: 50 });
      await manager.click("b", { windowId: "editor-b", x: 420, y: 50 });
      await manager.pressKey("a", "enter", "editor-a");
      await manager.pressKey("b", "enter", "editor-b");
      expect(backend.callsFor("pressKey")).toHaveLength(2);
      expect(backend.callsFor("raiseWindow")).toHaveLength(0);
      await expect(manager.pressKey("b", "enter", "editor-a-other")).rejects.toHaveProperty(
        "code",
        "computer_controlled_by_other_thread",
      );
      expect((await manager.getThreadState("b")).controlledByOtherThread).toBe(false);
      expect((await manager.getThreadState("b")).sharedPreviewUnavailable).toBe(true);
      await manager.releaseDesktopControl("a");
      expect((await manager.getThreadState("b")).sharedPreviewUnavailable).toBeUndefined();
      await manager.pressKey("b", "enter", "editor-a-other");
    } finally {
      await manager.dispose();
    }
  });

  it("keeps foreground, clipboard and drags globally exclusive", async () => {
    const backend = backgroundTargetBackend();
    const manager = new ComputerManager({ backend });
    try {
      await manager.pressKey("a", "enter", "editor-a");
      await expect(manager.writeClipboard("b", "clipboard")).rejects.toHaveProperty(
        "code",
        "computer_controlled_by_other_thread",
      );
      await expect(
        manager.drag(
          "b",
          { windowId: "editor-b", x: 420, y: 50 },
          { windowId: "editor-b", x: 440, y: 60 },
        ),
      ).rejects.toHaveProperty("code", "computer_controlled_by_other_thread");
      await expect(
        manager.activateWindow("b", "editor-b", VISIBLE_USE_AUTHORIZED),
      ).rejects.toHaveProperty("code", "computer_controlled_by_other_thread");
      expect(backend.callsFor("drag")).toHaveLength(0);
      expect(backend.callsFor("writeClipboard")).toHaveLength(0);
      expect(backend.callsFor("raiseWindow")).toHaveLength(0);
    } finally {
      await manager.dispose();
    }
  });

  it("does not release a newer background turn after a late old completion", async () => {
    const backend = backgroundTargetBackend();
    const manager = new ComputerManager({ backend });
    try {
      await manager.withAgentActivity(
        "a",
        () => manager.pressKey("a", "enter", "editor-a"),
        undefined,
        "old",
      );
      await manager.releaseDesktopControl("a", "old");
      await manager.withAgentActivity(
        "a",
        () => manager.pressKey("a", "enter", "editor-a"),
        undefined,
        "new",
      );
      await manager.releaseDesktopControl("a", "old");
      await expect(manager.pressKey("b", "enter", "editor-a")).rejects.toHaveProperty(
        "code",
        "computer_controlled_by_other_thread",
      );
      await manager.releaseDesktopControl("a", "new");
      await manager.pressKey("b", "enter", "editor-a");
    } finally {
      await manager.dispose();
    }
  });

  it("releases a completed background turn only after its admitted input drains", async () => {
    const backend = backgroundTargetBackend();
    const started = deferred();
    const finish = deferred();
    const press = vi.spyOn(backend, "pressKey").mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      return {};
    });
    const manager = new ComputerManager({ backend });
    const active = manager.withAgentActivity(
      "a",
      () => manager.pressKey("a", "enter", "editor-a"),
      undefined,
      "turn-a",
    );
    try {
      await started.promise;
      await manager.releaseDesktopControl("a", "turn-a");
      const next = manager.withAgentActivity(
        "b",
        () => manager.pressKey("b", "enter", "editor-a"),
        undefined,
        "turn-b",
      );
      expect(press).toHaveBeenCalledTimes(1);
      finish.resolve();
      await Promise.all([active, next]);
      expect(press).toHaveBeenCalledTimes(2);
    } finally {
      finish.resolve();
      await active;
      await manager.dispose();
    }
  });

  it("revokes a queued task without stopping the other app's active input", async () => {
    const backend = backgroundTargetBackend();
    const started = deferred();
    const finish = deferred();
    const stop = vi.fn(async () => {});
    Object.assign(backend, { stopInput: stop });
    const press = vi.spyOn(backend, "pressKey").mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      return {};
    });
    const manager = new ComputerManager({ backend });
    const active = manager.withAgentActivity(
      "b",
      () => manager.pressKey("b", "enter", "editor-b"),
      undefined,
      "turn-b",
    );
    try {
      await started.promise;
      const queued = manager.withAgentActivity(
        "a",
        () => manager.pressKey("a", "enter", "editor-a"),
        undefined,
        "turn-a",
      );
      const refused = expect(queued).rejects.toHaveProperty("controlRevoked", true);
      await manager.setControlEnabled("a", false);
      expect(stop).not.toHaveBeenCalled();
      finish.resolve();
      await Promise.all([active, refused]);
      expect(press).toHaveBeenCalledTimes(1);
    } finally {
      finish.resolve();
      await active;
      await manager.dispose();
    }
  });

  it("forwards exact key targets without focus changes and rejects window mismatches", async () => {
    const backend = backgroundTargetBackend();
    const press = vi.spyOn(backend, "pressKey");
    const manager = new ComputerManager({ backend });
    try {
      await manager.pressKey("a", "enter", "editor-a", {
        windowId: "editor-a",
        role: "AXTextArea",
      });
      expect(press).toHaveBeenCalledWith(
        "enter",
        "editor-a",
        expect.objectContaining({ node: expect.objectContaining({ windowId: "editor-a" }) }),
      );
      expect(backend.callsFor("focusWindow")).toHaveLength(0);
      await expect(
        manager.pressKey("a", "enter", "editor-a", { windowId: "editor-b", role: "AXTextArea" }),
      ).rejects.toHaveProperty("code", "computer_target_invalid");
      expect(press).toHaveBeenCalledTimes(1);
    } finally {
      await manager.dispose();
    }
  });
});

describe("ComputerManager and FakeComputerBackend", () => {
  it("dispatches a supported semantic click once and never retries an uncertain AX effect", async () => {
    const backend = Object.assign(new FakeComputerBackend(), {
      agentDialect: "macos" as const,
      supportsAction: (_target: unknown, action: string) => action === "AXPress",
    });
    const press = vi.spyOn(backend, "performAction").mockResolvedValue({
      effect: "dispatched-unknown",
      verified: "unverifiable",
    });
    const manager = new ComputerManager({ backend });
    await manager.click("thread-1", { label: "Calculate", role: "button" });
    expect(press).toHaveBeenCalledTimes(1);
    expect(press.mock.calls[0]?.[1]).toBe("AXPress");
    expect(backend.callsFor("click")).toHaveLength(0);
    press.mockRejectedValueOnce(new Error("Unknown dispatch"));
    await expect(manager.click("thread-1", { label: "Calculate", role: "button" })).rejects.toThrow(
      "Unknown dispatch",
    );
    expect(press).toHaveBeenCalledTimes(2);
    expect(backend.callsFor("click")).toHaveLength(0);
    await manager.doubleClick("thread-1", {
      label: "Calculate",
      role: "button",
    });
    await manager.click("thread-1", { label: "Calculate", role: "button" }, ["shift"]);
    expect(press).toHaveBeenCalledTimes(2);
    expect(backend.callsFor("doubleClick")).toHaveLength(1);
    expect(backend.callsFor("click")).toHaveLength(1);
    await manager.dispose();
  });

  it("performs semantic writes only against a fresh, unambiguous snapshot", async () => {
    const backend = new FakeComputerBackend();
    const manager = new ComputerManager({ backend });

    await expect(manager.setValue("thread-1", { label: "Display" }, "468")).resolves.toMatchObject({
      action: "computer_set_value",
      value: "468",
    });
    await expect(
      manager.performAction("thread-1", { label: "Calculate", role: "button" }, "activate"),
    ).resolves.toMatchObject({
      action: "computer_perform_action",
      point: { x: 1_180, y: 228 },
    });

    await expect(
      manager.selectText("thread-1", { label: "Display" }, { start: 0, length: 2 }),
    ).resolves.toMatchObject({
      action: "computer_select_text",
      value: "46",
    });

    await expect(manager.click("thread-1", { x: 1_920, y: 1_080 })).rejects.toMatchObject({
      code: "computer_target_offscreen",
    });
    await expect(manager.click("thread-1", { x: 10 })).rejects.toMatchObject({
      code: "computer_target_invalid",
    });

    await expect(
      manager.scroll("thread-1", { windowId: "fake-calculator" }, 0, 300),
    ).resolves.toMatchObject({
      action: "computer_scroll",
      point: { x: 1_260, y: 430 },
    });
    await expect(manager.setValue("thread-1", {}, "468")).rejects.toMatchObject({
      code: "computer_target_invalid",
    });
    await expect(manager.performAction("thread-1", {}, "activate")).rejects.toMatchObject({
      code: "computer_target_invalid",
    });
    await expect(manager.selectText("thread-1", {}, { start: 0, length: 1 })).rejects.toMatchObject(
      {
        code: "computer_target_invalid",
      },
    );

    await manager.dispose();
  });

  it("refuses a covered target the desktop cannot raise, and clicks it once it can", async () => {
    const backend = new FakeComputerBackend({
      windows: coveredCalculatorWindows(),
    });
    (backend as unknown as { raiseWindow?: undefined }).raiseWindow = undefined;
    const manager = new ComputerManager({ backend });

    const covered = manager.click("thread-1", {
      x: 1_100,
      y: 200,
      windowId: "fake-calculator",
    });
    await expect(covered).rejects.toMatchObject({
      code: "computer_target_occluded",
    });

    await expect(covered).rejects.toThrow(/Browser/);

    expect(backend.callsFor("click")).toHaveLength(0);
    expect(backend.callsFor("focusWindow")).toHaveLength(0);

    await expect(
      manager.click("thread-1", { label: "Calculate", role: "button" }),
    ).rejects.toMatchObject({ code: "computer_target_occluded" });

    await expect(
      manager.click("thread-1", { x: 1_100, y: 200, windowId: "fake-browser" }),
    ).resolves.toMatchObject({
      point: { x: 1_100, y: 200 },
      windowId: "fake-browser",
    });

    await manager.dispose();
  });

  it("gives the desktop to the first thread that drives it and refuses the second", async () => {
    const backend = new FakeComputerBackend();
    const manager = new ComputerManager({ backend });
    const states: ThreadComputerState[] = [];
    manager.onEvent((event) => {
      if (event.type === "computer.thread-state") states.push(event.state);
    });
    await manager.getThreadState("thread-a");
    await manager.getThreadState("thread-b");

    await manager.click("thread-a", { x: 10, y: 10 });
    await expect(manager.click("thread-b", { x: 20, y: 20 })).rejects.toMatchObject({
      code: "computer_controlled_by_other_thread",
      retryable: false,
      message: expect.stringMatching(/another conversation; no input was sent\. Do not retry/),
    });

    await expect(manager.listWindows()).resolves.toMatchObject({
      computerId: backend.computerId,
    });
    await expect(manager.getState({})).resolves.toMatchObject({
      computerId: backend.computerId,
    });
    await expect(manager.getScreenSize()).resolves.toMatchObject({
      computerId: backend.computerId,
    });
    await expect(manager.getThreadState("thread-b")).resolves.toMatchObject({
      controlledByOtherThread: true,
    });
    await expect(manager.getThreadState("thread-a")).resolves.toMatchObject({
      controlledByOtherThread: false,
    });

    await expect(manager.click(undefined, { x: 30, y: 30 })).resolves.toMatchObject({
      action: "computer_click",
    });
    await expect(manager.click("thread-b", { x: 20, y: 20 })).rejects.toMatchObject({
      code: "computer_controlled_by_other_thread",
    });

    expect(
      states.some((state) => state.threadId === "thread-b" && state.controlledByOtherThread),
    ).toBe(true);
    expect(states.findLast((state) => state.threadId === "thread-a")?.controlledByOtherThread).toBe(
      false,
    );

    await manager.dispose();
  });

  it("allows different threads to overlap exact-window semantic text", async () => {
    const release = deferred();
    let active = 0;
    let peak = 0;
    const windowIds = ["editor-a", "editor-b"];
    const windows = windowIds.map(
      (id, index): ComputerWindow => ({
        id,
        title: `Editor ${index + 1}`,
        bounds: { x: index * 400, y: 0, width: 360, height: 300 },
        focused: false,
        minimized: false,
        visible: true,
      }),
    );
    const backend = Object.assign(
      new FakeComputerBackend({
        windows,
        root: semanticTextRoot(windowIds),
      }),
      {
        focusNeutralSemanticText: true,
        typeText: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await release.promise;
          active -= 1;
          return {};
        },
      },
    );
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });

    const first = manager.withAgentActivity(
      "thread-a",
      () => manager.typeText("thread-a", "alpha", "editor-a"),
      undefined,
      "turn-a",
      "editor-a",
    );
    const second = manager.withAgentActivity(
      "thread-b",
      () => manager.typeText("thread-b", "bravo", "editor-b"),
      undefined,
      "turn-b",
      "editor-b",
    );
    await vi.waitFor(() => expect(peak).toBe(2));
    release.resolve();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(backend.callsFor("clearFocusWindow")).toHaveLength(0);
    expect(backend.callsFor("focusWindow")).toHaveLength(0);
    await manager.dispose();
  });

  it("releases desktop control even when preview cleanup is delayed or fails", async () => {
    const pending = deferred();
    const backend = Object.assign(new FakeComputerBackend(), {
      endTask: vi.fn(async () => {
        await pending.promise;
        throw new Error("Preview cleanup failed");
      }),
    });
    const manager = new ComputerManager({ backend });
    const states: ThreadComputerState[] = [];
    manager.onEvent((event) => {
      if (event.type === "computer.thread-state") states.push(event.state);
    });
    await manager.launchApp("thread-a", "kcalc");
    const cleared = backend.callsFor("clearFocusWindow").length;
    const release = manager.releaseDesktopControl("thread-a", "turn-one");
    await vi.waitFor(() => expect(backend.callsFor("clearFocusWindow")).toHaveLength(cleared + 1));
    await vi.waitFor(async () =>
      expect((await manager.getThreadState("thread-b")).controlledByOtherThread).toBe(false),
    );
    await expect(manager.typeText("thread-b", "hi")).resolves.toMatchObject({
      action: "computer_type_text",
    });

    let released = false;
    void release.then(() => {
      released = true;
    });
    try {
      await vi.waitFor(() => expect(released).toBe(true));
    } finally {
      pending.resolve();
    }
    await release;
    expect(backend.endTask).toHaveBeenCalledWith("thread-a", "turn-one");

    await vi.waitFor(() =>
      expect(
        states.some(
          (state) =>
            state.threadId === "thread-a" && state.lastError?.includes("Preview cleanup failed"),
        ),
      ).toBe(true),
    );
    await manager.dispose();
  });

  // The release runtime ingestion sends on session.exited can land while the dead session's last call
  // is still executing — a gateway call cannot be aborted. Handing the desktop over at that moment
  // would put two threads on the same pointer, so the release waits for the call to drain.
  it("defers a release until the owner's in-flight call drains", async () => {
    const backend = new FakeComputerBackend();
    const manager = new ComputerManager({ backend });
    await manager.getThreadState("thread-a");
    await manager.getThreadState("thread-b");

    const started = deferred();
    const finish = deferred();
    const inFlight = manager.withAgentActivity("thread-a", async () => {
      await manager.click("thread-a", { x: 10, y: 10 });
      started.resolve();
      await finish.promise;
    });
    await started.promise;

    await manager.releaseDesktopControl("thread-a");

    await expect(manager.typeText("thread-b", "hi")).rejects.toThrow(/another conversation/);
    await expect(manager.getThreadState("thread-b")).resolves.toMatchObject({
      controlledByOtherThread: true,
    });

    finish.resolve();
    await inFlight;

    await expect(manager.getThreadState("thread-b")).resolves.toMatchObject({
      controlledByOtherThread: false,
    });
    await expect(manager.typeText("thread-b", "hi")).resolves.toMatchObject({
      action: "computer_type_text",
    });
    await expect(manager.click("thread-a", { x: 10, y: 10 })).rejects.toThrow(
      /another conversation/,
    );

    await manager.dispose();
  });

  it("does not tear down a renewed lease for a stale deferred release", async () => {
    const backend = new FakeComputerBackend();
    const manager = new ComputerManager({ backend });
    await manager.getThreadState("thread-a");
    await manager.getThreadState("thread-b");

    const started = deferred();
    const releaseRecorded = deferred();
    const finish = deferred();
    const inFlight = manager.withAgentActivity(
      "thread-a",
      async () => {
        await manager.click("thread-a", { x: 10, y: 10 });
        started.resolve();
        await releaseRecorded.promise;
        // Turn two renews the lease while turn one's release is still only recorded — the deferred release
        // must not tear the renewal down.
        await manager.withAgentActivity(
          "thread-a",
          () => manager.click("thread-a", { x: 11, y: 11 }),
          undefined,
          "turn-2",
        );
        await finish.promise;
      },
      undefined,
      "turn-1",
    );
    await started.promise;
    await manager.releaseDesktopControl("thread-a", "turn-1");
    releaseRecorded.resolve();
    finish.resolve();
    await inFlight;

    await expect(manager.getThreadState("thread-b")).resolves.toMatchObject({
      controlledByOtherThread: true,
    });
    await expect(manager.typeText("thread-b", "hi")).rejects.toThrow(/another conversation/);

    await manager.releaseDesktopControl("thread-a", "turn-2");
    await expect(manager.getThreadState("thread-b")).resolves.toMatchObject({
      controlledByOtherThread: false,
    });

    await manager.dispose();
  });

  it("does not let a queued thread-level release tear down a newer turn", async () => {
    const backend = Object.assign(new FakeComputerBackend(), {
      endTask: vi.fn(async () => {}),
    });
    const manager = new ComputerManager({ backend });
    const started = deferred();
    const finish = deferred();
    try {
      await manager.withAgentActivity(
        "thread-a",
        () => manager.click("thread-a", { x: 10, y: 10 }),
        undefined,
        "turn-old",
      );
      const blocker = manager.withAgentActivity("reader", async () => {
        started.resolve();
        await finish.promise;
      });
      await started.promise;
      const renewed = manager.withAgentActivity(
        "thread-a",
        () => manager.click("thread-a", { x: 20, y: 20 }),
        undefined,
        "turn-new",
      );
      const released = manager.releaseDesktopControl("thread-a");
      finish.resolve();
      await Promise.all([blocker, renewed, released]);
      expect(backend.endTask).toHaveBeenCalledExactlyOnceWith("thread-a", "turn-old");
      await expect(manager.typeText("thread-b", "second")).rejects.toMatchObject({
        code: "computer_controlled_by_other_thread",
      });
      await manager.releaseDesktopControl("thread-a", "turn-new");
      await expect(manager.typeText("thread-b", "second")).resolves.toMatchObject({
        action: "computer_type_text",
      });
    } finally {
      finish.resolve();
      await manager.dispose();
    }
  });

  it("expires an idle lease as a backstop, but never one whose owner is still acting", async () => {
    const backend = new FakeComputerBackend();
    let nowMs = 0;
    const manager = new ComputerManager({
      backend,
      now: () => nowMs,
      leaseIdleMs: 1_000,
    });
    await manager.getThreadState("thread-a");

    await manager.click("thread-a", { x: 10, y: 10 });
    nowMs = 999;
    await expect(manager.click("thread-b", { x: 20, y: 20 })).rejects.toThrow(
      /another conversation/,
    );

    nowMs = 10_000;
    const started = deferred();
    const finish = deferred();
    const inFlight = manager.withAgentActivity("thread-a", async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;
    await expect(manager.click("thread-b", { x: 20, y: 20 })).rejects.toThrow(
      /another conversation/,
    );
    finish.resolve();
    await inFlight;

    await expect(manager.click("thread-b", { x: 20, y: 20 })).resolves.toMatchObject({
      action: "computer_click",
    });
    await expect(manager.click("thread-a", { x: 10, y: 10 })).rejects.toThrow(
      /another conversation/,
    );

    await manager.dispose();
  });

  it("drops late frames and state updates after a thread is removed", async () => {
    const backend = new FakeComputerBackend();
    const manager = new ComputerManager({ backend });
    const sink = new RecordingSink();
    const unsubscribe = manager.subscribeFrames(sink);
    await manager.flushStreamTransitions();
    await manager.getThreadState("thread-removed");
    await manager.handleThreadRemoved("thread-removed");

    backend.emitFrame(false, false, Uint8Array.of(9));
    await expect(
      manager.withAgentActivity("thread-removed", async () => undefined),
    ).rejects.toThrow("revoked");
    await manager.recordThreadError("thread-removed", "late error");

    const threads = (manager as unknown as { threads: Map<string, unknown> }).threads;
    expect(threads.has("thread-removed")).toBe(false);

    unsubscribe();
    await manager.dispose();
  });

  it("refuses a window-scoped click when the desktop reports no geometry", async () => {
    const backend = new FakeComputerBackend({
      windows: [
        {
          id: "boundless",
          title: "Calculator",
          appName: "org.kde.kcalc",
          focused: true,
          minimized: false,
          visible: true,
        },
      ],
    });
    const manager = new ComputerManager({ backend });

    await expect(
      manager.click("thread-1", { x: 100, y: 100, windowId: "boundless" }),
    ).rejects.toMatchObject({ code: "computer_target_offscreen" });
    expect(backend.callsFor("click")).toHaveLength(0);
    await manager.dispose();
  });

  it("observes only the agent's focus target after an untargeted action, never the active window", async () => {
    const backend = new FakeComputerBackend();
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });

    backend.emitWindowsChanged([
      {
        id: "human-browser",
        title: "Browser",
        bounds: { x: 100, y: 100, width: 1_200, height: 800 },
        focused: false,
        active: true,
        minimized: false,
        visible: true,
        stackingIndex: 0,
      },
    ]);
    const observed = await manager.captureActionScreenshot();
    expect(observed !== undefined && "windowId" in observed ? observed.windowId : undefined).toBe(
      undefined,
    );
    expect(backend.callsFor("captureScreenshot").at(-1)?.args[0]).toMatchObject({
      kind: "region",
    });

    const perception = await manager.captureFocusedWindow();
    expect(perception.windowId).toBe("human-browser");

    await manager.dispose();
  });

  it("resolves overlapping point candidates by stacking order and refuses to guess without one", async () => {
    const backend = new FakeComputerBackend();
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });
    const overlapping = (stacked: boolean): ComputerWindow[] => [
      {
        id: "under",
        title: "Under",
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        focused: false,
        minimized: false,
        visible: true,
        ...(stacked ? { stackingIndex: 1 } : {}),
      },
      {
        id: "over",
        title: "Over",
        bounds: { x: 300, y: 200, width: 400, height: 300 },
        focused: false,
        minimized: false,
        visible: true,
        ...(stacked ? { stackingIndex: 0 } : {}),
      },
    ];

    backend.emitWindowsChanged(overlapping(true));
    const observed = await manager.captureActionScreenshot(undefined, {
      x: 400,
      y: 300,
    });
    expect(observed !== undefined && "windowId" in observed ? observed.windowId : undefined).toBe(
      "over",
    );

    backend.emitWindowsChanged(overlapping(false));
    const widened = await manager.captureActionScreenshot(undefined, {
      x: 400,
      y: 300,
    });
    expect(widened !== undefined && "windowId" in widened ? widened.windowId : undefined).toBe(
      undefined,
    );
    expect(backend.callsFor("captureScreenshot").at(-1)?.args[0]).toMatchObject({
      kind: "region",
    });

    await manager.dispose();
  });

  it("downscales large action observations while keeping the coordinate mapping exact", async () => {
    const tall = COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION + 1_000;
    const backend = new FakeComputerBackend({
      screenSize: { width: 3_000, height: tall + 400, scale: 1 },
      windows: [
        {
          id: "fake-editor",
          title: "Editor",
          bounds: { x: 100, y: 100, width: 1_280, height: tall },
          focused: true,
          minimized: false,
          visible: true,
        },
      ],
    });
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });

    const observed = await manager.captureActionScreenshot("fake-editor");
    expect(backend.callsFor("captureScreenshot").at(-1)?.args[0]).toEqual({
      kind: "window",
      windowId: "fake-editor",
      maxDimension: COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION,
    });
    if (observed === undefined || !("screenshot" in observed)) {
      throw new Error("the action observation carried no screenshot");
    }
    const { region, scale, width, height } = observed.screenshot;

    expect(scale).toBeCloseTo(COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION / tall, 10);
    expect(region).toEqual({ x: 100, y: 100, width: 1_280, height: tall });

    if (region === undefined || scale === undefined) throw new Error("no coordinate mapping");
    expect(region.x + width / 2 / scale).toBeCloseTo(region.x + region.width / 2, 0);
    expect(region.y + height / 2 / scale).toBeCloseTo(region.y + region.height / 2, 0);

    await manager.captureFocusedWindow();
    expect(backend.callsFor("captureScreenshot").at(-1)?.args[0]).toEqual({
      kind: "window",
      windowId: "fake-editor",
    });

    await manager.dispose();
  });

  // A manager whose travel measurement is scripted, so the tests exercise the closed loop rather than
  // the correlator (which has its own unit tests). Each queued screenshot makes one capture's bytes
  // differ from the last, because byte-identical captures short-circuit to "did not move" before
  // measuring.
  function calibratedScrollFixture(
    travels: readonly (number | undefined)[],
    backend = new FakeComputerBackend(),
  ) {
    const measured: number[] = [];
    const manager = new ComputerManager({
      backend,
      actionSettleMs: 0,
      measureScrollTravel: () => travels[measured.push(0) - 1],
    });
    backend.queueScreenshots(Array.from({ length: 12 }, (_unused, index) => `capture-${index}`));
    return { backend, manager, measurements: measured };
  }

  it("converts measured travel out of capture pixels before reporting or learning it", async () => {
    const backend = new FakeComputerBackend({
      windows: [
        {
          id: "fake-browser",
          title: "Browser",
          bounds: { x: 0, y: 0, width: 1_920, height: 1_080 },
          focused: true,
          minimized: false,
          visible: true,
          stackingIndex: 0,
        },
      ],
    });
    const { manager } = calibratedScrollFixture([800], backend);

    const result = await manager.scrollCalibrated("thread-1", { x: 900, y: 500 }, 0, 40, {
      observe: true,
    });

    expect(result.result.scroll?.traveledY).toBe(1_000);
    expect(result.result.scroll?.gearing).toBe(25);

    await manager.dispose();
  });

  it("suppresses a wrong-way measurement instead of reporting or learning it", async () => {
    const { backend, manager } = calibratedScrollFixture([-752, undefined]);

    const result = await manager.scrollCalibrated("thread-1", { x: 1_100, y: 200 }, 0, 100, {
      observe: true,
    });

    expect(result.result.scroll?.traveledY).toBeUndefined();
    expect(result.result.scroll?.gearing).toBe(1);
    expect(backend.callsFor("scroll").map((entry) => entry.args[2])).toEqual([48, 52]);

    await manager.dispose();
  });

  describe("the scroll-leg conditional settle", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    function settleScrollFixture(
      travels: readonly (number | undefined)[],
      backend = new FakeComputerBackend(),
      screenshotCount = 16,
    ) {
      const queue = [...travels];
      const manager = new ComputerManager({
        backend,
        actionSettleMs: 60,
        measureScrollTravel: () => queue.shift(),
      });
      backend.queueScreenshots(
        Array.from({ length: screenshotCount }, (_unused, index) => `capture-${index}`),
      );
      return { backend, manager };
    }

    const settleWaited = (spy: {
      readonly mock: { readonly calls: readonly (readonly unknown[])[] };
    }) => spy.mock.calls.filter((call) => call[1] === 60).length;

    const teachGearing = async (manager: ComputerManager) => {
      await manager.scrollCalibrated("thread-1", { x: 1_100, y: 200 }, 0, 400, { observe: true });
    };

    it("does not let a waived settle upgrade a dispatched-unknown verdict", async () => {
      vi.stubEnv("GLADE_CUA_CONDITIONAL_SETTLE", "1");
      class UnknownScrollBackend extends FakeComputerBackend {
        override async scroll(...args: Parameters<FakeComputerBackend["scroll"]>) {
          await super.scroll(...args);
          return {
            deliveryPath: "fake-scroll",
            verified: "unconfirmed" as const,
            effect: "dispatched-unknown" as const,
          };
        }
      }
      const { manager } = settleScrollFixture([336, 64, 400], new UnknownScrollBackend());
      await teachGearing(manager);
      const spy = vi.spyOn(globalThis, "setTimeout");

      const result = await manager.scrollCalibrated("thread-1", { x: 1_100, y: 200 }, 0, 400, {
        observe: true,
      });

      expect(settleWaited(spy)).toBe(0);
      expect(result.result.scroll?.traveledY).toBe(400);
      expect(result.result.delivery).toEqual({
        path: "fake-scroll",
        verified: "unconfirmed",
        effect: "dispatched-unknown",
      });

      await manager.dispose();
    });
  });
});

it("holds refused input until a scoped observation establishes readiness", async () => {
  class PausedBackend extends FakeComputerBackend {
    ready = false;
    attempts = 0;
    checks = 0;
    override async typeText(text: string) {
      this.attempts += 1;
      if (!this.ready)
        throw new ComputerBackendError("Return to the target window.", {
          inputPause: {
            windowId: "fake-calculator",
            message: "Return to the target window.",
          },
        });
      return super.typeText(text);
    }
    async checkInputReady() {
      this.checks += 1;
      if (!this.ready) throw new Error("still unavailable");
    }
  }
  const backend = new PausedBackend();
  const manager = new ComputerManager({ backend });
  await expect(manager.typeText("thread-a", "hello")).rejects.toHaveProperty("inputPause");
  await expect(manager.typeText("thread-a", "hello")).rejects.toHaveProperty("inputPause");
  expect(backend.attempts).toBe(1);
  expect((await manager.getThreadState("thread-a")).inputPause?.windowId).toBe("fake-calculator");
  await manager.releaseDesktopControl("thread-a");
  expect((await manager.getState({ windowId: "fake-calculator" })).inputPause).toBeDefined();
  expect(backend.checks).toBe(1);
  expect((await manager.getThreadState("thread-a")).inputPause).toBeDefined();
  backend.ready = true;
  await manager.getState({ windowId: "different-window" });
  expect(backend.checks).toBe(1);
  await manager.getState({ windowId: "fake-calculator" });
  expect((await manager.getThreadState("thread-a")).inputPause).toBeUndefined();
  await manager.typeText("thread-a", "hello");
  expect(backend.attempts).toBe(2);
  await manager.dispose();
});

it("pauses calibrated scrolling before any second input or launch and preserves pause during idle eviction", async () => {
  const backend = new FakeComputerBackend();
  const manager = new ComputerManager({ backend });
  const pause = {
    windowId: "fake-calculator",
    message: "Return this window to the current Space.",
  };
  const scroll = backend.scroll.bind(backend);
  let attempts = 0;
  backend.scroll = async (...args: Parameters<typeof scroll>) => {
    attempts += 1;
    if (attempts === 1) throw new ComputerBackendError(pause.message, { inputPause: pause });
    return scroll(...args);
  };
  await expect(
    manager.scrollCalibrated("paused", { windowId: "fake-calculator" }, 0, 40, {
      observe: false,
    }),
  ).rejects.toHaveProperty("inputPause");
  await manager.releaseDesktopControl("paused");
  for (let i = 0; i < 260; i += 1) await manager.getThreadState(`other-${i}`);
  expect((await manager.getThreadState("paused")).inputPause).toEqual(pause);
  await expect(
    manager.scrollCalibrated("paused", null, 0, 40, { observe: false }),
  ).rejects.toHaveProperty("inputPause");
  await expect(manager.launchApp("paused", "Calculator")).rejects.toHaveProperty("inputPause");
  expect(attempts).toBe(1);
  expect(backend.callsFor("launchApp")).toHaveLength(0);
  await manager.dispose();
});

it("refuses detached input after its original operation ends while allowing a fresh admitted call", async () => {
  const backend = new FakeComputerBackend();
  const manager = new ComputerManager({ backend });
  const release = deferred();
  let detached!: Promise<unknown>;
  await manager.withAgentActivity(
    "owner",
    async () => {
      detached = release.promise.then(() => manager.typeText("owner", "stale input"));
    },
    undefined,
    "old-turn",
  );
  const refused = expect(detached).rejects.toThrow("operation has ended");
  release.resolve();
  await refused;
  expect(backend.callsFor("typeText")).toHaveLength(0);
  await manager.withAgentActivity(
    "owner",
    () => manager.typeText("owner", "fresh input"),
    undefined,
    "new-turn",
  );
  expect(backend.callsFor("typeText")).toHaveLength(1);
  await manager.dispose();
});

it("never re-admits a detached tool continuation after revocation and re-enable", async () => {
  const backend = new FakeComputerBackend();
  const manager = new ComputerManager({ backend });
  const release = deferred();
  let detached!: Promise<unknown>;
  await manager.withAgentActivity("owner", async () => {
    detached = release.promise.then(() =>
      manager.withAgentActivity("owner", () => manager.typeText("owner", "stale input")),
    );
  });
  await manager.setControlEnabled("owner", false);
  await manager.setControlEnabled("owner", true);
  const refused = expect(detached).rejects.toThrow("operation has ended");
  release.resolve();
  await refused;
  expect(backend.callsFor("typeText")).toHaveLength(0);
  await manager.dispose();
});

function foregroundRestoreActions(manager: ComputerManager): Array<Record<string, unknown>> {
  const actions: Array<Record<string, unknown>> = [];
  manager.onEvent((event) => {
    if (event.type === "computer.action") actions.push({ ...event });
  });
  return actions;
}

function foregroundRaisedIds(backend: FakeComputerBackend): readonly unknown[] {
  return backend.callsFor("raiseWindow").map((call) => call.args[0]);
}

const VISIBLE_USE_AUTHORIZED = { userRequestedVisibleUse: true } as const;

describe("ComputerManager foreground containment", () => {
  it("refuses the raise while the user was just interacting through the pane, then allows it after quiet", async () => {
    const backend = new FakeComputerBackend();
    let clock = 1_000_000;
    const manager = new ComputerManager({
      backend,
      actionSettleMs: 0,
      now: () => clock,
    });
    try {
      await manager.click(undefined, { x: 100, y: 100 });
      const refused = await manager
        .foregroundWithRestore("thread-1", "fake-calculator", undefined, VISIBLE_USE_AUTHORIZED)
        .catch((error) => error);
      expect(refused).toMatchObject({
        code: "foreground_user_interaction",
        effect: "not-dispatched",
      });
      expect(foregroundRaisedIds(backend)).toEqual([]);

      clock += 2_001;
      const result = await manager.foregroundWithRestore(
        "thread-1",
        "fake-calculator",
        undefined,
        VISIBLE_USE_AUTHORIZED,
      );
      expect(result.windowId).toBe("fake-calculator");
      expect(foregroundRaisedIds(backend)).toEqual(["fake-calculator", "fake-terminal"]);
    } finally {
      await manager.dispose();
    }
  });
});

describe("ComputerManager foregroundWithRestore", () => {
  it("restores the previously frontmost window after raising the target", async () => {
    const backend = new FakeComputerBackend();
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });
    const actions = foregroundRestoreActions(manager);
    try {
      const result = await manager.foregroundWithRestore(
        "thread-1",
        "fake-calculator",
        undefined,
        VISIBLE_USE_AUTHORIZED,
      );
      expect(result.windowId).toBe("fake-calculator");
      expect(result.note).toBeUndefined();
      expect(foregroundRaisedIds(backend)).toEqual(["fake-calculator", "fake-terminal"]);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        action: "computer_activate_window",
        windowId: "fake-calculator",
        restoredWindowId: "fake-terminal",
        restoreStatus: "restored",
      });
      expect(actions[0]).not.toHaveProperty("message");
    } finally {
      await manager.dispose();
    }
  });

  it("still restores when the approved input fails, then reports the input failure", async () => {
    const backend = new FakeComputerBackend();
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });
    const actions = foregroundRestoreActions(manager);
    try {
      await expect(
        manager.foregroundWithRestore(
          "thread-1",
          "fake-calculator",
          async () => {
            throw new Error("input blew up");
          },
          VISIBLE_USE_AUTHORIZED,
        ),
      ).rejects.toThrow("input blew up");

      expect(foregroundRaisedIds(backend)).toEqual(["fake-calculator", "fake-terminal"]);
      expect(actions).toHaveLength(0);
    } finally {
      await manager.dispose();
    }
  });
});

describe("ComputerManager masked activation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function armMaskedActivation(apps = "org.kde.kcalc"): void {
    vi.stubEnv("GLADE_CUA_MASKED_ACTIVATION", "1");
    vi.stubEnv("GLADE_CUA_MASKED_APPS", apps);
  }

  function shieldedMacBackend(
    options: ConstructorParameters<typeof FakeComputerBackend>[0] = {},
  ): FakeComputerBackend {
    return new FakeComputerBackend({ agentDialect: "macos", shield: true, ...options });
  }

  function shieldExcursionOrder(backend: FakeComputerBackend): readonly string[] {
    return backend.calls
      .filter((call) => ["engageShield", "raiseWindow", "releaseShield"].includes(call.method))
      .map((call) =>
        call.method === "raiseWindow" ? `${call.method}:${String(call.args[0])}` : call.method,
      );
  }

  it("shields the opted-in window's raise and releases the mask after the restore", async () => {
    armMaskedActivation();
    const backend = shieldedMacBackend();
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });
    const actions = foregroundRestoreActions(manager);
    try {
      const result = await manager.foregroundWithRestore(
        "thread-1",
        "fake-calculator",
        undefined,
        VISIBLE_USE_AUTHORIZED,
      );
      expect(result.windowId).toBe("fake-calculator");

      expect(shieldExcursionOrder(backend)).toEqual([
        "engageShield",
        "raiseWindow:fake-calculator",
        "raiseWindow:fake-terminal",
        "releaseShield",
      ]);
      const engage = backend.callsFor("engageShield")[0]!;
      expect(engage.args[0]).toMatchObject({
        windowId: "fake-calculator",
        frame: { x: 1_050, y: 120, width: 420, height: 620 },
        label: "Glade is activating Calculator",
      });
      const shieldId = (engage.args[0] as { shieldId: string }).shieldId;
      expect(shieldId).toMatch(/^shield-[0-9a-f]{8}$/);

      expect(backend.callsFor("releaseShield").map((call) => call.args[0])).toEqual([shieldId]);
      expect(backend.activeShields()).toEqual([]);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        action: "computer_activate_window",
        masked: true,
        restoreStatus: "restored",
      });
    } finally {
      await manager.dispose();
    }
  });

  it("refuses the activation when the opt-in is armed but no shield surface exists", async () => {
    armMaskedActivation();
    // A macOS backend whose host build lacks the shield command: the armed opt-in must fail closed
    // rather than degrade to a visible raise.
    const backend = new FakeComputerBackend({ agentDialect: "macos" });
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });
    try {
      await expect(
        manager.foregroundWithRestore(
          "thread-1",
          "fake-calculator",
          undefined,
          VISIBLE_USE_AUTHORIZED,
        ),
      ).rejects.toThrow("activation shield is unavailable");
      expect(foregroundRaisedIds(backend)).toEqual([]);
    } finally {
      await manager.dispose();
    }
  });

  it("drops the shield when the masked excursion itself fails", async () => {
    armMaskedActivation();
    const backend = shieldedMacBackend();
    backend.raiseWindow = async () => {
      throw new ComputerBackendError("The window closed.");
    };
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });
    try {
      await expect(
        manager.foregroundWithRestore(
          "thread-1",
          "fake-calculator",
          undefined,
          VISIBLE_USE_AUTHORIZED,
        ),
      ).rejects.toThrow("window closed");

      expect(backend.callsFor("releaseShield")).toHaveLength(1);
      expect(backend.activeShields()).toEqual([]);
    } finally {
      await manager.dispose();
    }
  });
});

it("an action resolving after thread removal does not resurrect the thread's state", async () => {
  const pending = deferred();
  const backend = Object.assign(new FakeComputerBackend(), {
    launchApp: vi.fn(async () => {
      await pending.promise;
      return { computerId: "desktop", app: "kcalc", window: null };
    }),
  });
  const manager = new ComputerManager({ backend, actionSettleMs: 0 });
  const events: ComputerEvent[] = [];
  manager.onEvent((event) => events.push(event));

  const launching = manager.launchApp("removed-thread", "kcalc").catch(() => undefined);
  await vi.waitFor(() => expect(backend.launchApp).toHaveBeenCalled());
  const removing = manager.handleThreadRemoved("removed-thread");
  pending.resolve();
  await Promise.allSettled([launching, removing]);

  expect(events.some((event) => event.type === "computer.open-pane-requested")).toBe(false);
  const statesBefore = events.filter((event) => event.type === "computer.thread-state").length;
  const state = await manager.getThreadState("removed-thread");
  expect(state.agentActive).toBe(false);
  expect(events.filter((event) => event.type === "computer.thread-state")).toHaveLength(
    statesBefore,
  );
  await manager.dispose();
});

it("thread removal completes on a wedged stop — the teardown wait is bounded", async () => {
  const backend = Object.assign(new FakeComputerBackend(), {
    stopInput: vi.fn(() => new Promise<void>(() => {})),
  });
  const manager = new ComputerManager({ backend, actionSettleMs: 0 });
  await manager.launchApp("wedged", "kcalc");
  vi.useFakeTimers();
  try {
    const removing = manager.handleThreadRemoved("wedged");
    // The host never answers stopInput: only the teardown bound lets the removal finish — the tombstone
    // and deletions are already held.
    await vi.advanceTimersByTimeAsync(COMPUTER_CONTROL_ENABLE_TIMEOUT_MS + 1_000);
    await removing;
    expect(backend.stopInput).toHaveBeenCalled();
    const disposing = manager.dispose();
    await vi.advanceTimersByTimeAsync(COMPUTER_CONTROL_ENABLE_TIMEOUT_MS * 2 + 2_000);
    await disposing;
  } finally {
    vi.useRealTimers();
  }
});
