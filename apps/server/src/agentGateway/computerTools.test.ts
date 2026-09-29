import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPUTER_SELECT_TEXT_RANGE_MAX,
  type ComputerPermission,
  type ProviderKind,
} from "@glade/contracts";

import {
  COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION,
  ComputerBackendError,
  DEFAULT_COMPUTER_CAPTURE_MAX_DIMENSION,
  MAX_COMPUTER_CLIPBOARD_BYTES,
} from "../computer/ComputerBackend.ts";

import { ComputerManager } from "../computer/ComputerManager.ts";
import { CuaActionError } from "../computer/CuaComputerBackend.ts";

import { FakeComputerBackend } from "../computer/FakeComputerBackend.ts";
import { isModelDesktopObservationActive } from "../computer/modelDesktopObservation.ts";
import {
  COMPUTER_APPROVAL_REQUIRED_TOOLS,
  computerToolInstructions,
  computerToolRequiresApproval,
  makeAgentGatewayComputerTools,
  type AgentGatewayComputerToolsOptions,
} from "./computerTools.ts";
import type { McpToolCallResult } from "./protocol.ts";
import { GatewayToolError, type ToolContext } from "./toolRuntime.ts";
import { makeAgentGatewayComputerBrowserTools } from "./computerBrowserTools.ts";

const THREAD = "thread-computer";

function resultJson(result: McpToolCallResult): unknown {
  const text = result.content.find((entry) => entry.type === "text");
  return text?.type === "text" ? JSON.parse(text.text) : undefined;
}

/** A backend that never implemented the optional clipboard methods. */

function makeContext(
  provider: ProviderKind = "claudeAgent",
  threadId = THREAD,
  label: string | null = null,
): ToolContext {
  return {
    principal: {
      kind: "provider-session",
      sessionKey: "gateway-session:computer",
      threadId,
      provider,
      turnId: "turn-computer",
    },
    callerThreadId: threadId,
    callerThreadLabel: label,
    callerSessionKey: "gateway-session:computer",
    callerProvider: provider,
    callerCapabilities: new Set(["computer:control"]),
    callerTurnId: "turn-computer",
    assertCallerTurnActive: () => Effect.void,
    jsonRpcRequestId: 1,
  };
}

async function setup(
  backend = new FakeComputerBackend(),
  authorizeAction?: AgentGatewayComputerToolsOptions["authorizeAction"],
  /**
   * The never-raise authorization resolver. Defaults to the user having asked
   * to see the screen: these suites exercise the raise/foreground mechanics,
   * and the gate itself has dedicated tests that pass an explicit refusal.
   */
  resolveForegroundAuthorization: AgentGatewayComputerToolsOptions["resolveForegroundAuthorization"] = async () => ({
    userRequestedVisibleUse: true,
  }),
  requestForegroundConsent?: AgentGatewayComputerToolsOptions["requestForegroundConsent"],
) {
  // A zero settle delay: these tests assert on what the post-action capture
  // does, not on how long the desktop is given to repaint.
  const manager = new ComputerManager({ backend, actionSettleMs: 0 });
  const browserTools = manager.supportsBrowser
    ? makeAgentGatewayComputerBrowserTools({
        manager,
        ...(authorizeAction ? { authorizeAction } : {}),
        resolveForegroundAuthorization,
        ...(requestForegroundConsent ? { requestForegroundConsent } : {}),
      })
    : [];
  const tools = makeAgentGatewayComputerTools({
    manager,
    ...(authorizeAction ? { authorizeAction } : {}),
    resolveForegroundAuthorization,
    ...(requestForegroundConsent ? { requestForegroundConsent } : {}),
    relatedTools: browserTools,
  });
  const byName = new Map([...tools, ...browserTools].map((tool) => [tool.definition.name, tool]));
  const call = async (
    name: string,
    args: Record<string, unknown>,
    provider?: ProviderKind,
    threadId?: string,
    label?: string | null,
  ): Promise<McpToolCallResult> => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`no such tool: ${name}`);
    return await Effect.runPromise(tool.handler(args, makeContext(provider, threadId, label)));
  };
  /**
   * Look at the desktop the way the model does before it points: a workspace
   * screenshot. The fake workspace is 1920×1080 and the perception budget caps
   * an image handed to a model at 1536 on its longest side, so this frame comes
   * back at 1536×864, scale 0.8, from (0, 0) — a screenshot pixel is 1.25
   * desktop points, and that conversion is exactly what the server does for the
   * model rather than asking it to.
   */
  const see = async (threadId = THREAD, label: string | null = null) => {
    const state = await call(
      "computer_get_state",
      { include_screenshot: true },
      undefined,
      threadId,
      label,
    );
    expect(state.isError).not.toBe(true);
    return (resultJson(state) as { screenshot: { screenshotId: string } }).screenshot;
  };
  return { backend, manager, tools, byName, call, see };
}

type ToolsByName = Map<string, { definition: { inputSchema: unknown } }>;

/** One property's `enum`, for the schemas whose vocabulary is backend-dependent. */

/** One property's description, for the same reason. */

/** The `window_id` blurb one tool advertises, which is backend-dependent prose. */
function windowIdDescription(byName: ToolsByName, tool: string): string {
  const schema = byName.get(tool)?.definition.inputSchema as
    | { properties?: { window_id?: { description?: string } } }
    | undefined;
  return schema?.properties?.window_id?.description ?? "";
}

describe("agent gateway computer tools", () => {
  it("reserves model observation authority for explicit perception tools", async () => {
    const { backend, manager, call } = await setup();
    const observations: boolean[] = [];
    const getState = backend.getState.bind(backend);
    const capture = backend.captureScreenshot.bind(backend);
    backend.getState = async (options) => {
      observations.push(isModelDesktopObservationActive());
      return getState(options);
    };
    backend.captureScreenshot = async (request) => {
      observations.push(isModelDesktopObservationActive());
      return capture(request);
    };
    try {
      for (const [name, args] of [
        ["computer_get_state", { window_id: "fake-calculator" }],
        ["computer_screenshot", { window_id: "fake-calculator" }],
        [
          "computer_wait",
          {
            window_id: "fake-calculator",
            label: "Display",
            duration_ms: 0,
            include_screenshot: false,
          },
        ],
      ] as const) {
        observations.length = 0;
        expect((await call(name, args)).isError).not.toBe(true);
        expect(observations.length).toBeGreaterThan(0);
        expect(observations.every(Boolean)).toBe(true);
        expect(isModelDesktopObservationActive()).toBe(false);
      }
      observations.length = 0;
      expect(
        (await call("computer_set_value", { label: "Display", value: "468" })).isError,
      ).not.toBe(true);
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.every((active) => !active)).toBe(true);
    } finally {
      await manager.dispose();
    }
  });

  it("covers routine foreground delivery with the active task consent on macOS", async () => {
    const { byName } = await setup(
      Object.assign(new FakeComputerBackend(), {
        agentDialect: "macos" as const,
      }),
    );
    const notes = computerToolInstructions();
    expect(notes).toContain("the user's visible-use request or direct confirmation");
    expect(notes).not.toContain("without bringing it to the front");
    expect(windowIdDescription(byName, "computer_click")).toContain(
      "Exact window for label or x/y targeting",
    );
    expect(windowIdDescription(byName, "computer_type_text")).toContain("does not activate it");
    // The activate tool no longer promises consent-covered foreground: the
    // user's own task text is the authorization, and the description says so.
    expect(byName.get("computer_activate_window")?.definition.description).toContain(
      "Unless the user's own task text asked to see the screen",
    );
    expect(byName.get("computer_list_windows")?.definition.description).not.toContain(
      "into view automatically",
    );
    expect(byName.get("computer_get_state")?.definition.description).toContain("primary display");
    expect(windowIdDescription(byName, "computer_get_state")).toContain("any requested screenshot");
    const capture = byName.get("computer_screenshot")?.definition;
    expect(capture?.description).toContain("Rectangular region capture is unavailable");
    const captureSchema = capture?.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(captureSchema.properties).toSorted()).toEqual([
      "max_dimension",
      "window_id",
    ]);
  });

  it("exposes the native batch fast path behind computer:control, with 15 specialist tools hidden", async () => {
    const { byName, tools } = await setup();
    // 33 registered desktop tools: 18 advertised, including the batch fast
    // path, plus 15 specialists. The 7 recording/replay tools, the three click
    // variants and computer_hotkey are gone entirely — their behavior folded
    // into computer_click's count/button and computer_press_key's chord.
    expect(tools.map((tool) => tool.definition.name)).toEqual([
      "computer_spaces",
      "computer_list_windows",
      "computer_get_state",
      "computer_screenshot",
      "computer_get_screen_size",
      "computer_wait",
      "computer_read_clipboard",
      "computer_launch_app",
      "computer_list_apps",
      "computer_verify_state",
      "computer_zoom",
      "computer_get_accessibility_tree",
      "computer_get_cursor_position",
      "computer_inspect",
      "computer_help",
      "computer_set_window_frame",
      "computer_invoke_menu",
      "computer_kill_app",
      "computer_set_window_minimized",
      "computer_set_app_visibility",
      "computer_click",
      "computer_move_cursor",
      "computer_drag",
      "computer_scroll",
      "computer_type_text",
      "computer_press_key",
      "computer_write_clipboard",
      "computer_paste",
      "computer_activate_window",
      "computer_set_value",
      "computer_perform_action",
      "computer_select_text",
      "computer_run",
    ]);
    expect(
      tools.filter((tool) => tool.discoveryOnly !== true).map((tool) => tool.definition.name),
    ).toEqual([
      "computer_list_windows",
      "computer_get_state",
      "computer_screenshot",
      "computer_get_screen_size",
      "computer_wait",
      "computer_launch_app",
      "computer_list_apps",
      "computer_verify_state",
      "computer_inspect",
      "computer_help",
      "computer_click",
      "computer_scroll",
      "computer_type_text",
      "computer_press_key",
      "computer_paste",
      "computer_activate_window",
      "computer_set_value",
      "computer_run",
    ]);
    // Hidden mutations remain reachable through the advertised batch tool;
    // computer_help returns only the specific schema a model asks for.
    expect(
      tools.filter((tool) => tool.discoveryOnly === true).map((tool) => tool.definition.name),
    ).toEqual([
      "computer_spaces",
      "computer_read_clipboard",
      "computer_zoom",
      "computer_get_accessibility_tree",
      "computer_get_cursor_position",
      "computer_set_window_frame",
      "computer_invoke_menu",
      "computer_kill_app",
      "computer_set_window_minimized",
      "computer_set_app_visibility",
      "computer_move_cursor",
      "computer_drag",
      "computer_write_clipboard",
      "computer_perform_action",
      "computer_select_text",
    ]);
    expect(tools.every((tool) => tool.requiredCapability === "computer:control")).toBe(true);
    expect(tools.every((tool) => tool.requiresActiveTurn === true)).toBe(true);
    expect(COMPUTER_APPROVAL_REQUIRED_TOOLS).toEqual(
      new Set([
        "computer_read_clipboard",
        "computer_launch_app",
        "computer_click",
        "computer_move_cursor",
        "computer_drag",
        "computer_scroll",
        "computer_type_text",
        "computer_press_key",
        "computer_write_clipboard",
        "computer_set_value",
        "computer_perform_action",
        "computer_select_text",
        "computer_paste",
        "computer_run",
        "computer_activate_window",
        "computer_set_window_frame",
        "computer_invoke_menu",
        "computer_kill_app",
        "computer_set_window_minimized",
        "computer_set_app_visibility",
      ]),
    );
    // A hover posts no event, presses nothing, and no longer aims the keyboard,
    // so there is nothing for a human to approve and nothing destructive to
    // warn about. It was gated back when `move` still re-pointed the keyboard.
    expect(computerToolRequiresApproval("computer_move_cursor")).toBe(true);
    expect(
      (
        byName.get("computer_move_cursor")?.definition.annotations as
          | { destructiveHint?: boolean }
          | undefined
      )?.destructiveHint,
    ).toBe(false);
    // Waiting touches nothing at all.
    expect(computerToolRequiresApproval("computer_wait")).toBe(false);
    for (const name of COMPUTER_APPROVAL_REQUIRED_TOOLS) {
      expect(computerToolRequiresApproval(name)).toBe(true);
      expect(tools.some((tool) => tool.definition.name === name)).toBe(true);
    }
  });

  it("returns perception payloads and preserves screenshot image content", async () => {
    const { call } = await setup();
    const list = await call("computer_list_windows", {});
    expect(list.isError).not.toBe(true);
    const state = await call("computer_get_state", {
      include_screenshot: true,
      include_text: true,
    });
    expect(state.content.map((entry) => entry.type)).toEqual(["text", "image"]);
    expect(state.content.find((entry) => entry.type === "image")).toMatchObject({
      mimeType: "image/png",
    });
    // The id is how the model names this picture later; the size is the space
    // its coordinates are in. Region and scale still travel for the pane and
    // for debugging, but the model is never asked to do arithmetic with them.
    const text = state.content.find((entry) => entry.type === "text");
    if (text?.type === "text") expect(text.text).toBe(JSON.stringify(JSON.parse(text.text)));
    expect(JSON.parse(text?.type === "text" ? text.text : "{}")).toMatchObject({
      screenshot: {
        screenshotId: "shot-1",
        // The 1920x1080 workspace comes back downscaled: no image handed to a
        // model may exceed the vision-API resize threshold, or the model reads
        // coordinates off a picture the server never produced.
        width: 1_536,
        height: 864,
        region: { x: 0, y: 0, width: 1_920, height: 1_080 },
        scale: 0.8,
      },
    });
  });

  /**
   * The elements digest is the parity lever with macOS visual understanding:
   * without it the model's only grounding is pixel estimation from a
   * downscaled screenshot, which is how forms turned into scroll-hunting.
   */

  it("refuses to point before the conversation has seen a screenshot", async () => {
    const { backend, call } = await setup();

    const blind = await call("computer_click", { x: 4, y: 4 });
    expect(blind.isError).toBe(true);
    expect(resultJson(blind)).toMatchObject({
      error: {
        code: "computer_target_invalid",
        message: expect.stringContaining("computer_screenshot"),
      },
    });
    // A scroll distance is in screenshot pixels too, so it needs a frame even
    // without a point.
    const scroll = await call("computer_scroll", { delta_x: 0, delta_y: 100 });
    expect(scroll.isError).toBe(true);
    expect(backend.callsFor("click")).toHaveLength(0);
    expect(backend.callsFor("scroll")).toHaveLength(0);

    // A label needs no picture: it is resolved from the accessibility tree.
    const byLabel = await call("computer_click", {
      label: "Calculate",
      role: "button",
    });
    expect(byLabel.isError).not.toBe(true);
    expect(backend.callsFor("click")).toHaveLength(1);
  });

  it("keeps each conversation's screenshots apart", async () => {
    const { call, see } = await setup();
    await see("thread-a");

    // Thread B never looked, so thread A's picture is not its frame.
    const blind = await call("computer_click", { x: 1, y: 1 }, undefined, "thread-b");
    expect(resultJson(blind)).toMatchObject({
      error: { code: "computer_target_invalid" },
    });
  });

  it("refuses an ambiguous or incomplete screenshot request without capturing", async () => {
    const { backend, call } = await setup();

    const both = await call("computer_screenshot", {
      window_id: "fake-calculator",
      x: 0,
    });
    expect(both.isError).toBe(true);
    expect(both.content[0]).toMatchObject({
      text: expect.stringContaining("never both"),
    });

    const partial = await call("computer_screenshot", {
      x: 10,
      y: 20,
      width: 30,
    });
    expect(partial.isError).toBe(true);
    expect(partial.content[0]).toMatchObject({
      text: expect.stringContaining("height"),
    });

    const empty = await call("computer_screenshot", {
      x: 10,
      y: 20,
      width: 0,
      height: 30,
    });
    expect(empty.isError).toBe(true);
    expect(empty.content[0]).toMatchObject({
      text: expect.stringContaining("greater than zero"),
    });

    expect(backend.callsFor("captureScreenshot")).toHaveLength(0);
  });

  it("attaches a post-action screenshot of the focused window to action results", async () => {
    const { backend, call, see } = await setup();
    await see();
    const result = await call("computer_click", { x: 100, y: 100 });

    expect(result.isError).not.toBe(true);
    expect(result.content.map((entry) => entry.type)).toEqual(["text", "image"]);
    // A bare coordinate names no window, so the capture goes to the window the
    // compositor routed the click to — the topmost one at the point — and the
    // metadata says which window the pixels cover. (An untargeted action also
    // clears the pinned focus, so the focused-window fallback cannot answer
    // here; the action point is what identifies the window.)
    const text = result.content.find((entry) => entry.type === "text");
    expect(JSON.parse(text?.type === "text" ? text.text : "{}")).toMatchObject({
      action: "computer_click",
      point: { x: 125, y: 125 },
      screenshot: {
        screenshotId: "shot-2",
        windowId: "fake-terminal",
        region: { x: 40, y: 40, width: 960, height: 720 },
        scale: 1,
      },
    });
    expect(backend.callsFor("captureScreenshot").at(-1)?.args[0]).toEqual({
      kind: "window",
      windowId: "fake-terminal",
      // Action observations spend a smaller pixel budget than perception ones.
      maxDimension: COMPUTER_ACTION_OBSERVATION_MAX_DIMENSION,
    });

    // The observation is the picture the model reads next, so it is also the
    // one its next coordinates are in: (5, 5) of the terminal is desktop (45, 45).
    await call("computer_click", { x: 5, y: 5 });
    expect(backend.callsFor("click").at(-1)?.args[0]).toEqual({ x: 45, y: 45 });
    // The identical capture comes back as screenshotUnchanged, and the model is
    // told to keep reading the previous picture — so that stays the frame.
    const repeat = await call("computer_click", { x: 5, y: 5 });
    expect(resultJson(repeat)).toMatchObject({ screenshotUnchanged: true });
    await call("computer_click", { x: 6, y: 6 });
    expect(backend.callsFor("click").at(-1)?.args[0]).toEqual({ x: 46, y: 46 });
  });

  it("reports a closed target instead of photographing another window", async () => {
    const backend = new FakeComputerBackend();
    const originalClick = backend.click.bind(backend);
    backend.click = async (target) => {
      const result = await originalClick(target);
      // The click closed every window: by observation time the target is gone,
      // and the one thing the result must not contain is a screenshot of
      // whatever window remains focused — on a live desktop, the human's.
      backend.emitWindowsChanged([]);
      return result;
    };
    const { call, see } = await setup(backend);
    await see();

    const result = await call("computer_click", {
      x: 1_100,
      y: 200,
      window_id: "fake-calculator",
    });
    expect(result.isError).not.toBe(true);
    expect(result.content.map((entry) => entry.type)).toEqual(["text"]);
    const text = result.content.find((entry) => entry.type === "text");
    expect(JSON.parse(text?.type === "text" ? text.text : "{}")).toMatchObject({
      action: "computer_click",
      targetWindowClosed: true,
    });
  });

  it("uses exact semantic text input without focusing the target window", async () => {
    const backend = Object.assign(new FakeComputerBackend(), {
      focusNeutralSemanticText: true,
    });
    const { call, manager } = await setup(backend);
    const semanticText = vi.spyOn(manager, "typeTextAt");
    try {
      const typed = await call("computer_type_text", {
        text: "42",
        label: "Display",
        role: "text-field",
        window_id: "fake-calculator",
        include_screenshot: false,
      });

      expect(typed.isError).not.toBe(true);
      expect(semanticText).toHaveBeenCalledWith(
        THREAD,
        "42",
        expect.objectContaining({
          label: "Display",
          role: "text-field",
          windowId: "fake-calculator",
        }),
      );
      expect(backend.callsFor("focusWindow")).toHaveLength(0);
      expect(backend.callsFor("raiseWindow")).toHaveLength(0);
      expect(backend.callsFor("typeText").at(-1)?.args[0]).toBe("42");
    } finally {
      await manager.dispose();
    }
  });

  it("refuses the third identical mutating call that observed nothing", async () => {
    const { backend, call } = await setup();
    // A keypress on the fake backend reports no delivery verdict, so its
    // effect is dispatched-unknown — the unverified repeat this guard exists
    // for. Two are ordinary retries; the third is a loop.
    const args = { key: "enter", include_screenshot: false };
    const first = await call("computer_press_key", args);
    expect(first.isError).not.toBe(true);
    const second = await call("computer_press_key", args);
    expect(second.isError).not.toBe(true);
    const third = await call("computer_press_key", args);
    expect(third.isError).toBe(true);
    expect(resultJson(third)).toMatchObject({
      error: { code: "repeated_unverified_action" },
    });
    expect(backend.callsFor("pressKey")).toHaveLength(2);
  });
  it("does not turn lease refusals into repeated input or block a later corrected call", async () => {
    const { backend, manager, call } = await setup();
    try {
      await manager.pressKey("owner", "tab");
      const args = { key: "enter", include_screenshot: false };
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const refused = await call("computer_press_key", args);
        expect(resultJson(refused)).toMatchObject({
          error: { code: "computer_controlled_by_other_thread" },
        });
      }
      expect(backend.callsFor("pressKey")).toHaveLength(1);
      await manager.releaseDesktopControl("owner");
      expect((await call("computer_press_key", args)).isError).not.toBe(true);
      expect(backend.callsFor("pressKey")).toHaveLength(2);
    } finally {
      await manager.dispose();
    }
  });
  it("retains uncertain native errors and their diagnostics in the audit", async () => {
    const { backend, manager, call } = await setup();
    const diagnostics = {
      delivery_path: "ax" as const,
      actuator: "ax_press" as const,
      ax_error: -25202,
    };
    const key = vi
      .spyOn(backend, "pressKey")
      .mockRejectedValue(
        new CuaActionError(
          "Native action failed.",
          "dispatched-unknown",
          "cua_action_failed",
          undefined,
          diagnostics,
        ),
      );
    const audit = vi.spyOn(manager, "recordComputerAudit");
    try {
      const args = { key: "enter", include_screenshot: false };
      expect(resultJson(await call("computer_press_key", args))).toMatchObject({
        error: "cua_action_failed",
        effect: "dispatched-unknown",
        diagnostics,
      });
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          effect: "dispatched-unknown",
          code: "cua_action_failed",
          diagnostics,
        }),
      );
      await call("computer_press_key", args);
      expect(resultJson(await call("computer_press_key", args))).toMatchObject({
        error: { code: "repeated_unverified_action" },
      });
      expect(key).toHaveBeenCalledTimes(2);
    } finally {
      key.mockRestore();
      await manager.dispose();
    }
  });

  it("refuses the repeat before the approval prompt and before dispatch", async () => {
    // The guard fires ahead of consent: a refused loop must not spend an
    // approval prompt on an action that will not run.
    let approvals = 0;
    const { backend, call } = await setup(new FakeComputerBackend(), async () => {
      approvals += 1;
      return true;
    });
    const args = { key: "enter", include_screenshot: false };
    await call("computer_press_key", args);
    await call("computer_press_key", args);
    const refused = await call("computer_press_key", args);
    expect(refused.isError).toBe(true);
    expect(resultJson(refused)).toMatchObject({
      error: { code: "repeated_unverified_action" },
    });
    expect(approvals).toBe(2);
    expect(backend.callsFor("pressKey")).toHaveLength(2);
  });

  it("does not guard reads — repeated get_state calls still answer", async () => {
    const { backend, call } = await setup();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await call("computer_get_state", { include_screenshot: false });
      expect(result.isError).not.toBe(true);
    }
    // computer_read_clipboard sits in the approval set for privacy, but a
    // re-read is not a mutating loop: it is deliberately out of the guard.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await call("computer_read_clipboard", {});
      expect(result.isError).not.toBe(true);
    }
    expect(backend.callsFor("readClipboard")).toHaveLength(4);
  });

  it("resolves semantic actions from a fresh snapshot and reports backend calls", async () => {
    const { backend, call } = await setup();
    const result = await call("computer_click", {
      label: "Calculate",
      role: "button",
    });
    expect(result.isError).not.toBe(true);
    expect(backend.callsFor("click")).toHaveLength(1);
    expect(backend.callsFor("click")[0]?.args[0]).toEqual({ x: 1_180, y: 228 });

    const setValue = await call("computer_set_value", {
      label: "Display",
      value: "468",
    });
    expect(setValue.isError).not.toBe(true);
    expect(backend.callsFor("setValue")).toHaveLength(1);

    const selectText = await call("computer_select_text", {
      label: "Display",
      start: 0,
      length: 2,
    });
    expect(selectText.isError).not.toBe(true);
    const selectCalls = backend.callsFor("selectText");
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]?.args[0]).toMatchObject({
      node: expect.objectContaining({ label: "Display" }),
    });
    expect(selectCalls[0]?.args[1]).toEqual({ start: 0, length: 2 });
    // The fake's read-back is the substring the range covers: "468"[0..2].
    expect(resultJson(selectText)).toMatchObject({
      action: "computer_select_text",
      value: "46",
    });
  });

  it("refuses invalid targets with structured candidate data", async () => {
    const { call } = await setup();
    const result = await call("computer_click", { label: "does not exist" });
    expect(result.isError).toBe(true);
    const text = result.content.find((entry) => entry.type === "text");
    const structured = text && text.type === "text" ? JSON.parse(text.text) : null;
    expect(structured.error.code).toBe("computer_target_not_found");
    expect(structured.error.candidates.length).toBeGreaterThan(0);
  });

  it("refuses clipboard text past the byte limit before it reaches the backend", async () => {
    const { backend, call } = await setup();
    const result = await call("computer_write_clipboard", {
      text: "x".repeat(MAX_COMPUTER_CLIPBOARD_BYTES + 1),
    });
    expect(result.isError).toBe(true);
    expect(backend.callsFor("writeClipboard")).toHaveLength(0);
  });

  /**
   * MCP tool arguments are never validated against their JSON Schemas, so
   * these bounds are enforced at the tool layer: an oversized set_value that
   * fell back to typed keystrokes would hold the exclusive desktop lease and
   * the turn for hours, and thousands of hotkey keys would hold the seat
   * indefinitely as press/release pairs.
   */

  it("refuses control-off mutations even for a gated provider without touching the backend", async () => {
    const { backend, manager, call } = await setup();
    try {
      await manager.setControlEnabled(THREAD, false);
      const refused = await call("computer_click", { x: 10, y: 10 });
      expect(refused.isError).toBe(true);
      expect(backend.callsFor("click")).toHaveLength(0);
    } finally {
      await manager.setControlEnabled(THREAD, true);
      await manager.dispose();
    }
  });

  it("refuses malformed select_text ranges and x/y targets before the backend", async () => {
    const { backend, call } = await setup();

    for (const args of [
      { label: "Display" },
      { label: "Display", start: 0 },
      { label: "Display", start: -1, length: 1 },
      { label: "Display", start: 0, length: -1 },
      { label: "Display", start: 0.5, length: 1 },
      { label: "Display", start: 0, length: COMPUTER_SELECT_TEXT_RANGE_MAX + 1 },
      // A coordinate cannot name which characters a range covers — refused
      // outright rather than resolving the window's first writable field.
      { x: 100, y: 200, start: 0, length: 1 },
    ]) {
      const result = await call("computer_select_text", args);
      expect(result.isError).toBe(true);
    }
    expect(backend.callsFor("selectText")).toHaveLength(0);
    expect(backend.callsFor("getState")).toHaveLength(0);

    const caret = await call("computer_select_text", {
      label: "Display",
      start: 1,
      length: 0,
    });
    expect(caret.isError).not.toBe(true);
    expect(backend.callsFor("selectText")).toHaveLength(1);
  });

  it("refuses a second thread's actions without encouraging retry loops and keeps its perception", async () => {
    const { backend, call, manager, see } = await setup();
    await see("thread-a");

    // The first action to land owns the desktop; nothing asks for it explicitly.
    const owned = await call("computer_click", { x: 10, y: 10 }, undefined, "thread-a");
    expect(owned.isError).not.toBe(true);

    const blocked = await call("computer_type_text", { text: "hello" }, undefined, "thread-b");
    expect(blocked.isError).toBe(true);
    expect(resultJson(blocked)).toMatchObject({
      error: {
        code: "computer_controlled_by_other_thread",
        retryable: false,
        message: expect.stringContaining("another conversation"),
      },
    });
    // The refusal happens before the backend, so the loser never moves anything.
    expect(backend.callsFor("typeText")).toHaveLength(0);

    // Reading the desktop is never arbitrated: the blocked thread can keep
    // watching, which is what makes "try again later" actionable advice. (The
    // state call gives the zoom that follows it a screenshot to point into.)
    for (const [name, args] of [
      ["computer_list_windows", {}],
      ["computer_get_state", { include_screenshot: true }],
      ["computer_get_screen_size", {}],
      ["computer_screenshot", { x: 0, y: 0, width: 100, height: 100 }],
    ] as const) {
      const perception = await call(name, args, undefined, "thread-b");
      expect(perception.isError).not.toBe(true);
    }

    // Turn end hands the desktop over; the roles then swap.
    await manager.releaseDesktopControl("thread-a");
    const handover = await call("computer_type_text", { text: "hello" }, undefined, "thread-b");
    expect(handover.isError).not.toBe(true);
    const nowBlocked = await call("computer_click", { x: 1, y: 1 }, undefined, "thread-a");
    expect(resultJson(nowBlocked)).toMatchObject({
      error: { code: "computer_controlled_by_other_thread" },
    });
  });

  /**
   * Models spell an omitted optional field as an explicit `null` all the time.
   * Deciding "this scroll has a target" from which keys are present read that
   * as a target, built an empty one, and had it refused as
   * computer_target_invalid — a hard failure for a request that meant "scroll
   * wherever the pointer is".
   */

  /**
   * The JSON Schema bound is advisory: nothing validates MCP tool arguments
   * against it before dispatch. Unclamped, a duration of 1e9 held the pointer
   * button — and the exclusive desktop lease — for eleven days.
   */

  it("never hands the model an image larger than it will actually be shown", async () => {
    // Above roughly 1568 px on the long edge a vision API downscales the picture
    // before the model sees it, so the model reads coordinates off an image the
    // server never produced and the mapping is wrong by that ratio.
    const { backend, byName, call } = await setup();
    const schema = byName.get("computer_screenshot")?.definition.inputSchema as {
      properties: { max_dimension: { maximum: number } };
    };
    expect(schema.properties.max_dimension.maximum).toBe(DEFAULT_COMPUTER_CAPTURE_MAX_DIMENSION);
    expect(DEFAULT_COMPUTER_CAPTURE_MAX_DIMENSION).toBe(1_536);

    // The schema bound is advisory — nothing validates MCP arguments against it
    // — so the request is clamped here too.
    await call("computer_screenshot", {
      window_id: "fake-terminal",
      max_dimension: 8_000,
    });
    expect(backend.callsFor("captureScreenshot").at(-1)?.args[0]).toEqual({
      kind: "window",
      windowId: "fake-terminal",
      maxDimension: DEFAULT_COMPUTER_CAPTURE_MAX_DIMENSION,
    });
  });
});

describe("agent gateway computer setup prompts", () => {
  /** One tool call against a backend whose window read fails the given way. */
  async function readFailingWith(error: unknown) {
    const backend = Object.assign(new FakeComputerBackend(), {
      listWindows: () => Promise.reject(error),
    });
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });
    const setupPrompts: string[] = [];
    const tools = makeAgentGatewayComputerTools({
      manager,
      onSetupRequired: ({ toolName }) => Effect.sync(() => void setupPrompts.push(toolName)),
    });
    const tool = tools.find((entry) => entry.definition.name === "computer_list_windows")!;
    const result = await Effect.runPromise(tool.handler({}, makeContext()));
    return { result, setupPrompts };
  }

  it("prompts for setup when the desktop withheld an OS permission", async () => {
    const { result, setupPrompts } = await readFailingWith(
      new ComputerBackendError("Screen Recording is not granted.", {
        setupRequired: true,
      }),
    );
    expect(result.isError).toBe(true);
    expect(setupPrompts).toEqual(["computer_list_windows"]);
  });

  /** One `computer_list_windows` against a backend that succeeds but is blocked. */
  async function readWith(overrides: Partial<FakeComputerBackend>) {
    const backend = Object.assign(new FakeComputerBackend(), overrides);
    const manager = new ComputerManager({ backend, actionSettleMs: 0 });
    const prompts: {
      toolName: string;
      missing: readonly string[];
      buildSignature?: string;
    }[] = [];
    const tools = makeAgentGatewayComputerTools({
      manager,
      onSetupRequired: ({ toolName, missing, buildSignature }) =>
        Effect.sync(
          () =>
            void prompts.push({
              toolName,
              missing,
              ...(buildSignature ? { buildSignature } : {}),
            }),
        ),
    });
    const tool = tools.find((entry) => entry.definition.name === "computer_list_windows")!;
    const result = await Effect.runPromise(tool.handler({}, makeContext()));
    const text = result.content.find((part) => part.type === "text")?.text ?? "";
    return { result, prompts, text };
  }

  it("reads the missing grants fresh on every call, never from the previous answer", async () => {
    // The live failure this signature exists to prevent: the user granted Screen
    // Recording between two tool calls, the second call re-read a cached
    // "missing", and the card and the model's refusal stayed on screen over a
    // desktop that already worked.
    let granted = false;
    const { prompts } = await readWith({
      missingPermissions: () => {
        const answer = granted ? [] : ["screenRecording"];
        granted = true;
        return Promise.resolve(answer as readonly ComputerPermission[]);
      },
    });
    expect(prompts).toEqual([{ toolName: "computer_list_windows", missing: ["screenRecording"] }]);

    const second = await readWith({
      missingPermissions: () => Promise.resolve([]),
    });
    expect(second.prompts).toEqual([]);
  });
});

describe("computer operation ordering", () => {
  it("keeps pane input after the action observation and refuses a queued call from an ended turn", async () => {
    const { backend, manager, byName, call } = await setup();
    let finish = () => {};
    let entered = () => {};
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pressKey = backend.pressKey.bind(backend);
    backend.pressKey = async (key) => {
      const result = await pressKey(key);
      entered();
      await held;
      return result;
    };
    const events: string[] = [];
    const capture = backend.captureScreenshot.bind(backend);
    backend.captureScreenshot = async (request) => {
      events.push("capture");
      return capture(request);
    };
    const type = backend.typeText.bind(backend);
    backend.typeText = async (text) => {
      events.push("pane input");
      return type(text);
    };
    let active = true;
    try {
      const first = call("computer_press_key", { key: "enter" });
      await started;
      const paneInput = manager.typeText(undefined, "human");
      const context = {
        ...makeContext(),
        assertCallerTurnActive: () =>
          active
            ? Effect.void
            : Effect.fail(
                new GatewayToolError("caller_turn_inactive", "The requesting turn ended."),
              ),
      };
      const next = Effect.runPromise(
        byName.get("computer_press_key")!.handler({ key: "escape" }, context),
      );
      active = false;
      expect(events).toEqual([]);
      finish();
      await first;
      await paneInput;
      expect((await next).isError).toBe(true);
      expect(events).toEqual(["capture", "pane input"]);
      expect(backend.callsFor("pressKey")).toHaveLength(1);
    } finally {
      finish();
      await manager.dispose();
    }
  });

  it("refuses a queued mutation flipped off mid-queue without new backend calls", async () => {
    const { backend, manager, call } = await setup();
    let finish = () => {};
    let entered = () => {};
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pressKey = backend.pressKey.bind(backend);
    backend.pressKey = async (...args: Parameters<typeof pressKey>) => {
      const result = await pressKey(...args);
      entered();
      await held;
      return result;
    };
    try {
      const first = call("computer_press_key", { key: "enter" });
      await started;
      const queued = call("computer_press_key", { key: "escape" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const disabling = manager.setControlEnabled(THREAD, false);
      finish();
      await disabling;
      await first;
      const queuedResult = await queued;
      expect(queuedResult.isError).toBe(true);
      expect(backend.callsFor("pressKey")).toHaveLength(1);
      await manager.setControlEnabled(THREAD, true);
    } finally {
      finish();
      await manager.dispose();
    }
  });
});

it("does not substitute a new window from another process for the target screenshot", async () => {
  const backend = new FakeComputerBackend();
  const before = (await backend.listWindows()).map((window) => ({
    ...window,
    pid: 10,
  }));
  backend.emitWindowsChanged(before);
  const { call } = await setup(backend);
  backend.pressKey = async () => {
    backend.emitWindowsChanged([
      ...before,
      { ...before[0]!, id: "unrelated-popup", pid: 20, stackingIndex: 0 },
    ]);
    return {};
  };
  const result = await call("computer_press_key", {
    key: "enter",
    window_id: "fake-terminal",
  });
  expect(resultJson(result)).toMatchObject({
    screenshot: { windowId: "fake-terminal" },
  });
});

it("allows human input between conditional wait observations and stops polling when control is revoked", async () => {
  const { backend, manager, call } = await setup();
  const reading = Promise.withResolvers<void>();
  const getState = backend.getState.bind(backend);
  backend.getState = async (...args: Parameters<typeof getState>) => {
    const state = await getState(...args);
    reading.resolve();
    return state;
  };
  try {
    const waiting = call("computer_wait", {
      duration_ms: 1000,
      label: "Never exists",
      window_id: "fake-calculator",
      include_screenshot: false,
    });
    await reading.promise;
    await manager.typeText(undefined, "human input");
    expect(backend.callsFor("typeText")).toHaveLength(1);
    await manager.setControlEnabled(THREAD, false);
    const reads = backend.callsFor("getState").length;
    expect((await waiting).isError).toBe(true);
    expect(backend.callsFor("getState")).toHaveLength(reads);
    expect(backend.callsFor("click")).toHaveLength(0);
  } finally {
    await manager.dispose();
  }
});

describe("computer never-raise gate", () => {
  const refusing = async () => ({ userRequestedVisibleUse: false });

  it("refuses activate without the user's task-text authorization, and raises nothing", async () => {
    const backend = new FakeComputerBackend();
    const approval = vi.fn(async () => true);
    const { call, manager } = await setup(backend, approval, refusing);
    try {
      const refused = await call("computer_activate_window", { window_id: "fake-calculator" });
      expect(refused.isError).toBe(true);
      const payload = resultJson(refused) as { error: string; effect: string; message: string };
      expect(payload.error).toBe("foreground_not_requested");
      expect(payload.effect).toBe("not-dispatched");
      expect(payload.message).toContain("did not ask");
      expect(backend.callsFor("raiseWindow")).toEqual([]);
      expect(backend.callsFor("focusWindow")).toEqual([]);
    } finally {
      await manager.dispose();
    }
  });

  it("asks on the approval card before the queue and raises once the user allows it", async () => {
    const backend = new FakeComputerBackend();
    let granted = false;
    const consent = vi.fn(async () => {
      granted = true;
      return true;
    });
    const { call, manager } = await setup(
      backend,
      async () => true,
      async () => ({ userRequestedVisibleUse: granted }),
      consent,
    );
    try {
      const raised = await call("computer_activate_window", { window_id: "fake-calculator" });
      expect(raised.isError).not.toBe(true);
      expect(consent).toHaveBeenCalledTimes(1);
      expect(backend.callsFor("raiseWindow").length).toBeGreaterThan(0);
      // The grant holds for the turn: a second raise does not prompt again.
      await call("computer_activate_window", { window_id: "fake-calculator" });
      expect(consent).toHaveBeenCalledTimes(1);
    } finally {
      await manager.dispose();
    }
  });

  it("refuses foreground delivery without authorization and dispatches nothing", async () => {
    const backend = new FakeComputerBackend();
    const approval = vi.fn(async () => true);
    const { call, manager } = await setup(backend, approval, refusing);
    try {
      const refused = await call("computer_press_key", {
        key: "enter",
        window_id: "fake-calculator",
        delivery_mode: "foreground",
      });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(resultJson(refused))).toContain("foreground_not_requested");
      expect(backend.callsFor("pressKey")).toEqual([]);
    } finally {
      await manager.dispose();
    }
  });
});

describe("computer_inspect", () => {
  // The route is provider-agnostic; one gated and one gate-less provider cover
  // both approval branches.

  it("refuses unknown routes, invalid schemas and extra fields before any backend call", async () => {
    const authorize = vi.fn(async () => true);
    const { backend, manager, call } = await setup(new FakeComputerBackend(), authorize);
    try {
      for (const args of [
        { tool: "computer_click", arguments: { x: 2, y: 3 } },
        { tool: "computer_inspect", arguments: { tool: "computer_read_clipboard" } },
        { tool: "computer_future" },
        { tool: "mcp__glade__computer_read_clipboard" },
        { tool: "computer_read_clipboard", arguments: { text: "private" } },
        { tool: "computer_read_clipboard", arguments: [] },
        { tool: "computer_read_clipboard", arguments: null },
        { tool: "computer_get_cursor_position", arguments: { window_id: 42 } },
        { tool: "computer_zoom", arguments: { window_id: "fake-calculator" } },
        {
          tool: "computer_zoom",
          arguments: { window_id: "fake-calculator", x: "1", y: 0, width: 4, height: 4 },
        },
        {
          tool: "computer_zoom",
          arguments: { window_id: "fake-calculator", x: 1, y: 0, width: Infinity, height: 4 },
        },
        { tool: "computer_get_accessibility_tree", delivery_mode: "foreground" },
      ]) {
        expect((await call("computer_inspect", args)).isError).toBe(true);
      }
      expect(backend.calls).toHaveLength(0);
      expect(authorize).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });
});

describe("computer_run", () => {
  it("stops at the first failure and reports which step and why", async () => {
    const { backend, manager, call } = await setup();
    backend.failNext("typeText", new ComputerBackendError("seat unavailable"));
    try {
      const result = await call("computer_run", {
        steps: [
          { type: "click", label: "Display", window_id: "fake-calculator" },
          { type: "type_text", text: "1" },
          { type: "press_key", key: "enter" },
        ],
      });
      expect(result.isError).not.toBe(true);
      const payload = resultJson(result) as {
        steps: { step: number; ok: boolean; error?: { message?: string } }[];
        completed: number;
        stopped: boolean;
      };
      expect(payload.stopped).toBe(true);
      expect(payload.completed).toBe(1);
      expect(payload.steps).toHaveLength(2);
      expect(payload.steps[1]).toMatchObject({
        step: 1,
        type: "type_text",
        ok: false,
        error: { message: "seat unavailable" },
      });
      // The third step never dispatched.
      expect(backend.callsFor("pressKey")).toHaveLength(0);
    } finally {
      await manager.dispose();
    }
  });

  it("refuses a malformed batch whole, before anything dispatches", async () => {
    const { backend, manager, call } = await setup();
    try {
      for (const steps of [
        [{ type: "click", label: "Display" }, { type: "levitate" }],
        [{ type: "type_text", text: "hi", bogus: true }],
        [{ type: "type_text" }],
        [{ type: "click", label: "Display" }, 42],
      ]) {
        const result = await call("computer_run", { steps });
        expect(result.isError).toBe(true);
      }
      expect(backend.callsFor("click")).toHaveLength(0);
      expect(backend.callsFor("typeText")).toHaveLength(0);
    } finally {
      await manager.dispose();
    }
  });

  it("asks approval once for the declared list and dispatches nothing when refused", async () => {
    const backend = new FakeComputerBackend();
    const approval = vi.fn(async (_name: string) => false);
    const { call, manager } = await setup(backend, approval);
    try {
      const refused = await call("computer_run", {
        steps: [{ type: "click", label: "Display", window_id: "fake-calculator" }],
      });
      expect(refused.isError).toBe(true);
      expect(approval).toHaveBeenCalledTimes(1);
      expect(approval.mock.calls[0]?.[0]).toBe("computer_run");
      expect(backend.callsFor("click")).toHaveLength(0);
    } finally {
      await manager.dispose();
    }
  });

  it("propagates a dead turn instead of reporting a half-run as data", async () => {
    const { backend, manager, byName } = await setup();
    let checks = 0;
    const context = {
      ...makeContext(),
      assertCallerTurnActive: () => {
        checks += 1;
        return checks <= 2
          ? Effect.void
          : Effect.fail(new GatewayToolError("caller_turn_inactive", "The requesting turn ended."));
      },
    };
    try {
      const result = await Effect.runPromise(
        byName.get("computer_run")!.handler(
          {
            steps: [
              { type: "click", label: "Display", window_id: "fake-calculator" },
              { type: "type_text", text: "1" },
            ],
          },
          context,
        ),
      );
      expect(result.isError).toBe(true);
      // The turn died before step two: one click dispatched, nothing typed.
      expect(backend.callsFor("click")).toHaveLength(1);
      expect(backend.callsFor("typeText")).toHaveLength(0);
    } finally {
      await manager.dispose();
    }
  });
});

describe("computer_paste", () => {
  it("saves, pastes, and restores the shared clipboard", async () => {
    const { backend, manager, call } = await setup();
    try {
      await call("computer_write_clipboard", { text: "keep me" });
      const result = await call("computer_paste", {
        text: "pasted text",
        window_id: "fake-calculator",
      });
      expect(result.isError).not.toBe(true);
      expect(resultJson(result)).toMatchObject({
        action: "computer_paste",
        clipboardRestored: true,
      });
      expect(backend.callsFor("hotkey").map((entry) => entry.args[0])).toEqual([["ctrl", "v"]]);
      const clipboard = resultJson(await call("computer_read_clipboard", {})) as {
        value: string;
      };
      expect(clipboard.value).toBe("keep me");
    } finally {
      await manager.dispose();
    }
  });

  it("still restores the clipboard when the paste dispatch fails", async () => {
    const { backend, manager, call } = await setup();
    try {
      await call("computer_write_clipboard", { text: "user text" });
      backend.failNext("hotkey");
      const result = await call("computer_paste", {
        text: "agent text",
        window_id: "fake-calculator",
      });
      expect(result.isError).toBe(true);
      expect(backend.callsFor("writeClipboard").map((entry) => entry.args[0])).toEqual([
        "user text",
        "agent text",
        "user text",
      ]);
    } finally {
      await manager.dispose();
    }
  });
});

describe("multi-app driving", () => {
  describe("native driver parity tools", () => {
    it("lists apps, verifies state, and zooms without approval or dispatch", async () => {
      const { backend, manager, call } = await setup();
      try {
        const apps = await call("computer_list_apps", {});
        expect(apps.isError).not.toBe(true);
        const appList = resultJson(apps) as { apps: { pid: number; name: string }[] };
        expect(appList.apps.map((app) => app.pid)).toContain(1002);

        const verified = await call("computer_verify_state", {
          window_id: "fake-calculator",
          expect: [{ window: { bounds: { x: 1050, y: 120, tolerance_px: 4 } } }],
        });
        expect(verified.isError).not.toBe(true);
        expect(resultJson(verified)).toMatchObject({ status: "satisfied" });
        expect(backend.callsFor("verifyState").map((entry) => entry.args[0])).toEqual([
          "fake-calculator",
        ]);

        backend.setVerifySatisfied(false);
        const unsatisfied = await call("computer_verify_state", {
          window_id: "fake-calculator",
          expect: [{ element: { selector: { role: "AXButton" }, exists: true } }],
        });
        expect(resultJson(unsatisfied)).toMatchObject({ status: "unsatisfied" });

        const zoomed = await call("computer_zoom", {
          window_id: "fake-calculator",
          x: 10,
          y: 10,
          width: 100,
          height: 80,
        });
        expect(zoomed.isError).not.toBe(true);
        expect(zoomed.content.map((entry) => entry.type)).toEqual(["text", "image"]);
        expect(zoomed.content[1]).toMatchObject({ mimeType: "image/jpeg" });
        // The magnified frame must not become a coordinate frame: a click aimed
        // from it would land off-target.
        expect(resultJson(zoomed)).not.toHaveProperty("screenshot.screenshotId");

        const outOfBounds = await call("computer_zoom", {
          window_id: "fake-calculator",
          x: 400,
          y: 0,
          width: 100,
          height: 80,
        });
        expect(outOfBounds.isError).toBe(true);
      } finally {
        await manager.dispose();
      }
    });

    it("asks approval before invoking menus and force-quitting, dispatching nothing when refused", async () => {
      const backend = new FakeComputerBackend();
      const approval = vi.fn(async () => false);
      const { call, manager } = await setup(backend, approval);
      try {
        for (const [name, args] of [
          ["computer_invoke_menu", { window_id: "fake-calculator", path: ["File", "Save"] }],
          ["computer_kill_app", { window_id: "fake-calculator" }],
        ] as const) {
          const refused = await call(name, args);
          expect(refused.isError).toBe(true);
        }
        expect(backend.callsFor("invokeMenu")).toHaveLength(0);
        expect(backend.callsFor("killApp")).toHaveLength(0);
        expect(approval.mock.calls.map((entry) => (entry as unknown[])[0])).toEqual([
          "computer_invoke_menu",
          "computer_kill_app",
        ]);
      } finally {
        await manager.dispose();
      }
    });
  });

  describe("GLADE_CUA_CAPTURE_REUSE", () => {
    const FLAG = "GLADE_CUA_CAPTURE_REUSE";
    let savedFlag: string | undefined;

    const setFlag = (value: string | undefined) => {
      if (savedFlag === undefined) savedFlag = process.env[FLAG];
      if (value === undefined) delete process.env[FLAG];
      else process.env[FLAG] = value;
    };

    afterEach(() => {
      if (savedFlag !== undefined) process.env[FLAG] = savedFlag;
      else delete process.env[FLAG];
      savedFlag = undefined;
    });

    it("never lets one thread's picture stand in for another's", async () => {
      setFlag("1");
      const { call, manager } = await setup();
      try {
        const first = resultJson(
          await call("computer_screenshot", { window_id: "fake-calculator" }),
        ) as { screenshot: { screenshotId: string } };
        const second = resultJson(
          await call(
            "computer_screenshot",
            { window_id: "fake-calculator" },
            undefined,
            "other-thread",
          ),
        ) as { screenshot: { screenshotId: string }; screenshotUnchanged?: boolean };
        expect(second.screenshot.screenshotId).not.toBe(first.screenshot.screenshotId);
        expect(second.screenshotUnchanged).toBeUndefined();
      } finally {
        await manager.dispose();
      }
    });
  });
});

describe("element refs", () => {
  type ListedElement = {
    ref: number;
    role: string;
    label: string;
    windowId: string | null;
    value?: string;
  };
  const elementsOf = (result: McpToolCallResult): ListedElement[] =>
    (resultJson(result) as { elements?: ListedElement[] }).elements ?? [];

  it("keeps a ref bound to the same element across listings", async () => {
    const { backend, call, manager } = await setup();
    try {
      const first = elementsOf(await call("computer_get_state", {}));
      const calculate = first.find((element) => element.label === "Calculate")!;

      // A scoped second listing still shows the same number for it — refs do
      // not re-seat when the model narrows or widens its view.
      const second = elementsOf(await call("computer_get_state", { window_id: "fake-calculator" }));
      expect(second.find((element) => element.label === "Calculate")?.ref).toBe(calculate.ref);

      const result = await call("computer_click", { ref: calculate.ref });
      expect(result.isError).not.toBe(true);
      expect(backend.callsFor("click").at(-1)?.args[0]).toEqual({ x: 1180, y: 228 });
    } finally {
      await manager.dispose();
    }
  });

  it("refuses a ref no listing ever minted, and a ref mixed with coordinates", async () => {
    const { call, manager } = await setup();
    try {
      const before = await call("computer_click", { ref: 0 });
      expect(before.isError).toBe(true);
      const beforeText = before.content.find((entry) => entry.type === "text");
      expect(beforeText?.type === "text" ? beforeText.text : "").toContain("computer_get_state");

      await call("computer_get_state", {});
      const outOfRange = await call("computer_click", { ref: 999 });
      expect(outOfRange.isError).toBe(true);
      const outText = outOfRange.content.find((entry) => entry.type === "text");
      expect(outText?.type === "text" ? outText.text : "").toContain("999");

      const mixed = await call("computer_click", { ref: 0, x: 10, y: 10 });
      expect(mixed.isError).toBe(true);
      const mixedText = mixed.content.find((entry) => entry.type === "text");
      expect(mixedText?.type === "text" ? mixedText.text : "").toContain("x/y");
    } finally {
      await manager.dispose();
    }
  });

  it("keeps refs thread-scoped", async () => {
    const { call, manager } = await setup();
    try {
      const elements = elementsOf(await call("computer_get_state", {}));
      const ref = elements[0]!.ref;
      const other = await call("computer_click", { ref }, undefined, "other-thread");
      expect(other.isError).toBe(true);
      const text = other.content.find((entry) => entry.type === "text");
      expect(text?.type === "text" ? text.text : "").toContain("computer_get_state");
    } finally {
      await manager.dispose();
    }
  });
});
