import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalRequestId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { fullAccessTurnOverrides, createRequestHarness } from "./requestHarness.testSupport";
import {
  createCollabNotificationHarness,
  handleServerRequestForTest,
} from "./notificationHarness.testSupport";

describe("respondToRequest", () => {
  it("keeps acceptForSession active for later Codex turns", async () => {
    const { manager, context, requireSession, writeMessage, emitEvent, sendRequest } =
      createRequestHarness("approval-required", true);

    await manager.respondToRequest(
      ThreadId.makeUnsafe("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );

    expect(requireSession).toHaveBeenCalledWith("thread_1");
    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 42,
      result: {
        decision: "acceptForSession",
      },
    });
    expect(context.sessionApprovalOverride).toEqual(fullAccessTurnOverrides);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "item/requestApproval/decision",
        lifecycleGeneration: "generation-request-a",
        requestKind: "command",
        payload: {
          requestId: "req-approval-1",
          requestKind: "command",
          decision: "acceptForSession",
        },
      }),
    );

    await manager.sendTurn({
      threadId: ThreadId.makeUnsafe("thread_1"),
      input: "Continue without asking again",
    });

    expect(sendRequest).toHaveBeenLastCalledWith(context, "turn/start", {
      threadId: "thread_1",
      ...fullAccessTurnOverrides,
      summary: "auto",
      input: [
        {
          type: "text",
          text: "Continue without asking again",
          text_elements: [],
        },
      ],
      model: "gpt-5.3-codex",
    });
  });

  it("auto-resolves later approval requests during an always-allowed Codex session", async () => {
    const { manager, context, writeMessage, emitEvent } = createRequestHarness(
      "approval-required",
      true,
    );

    await manager.respondToRequest(
      ThreadId.makeUnsafe("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );
    writeMessage.mockClear();
    emitEvent.mockClear();

    await (
      manager as unknown as {
        handleServerRequest: (context: unknown, request: Record<string, unknown>) => Promise<void>;
      }
    ).handleServerRequest(context, {
      jsonrpc: "2.0",
      id: 99,
      method: "item/fileChange/requestApproval",
      params: {
        turnId: "turn_2",
        itemId: "item_file_change",
        path: "apps/web/src/components/chat/ComposerPendingApprovalActions.tsx",
      },
    });

    expect(context.pendingApprovals.size).toBe(0);
    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 99,
      result: {
        decision: "acceptForSession",
      },
    });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "notification",
        method: "item/requestApproval/decision",
        turnId: "turn_2",
        itemId: "item_file_change",
        requestKind: "file-change",
        payload: expect.objectContaining({
          requestKind: "file-change",
          decision: "acceptForSession",
        }),
      }),
    );
    expect(
      emitEvent.mock.calls.some(([event]) => (event as { kind?: string }).kind === "request"),
    ).toBe(false);
  });

  it("keeps later permission-profile requests interactive during an always-allowed session", async () => {
    const { manager, context, writeMessage, emitEvent } = createRequestHarness(
      "approval-required",
      true,
    );
    const permissions = {
      network: { enabled: true },
      fileSystem: { read: ["/tmp/example"] },
    };

    await manager.respondToRequest(
      ThreadId.makeUnsafe("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );
    writeMessage.mockClear();
    emitEvent.mockClear();

    await handleServerRequestForTest(manager, context, {
      id: 100,
      method: "item/permissions/requestApproval",
      params: {
        turnId: "turn_2",
        itemId: "item_permissions",
        permissions,
      },
    });

    expect(context.pendingApprovals.size).toBe(1);
    expect(Array.from(context.pendingApprovals.values())[0]).toEqual(
      expect.objectContaining({
        method: "item/permissions/requestApproval",
        requestedPermissions: permissions,
      }),
    );
    expect(writeMessage).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "request",
        method: "item/permissions/requestApproval",
        requestKind: "permissions",
      }),
    );
  });

  it("does not sweep a pending permission-profile request into always allow", async () => {
    const { manager, context, writeMessage } = createRequestHarness("approval-required", true);
    const permissions = {
      network: { enabled: true },
    };

    await handleServerRequestForTest(manager, context, {
      id: 101,
      method: "item/permissions/requestApproval",
      params: {
        turnId: "turn_1",
        itemId: "item_permissions",
        permissions,
      },
    });
    const permissionRequestId = Array.from(context.pendingApprovals.keys()).find(
      (requestId) => requestId !== "req-approval-1",
    );
    if (permissionRequestId === undefined) {
      throw new Error("Expected the permission-profile request to remain pending.");
    }

    await manager.respondToRequest(
      ThreadId.makeUnsafe("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );

    expect(context.pendingApprovals.has(permissionRequestId)).toBe(true);
    expect(writeMessage).not.toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        id: 101,
      }),
    );
  });

  it("leaves pending MCP tool approvals alone when a command is accepted for the session", async () => {
    const { manager, context, writeMessage } = createRequestHarness("approval-required", true);

    await handleServerRequestForTest(manager, context, {
      id: 100,
      method: "mcpServer/elicitation/request",
      params: {
        turnId: "turn_2",
        mode: "form",
        message: "Approve this tool call",
        _meta: {
          codex_approval_kind: "mcp_tool_call",
          persist: ["session"],
          tool_name: "computer_launch_app",
          tool_params_display: [{ name: "app", value: "kcalc" }],
        },
      },
    });

    const mcpRequest = [...context.pendingApprovals.values()].find(
      (request) => String(request.method) === "mcpServer/elicitation/request",
    );
    if (!mcpRequest) {
      throw new Error("Expected the MCP tool approval to remain pending.");
    }

    await manager.respondToRequest(
      ThreadId.makeUnsafe("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );

    expect(context.pendingApprovals.has(mcpRequest.requestId)).toBe(true);
    expect(writeMessage).not.toHaveBeenCalledWith(context, expect.objectContaining({ id: 100 }));
  });
});

describe("MCP tool call elicitation approvals", () => {
  const approvalParams = (persist: ReadonlyArray<string> | string = ["session"]) => ({
    threadId: "provider_parent",
    turnId: "turn_mcp",
    serverName: "glade",
    mode: "form",
    message: "Allow Glade to launch the calculator?",
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      persist,
      tool_name: "computer_launch_app",
      tool_params: { app: "kcalc" },
      tool_params_display: [{ name: "app", value: "kcalc", display_name: "app" }],
    },
  });

  function computerApprovalHarness() {
    const harness = createCollabNotificationHarness();
    const context = Object.assign(harness.context, {
      enableComputerControl: true,

      gatewaySessionLease: { release: vi.fn() } as { release: () => void } | undefined,
    });
    context.session.runtimeMode = "approval-required";
    context.session.activeTurnId = "turn_mcp";
    return { ...harness, context };
  }

  it("delegates exact active Glade Computer calls to gateway consent without persistent permission", async () => {
    const { manager, context, emitEvent, writeMessage } = computerApprovalHarness();
    for (const toolName of ["computer_click", "computer_type_text", "computer_read_clipboard"]) {
      const params = approvalParams();
      params._meta.tool_name = toolName;
      await handleServerRequestForTest(manager, context, {
        id: toolName,
        method: "mcpServer/elicitation/request",
        params,
      });
      expect(writeMessage).toHaveBeenCalledWith(context, {
        id: toolName,
        result: { action: "accept", content: null, _meta: null },
      });
    }
    expect(context.pendingApprovals.size).toBe(0);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it.each([
    "other-server",
    "disabled",
    "no-lease",
    "retired",
    "stopping",
    "inactive",
    "stale-turn",
    "child-thread",
  ])("preserves provider approval for %s requests", async (condition) => {
    const { manager, context, emitEvent, writeMessage } = computerApprovalHarness();
    const params = approvalParams();
    switch (condition) {
      case "other-server":
        params.serverName = "other";
        break;
      case "disabled":
        context.enableComputerControl = false;
        break;
      case "no-lease":
        context.gatewaySessionLease = undefined;
        break;
      case "retired":
        context.gatewayCredentialRetired = true;
        break;
      case "stopping":
        context.stopping = true;
        break;
      case "inactive":
        context.session.status = "ready";
        break;
      case "stale-turn":
        params.turnId = "turn_old";
        break;
      case "child-thread":
        params.threadId = "provider_child";
        break;
    }
    await handleServerRequestForTest(manager, context, {
      id: 74,
      method: "mcpServer/elicitation/request",
      params,
    });
    expect(context.pendingApprovals.size).toBe(1);
    expect(writeMessage).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "request", requestKind: "tool" }),
    );
  });

  describe("in Full Access", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function fullAccessHarness(onCatalogRead: () => void = () => {}) {
      const harness = computerApprovalHarness();
      harness.context.enableComputerControl = false;
      harness.context.session.runtimeMode = "full-access";
      harness.context.gatewaySessionLease = {
        release: vi.fn(),
        connection: { url: "http://127.0.0.1:1/mcp", bearerToken: "lease-token" },
      } as { release: () => void };
      const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
        onCatalogRead();
        const { id } = JSON.parse(String(init?.body)) as { id: string };
        const tools = ["glade_send_message", "glade_read_thread"].map((name) => ({
          name,
          description: name,
          inputSchema: { type: "object" },
        }));
        return Response.json({ jsonrpc: "2.0", id, result: { tools } });
      });
      vi.stubGlobal("fetch", fetchMock);
      return { ...harness, fetchMock };
    }

    const sendMessageParams = () => {
      const params = approvalParams();
      params._meta.tool_name = "glade_send_message";
      return params;
    };

    it("accepts a single served gateway call without persistent permission", async () => {
      const { manager, context, emitEvent, writeMessage } = fullAccessHarness();
      await handleServerRequestForTest(manager, context, {
        id: 80,
        method: "mcpServer/elicitation/request",
        params: sendMessageParams(),
      });
      expect(writeMessage).toHaveBeenCalledWith(context, {
        id: 80,
        result: { action: "accept", content: null, _meta: null },
      });
      expect(context.pendingApprovals.size).toBe(0);
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it.each([
      "unserved-tool",
      "other-server",
      "approval-required",
      "auto",
      "stale-turn",
      "retired",
      "stopping",
      "no-lease",
      "catalog-unavailable",
      "stopped-during-catalog",
    ])("preserves provider approval for %s requests", async (condition) => {
      let stopDuringCatalog = false;
      const { manager, context, emitEvent, writeMessage, fetchMock } = fullAccessHarness(() => {
        if (stopDuringCatalog) context.stopping = true;
      });
      const params = sendMessageParams();
      switch (condition) {
        case "unserved-tool":
          params._meta.tool_name = "glade_send_message_anywhere";
          break;
        case "other-server":
          params.serverName = "other";
          break;
        case "approval-required":
        case "auto":
          context.session.runtimeMode = condition;
          break;
        case "stale-turn":
          params.turnId = "turn_old";
          break;
        case "retired":
          context.gatewayCredentialRetired = true;
          break;
        case "stopping":
          context.stopping = true;
          break;
        case "no-lease":
          context.gatewaySessionLease = undefined;
          break;
        case "catalog-unavailable":
          fetchMock.mockRejectedValueOnce(new Error("gateway unavailable"));
          break;
        case "stopped-during-catalog":
          stopDuringCatalog = true;
          break;
      }
      await handleServerRequestForTest(manager, context, {
        id: 81,
        method: "mcpServer/elicitation/request",
        params,
      });
      expect(context.pendingApprovals.size).toBe(1);
      expect(writeMessage).not.toHaveBeenCalled();
      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "request", requestKind: "tool" }),
      );
    });
  });

  it("tracks approval elicitations as tool requests and accepts them with the MCP response shape", async () => {
    const { manager, context, emitEvent, writeMessage } = createCollabNotificationHarness();

    await handleServerRequestForTest(manager, context, {
      id: 70,
      method: "mcpServer/elicitation/request",
      params: approvalParams(),
    });

    const pendingRequest = Array.from(context.pendingApprovals.values())[0];
    expect(pendingRequest).toEqual(
      expect.objectContaining({
        method: "mcpServer/elicitation/request",
        requestKind: "tool",
        mcpSessionPersistenceAdvertised: true,
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "request",
        requestKind: "tool",
        payload: expect.objectContaining({
          _meta: expect.objectContaining({
            tool_name: "computer_launch_app",
            tool_params_display: [{ name: "app", value: "kcalc", display_name: "app" }],
          }),
        }),
      }),
    );

    await manager.respondToRequest(
      ThreadId.makeUnsafe("thread_1"),
      pendingRequest.requestId,
      "accept",
    );

    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 70,
      result: { action: "accept", content: null, _meta: null },
    });
  });

  it.each([
    ["acceptForSession", ["session"], { persist: "session" }],
    ["acceptForSession", ["always"], null],
    ["acceptForSession", "session", { persist: "session" }],
  ] as const)(
    "maps %s with persist=%j to the protocol response",
    async (decision, persist, meta) => {
      const { manager, context, writeMessage } = createCollabNotificationHarness();

      await handleServerRequestForTest(manager, context, {
        id: 71,
        method: "mcpServer/elicitation/request",
        params: approvalParams(persist),
      });
      const pendingRequest = Array.from(context.pendingApprovals.values())[0];
      await manager.respondToRequest(
        ThreadId.makeUnsafe("thread_1"),
        pendingRequest.requestId,
        decision,
      );

      expect(writeMessage).toHaveBeenCalledWith(context, {
        id: 71,
        result: { action: "accept", content: null, _meta: meta },
      });
    },
  );
});
