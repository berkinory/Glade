import { describe, expect, it, vi } from "vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  createCollabNotificationHarness,
  handleServerRequestForTest,
  handleServerNotificationForTest,
} from "./notificationHarness.testSupport";

describe("collab child conversation routing", () => {
  it("reads a native child on activity without resuming it or mutating the parent turn", async () => {
    const { manager, context, emitEvent, updateSession } = createCollabNotificationHarness();
    // Exercise the private transport boundary with a provider-authored snapshot.
    const boundary = manager as unknown as {
      sessions: Map<ThreadId, unknown>;
      sendRequest: (...args: unknown[]) => Promise<unknown>;
    };
    boundary.sessions.set(context.session.threadId, context);
    const request = vi.spyOn(boundary, "sendRequest").mockResolvedValue({
      thread: {
        id: "native_child",
        agentNickname: "Euclid",
        model: "gpt-6.1-sol",
        turns: [
          {
            id: "child_turn",
            status: "completed",
            items: [
              {
                type: "subAgentActivity",
                id: "inherited_spawn",
                kind: "started",
                agentThreadId: "native_child",
                agentPath: "/root/worker",
              },
              { type: "agentMessage", id: "child_message", text: "done" },
            ],
          },
        ],
      },
    });
    handleServerNotificationForTest(manager, context, {
      method: "item/completed",
      params: {
        threadId: "provider_parent",
        turnId: "turn_parent",
        item: {
          type: "subAgentActivity",
          id: "native_activity",
          kind: "completed",
          agentThreadId: "native_child",
          agentPath: "/root/worker",
        },
      },
    });
    await vi.waitFor(() => {
      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "item/completed",
          providerThreadId: "native_child",
          providerParentThreadId: "provider_parent",
          turnId: "child_turn",
          payload: expect.objectContaining({
            item: expect.objectContaining({ id: "child_message", text: "done" }),
          }),
        }),
      );
    });
    expect(emitEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "turn/started", providerThreadId: "native_child" }),
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(context, "thread/read", {
      threadId: "native_child",
      includeTurns: true,
    });
    expect(updateSession).not.toHaveBeenCalled();
    const projected = emitEvent.mock.calls.length;
    handleServerNotificationForTest(manager, context, {
      method: "item/completed",
      params: {
        threadId: "provider_parent",
        turnId: "turn_parent",
        item: {
          type: "subAgentActivity",
          id: "native_activity_repeat",
          kind: "completed",
          agentThreadId: "native_child",
          agentPath: "/root/worker",
        },
      },
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emitEvent.mock.calls.length).toBe(projected + 1);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("retries a newly announced child whose native rollout is still empty", async () => {
    const { manager, context, emitEvent } = createCollabNotificationHarness();
    // Hold the real transport boundary at the native initialization race.
    const boundary = manager as unknown as {
      sessions: Map<ThreadId, unknown>;
      sendRequest: (...args: unknown[]) => Promise<unknown>;
    };
    boundary.sessions.set(context.session.threadId, context);
    const request = vi
      .spyOn(boundary, "sendRequest")
      .mockRejectedValueOnce(
        new Error("thread/read failed: rollout at /native/child.jsonl is empty"),
      )
      .mockResolvedValue({
        thread: {
          id: "native_child",
          agentNickname: "Euclid",
          turns: [
            {
              id: "child_turn",
              status: "completed",
              items: [{ type: "agentMessage", id: "message", text: "done" }],
            },
          ],
        },
      });
    handleServerNotificationForTest(manager, context, {
      method: "item/completed",
      params: {
        threadId: "provider_parent",
        turnId: "turn_parent",
        item: {
          type: "subAgentActivity",
          id: "activity",
          kind: "started",
          agentThreadId: "native_child",
        },
      },
    });
    await vi.waitFor(
      () =>
        expect(emitEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            providerThreadId: "native_child",
            method: "item/completed",
            payload: expect.objectContaining({ item: expect.objectContaining({ text: "done" }) }),
          }),
        ),
      { timeout: 3_000 },
    );
    expect(request).toHaveBeenCalledTimes(2);
    boundary.sessions.delete(context.session.threadId);
  });

  it("discards a child read that completes after its parent runtime was replaced", async () => {
    const { manager, context, emitEvent } = createCollabNotificationHarness();
    // The private transport boundary lets the test hold an actual in-flight provider read.
    const boundary = manager as unknown as {
      sessions: Map<ThreadId, unknown>;
      sendRequest: (...args: unknown[]) => Promise<unknown>;
    };
    boundary.sessions.set(context.session.threadId, context);
    let complete: ((value: unknown) => void) | undefined;
    const request = vi.spyOn(boundary, "sendRequest").mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    handleServerNotificationForTest(manager, context, {
      method: "item/completed",
      params: {
        threadId: "provider_parent",
        turnId: "turn_parent",
        item: {
          type: "subAgentActivity",
          id: "activity",
          kind: "completed",
          agentThreadId: "native_child",
        },
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
    boundary.sessions.set(context.session.threadId, {});
    emitEvent.mockClear();
    complete?.({
      thread: {
        id: "native_child",
        turns: [
          {
            id: "child_turn",
            status: "completed",
            items: [{ type: "agentMessage", id: "message", text: "late" }],
          },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it.each([
    { type: "collabToolCall", receiverThreadId: "child_provider_current" },
    {
      type: "subAgentActivity",
      agentThreadId: "child_provider_current",
      kind: "started",
      agentPath: "/root/worker",
    },
  ])("tracks native receiver routing for $type", (item) => {
    const { manager, context } = createCollabNotificationHarness();

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/started",
      params: {
        item: {
          ...item,
          id: "call_collab_current",
        },
        threadId: "provider_parent",
        turnId: "turn_parent",
      },
    });

    expect(context.collabReceiverTurns.get("child_provider_current")).toBe("turn_parent");
    expect(context.collabReceiverParents.get("child_provider_current")).toBe("provider_parent");
  });

  it("preserves child notification turn ids and annotates the parent turn", () => {
    const { manager, context, emitEvent } = createCollabNotificationHarness();

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/completed",
      params: {
        item: {
          type: "collabAgentToolCall",
          id: "call_collab_1",
          receiverThreadIds: ["child_provider_1"],
        },
        threadId: "provider_parent",
        turnId: "turn_parent",
      },
    });

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "child_provider_1",
        turnId: "turn_child_1",
        itemId: "msg_child_1",
        delta: "working",
      },
    });

    expect(emitEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "item/agentMessage/delta",
        turnId: "turn_child_1",
        parentTurnId: "turn_parent",
        itemId: "msg_child_1",
        providerThreadId: "child_provider_1",
        providerParentThreadId: "provider_parent",
      }),
    );
  });

  it("routes background child completion after the parent becomes idle without completing the parent again", () => {
    const { manager, context, emitEvent, updateSession } = createCollabNotificationHarness();
    handleServerNotificationForTest(manager, context, {
      method: "item/completed",
      params: {
        threadId: "provider_parent",
        turnId: "turn_parent",
        item: {
          type: "collabToolCall",
          id: "spawn_background",
          receiverThreadId: "child_background",
        },
      },
    });
    handleServerNotificationForTest(manager, context, {
      method: "turn/completed",
      params: { threadId: "provider_parent", turn: { id: "turn_parent", status: "completed" } },
    });
    context.session.status = "ready";
    emitEvent.mockClear();
    updateSession.mockClear();
    handleServerNotificationForTest(manager, context, {
      method: "thread/started",
      params: { thread: { id: "late_unmapped_child" } },
    });
    expect(updateSession).not.toHaveBeenCalled();
    handleServerNotificationForTest(manager, context, {
      method: "turn/completed",
      params: { threadId: "child_background", turn: { id: "turn_child", status: "completed" } },
    });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "turn/completed",
        turnId: "turn_child",
        parentTurnId: "turn_parent",
        providerThreadId: "child_background",
        providerParentThreadId: "provider_parent",
      }),
    );
    expect(updateSession).not.toHaveBeenCalled();
    emitEvent.mockClear();
    handleServerNotificationForTest(manager, context, {
      method: "item/completed",
      params: {
        threadId: "child_background",
        turnId: "turn_child",
        item: {
          type: "subAgentActivity",
          id: "message_to_parent",
          kind: "interacted",
          agentThreadId: "provider_parent",
          agentPath: "/root",
        },
      },
    });
    expect(emitEvent).not.toHaveBeenCalled();
    emitEvent.mockClear();
    handleServerNotificationForTest(manager, context, {
      method: "item/agentMessage/delta",
      params: { threadId: "provider_parent", turnId: "next_parent_turn", delta: "parent output" },
    });
    expect(emitEvent.mock.calls[0]?.[0]).toMatchObject({ providerThreadId: "provider_parent" });
    expect(emitEvent.mock.calls[0]?.[0]).not.toHaveProperty("providerParentThreadId");
    expect(emitEvent.mock.calls[0]?.[0]).not.toHaveProperty("parentTurnId");
  });

  it("preserves an inferred child approval route through the decision event", async () => {
    const { manager, context, emitEvent, writeMessage } = createCollabNotificationHarness();

    await handleServerRequestForTest(manager, context, {
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "child_provider_unmapped",
        turnId: "turn_child_unmapped",
        itemId: "call_child_unmapped",
        command: "bun install",
      },
    });

    const pendingRequest = Array.from(context.pendingApprovals.values())[0];
    expect(pendingRequest).toEqual(
      expect.objectContaining({
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
    await manager.respondToRequest(
      ThreadId.makeUnsafe("thread_1"),
      pendingRequest.requestId,
      "accept",
    );

    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 42,
      result: { decision: "accept" },
    });
    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "request",
        method: "item/commandExecution/requestApproval",
        turnId: "turn_child_unmapped",
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "notification",
        method: "item/requestApproval/decision",
        turnId: "turn_child_unmapped",
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
  });

  it("responds to permission-profile approvals with the requested native permissions", async () => {
    const { manager, context, emitEvent, writeMessage } = createCollabNotificationHarness();
    const permissions = {
      network: { enabled: true },
      fileSystem: { read: ["/tmp/example"] },
    };

    await handleServerRequestForTest(manager, context, {
      id: 45,
      method: "item/permissions/requestApproval",
      params: {
        threadId: "provider_parent",
        turnId: "turn_permissions",
        itemId: "call_permissions",
        reason: "Needs package metadata",
        permissions,
      },
    });

    const pendingRequest = Array.from(context.pendingApprovals.values())[0];
    expect(pendingRequest).toEqual(
      expect.objectContaining({
        method: "item/permissions/requestApproval",
        requestKind: "permissions",
        requestedPermissions: permissions,
      }),
    );
    await manager.respondToRequest(
      ThreadId.makeUnsafe("thread_1"),
      pendingRequest.requestId,
      "acceptForSession",
    );

    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 45,
      result: { permissions, scope: "session" },
    });
    expect(context.sessionApprovalOverride).toBeUndefined();
    expect(emitEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "item/requestApproval/decision",
        requestKind: "permissions",
      }),
    );
  });

  it("preserves an unmapped child user-input route through the answered event", async () => {
    const { manager, context, emitEvent, writeMessage } = createCollabNotificationHarness();

    await handleServerRequestForTest(manager, context, {
      id: 43,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "child_provider_unmapped",
        turnId: "turn_child_unmapped",
        itemId: "tool_child_unmapped",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope should this change target?",
            options: [{ label: "child", description: "Only the child thread" }],
          },
        ],
      },
    });

    const pendingRequest = Array.from(context.pendingUserInputs.values())[0];
    expect(pendingRequest).toEqual(
      expect.objectContaining({
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
    await manager.respondToUserInput(ThreadId.makeUnsafe("thread_1"), pendingRequest.requestId, {
      scope: "child",
    });

    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 43,
      result: {
        answers: {
          scope: { answers: ["child"] },
        },
      },
    });
    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "request",
        method: "item/tool/requestUserInput",
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "notification",
        method: "item/tool/requestUserInput/answered",
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
  });

  it("preserves child approval requests and annotates the parent turn", async () => {
    const { manager, context, emitEvent } = createCollabNotificationHarness();

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/completed",
      params: {
        item: {
          type: "collabAgentToolCall",
          id: "call_collab_1",
          receiverThreadIds: ["child_provider_1"],
        },
        threadId: "provider_parent",
        turnId: "turn_parent",
      },
    });
    emitEvent.mockClear();

    await (
      manager as unknown as {
        handleServerRequest: (context: unknown, request: Record<string, unknown>) => Promise<void>;
      }
    ).handleServerRequest(context, {
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "child_provider_1",
        turnId: "turn_child_1",
        itemId: "call_child_1",
        command: "bun install",
      },
    });

    expect(Array.from(context.pendingApprovals.values())[0]).toEqual(
      expect.objectContaining({
        turnId: "turn_child_1",
        itemId: "call_child_1",
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "item/commandExecution/requestApproval",
        turnId: "turn_child_1",
        parentTurnId: "turn_parent",
        itemId: "call_child_1",
        providerThreadId: "child_provider_1",
        providerParentThreadId: "provider_parent",
      }),
    );
  });
});
