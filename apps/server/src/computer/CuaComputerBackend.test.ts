import { describe, expect, it, vi } from "vitest";
import { CuaComputerBackend } from "./CuaComputerBackend.ts";
import { ComputerScreenshot } from "@glade/contracts";
import { Effect, Schema } from "effect";
import { CuaTransportError, type cuaRequest } from "@glade/shared/cuaDriverProtocol";
import { ComputerManager } from "./ComputerManager.ts";

import { withDesktopDeliveryMode } from "./DesktopOperationQueue.ts";

import { makeAgentGatewayComputerTools } from "../agentGateway/computerTools.ts";
import type { ToolContext } from "../agentGateway/toolRuntime.ts";

const isTyping = (name?: string) => name === "type_text";

function fixture(options?: {
  readonly semanticTextLaneHoldMs?: number;
  readonly semanticTextLaneGapMs?: number;
  readonly stillIntervalMs?: number;
  readonly hostPlatform?: string;
  readonly nativeRevision?: number | null;
}) {
  const calls: Array<{
    name?: string;
    args?: Record<string, unknown>;
    modelObservation?: boolean;
    deliveryMode?: string;
  }> = [];
  let bounds = { x: -300, y: 20, width: 200, height: 100 };
  let live = true;
  let elements: Record<string, unknown>[] = [];
  let failure: Error | undefined;
  let nativeRefusal = false;
  let desktopPaused = false;
  let desktopEpoch = 0;
  let missingPermissions = false;
  let screenRecordingMissing = false;
  let monitorPermissions: Record<string, unknown> = {};
  let permissionWait: Promise<void> | undefined;
  let overviewFailure = false;
  let captureWindowId = 20;
  let capturePid = 10;
  let captureFrameValid = true;
  let captureFrameFreshness = "captured_current_space";
  let visible = true;
  let ready: Record<string, unknown> = { ready: true, pid: 10, window_id: 20 };
  let afterCapture: (() => void) | undefined;
  let overviewWait: Promise<void> | undefined;
  let windowStateWait: Promise<void> | undefined;
  let typeGate: Promise<void> | undefined;
  // type_text requests the fake driver is holding at once, so lane tests can
  // prove writes overlapped at the native boundary rather than merely
  // resolving in some order.
  let typingInFlight = 0;
  let typingMaxInFlight = 0;
  let extraWindows: Array<Record<string, unknown>> = [];
  let toolHandlers: Record<string, (args: Record<string, unknown>) => Record<string, unknown>> = {};
  let setValueSwallowed = false;
  let actionResult: Record<string, unknown> = {
    route: "synthetic_events",
    delivery: { mode: "background" },
    effect: "unverifiable",
  };
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.write("IHDR", 12);
  header.writeUInt32BE(400, 16);
  header.writeUInt32BE(200, 20);
  const respond = async (
    _endpoint: unknown,
    request: (typeof calls)[number] & { method?: string },
  ) => {
    calls.push(request);
    const responseEpoch = desktopEpoch;
    if (request.method === "probe" || request.method === "stop")
      return {
        ok: true,
        desktopEpoch: responseEpoch,
        hostPlatform: options?.hostPlatform ?? "darwin",
      };
    if (desktopPaused && (request.name === "click" || isTyping(request.name)))
      return {
        ok: true,
        desktopEpoch: responseEpoch,
        result: {
          isError: true,
          structuredContent: {
            effect: "refused",
            code: "desktop_input_paused",
            message: "Desktop is locked.",
          },
        },
      };
    if (isTyping(request.name)) {
      typingInFlight += 1;
      typingMaxInFlight = Math.max(typingMaxInFlight, typingInFlight);
      try {
        if (failure) throw failure;
        if (typeGate) await typeGate;
      } finally {
        typingInFlight -= 1;
      }
      if (nativeRefusal)
        return {
          ok: true,
          desktopEpoch: responseEpoch,
          result: {
            isError: true,
            structuredContent: {
              effect: "refused",
              code: "same_pid_keyboard_ambiguity",
            },
            content: [{ type: "text", text: "No actuator ran." }],
          },
        };
    }
    let data: unknown = {};
    if (request.name === "check_permissions") {
      data = {
        accessibility: !missingPermissions,
        screen_recording: !missingPermissions && !screenRecordingMissing,
        ...monitorPermissions,
        source: { host_bundle_id: "com.glade.test" },
      };
      await permissionWait;
    }
    if (request.name === "list_windows")
      data = {
        windows: live
          ? [
              {
                pid: 10,
                window_id: 20,
                title: "Owned fixture",
                bounds,
                is_on_screen: visible,
                on_current_space: visible,
                z_index: 1,
              },
              ...extraWindows,
              {
                pid: 20,
                window_id: 30,
                bounds: { x: 0, y: 0, width: 0, height: 0 },
              },
            ]
          : [],
      };
    if (request.name === "check_input_ready") data = ready;
    if (request.name === "get_screen_size") data = { width: 1000, height: 800, scale_factor: 2 };
    if (request.name === "get_desktop_state") {
      if (overviewFailure) throw new Error("Capture denied before permission recovery");
      await overviewWait;
      return {
        ok: true,
        desktopEpoch: responseEpoch,
        result: {
          structuredContent: { screen_width: 200, screen_height: 100 },
          content: [
            {
              type: "image",
              mimeType: "image/png",
              data: header.toString("base64"),
            },
          ],
        },
      };
    }
    if (request.name === "get_window_state") {
      if (windowStateWait) await windowStateWait;
      const result = {
        structuredContent: {
          pid: capturePid,
          window_id: captureWindowId,
          window_bounds: bounds,
          screenshot_frame_valid: captureFrameValid,
          screenshot_frame_freshness: captureFrameFreshness,
          elements,
        },
        content: [
          {
            type: "image",
            mimeType: "image/png",
            data: header.toString("base64"),
          },
        ],
      };
      afterCapture?.();
      return { ok: true, result, desktopEpoch: responseEpoch };
    }
    if (request.name === "set_value" && !setValueSwallowed) {
      const token = (request.args as Record<string, unknown> | undefined)?.element_token;
      const written = (request.args as Record<string, unknown> | undefined)?.value;
      const target = elements.find((element) => element.element_token === token);
      if (target && typeof written === "string")
        target.value = request.args?.append === true ? `${target.value ?? ""}${written}` : written;
    }
    if (isTyping(request.name)) data = actionResult;
    const toolHandler = request.name ? toolHandlers[request.name] : undefined;
    if (toolHandler)
      return {
        ok: true,
        result: toolHandler(request.args ?? {}),
        desktopEpoch: responseEpoch,
        hostPlatform: options?.hostPlatform ?? "darwin",
      };
    return {
      ok: true,
      result: { structuredContent: data },
      desktopEpoch: responseEpoch,
      hostPlatform: options?.hostPlatform ?? "darwin",
    };
  };
  const request = vi.fn(async (...args: Parameters<typeof respond>) => ({
    ...(await respond(...args)),
    ...(options?.nativeRevision === null
      ? {}
      : { driverNativeRevision: options?.nativeRevision ?? 34 }),
  })) as unknown as typeof cuaRequest;
  const backend = new CuaComputerBackend({
    endpoint: "/fixture-only",
    request,
    ...(options?.semanticTextLaneHoldMs !== undefined
      ? { semanticTextLaneHoldMs: options.semanticTextLaneHoldMs }
      : {}),
    ...(options?.semanticTextLaneGapMs !== undefined
      ? { semanticTextLaneGapMs: options.semanticTextLaneGapMs }
      : {}),
    ...(options?.stillIntervalMs !== undefined ? { stillIntervalMs: options.stillIntervalMs } : {}),
  });
  return {
    backend,
    setElements: (value: Record<string, unknown>[]) => {
      elements = value;
    },
    swallowSetValue: () => {
      setValueSwallowed = true;
    },
    setWindows: (value: Array<Record<string, unknown>>) => {
      extraWindows = value;
    },
    setBounds: (value: typeof bounds) => {
      bounds = value;
    },
    onTool: (name: string, handler: (args: Record<string, unknown>) => Record<string, unknown>) => {
      toolHandlers[name] = handler;
    },
    gateTypeText: (wait: Promise<void> | undefined) => {
      typeGate = wait;
    },
    typingMaxInFlight: () => typingMaxInFlight,
    pauseDesktop: (paused: boolean) => {
      desktopPaused = paused;
    },
    changeDesktop: () => {
      desktopEpoch += 1;
    },
    calls,
    delayOverview: (wait: Promise<void>) => {
      overviewWait = wait;
    },
    delayWindowState: (wait: Promise<void> | undefined) => {
      windowStateWait = wait;
    },
    setVisible: (value: boolean) => {
      visible = value;
    },
    readiness: (value: Record<string, unknown>) => {
      ready = value;
    },
    moveAfterCapture: () => {
      afterCapture = () => {
        bounds = { ...bounds, x: -250 };
      };
    },
    captureWindow: (value: number, pid = 10) => {
      captureWindowId = value;
      capturePid = pid;
    },
    invalidateCapture: () => {
      captureFrameValid = false;
    },
    markOffSpaceCaptureUnverified: () => {
      captureFrameFreshness = "unverified_off_space";
    },
    actionResult: (value: Record<string, unknown>) => {
      actionResult = value;
    },
    move: () => {
      bounds = { ...bounds, x: -250 };
    },
    close: () => {
      live = false;
    },
    fail: (error: Error) => {
      failure = error;
    },
    unfail: () => {
      failure = undefined;
    },
    refuse: () => {
      nativeRefusal = true;
    },
    denyPermissions: () => {
      missingPermissions = true;
    },
    grantPermissions: () => {
      missingPermissions = false;
      screenRecordingMissing = false;
    },
    denyScreenRecording: () => {
      screenRecordingMissing = true;
    },
    setInputMonitor: (granted: boolean, ready: boolean) => {
      monitorPermissions = { input_monitoring: granted, input_monitor_ready: ready };
    },
    waitForPermission: (wait: Promise<void>) => {
      permissionWait = wait;
    },
    failOverview: () => {
      overviewFailure = true;
    },
  };
}

function gatewayFixture(f: ReturnType<typeof fixture>) {
  const manager = new ComputerManager({ backend: f.backend, actionSettleMs: 0 });
  const tools = makeAgentGatewayComputerTools({ manager });
  const context: ToolContext = {
    principal: {
      kind: "provider-session",
      sessionKey: "test-session",
      threadId: "test-thread",
      turnId: "test-turn",
      provider: "claudeAgent",
    },
    callerThreadId: "test-thread",
    callerThreadLabel: null,
    callerSessionKey: "test-session",
    callerProvider: "claudeAgent",
    callerCapabilities: new Set(["computer:control"]),
    callerTurnId: "test-turn",
    assertCallerTurnActive: () => Effect.void,
    jsonRpcRequestId: 1,
  };
  const call = (name: string, args: Record<string, unknown>) =>
    Effect.runPromise(tools.find((tool) => tool.definition.name === name)!.handler(args, context));
  const list = async () => {
    const result = await call("computer_get_state", {
      window_id: "cua:10:20",
      include_screenshot: false,
    });
    expect(result.isError).not.toBe(true);
    const text = result.content.find((entry) => entry.type === "text");
    return JSON.parse(text?.type === "text" ? text.text : "{}").elements as Array<{
      ref: number;
      label: string;
      value?: string;
    }>;
  };
  return { manager, call, list };
}

describe("Cua native boundary", () => {
  it("refuses a retained web append when an identical replacement occupies the same geometry", async () => {
    const f = fixture({ nativeRevision: 37 });
    const field = {
      role: "AXTextField",
      label: "Search",
      value: "old",
      frame: { x: -290, y: 30, width: 120, height: 20 },
      element_token: "original-token",
      in_web_content: true,
    };
    f.setElements([field]);
    const { manager, call, list } = gatewayFixture(f);
    try {
      const original = (await list())[0]!;
      f.setElements([{ ...field, value: "replacement", element_token: "replacement-token" }]);
      await list();
      f.onTool("set_value", () => ({
        isError: true,
        structuredContent: {
          effect: "not-dispatched",
          code: "stale_target",
          message: "The original token expired.",
        },
      }));
      const beforeAction = f.calls.length;
      const result = await call("computer_type_text", {
        ref: original.ref,
        text: " appended",
        include_screenshot: false,
      });
      expect(result.isError).toBe(true);
      const writes = f.calls
        .slice(beforeAction)
        .filter((call) => call.name === "set_value" || call.name === "type_text");
      expect(writes).toHaveLength(1);
      expect(writes[0]?.args).toMatchObject({ element_token: "original-token", append: true });
      expect(f.calls.slice(beforeAction).some((call) => call.name === "get_window_state")).toBe(
        false,
      );
    } finally {
      await manager.dispose();
    }
  });

  it("refuses a native retained ref without a semantic click instead of using its stale coordinates", async () => {
    const f = fixture({ nativeRevision: 37 });
    f.setElements([
      {
        role: "AXTextField",
        label: "Search",
        frame: { x: -290, y: 30, width: 120, height: 20 },
        element_token: "original-token",
      },
    ]);
    const { manager, call, list } = gatewayFixture(f);
    try {
      const original = (await list())[0]!;
      const result = await call("computer_click", { ref: original.ref, include_screenshot: false });
      expect(result.isError).toBe(true);
      expect(f.calls.filter((call) => call.name === "click")).toHaveLength(0);
    } finally {
      await manager.dispose();
    }
  });

  it("writes through a live token and refuses a stale one without a second dispatch", async () => {
    const f = fixture();
    f.setElements([
      {
        role: "AXTextField",
        label: "Display",
        frame: { x: -290, y: 30, width: 20, height: 20 },
        element_token: "fresh-token",
      },
    ]);
    const state = await f.backend.getState({
      windowId: "cua:10:20",
      includeTree: true,
    });
    const node = state.root!.children[0]!;
    const target = {
      target: { label: "Display" },
      node,
      point: node.activationPoint!,
    };
    await f.backend.setValue(target, "1");
    expect(f.calls.find((c) => c.name === "set_value")?.args).toMatchObject({
      element_token: "fresh-token",
      value: "1",
    });
    f.close();
    await expect(f.backend.setValue(target, "2")).rejects.toMatchObject({
      effect: "not-dispatched",
    });
    expect(f.calls.filter((c) => c.name === "set_value")).toHaveLength(1);
  });

  it("refuses a stale semantic field when fresh state has two matching controls", async () => {
    const f = fixture();
    const field = {
      role: "AXTextField",
      label: "Message",
      frame: { x: -290, y: 30, width: 120, height: 20 },
      element_token: "one",
      element_index: 2,
      in_web_content: true,
      value: "seed",
    };
    f.setElements([field]);
    const state = await f.backend.getState({ windowId: "cua:10:20", includeTree: true });
    const node = state.root!.children[0]!;
    f.setElements([field, { ...field, element_token: "two", element_index: 3 }]);
    await expect(
      f.backend.setValue(
        { target: { label: "Message", windowId: "cua:10:20" }, node, point: node.activationPoint! },
        "replacement",
      ),
    ).rejects.toMatchObject({ effect: "not-dispatched", code: "stale_target" });
    expect(f.calls.filter((call) => call.name === "set_value")).toHaveLength(0);
  });

  it("semantic text lane serializes same-window writes", async () => {
    const f = fixture({ semanticTextLaneGapMs: 0 });
    // Two distinct elements in one window still share the lane: the native
    // semantic lease is per (pid, window), so a second concurrent write to the
    // window would be refused outright rather than queued.
    f.setElements([
      {
        role: "AXTextField",
        label: "Message",
        frame: { x: -290, y: 30, width: 120, height: 20 },
        element_token: "message-token",
      },
      {
        role: "AXTextField",
        label: "Notes",
        frame: { x: -290, y: 60, width: 120, height: 20 },
        element_token: "notes-token",
      },
    ]);
    const state = await f.backend.getState({
      windowId: "cua:10:20",
      includeTree: true,
    });
    const firstNode = state.root!.children[0]!;
    const secondNode = state.root!.children[1]!;
    const firstTarget = {
      target: { label: "Message", windowId: "cua:10:20" },
      node: firstNode,
      point: firstNode.activationPoint!,
    };
    const secondTarget = {
      target: { label: "Notes", windowId: "cua:10:20" },
      node: secondNode,
      point: secondNode.activationPoint!,
    };
    let releaseGate!: () => void;
    f.gateTypeText(new Promise<void>((resolve) => (releaseGate = resolve)));
    const typeTexts = () => f.calls.filter((call) => call.name === "type_text");

    const first = f.backend.typeText("alpha", "cua:10:20", firstTarget);
    await vi.waitFor(() => expect(typeTexts()).toHaveLength(1));
    const second = f.backend.typeText("bravo", "cua:10:20", secondTarget);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(typeTexts()).toHaveLength(1);
    expect(f.typingMaxInFlight()).toBe(1);
    releaseGate!();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(typeTexts().map((call) => call.args?.text)).toEqual(["alpha", "bravo"]);
  });

  it("expires a queued semantic write without dispatching it after the lane drains", async () => {
    const f = fixture({ semanticTextLaneGapMs: 0, semanticTextLaneHoldMs: 40 });
    f.setElements([
      {
        role: "AXTextField",
        label: "Message",
        frame: { x: -290, y: 30, width: 120, height: 20 },
        element_token: "message-token",
      },
    ]);
    const node = (await f.backend.getState({ windowId: "cua:10:20", includeTree: true })).root!
      .children[0]!;
    const target = {
      target: { label: "Message", windowId: "cua:10:20" },
      node,
      point: node.activationPoint!,
    };
    let releaseGate!: () => void;
    f.gateTypeText(new Promise<void>((resolve) => (releaseGate = resolve)));

    await expect(f.backend.typeText("alpha", "cua:10:20", target)).rejects.toMatchObject({
      effect: "dispatched-unknown",
      code: "cua_action_failed",
    });
    await expect(f.backend.typeText("expired", "cua:10:20", target)).rejects.toMatchObject({
      effect: "not-dispatched",
    });
    expect(f.calls.filter((call) => call.name === "type_text")).toHaveLength(1);
    f.gateTypeText(undefined);
    releaseGate();
    await expect(f.backend.typeText("beta", "cua:10:20", target)).resolves.toMatchObject({
      windowId: "cua:10:20",
    });
    expect(
      f.calls.filter((call) => call.name === "type_text").map((call) => call.args?.text),
    ).toEqual(["alpha", "beta"]);
    expect(f.typingMaxInFlight()).toBe(1);
  });

  it("does not reuse an in-flight permission denial for a grant-triggered status refresh", async () => {
    const f = fixture();
    f.denyPermissions();
    await f.backend.availability();
    const previousChecks = f.calls.filter((call) => call.name === "check_permissions").length;
    let release!: () => void;
    f.waitForPermission(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const old = f.backend.availability({ refresh: true });
    await vi.waitFor(() =>
      expect(f.calls.filter((call) => call.name === "check_permissions")).toHaveLength(
        previousChecks + 1,
      ),
    );
    const updated = f.backend.availability({ refresh: true });
    f.grantPermissions();
    release();
    expect(await old).toMatchObject({ kind: "permission-required" });
    expect(await updated).toMatchObject({ kind: "available" });
  });

  it("rejects a delayed observation from before a known desktop interruption", async () => {
    const f = fixture();
    let finish!: () => void;
    f.delayOverview(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const observing = f.backend.getState({ includeScreenshot: true });
    const failure = expect(observing).rejects.toMatchObject({
      effect: "not-dispatched",
      code: "stale_desktop_epoch",
    });
    await vi.waitFor(() =>
      expect(f.calls.some((call) => call.name === "get_desktop_state")).toBe(true),
    );
    f.changeDesktop();
    await f.backend.checkInputReady("cua:10:20");
    finish();
    await failure;
  });
  it("pauses input on another Space while leaving observation available", async () => {
    const f = fixture();
    f.setVisible(false);
    await expect(f.backend.typeText("abc", "cua:10:20")).rejects.toMatchObject({
      effect: "not-dispatched",
      code: "target_not_on_active_space",
      inputPause: { windowId: "cua:10:20" },
    });
    expect(f.calls.some((call) => isTyping(call.name))).toBe(false);
    await expect(f.backend.getState({ windowId: "cua:10:20" })).resolves.toMatchObject({
      computerId: "desktop",
    });
  });
  it("rejects a drag if its prepared window moves before input admission", async () => {
    const f = fixture();
    await f.backend.captureScreenshot({
      kind: "window",
      windowId: "cua:10:20",
    });
    f.move();
    await expect(
      withDesktopDeliveryMode("foreground", () =>
        f.backend.drag({ x: -275, y: 30 }, { x: -225, y: 50 }, 500, "cua:10:20"),
      ),
    ).rejects.toMatchObject({
      effect: "not-dispatched",
      code: "stale_geometry",
    });
    expect(f.calls.some((call) => call.name === "drag")).toBe(false);
  });
  it("preserves capture identity and rejects a different native window", async () => {
    const f = fixture();
    const image = await f.backend.captureScreenshot({
      kind: "window",
      windowId: "cua:10:20",
    });
    expect(Schema.decodeUnknownSync(ComputerScreenshot)(image)).toMatchObject({
      windowId: "cua:10:20",
    });
    expect(
      await f.backend.getState({
        windowId: "cua:10:20",
        includeScreenshot: true,
      }),
    ).toMatchObject({ screenshot: { windowId: "cua:10:20" } });
    f.captureWindow(21);
    await expect(
      f.backend.captureScreenshot({ kind: "window", windowId: "cua:10:20" }),
    ).rejects.toMatchObject({ effect: "not-dispatched" });
    await expect(
      f.backend.getState({ windowId: "cua:10:20", includeTree: true }),
    ).rejects.toMatchObject({ effect: "not-dispatched" });
    expect(f.calls.some((call) => call.name === "click")).toBe(false);
  });
  it("clears targeting after desktop pause and requires a fresh observation", async () => {
    const f = fixture();
    await f.backend.captureScreenshot({
      kind: "window",
      windowId: "cua:10:20",
    });
    f.pauseDesktop(true);
    await expect(f.backend.click({ x: -275, y: 30 }, "cua:10:20")).rejects.toMatchObject({
      effect: "not-dispatched",
      code: "computer_input_paused",
      layer: "driver-host",
      inputPause: { windowId: "cua:10:20" },
    });
    f.pauseDesktop(false);
    await expect(f.backend.click({ x: -275, y: 30 }, "cua:10:20")).rejects.toMatchObject({
      code: "stale_geometry",
    });
    await f.backend.captureScreenshot({
      kind: "window",
      windowId: "cua:10:20",
    });
    await expect(f.backend.click({ x: -275, y: 30 }, "cua:10:20")).resolves.toBeDefined();
  });

  it("refuses unsupported Linux hidden launches and ambiguous executable paths before dispatch", async () => {
    const request = vi.fn(async (_endpoint: string, _request: unknown) => ({
      ok: true,
      hostPlatform: "linux",
      driverNativeRevision: 0,
    }));
    const backend = new CuaComputerBackend({
      endpoint: "/fixture-only",
      request: request as unknown as typeof cuaRequest,
    });
    for (const options of [undefined, { hidden: true }]) {
      await expect(backend.launchApp("org.gnome.Calculator", [], options)).rejects.toMatchObject({
        effect: "not-dispatched",
        code: "unsupported_operation",
      });
    }
    await expect(
      backend.launchApp("/opt/My App/bin/calculator", [], { hidden: false }),
    ).rejects.toMatchObject({ effect: "not-dispatched", code: "unsupported_operation" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "probe" });
  });
  it("does not replay identical text when native readback is unverifiable", async () => {
    const f = fixture();
    await f.backend.availability();
    await f.backend.focusWindow("cua:10:20");
    expect(await f.backend.typeText("abc")).toMatchObject({
      verified: "unverifiable",
    });
    expect(f.calls.filter((c) => isTyping(c.name))).toHaveLength(1);
    expect(f.calls.find((c) => isTyping(c.name))?.args).toMatchObject({
      delivery_mode: "background",
      text: "abc",
      pid: 10,
      window_id: 20,
    });
  });
  it("preserves unknown dispatch on transport timeout without retry", async () => {
    const f = fixture();
    await f.backend.availability();
    f.fail(new CuaTransportError("timeout", "dispatched-unknown"));
    await expect(f.backend.typeText("abc", "cua:10:20")).rejects.toMatchObject({
      effect: "dispatched-unknown",
    });
    expect(f.calls.filter((c) => isTyping(c.name))).toHaveLength(1);
  });
  it("refuses a moved or closed window without injecting", async () => {
    const f = fixture();
    await f.backend.availability();
    await f.backend.captureScreenshot({
      kind: "window",
      windowId: "cua:10:20",
    });
    f.move();
    await expect(f.backend.click({ x: -275, y: 30 }, "cua:10:20")).rejects.toMatchObject({
      effect: "not-dispatched",
      code: "stale_geometry",
    });
    f.close();
    await expect(f.backend.typeText("abc", "cua:10:20")).rejects.toMatchObject({
      effect: "not-dispatched",
      code: "stale_target",
    });
    expect(f.calls.filter((c) => c.name === "click" || isTyping(c.name))).toHaveLength(0);
  });
});

describe("Cua hardening", () => {
  it("pauses input while an auth sheet holds focus, keeping observation available", async () => {
    const f = fixture();
    f.actionResult({
      effect: "refused",
      code: "auth_sheet_focused",
      message: "An authentication sheet has focus.",
    });
    await expect(f.backend.typeText("abc", "cua:10:20")).rejects.toMatchObject({
      effect: "not-dispatched",
      code: "auth_sheet_focused",
      inputPause: { windowId: "cua:10:20" },
    });
    await expect(f.backend.getState({ windowId: "cua:10:20" })).resolves.toMatchObject({
      computerId: "desktop",
    });
  });
  it("degrades blind on a mid-task Screen Recording revoke without replaying input", async () => {
    const f = fixture();
    // Grounded and driving before the revoke lands.
    await f.backend.captureScreenshot({
      kind: "window",
      windowId: "cua:10:20",
    });
    await expect(f.backend.click({ x: -275, y: 30 }, "cua:10:20")).resolves.toBeDefined();
    const clicks = f.calls.filter((call) => call.name === "click").length;

    // The revoke lands mid-task: the probe reports the grant missing...
    f.denyScreenRecording();
    expect(await f.backend.availability()).toMatchObject({
      kind: "permission-required",
      missing: ["screenRecording"],
    });
    // ...perception goes blind but stays available: no pixels, no throw, tree intact...
    const blind = await f.backend.getState({ includeScreenshot: true });
    expect(blind.screenshot).toBeUndefined();
    await expect(
      f.backend.getState({ windowId: "cua:10:20", includeTree: true }),
    ).resolves.toMatchObject({ computerId: "desktop" });
    expect(f.backend.health().captureAvailable).toBe(false);
    // ...and the desktop stays driveable: exactly one native input, never a replay.
    await expect(f.backend.typeText("abc", "cua:10:20")).resolves.toBeDefined();
    expect(f.calls.filter((call) => call.name === "click")).toHaveLength(clicks);
    expect(f.calls.filter((call) => isTyping(call.name))).toHaveLength(1);
    await f.backend.dispose();
  });
  it("requires a fresh granted observation to recover from a failed capture", async () => {
    const f = fixture();
    // A capture that fails native-side flips health while dispatching zero input...
    f.failOverview();
    await expect(f.backend.getState({ includeScreenshot: true })).rejects.toThrow();
    expect(f.backend.health()).toMatchObject({
      status: "unavailable",
      captureAvailable: false,
    });
    const overviews = f.calls.filter((call) => call.name === "get_desktop_state").length;
    expect(f.calls.some((call) => call.name === "click" || isTyping(call.name))).toBe(false);
    // ...inputs keep working through the outage...
    await expect(f.backend.typeText("abc", "cua:10:20")).resolves.toBeDefined();
    // ...and a latched heal is not enough: only a fresh successful observation
    // recovers, so a still-failing capture flips health right back.
    f.grantPermissions();
    await f.backend.provision();
    expect(f.backend.health()).toMatchObject({
      status: "connected",
      captureAvailable: true,
    });
    await expect(f.backend.getState({ includeScreenshot: true })).rejects.toThrow();
    expect(f.backend.health()).toMatchObject({
      status: "unavailable",
      captureAvailable: false,
    });
    expect(f.calls.filter((call) => call.name === "get_desktop_state")).toHaveLength(overviews + 1);
    await f.backend.dispose();
  });
  it("drops grounding after uncertain delivery but keeps it after a clean refusal", async () => {
    const f = fixture();
    await f.backend.captureScreenshot({
      kind: "window",
      windowId: "cua:10:20",
    });
    f.fail(new CuaTransportError("timeout", "dispatched-unknown"));
    await expect(f.backend.typeText("abc", "cua:10:20")).rejects.toMatchObject({
      effect: "dispatched-unknown",
    });
    // Uncertain delivery may have moved the window: re-observe first.
    await expect(f.backend.click({ x: -275, y: 30 }, "cua:10:20")).rejects.toMatchObject({
      code: "stale_geometry",
    });
    await f.backend.captureScreenshot({
      kind: "window",
      windowId: "cua:10:20",
    });
    f.refuse();
    f.unfail();
    await expect(f.backend.typeText("abc", "cua:10:20")).rejects.toMatchObject({
      effect: "not-dispatched",
    });
    // A clean refusal dispatched nothing, so the grounding still stands.
    await expect(f.backend.click({ x: -275, y: 30 }, "cua:10:20")).resolves.toBeDefined();
    await f.backend.dispose();
  });
});

describe("preview stills target scope", () => {
  it("captures the exact window the task aims at, never the desktop", async () => {
    const f = fixture();
    await f.backend.focusWindow("cua:10:20");
    f.calls.length = 0;
    const frames: Array<unknown> = [];
    await f.backend.attachStream((frame) => frames.push(frame));
    expect(frames).toHaveLength(1);
    expect(f.calls.find((call) => call.name === "get_window_state")?.args).toMatchObject({
      pid: 10,
      window_id: 20,
      include_screenshot: true,
      include_accessibility_tree: false,
    });
    expect(f.calls.some((call) => call.name === "get_desktop_state")).toBe(false);
    await f.backend.dispose();
  });
});

describe("Linux native input dialect", () => {
  it("refuses default background input without dispatching a relaxed Linux request", async () => {
    const f = fixture({ hostPlatform: "linux" });
    await expect(f.backend.typeText("must not type", "cua:10:20")).rejects.toMatchObject({
      effect: "not-dispatched",
      code: "linux_background_unavailable",
    });
    expect(f.calls.some((call) => call.name === "type_text")).toBe(false);
    expect(f.calls.every((call) => call.deliveryMode === "background")).toBe(true);
  });

  it("does not downgrade an exact semantic text target to focused Linux typing", async () => {
    const f = fixture({ hostPlatform: "linux" });
    f.setElements([
      {
        role: "AXTextField",
        label: "Fixture input",
        element_token: "snapshot-token",
        frame: { x: -290, y: 30, width: 20, height: 20 },
      },
    ]);
    const state = await f.backend.getState({ windowId: "cua:10:20", includeTree: true });
    const node = state.root!.children[0]!;
    const target = { target: { label: "Fixture input" }, node, point: node.activationPoint! };
    await expect(
      withDesktopDeliveryMode("foreground", () =>
        f.backend.typeText("must preserve identity", "cua:10:20", target),
      ),
    ).rejects.toMatchObject({ effect: "not-dispatched", code: "linux_semantic_target_unproven" });
    expect(f.calls.some((call) => call.name === "type_text" || call.name === "set_value")).toBe(
      false,
    );
  });
});
