import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { ProviderKind } from "@glade/contracts/core/baseSchemas";

import { ComputerBackendError } from "../computer/ComputerBackend.ts";
import { ComputerManager } from "../computer/ComputerManager.ts";
import { FakeComputerBackend } from "../computer/FakeComputerBackend.ts";

import {
  COMPUTER_APPROVAL_REQUIRED_TOOLS,
  makeAgentGatewayComputerTools,
  type AgentGatewayComputerToolsOptions,
} from "./computerTools.ts";
import {
  canonicalGladeComputerToolName,
  isGladeComputerToolFamilyName,
  GLADE_COMPUTER_TOOL_NAMES,
} from "./computerToolPermission.ts";
import type { McpToolCallResult } from "./protocol.ts";
import type { ToolContext } from "./toolRuntime.ts";

const THREAD = "thread-gap4";

function resultJson(result: McpToolCallResult): unknown {
  const text = result.content.find((entry) => entry.type === "text");
  return text?.type === "text" ? JSON.parse(text.text) : undefined;
}

function resultText(result: McpToolCallResult): string {
  return result.content.map((entry) => (entry.type === "text" ? entry.text : "")).join("\n");
}

function makeContext(provider: ProviderKind = "claudeAgent", threadId = THREAD): ToolContext {
  return {
    principal: {
      kind: "provider-session",
      sessionKey: "gateway-session:gap4",
      threadId,
      provider,
      turnId: "turn-gap4",
    },
    callerThreadId: threadId,
    callerThreadLabel: null,
    callerSessionKey: "gateway-session:gap4",
    callerProvider: provider,
    callerCapabilities: new Set(["computer:control"]),
    callerTurnId: "turn-gap4",
    assertCallerTurnActive: () => Effect.void,
    jsonRpcRequestId: 1,
  };
}

async function setup(
  backend = new FakeComputerBackend(),
  authorizeAction?: AgentGatewayComputerToolsOptions["authorizeAction"],
) {
  const manager = new ComputerManager({ backend, actionSettleMs: 0 });
  const tools = makeAgentGatewayComputerTools({
    manager,

    resolveForegroundAuthorization: async () => ({ userRequestedVisibleUse: true }),
    ...(authorizeAction ? { authorizeAction } : {}),
  });
  const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  const call = async (
    name: string,
    args: Record<string, unknown>,
    provider?: ProviderKind,
    threadId?: string,
  ): Promise<McpToolCallResult> => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`no such tool: ${name}`);
    return await Effect.runPromise(tool.handler(args, makeContext(provider, threadId)));
  };
  return { backend, manager, tools, byName, call };
}

describe("computer_set_window_frame", () => {
  it("is approval-gated and moves the exact window, reporting a verified result", async () => {
    const approval = vi.fn(async () => true);
    const backend = new FakeComputerBackend();
    const { call } = await setup(backend, approval);
    expect(COMPUTER_APPROVAL_REQUIRED_TOOLS.has("computer_set_window_frame")).toBe(true);

    const result = await call("computer_set_window_frame", {
      window_id: "fake-calculator",
      x: 200,
      y: 300,
      width: 800,
      height: 600,
    });
    expect(approval).toHaveBeenCalledWith(
      "computer_set_window_frame",
      expect.objectContaining({ window_id: "fake-calculator" }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.isError).not.toBe(true);
    const payload = resultJson(result) as {
      action: string;
      windowId: string;
      delivery?: { verified: string; effect?: string };
    };
    expect(payload.action).toBe("computer_set_window_frame");
    expect(payload.windowId).toBe("fake-calculator");
    expect(payload.delivery).toMatchObject({ verified: "confirmed", effect: "verified" });

    const windows = await backend.listWindows();
    expect(windows.find((window) => window.id === "fake-calculator")?.bounds).toEqual({
      x: 200,
      y: 300,
      width: 800,
      height: 600,
    });
  });

  it("refuses a nonpositive frame and an unknown window before dispatch", async () => {
    const approval = vi.fn(async () => true);
    const backend = new FakeComputerBackend();
    const { call } = await setup(backend, approval);

    const badSize = await call("computer_set_window_frame", {
      window_id: "fake-calculator",
      x: 0,
      y: 0,
      width: 0,
      height: 480,
    });
    expect(badSize.isError).toBe(true);
    const missingWindow = await call("computer_set_window_frame", {
      window_id: "no-such-window",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(missingWindow.isError).toBe(true);
    const missingId = await call("computer_set_window_frame", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(missingId.isError).toBe(true);
    expect(backend.callsFor("setWindowFrame")).toEqual([]);
  });

  it("dispatches nothing when approval is refused", async () => {
    const approval = vi.fn(async () => false);
    const backend = new FakeComputerBackend();
    const { call } = await setup(backend, approval);
    const result = await call("computer_set_window_frame", {
      window_id: "fake-calculator",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(result.isError).toBe(true);
    expect(backend.callsFor("setWindowFrame")).toEqual([]);
    expect(
      (await backend.listWindows()).find((window) => window.id === "fake-calculator")?.bounds,
    ).toEqual({ x: 1_050, y: 120, width: 420, height: 620 });
  });
});

describe("computer_invoke_menu", () => {
  it("is approval-gated and invokes the exact path on the window's app", async () => {
    const approval = vi.fn(async () => true);
    const backend = new FakeComputerBackend();
    const { call } = await setup(backend, approval);
    expect(COMPUTER_APPROVAL_REQUIRED_TOOLS.has("computer_invoke_menu")).toBe(true);

    const result = await call("computer_invoke_menu", {
      window_id: "fake-terminal",
      path: ["File", "Save"],
    });
    expect(result.isError).not.toBe(true);
    const payload = resultJson(result) as {
      action: string;
      windowId: string;
      delivery?: { verified: string };
    };
    expect(payload.action).toBe("computer_invoke_menu");
    expect(payload.windowId).toBe("fake-terminal");
    expect(backend.callsFor("invokeMenu").at(-1)?.args).toEqual([
      { windowId: "fake-terminal" },
      ["File", "Save"],
    ]);
  });

  it("preserves a disabled-item refusal instead of falling back to pixels", async () => {
    const approval = vi.fn(async () => true);
    const backend = new FakeComputerBackend();
    backend.refuseMenuPath(
      ["Edit", "Undo"],
      new ComputerBackendError("The menu item is disabled.", {
        rejectedOperation: "invokeMenu",
      }),
    );
    const { call } = await setup(backend, approval);
    const result = await call("computer_invoke_menu", {
      window_id: "fake-terminal",
      path: ["Edit", "Undo"],
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("disabled");

    const replay = await call("computer_invoke_menu", {
      window_id: "fake-terminal",
      path: ["Edit", "Undo"],
    });
    expect(replay.isError).toBe(true);
  });
});

describe("tool-name registry", () => {
  it("owns every served tool name in all three provider spellings", async () => {
    const { byName } = await setup();
    for (const name of [
      "computer_list_apps",
      "computer_set_window_frame",
      "computer_invoke_menu",
      "computer_verify_state",
      "computer_zoom",
      "computer_get_accessibility_tree",
      "computer_get_cursor_position",
      "computer_kill_app",
      "computer_set_window_minimized",
      "computer_set_app_visibility",
    ]) {
      expect(byName.has(name), `gateway serves ${name}`).toBe(true);
      expect(GLADE_COMPUTER_TOOL_NAMES).toContain(name);
      expect(canonicalGladeComputerToolName(`glade_${name}`)).toBe(name);
      expect(canonicalGladeComputerToolName(`mcp__glade__${name}`)).toBe(name);
      expect(isGladeComputerToolFamilyName(name)).toBe(true);
    }
  });
});
