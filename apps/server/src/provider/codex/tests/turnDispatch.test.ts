import { describe, expect, it } from "vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { fullAccessTurnOverrides, createRequestHarness } from "./requestHarness.testSupport";
import { handleServerNotificationForTest } from "./notificationHarness.testSupport";

const approvalRequiredTurnOverrides = {
  approvalPolicy: "untrusted",
  approvalsReviewer: "user",
  sandboxPolicy: { type: "readOnly" },
} as const;

const autoTurnOverrides = {
  approvalPolicy: "on-request",
  approvalsReviewer: "auto_review",
  sandboxPolicy: { type: "workspaceWrite" },
} as const;

describe("sendTurn", () => {
  it("allows the next turn after native compaction completes without a legacy notification", async () => {
    const { manager, context, sendRequest } = createRequestHarness();
    sendRequest.mockImplementation(async (_context, method) => {
      if (method === "thread/compact/start") return {};
      if (method === "turn/start") return { turn: { id: "next-turn" } };
      throw new Error(`Unexpected Codex request: ${method}`);
    });
    const threadId = ThreadId.makeUnsafe("thread_1");
    await manager.compactThread(threadId);
    await expect(manager.sendTurn({ threadId, input: "Continue" })).rejects.toThrow(
      "Wait for context compaction to finish.",
    );

    handleServerNotificationForTest(manager, context, {
      method: "turn/completed",
      params: { threadId: "thread_1", turn: { id: "compact-turn", status: "completed" } },
    });

    await expect(manager.sendTurn({ threadId, input: "Continue" })).resolves.toMatchObject({
      turnId: "next-turn",
    });
  });

  it("clears stale collaboration receiver routing before a new turn", async () => {
    const { manager, context } = createRequestHarness();
    context.collabReceiverTurns.set("reused-child", "old-turn");
    context.collabReceiverParents.set("reused-child", "old-parent");

    await manager.sendTurn({
      threadId: ThreadId.makeUnsafe("thread_1"),
      input: "Start the next turn",
    });

    expect(context.collabReceiverTurns.size).toBe(0);
    expect(context.collabReceiverParents.size).toBe(0);
  });

  it("sends text and image user input items to turn/start", async () => {
    const { manager, context, requireSession, sendRequest, updateSession } = createRequestHarness();

    const result = await manager.sendTurn({
      threadId: ThreadId.makeUnsafe("thread_1"),
      input: "Inspect this image",
      attachments: [
        {
          type: "image",
          url: "data:image/png;base64,AAAA",
        },
      ],
      model: "gpt-5.3",
      serviceTier: "fast",
      effort: "high",
    });

    expect(result).toEqual({
      threadId: "thread_1",
      turnId: "turn_1",
      resumeCursor: { threadId: "thread_1" },
    });
    expect(requireSession).toHaveBeenCalledWith("thread_1");
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/start", {
      threadId: "thread_1",
      ...fullAccessTurnOverrides,
      summary: "auto",
      input: [
        {
          type: "text",
          text: "Inspect this image",
          text_elements: [],
        },
        {
          type: "image",
          url: "data:image/png;base64,AAAA",
        },
      ],
      model: "gpt-5.3",
      serviceTier: "fast",
      effort: "high",
    });
    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "running",
      activeTurnId: "turn_1",
      resumeCursor: { threadId: "thread_1" },
    });
  });

  it.each([
    { runtimeMode: "approval-required", expected: approvalRequiredTurnOverrides },
    { runtimeMode: "auto", expected: autoTurnOverrides },
  ] as const)(
    "applies $runtimeMode policy to the native turn",
    async ({ runtimeMode, expected }) => {
      const { manager, context, sendRequest } = createRequestHarness(runtimeMode);
      await manager.sendTurn({
        threadId: ThreadId.makeUnsafe("thread_1"),
        input: "Make the workspace changes",
      });
      expect(sendRequest).toHaveBeenCalledWith(context, "turn/start", {
        threadId: "thread_1",
        ...expected,
        summary: "auto",
        input: [{ type: "text", text: "Make the workspace changes", text_elements: [] }],
        model: "gpt-5.3-codex",
      });
    },
  );

  it("starts a fresh turn even when the session currently reports running", async () => {
    const { manager, context, sendRequest, updateSession } = createRequestHarness();
    context.session.status = "running";
    context.session.activeTurnId = "turn_active";
    sendRequest.mockResolvedValueOnce({
      turn: { id: "turn_next" },
    });

    const result = await manager.sendTurn({
      threadId: ThreadId.makeUnsafe("thread_1"),
      input: "Focus on the failing tests first",
      attachments: [
        {
          type: "image",
          url: "data:image/png;base64,AAAA",
        },
      ],
      model: "gpt-5.4",
      serviceTier: "fast",
      effort: "high",
    });

    expect(result).toEqual({
      threadId: "thread_1",
      turnId: "turn_next",
      resumeCursor: { threadId: "thread_1" },
    });
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/start", {
      threadId: "thread_1",
      ...fullAccessTurnOverrides,
      summary: "auto",
      input: [
        {
          type: "text",
          text: "Focus on the failing tests first",
          text_elements: [],
        },
        {
          type: "image",
          url: "data:image/png;base64,AAAA",
        },
      ],
      model: "gpt-5.4",
      serviceTier: "fast",
      effort: "high",
    });
    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "running",
      activeTurnId: "turn_next",
      resumeCursor: { threadId: "thread_1" },
    });
  });
});

describe("steerTurn", () => {
  it("steers the active Codex turn when the session is already running", async () => {
    const { manager, context, sendRequest } = createRequestHarness();
    context.session.status = "running";
    context.session.activeTurnId = "turn_active";
    context.collabReceiverTurns.set("child_provider_1", "turn_active");
    sendRequest.mockResolvedValueOnce({
      turnId: "turn_active",
    });

    const result = await manager.steerTurn({
      threadId: ThreadId.makeUnsafe("thread_1"),
      input: "Keep going",
    });

    expect(result).toEqual({
      threadId: "thread_1",
      turnId: "turn_active",
      resumeCursor: { threadId: "thread_1" },
    });
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/steer", {
      threadId: "thread_1",
      input: [
        {
          type: "text",
          text: "Keep going",
          text_elements: [],
        },
      ],
      expectedTurnId: "turn_active",
    });
    expect(context.collabReceiverTurns.get("child_provider_1")).toBe("turn_active");
  });

  it("requires turn/steer to return the active turn id", async () => {
    const { manager, context, sendRequest } = createRequestHarness();
    context.session.status = "running";
    context.session.activeTurnId = "turn_active";
    sendRequest.mockResolvedValueOnce({});

    await expect(
      manager.steerTurn({
        threadId: ThreadId.makeUnsafe("thread_1"),
        input: "Keep going",
      }),
    ).rejects.toThrow("turn/steer response did not include a turn id.");
  });
});
