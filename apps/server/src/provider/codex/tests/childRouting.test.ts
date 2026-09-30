import { describe, expect, it } from "vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  createCollabNotificationHarness,
  handleServerRequestForTest,
} from "./notificationHarness.testSupport";

describe("collab child conversation routing", () => {
  it("tracks the current collabToolCall receiver shape", () => {
    const { manager, context } = createCollabNotificationHarness();

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/started",
      params: {
        item: {
          type: "collabToolCall",
          id: "call_collab_current",
          receiverThreadId: "child_provider_current",
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
