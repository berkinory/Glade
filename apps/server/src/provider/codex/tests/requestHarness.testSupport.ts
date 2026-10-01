import { vi } from "vitest";
import { ApprovalRequestId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { CodexAppServerManager } from "../codexAppServerManager";

export const fullAccessTurnOverrides = {
  approvalPolicy: "never",
  approvalsReviewer: "user",
  sandboxPolicy: { type: "dangerFullAccess" },
} as const;

export function createRequestHarness(
  runtimeMode: RuntimeMode = "full-access",
  pendingApproval = false,
) {
  const manager = new CodexAppServerManager();
  const context = {
    lifecycleGeneration: "generation-request-a",
    session: {
      provider: "codex",
      status: "ready",
      threadId: "thread_1",
      runtimeMode,
      model: "gpt-5.3-codex",
      activeTurnId: undefined as string | undefined,
      resumeCursor: { threadId: "thread_1" },
      createdAt: "2026-02-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
    },
    account: { type: "unknown", planType: null, sparkEnabled: true },
    pendingApprovals: new Map(
      pendingApproval
        ? [
            [
              ApprovalRequestId.makeUnsafe("req-approval-1"),
              {
                requestId: ApprovalRequestId.makeUnsafe("req-approval-1"),
                jsonRpcId: 42,
                method: "item/commandExecution/requestApproval" as const,
                requestKind: "command" as const,
                threadId: ThreadId.makeUnsafe("thread_1"),
              },
            ] as const,
          ]
        : [],
    ),
    pendingUserInputs: new Map(),
    sessionApprovalOverride: undefined as typeof fullAccessTurnOverrides | undefined,
    collabReceiverTurns: new Map<string, string>(),
    collabReceiverParents: new Map<string, string>(),
    reviewTurnIds: new Set<string>(),
  };
  // Replace the private transport boundary while exercising the manager's request and policy logic.
  const transport = manager as unknown as {
    requireSession: (threadId: string) => unknown;
    sendRequest: (
      context: unknown,
      method: string,
      params?: Record<string, unknown>,
    ) => Promise<unknown>;
    writeMessage: (...args: unknown[]) => Promise<void>;
    updateSession: (...args: unknown[]) => void;
    emitEvent: (...args: unknown[]) => void;
  };
  const requireSession = vi.spyOn(transport, "requireSession").mockReturnValue(context);
  const sendRequest = vi
    .spyOn(transport, "sendRequest")
    .mockImplementation(async (_context, method) => {
      if (method === "turn/start") return { turn: { id: "turn_1" } };
      throw new Error(`Unexpected Codex request: ${method}`);
    });
  const writeMessage = vi.spyOn(transport, "writeMessage").mockResolvedValue(undefined);
  const updateSession = vi.spyOn(transport, "updateSession").mockImplementation(() => {});
  const emitEvent = vi.spyOn(transport, "emitEvent").mockImplementation(() => {});

  return { manager, context, requireSession, sendRequest, writeMessage, updateSession, emitEvent };
}
