import { describe, expect, it, vi } from "vitest";
import { CodexAppServerManager } from "../codexAppServerManager";
import { AGENT_GATEWAY_TURN_AUTHORITY_RETIRED } from "../../../agentGateway/sessionLease.ts";
import {
  createCollabNotificationHarness,
  handleServerNotificationForTest,
} from "./notificationHarness.testSupport";

describe("handleServerNotification error normalization", () => {
  it("recovers a missing turn/completed after legacy task_complete", () => {
    vi.useFakeTimers();
    try {
      const manager = new CodexAppServerManager(undefined, {
        taskCompleteFallbackGraceMs: 25,
      });
      const harness = createCollabNotificationHarness();
      const context = harness.context;
      const emitEvent = vi
        .spyOn(manager as unknown as { emitEvent: (...args: unknown[]) => void }, "emitEvent")
        .mockImplementation(() => {});
      const cancelTurn = vi.fn(() => Promise.resolve());
      const retireTurn = vi.fn(() => {
        expect(emitEvent).not.toHaveBeenCalled();
        return Promise.resolve();
      });
      Object.assign(context, {
        gatewaySessionLease: {
          connection: {
            url: "http://127.0.0.1:48123/mcp",
            bearerToken: "gateway-token",
          },
          cancelTurn,
          retireTurn,
          release: vi.fn(),
        },
      });
      const updateSession = vi
        .spyOn(
          manager as unknown as { updateSession: (...args: unknown[]) => void },
          "updateSession",
        )
        .mockImplementation(() => {});

      handleServerNotificationForTest(manager, context, {
        method: "codex/event/task_complete",
        params: {
          id: "turn_parent",
          msg: {
            type: "task_complete",
            turn_id: "turn_parent",
            last_agent_message: "Done.",
          },
        },
      });
      vi.advanceTimersByTime(25);

      expect(retireTurn).toHaveBeenCalledOnce();
      expect(retireTurn).toHaveBeenCalledWith("turn_parent");
      expect(cancelTurn).not.toHaveBeenCalled();
      expect(context.gatewayCredentialRetired).toBe(true);
      expect(updateSession).toHaveBeenCalledWith(context, {
        status: "ready",
        activeTurnId: undefined,
        lastError: undefined,
      });
      expect(emitEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          method: "turn/completed",
          turnId: "turn_parent",
          payload: expect.objectContaining({
            recoveredFrom: "codex/event/task_complete",
            [AGENT_GATEWAY_TURN_AUTHORITY_RETIRED]: true,
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("retires gateway authority before publishing every terminal parent-turn notification", () => {
    const terminalNotifications = [
      {
        expectedTurnId: "turn-completed",
        notification: {
          method: "turn/completed",
          params: {
            threadId: "provider_parent",
            turn: { id: "turn-completed", status: "completed" },
          },
        },
      },
      {
        expectedTurnId: "turn-aborted",
        notification: {
          method: "turn/aborted",
          params: {
            threadId: "provider_parent",
            turn: { id: "turn-aborted", status: "interrupted" },
          },
        },
      },
      {
        expectedTurnId: "turn-error",
        notification: {
          method: "error",
          params: {
            threadId: "provider_parent",
            turnId: "turn-error",
            error: { message: "terminal provider failure" },
            willRetry: false,
          },
        },
      },
    ];

    for (const { expectedTurnId, notification } of terminalNotifications) {
      const { manager, context, emitEvent } = createCollabNotificationHarness();
      const cancelTurn = vi.fn(() => Promise.resolve());
      const retireTurn = vi.fn(() => {
        expect(emitEvent).not.toHaveBeenCalled();
        return Promise.resolve();
      });
      Object.assign(context, {
        gatewaySessionLease: {
          connection: {
            url: "http://127.0.0.1:48123/mcp",
            bearerToken: "gateway-token",
          },
          cancelTurn,
          retireTurn,
          release: vi.fn(),
        },
      });

      handleServerNotificationForTest(manager, context, notification);

      expect(retireTurn).toHaveBeenCalledOnce();
      expect(retireTurn).toHaveBeenCalledWith(expectedTurnId);
      expect(cancelTurn).not.toHaveBeenCalled();
      expect(context.gatewayCredentialRetired).toBe(true);
      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            [AGENT_GATEWAY_TURN_AUTHORITY_RETIRED]: true,
          }),
        }),
      );
    }
  });

  it("keeps a proven-call runtime reusable after fencing a completed turn", () => {
    const { manager, context, emitEvent } = createCollabNotificationHarness();
    const registerNativeToolCall = vi.fn();
    const retireTurn = vi.fn(() => Promise.resolve());
    Object.assign(context, {
      gatewaySessionLease: {
        connection: { url: "http://localhost/mcp", bearerToken: "test" },
        registerNativeToolCall,
        retireTurn,
        cancelTurn: vi.fn(),
        release: vi.fn(),
      },
    });
    handleServerNotificationForTest(manager, context, {
      method: "item/started",
      params: {
        threadId: "provider_parent",
        turnId: "turn_parent",
        item: { id: "call-1", type: "mcpToolCall", server: "glade", tool: "write" },
      },
    });
    expect(registerNativeToolCall).toHaveBeenCalledWith({
      callId: "call-1",
      turnId: "turn_parent",
      toolName: "write",
    });
    handleServerNotificationForTest(manager, context, {
      method: "turn/completed",
      params: {
        threadId: "provider_parent",
        turn: { id: "turn_parent", status: "completed" },
      },
    });
    expect(retireTurn).toHaveBeenCalledWith("turn_parent");
    expect(context.gatewayCredentialRetired).not.toBe(true);
    expect(emitEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ [AGENT_GATEWAY_TURN_AUTHORITY_RETIRED]: true }),
      }),
    );
  });

  it("settles native review when review mode exits", () => {
    const { manager, context, updateSession, emitEvent } = createCollabNotificationHarness();
    context.reviewTurnIds.add("turn_parent");
    context.reviewTurnIds.add("turn_child");
    context.session.activeTurnId = "turn_child";

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/completed",
      params: {
        item: {
          type: "exitedReviewMode",
          id: "turn_parent",
          review: "The working tree is clean.",
        },
        threadId: "provider_parent",
      },
    });

    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "ready",
      activeTurnId: undefined,
      lastError: undefined,
    });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "notification",
        method: "turn/completed",
        turnId: "turn_child",
        threadId: "thread_1",
        payload: {
          turn: {
            id: "turn_child",
            status: "completed",
          },
        },
      }),
    );
  });

  it("clears the running session turn when Codex aborts a turn", () => {
    const { manager, context, updateSession } = createCollabNotificationHarness();

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "turn/aborted",
      params: {
        threadId: "provider_parent",
        turn: {
          id: "turn_parent",
          status: "interrupted",
        },
      },
    });

    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "ready",
      activeTurnId: undefined,
      lastError: undefined,
    });
  });
});
