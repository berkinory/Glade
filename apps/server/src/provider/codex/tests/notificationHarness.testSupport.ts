import { vi } from "vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { CodexAppServerManager } from "../codexAppServerManager";

export function createCollabNotificationHarness() {
  const manager = new CodexAppServerManager();
  const context = {
    session: {
      provider: "codex",
      status: "running",
      threadId: ThreadId.makeUnsafe("thread_1"),
      runtimeMode: "full-access",
      model: "gpt-5.3-codex",
      activeTurnId: "turn_parent",
      resumeCursor: { threadId: "provider_parent" },
      createdAt: "2026-02-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
    },
    account: {
      type: "unknown",
      planType: null,
      sparkEnabled: true,
    },
    pending: new Map(),
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    sessionApprovalOverride: undefined as
      | undefined
      | {
          approvalPolicy: "never";
          approvalsReviewer: "user";
          sandboxPolicy: { type: "dangerFullAccess" };
        },
    collabReceiverTurns: new Map<string, string>(),
    collabReceiverParents: new Map<string, string>(),
    reviewTurnIds: new Set<string>(),
    gatewayCredentialRetired: false,
    nextRequestId: 1,
    stopping: false,
  };

  const emitEvent = vi
    .spyOn(manager as unknown as { emitEvent: (...args: unknown[]) => void }, "emitEvent")
    .mockImplementation(() => {});
  const updateSession = vi
    .spyOn(manager as unknown as { updateSession: (...args: unknown[]) => void }, "updateSession")
    .mockImplementation(() => {});
  const requireSession = vi
    .spyOn(
      manager as unknown as { requireSession: (threadId: ThreadId) => unknown },
      "requireSession",
    )
    .mockReturnValue(context);
  const writeMessage = vi
    .spyOn(
      manager as unknown as { writeMessage: (...args: unknown[]) => Promise<void> },
      "writeMessage",
    )
    .mockResolvedValue(undefined);

  return { manager, context, emitEvent, updateSession, requireSession, writeMessage };
}

export function handleServerNotificationForTest(
  manager: CodexAppServerManager,
  context: unknown,
  notification: Record<string, unknown>,
): void {
  (
    manager as unknown as {
      handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
    }
  ).handleServerNotification(context, notification);
}

export async function handleServerRequestForTest(
  manager: CodexAppServerManager,
  context: unknown,
  request: Record<string, unknown>,
): Promise<void> {
  await (
    manager as unknown as {
      handleServerRequest: (context: unknown, request: Record<string, unknown>) => Promise<void>;
    }
  ).handleServerRequest(context, request);
}
