import { type CuaReply } from "@glade/shared/computer/cuaDriverProtocol";
import { describe, expect, it, vi } from "vitest";
import {
  capability,
  cuaRequest,
  deferred,
  fixture,
  foregroundCollision,
  waitForEvent,
} from "./cuaHostFixture";
import { ESCAPE_INPUT_COOLDOWN_MS } from "./cuaHostPolicy";
import type { ComputerInputMonitorState } from "./escapeKillSwitchMonitor";
describe("physical Escape interrupt", () => {
  const pressKey = (endpoint: string) =>
    cuaRequest<CuaReply>(endpoint, {
      method: "call",
      name: "press_key",
      args: { key: "enter" },
    });

  it("drains native input, keeps the generation, and requires fresh observation after Escape", async () => {
    let releaseCalls = 0;
    const f = await fixture(capability, {
      releaseHeldInput: async () => {
        releaseCalls += 1;
      },
    });

    await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true });

    // The fake driver holds a type_text reply for 10s — the wedged-provider shape the interrupt exists
    // for. The press must not wait on it.
    const hung = cuaRequest(
      f.endpoint,
      { method: "call", name: "type_text", args: { text: "fixture" } },
      { timeoutMs: 5_000, mutation: true },
    );
    await waitForEvent(f, "dispatch");
    expect(f.host.emergencyStopInput()).toBe(true);

    await expect(hung).resolves.toMatchObject({ ok: false });
    await waitForEvent(f, "interrupt-ack");
    expect(releaseCalls).toBe(0);
    const mid = await f.events();
    expect(mid.some((event) => event.event === "interrupt")).toBe(true);
    expect(mid.filter((event) => event.event === "release")).toHaveLength(1);
    expect(mid.some((event) => event.event === "effect")).toBe(false);
    expect(mid.some((event) => event.event === "cancel")).toBe(false);
    expect(mid.some((event) => event.event === "retiring")).toBe(false);
    expect(mid.filter((event) => event.event === "start")).toHaveLength(1);

    await expect(pressKey(f.endpoint)).resolves.toMatchObject({
      ok: true,
      result: {
        isError: true,
        structuredContent: { effect: "refused", code: "computer_input_paused" },
      },
    });
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "list_windows" }),
    ).resolves.toMatchObject({ ok: true });

    await new Promise((resolve) => setTimeout(resolve, ESCAPE_INPUT_COOLDOWN_MS + 50));
    await expect(pressKey(f.endpoint)).resolves.toMatchObject({
      result: { structuredContent: { code: "computer_input_paused" } },
      desktopInterruptions: 0,
    });
    await cuaRequest(f.endpoint, { method: "call", name: "get_window_state" });
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "check_input_ready" }),
    ).resolves.toMatchObject({ result: { isError: true } });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_window_state",
      modelObservation: true,
    });
    await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true, result: {} });
    const after = await f.events();
    expect(after.filter((event) => event.event === "start")).toHaveLength(1);
    expect(after.filter((event) => event.event === "key")).toHaveLength(2);
    expect(after.some((event) => event.event === "retiring")).toBe(false);
  });

  it("keeps admission closed after a driver crash until the held-input release is confirmed", async () => {
    const release = deferred<void>();
    const f = await fixture(capability, {
      crash: true,
      releaseHeldInput: async () => {
        await release.promise;
      },
    });

    const crashing = cuaRequest(
      f.endpoint,
      { method: "call", name: "type_text", args: { text: "fixture" } },
      { timeoutMs: 5_000, mutation: true },
    );
    await waitForEvent(f, "crash");
    expect(f.host.emergencyStopInput()).toBe(true);

    release.resolve();
    await expect(crashing).resolves.toMatchObject({ ok: false });

    await f.host.stop();

    await new Promise((resolve) => setTimeout(resolve, ESCAPE_INPUT_COOLDOWN_MS + 50));
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_window_state",
      modelObservation: true,
    });
    await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true, result: {} });
  });

  it("keeps input closed after an incomplete native interrupt and rechecks the drain before dispatch", async () => {
    const releaseHeldInput = vi.fn(async () => {});
    const f = await fixture(capability, { interruptCleanup: "once-incomplete", releaseHeldInput });
    await pressKey(f.endpoint);
    await expect(cuaRequest(f.endpoint, { method: "stop" })).resolves.toMatchObject({ ok: false });
    expect(releaseHeldInput).toHaveBeenCalledTimes(1);
    expect((await f.events()).filter((event) => event.event === "key")).toHaveLength(1);
    await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true, result: {} });
    const events = (await f.events()).map((event) => event.event);
    expect(events.filter((event) => event === "interrupt")).toHaveLength(2);
    expect(events.filter((event) => event === "key")).toHaveLength(2);
    expect(events.lastIndexOf("interrupt-ack")).toBeLessThan(events.lastIndexOf("key"));
    expect(events.filter((event) => event === "start")).toHaveLength(1);
  });

  it.each(["wrong-pid", "missing-admission", "incomplete"] as const)(
    "never resumes input on a %s interruption acknowledgement",
    async (interruptCleanup) => {
      const f = await fixture(capability, { interruptCleanup });
      await pressKey(f.endpoint);
      await expect(cuaRequest(f.endpoint, { method: "stop" })).resolves.toMatchObject({
        ok: false,
      });
      await expect(pressKey(f.endpoint)).resolves.toMatchObject({
        ok: false,
        effect: "not-dispatched",
      });
      expect((await f.events()).filter((event) => event.event === "key")).toHaveLength(1);
    },
  );

  it("interrupts foreground input even when the physical event belongs to a different app", async () => {
    const f = await fixture();
    const hung = cuaRequest(
      f.endpoint,
      {
        method: "call",
        name: "type_text",
        args: { pid: 700, window_id: 900, delivery_mode: "foreground", text: "fixture" },
      },
      { mutation: true },
    );
    await waitForEvent(f, "dispatch");
    expect(f.host.physicalInput({ type: "physical-input", kind: "keyboard", pid: 701 })).toBe(true);
    await expect(hung).resolves.toMatchObject({ ok: false, effect: "dispatched-unknown" });
    await waitForEvent(f, "interrupt-ack");
    expect((await f.events()).filter((event) => event.event === "release")).toHaveLength(1);
  });

  it("starts listener activation only on use and disarms it when the last task ends", async () => {
    let state: ComputerInputMonitorState = { ready: false, error: "input_monitor_idle" };
    const activateInputMonitor = vi.fn(async () => {
      state = { ready: true };
    });
    const onInputMonitorArmedChange = vi.fn((armed: boolean) => {
      if (!armed) state = { ready: false, error: "input_monitor_idle" };
    });
    const f = await fixture(capability, {
      activateInputMonitor,
      onInputMonitorArmedChange,
      inputMonitorState: () => state,
    });
    expect(activateInputMonitor).not.toHaveBeenCalled();
    const task = { threadId: "activation", turnId: "turn" };
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "press_key",
      args: { key: "enter" },
      task,
    });
    expect(activateInputMonitor).toHaveBeenCalledTimes(1);
    await cuaRequest(f.endpoint, { method: "end_task", task });
    expect(onInputMonitorArmedChange).toHaveBeenLastCalledWith(false);
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "press_key",
      args: { key: "enter" },
      task: { ...task, turnId: "next" },
    });
    expect(activateInputMonitor).toHaveBeenCalledTimes(2);
    expect((await f.events()).filter((event) => event.event === "key")).toHaveLength(2);
  });

  it.each(["type_text", "browser_type"])(
    "drains already-dispatched %s when its caller disconnects, without replay or replacement",
    async (name) => {
      const f = await fixture(capability, { browserHang: true, inputDelayMs: 150 });
      const controller = new AbortController();
      const call = cuaRequest(
        f.endpoint,
        {
          method: "call",
          name,
          args: { text: "fixture" },
          task: { threadId: "disconnect", turnId: "turn" },
        },
        { mutation: true, signal: controller.signal },
      ).catch((error: unknown) => error);
      await waitForEvent(f, name === "browser_type" ? "browser-dispatch" : "dispatch");
      controller.abort();
      expect(await call).toMatchObject({ effect: "dispatched-unknown" });
      await waitForEvent(f, "interrupt");

      await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true, result: {} });
      await new Promise((resolve) => setTimeout(resolve, 180));
      const events = (await f.events()).map((event) => event.event);
      expect(events.filter((event) => event === "release")).toHaveLength(1);
      expect(events.filter((event) => event === "start")).toHaveLength(1);
      expect(events.indexOf("key")).toBeGreaterThan(events.indexOf("interrupt-ack"));
      expect(events).not.toContain("effect");
      expect(events).not.toContain("browser-effect");
    },
  );

  it("requires a live Escape listener for browser mutations but keeps browser reads available", async () => {
    let state: ComputerInputMonitorState = { ready: false, error: "event_tap_unavailable" };
    const f = await fixture(capability, { inputMonitorState: () => state });
    const task = { threadId: "listener-browser", turnId: "turn" };
    const action = () =>
      cuaRequest(f.endpoint, { method: "call", name: "browser_navigate", args: {}, task });
    await expect(action()).resolves.toMatchObject({
      result: { structuredContent: { code: "input_monitor_unavailable" } },
    });
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "get_browser_state", args: {}, task }),
    ).resolves.toMatchObject({ ok: true, result: {} });
    state = { ready: true };
    await expect(action()).resolves.toMatchObject({ ok: true, result: {} });
    expect(
      (await f.events()).filter((event) => event.event.startsWith("browser:browser_navigate:")),
    ).toHaveLength(1);
  });

  it("does not let another task, window, preview, or mismatched read clear native takeover", async () => {
    const f = await fixture();
    const taskA = { threadId: "task-a", turnId: "turn" };
    const taskB = { threadId: "task-b", turnId: "turn" };
    const windowA = { pid: 701, window_id: 901 };
    const windowB = { pid: 700, window_id: 900 };
    const observe = (task: typeof taskA, args: Record<string, unknown>, modelObservation = true) =>
      cuaRequest(f.endpoint, {
        method: "call",
        name: "get_window_state",
        args,
        modelObservation,
        task,
      });
    const click = (task: typeof taskA, args: Record<string, unknown>) =>
      cuaRequest(f.endpoint, {
        method: "call",
        name: "press_key",
        args: { ...args, key: "enter" },
        task,
      });
    await observe(taskA, windowA);
    await observe(taskB, windowB);
    await foregroundCollision(f, taskB, windowB);
    await observe(taskA, windowB);
    await observe(taskB, windowA);
    await observe(taskB, windowB, false);
    await observe(taskB, { ...windowB, fixture_wrong_window: true });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_desktop_state",
      modelObservation: true,
      task: taskB,
    });
    await new Promise((resolve) => setTimeout(resolve, ESCAPE_INPUT_COOLDOWN_MS + 50));
    await expect(click(taskA, windowA)).resolves.toMatchObject({ ok: true, result: {} });
    await expect(click(taskB, windowB)).resolves.toMatchObject({
      result: { structuredContent: { code: "computer_input_paused" } },
      desktopInterruptions: 0,
    });
    await observe(taskB, windowB);
    await expect(click(taskB, windowB)).resolves.toMatchObject({ ok: true, result: {} });
  });

  it("fences input after uncertain focus restoration until a fresh model observation", async () => {
    const result = {
      isError: true,
      structuredContent: { effect: "unverifiable", code: "focus_restore_failed" },
    };
    const f = await fixture(capability, { actionResult: result });
    const task = { threadId: "restore-failure", turnId: "turn" };
    const target = { pid: 700, window_id: 900 };
    const act = () =>
      cuaRequest<CuaReply>(f.endpoint, {
        method: "call",
        name: "press_key",
        args: { ...target, key: "enter" },
        task,
      });
    const read = (modelObservation: boolean) =>
      cuaRequest(f.endpoint, {
        method: "call",
        name: "get_window_state",
        args: target,
        modelObservation,
        task,
      });
    expect((await act()).result).toEqual(result);
    await read(false);
    expect((await act()).result?.structuredContent?.code).toBe("computer_input_paused");
    expect((await f.events()).filter((e) => e.event === "key")).toHaveLength(1);
    await read(true);

    expect((await act()).result).toEqual(result);
    expect((await f.events()).filter((e) => e.event === "key")).toHaveLength(2);
  });

  it("keeps Escape browser recovery separate from native reads and rejects an interrupted browser snapshot", async () => {
    const f = await fixture(capability, {
      browserObservations: true,
      delayBrowserObservation: true,
    });
    const task = { threadId: "browser-escape", turnId: "turn" };
    const window = { pid: 700, window_id: 900 };
    const browser = { target_id: "target-700-900", tab_id: "tab-a" };
    await cuaRequest(f.endpoint, { method: "call", name: "get_browser_state", args: window, task });
    expect(f.host.emergencyStopInput()).toBe(true);
    await waitForEvent(f, "interrupt-ack");
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_desktop_state",
      modelObservation: true,
      task,
    });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      args: window,
      modelObservation: true,
      task,
    });
    const reading = cuaRequest(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      args: browser,
      modelObservation: true,
      task,
    });
    await waitForEvent(f, "browser-observe");
    expect(f.host.emergencyStopInput()).toBe(true);
    await expect(reading).resolves.toMatchObject({
      result: { structuredContent: { code: "computer_input_paused" } },
    });
    await new Promise((resolve) => setTimeout(resolve, ESCAPE_INPUT_COOLDOWN_MS + 50));
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "browser_navigate", args: browser, task }),
    ).resolves.toMatchObject({ result: { isError: true } });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      args: browser,
      modelObservation: true,
      task,
    });
    expect(
      (
        await cuaRequest<CuaReply>(f.endpoint, {
          method: "call",
          name: "browser_navigate",
          args: browser,
          task,
        })
      ).result,
    ).toEqual({});
  });
});
