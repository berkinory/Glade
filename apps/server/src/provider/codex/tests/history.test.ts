import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { createRequestHarness } from "./requestHarness.testSupport";
import { attachFakeGatewayLease } from "./notificationHarness.testSupport";

describe("thread checkpoint control", () => {
  it("does not spawn a fork runtime after cancellation during version discovery", async () => {
    const { manager, sendRequest } = createRequestHarness();
    let releaseVersionCheck!: () => void;
    let versionCheckStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      versionCheckStarted = resolve;
    });
    vi.spyOn(
      manager as unknown as { assertSupportedCodexCliVersion: () => Promise<void> },
      "assertSupportedCodexCliVersion",
    ).mockImplementation(() => {
      versionCheckStarted();
      return new Promise<void>((resolve) => {
        releaseVersionCheck = resolve;
      });
    });
    const controller = new AbortController();
    const copied = manager.forkThread(
      {
        sourceThreadId: ThreadId.makeUnsafe("source"),
        threadId: ThreadId.makeUnsafe("target"),
        sourceResumeCursor: { threadId: "source" },
        cwd: os.tmpdir(),
        runtimeMode: "full-access",
      },
      controller.signal,
    );
    const failure = expect(copied).rejects.toThrow();
    await started;
    controller.abort();
    releaseVersionCheck();
    await failure;
    expect(manager.listSessions()).toEqual([]);
    expect(sendRequest).not.toHaveBeenCalled();
  });
  it("reads full paginated history and preserves native turn timestamps", async () => {
    const { manager, context, sendRequest } = createRequestHarness();
    sendRequest
      .mockRejectedValueOnce(
        new Error("includeTurns is not supported for paginated threads; use thread/turns/list"),
      )
      .mockResolvedValueOnce({ thread: { id: "thread_1", cwd: "/repo/source" } })
      .mockResolvedValueOnce({
        data: [
          {
            id: "turn_1",
            itemsView: "full",
            status: "completed",
            startedAt: 1700000000,
            completedAt: 1700000005,
            items: [{ type: "userMessage" }],
          },
        ],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "turn_2",
            itemsView: "full",
            status: "completed",
            items: [{ type: "agentMessage", text: "done" }],
          },
        ],
        nextCursor: null,
      });
    const result = await manager.readThread(ThreadId.makeUnsafe("thread_1"));
    expect(result.cwd).toBe("/repo/source");
    expect(result.turns).toEqual([
      {
        id: "turn_1",
        status: "completed",
        startedAt: 1700000000,
        completedAt: 1700000005,
        items: [{ type: "userMessage" }],
      },
      { id: "turn_2", status: "completed", items: [{ type: "agentMessage", text: "done" }] },
    ]);
    expect(sendRequest).toHaveBeenNthCalledWith(4, context, "thread/turns/list", {
      threadId: "thread_1",
      itemsView: "full",
      sortDirection: "asc",
      limit: 100,
      cursor: "page-2",
    });
  });

  it("rejects repeated native history cursors instead of looping or truncating silently", async () => {
    const { manager, sendRequest } = createRequestHarness();
    sendRequest
      .mockRejectedValueOnce(new Error("full history is unavailable for paginated threads"))
      .mockResolvedValueOnce({ thread: { id: "thread_1" } })
      .mockResolvedValue({ data: [], nextCursor: "same-page" });
    await expect(manager.readThread(ThreadId.makeUnsafe("thread_1"))).rejects.toThrow("repeated");
    expect(sendRequest).toHaveBeenCalledTimes(4);
  });

  it("forks a provider thread with an explicitly selected Standard tier", async () => {
    const homePath = mkdtempSync(path.join(os.tmpdir(), "glade-codex-fork-tier-"));
    writeFileSync(path.join(homePath, "app-server"), "process.stdin.resume();\n");
    const previousGladeHome = process.env.GLADE_HOME;
    process.env.GLADE_HOME = path.join(homePath, "glade-home");
    const { manager, sendRequest } = createRequestHarness();
    vi.spyOn(
      manager as unknown as { assertSupportedCodexCliVersion: () => Promise<void> },
      "assertSupportedCodexCliVersion",
    ).mockResolvedValue(undefined);
    sendRequest.mockResolvedValue({ thread: { id: "thread_forked", turns: [] } });

    try {
      const fork = manager.forkThread({
        sourceThreadId: ThreadId.makeUnsafe("thread_1"),
        sourceResumeCursor: {
          threadId: "thread_1",
        },
        threadId: ThreadId.makeUnsafe("thread_2"),
        lifecycleGeneration: "fork-generation",
        forkPoint: { provider: "codex", turnId: TurnId.makeUnsafe("chosen-earlier-turn") },
        cwd: homePath,
        providerOptions: { codex: { binaryPath: process.execPath, homePath } },
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: { fastMode: false },
        },
        runtimeMode: "full-access",
      });
      const result = await fork;
      const forkRequest = sendRequest.mock.calls.find(([, method]) => method === "thread/fork");
      expect(forkRequest?.[2]).toMatchObject({
        threadId: "thread_1",
        deferGoalContinuation: true,
        serviceTier: "default",
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      });
      expect(forkRequest?.[2]).toMatchObject({ lastTurnId: "chosen-earlier-turn" });
      expect(forkRequest?.[0]).toMatchObject({ lifecycleGeneration: "fork-generation" });
      expect(
        sendRequest.mock.calls.some(
          ([, method]) => method === "thread/resume" || method === "turn/start",
        ),
      ).toBe(false);
      expect(result).toEqual({
        threadId: "thread_2",
        resumeCursor: {
          threadId: "thread_forked",
        },
      });
    } finally {
      await manager.stopAll();
      if (previousGladeHome === undefined) {
        delete process.env.GLADE_HOME;
      } else {
        process.env.GLADE_HOME = previousGladeHome;
      }
      rmSync(homePath, { recursive: true, force: true });
    }
  });

  it.each([1, 100, 101])(
    "resolves only the newest %i turn ids and accepts unloaded retained history",
    async (count) => {
      const { manager, context, sendRequest, updateSession } = createRequestHarness();
      let transferredTurns = 0;
      sendRequest.mockImplementation(async (_context, method, params) => {
        if (method === "thread/turns/list") {
          const size = Number(params?.limit);
          const start = transferredTurns;
          transferredTurns += size;
          return {
            data: Array.from({ length: size }, (_, index) => ({ id: `turn-${start + index}` })),
            nextCursor: `page-${transferredTurns}`,
          };
        }
        if (method === "thread/revert")
          return { thread: { id: "thread_1", turns: [], nextCursor: "retained-history" } };
        throw new Error(`Unexpected request: ${method}`);
      });
      await expect(
        manager.rollbackThread(ThreadId.makeUnsafe("thread_1"), count),
      ).resolves.toBeUndefined();
      expect(sendRequest).toHaveBeenCalledTimes(Math.ceil(count / 100) + 1);
      expect(transferredTurns).toBe(count);
      expect(sendRequest).toHaveBeenLastCalledWith(context, "thread/revert", {
        threadId: "thread_1",
        beforeTurnId: `turn-${count - 1}`,
      });
      expect(
        sendRequest.mock.calls
          .filter(([, method]) => method === "thread/turns/list")
          .every(
            ([, , params]) => params?.itemsView === "notLoaded" && params?.sortDirection === "desc",
          ),
      ).toBe(true);
      expect(updateSession).toHaveBeenCalledWith(context, {
        status: "ready",
        activeTurnId: undefined,
      });
    },
  );

  it.each([
    {
      name: "excessive rewind",
      pages: [{ data: [{ id: "last" }], nextCursor: null }],
      issue: "missing",
    },
    { name: "empty page", pages: [{ data: [], nextCursor: "next" }], issue: "missing" },
    { name: "missing id", pages: [{ data: [{}], nextCursor: null }], issue: "missing" },
    {
      name: "duplicate turn",
      pages: [{ data: [{ id: "last" }, { id: "last" }], nextCursor: null }],
      issue: "repeated",
    },
    {
      name: "duplicate cursor",
      pages: [
        { data: [{ id: "last" }], nextCursor: "same" },
        { data: [{ id: "previous" }], nextCursor: "same" },
      ],
      issue: "cursor",
    },
  ])("rejects $name without mutating native history", async ({ pages, issue }) => {
    const { manager, sendRequest, updateSession } = createRequestHarness();
    for (const page of pages) sendRequest.mockResolvedValueOnce(page);
    await expect(manager.rollbackThread(ThreadId.makeUnsafe("thread_1"), 3)).rejects.toThrow(issue);
    expect(sendRequest.mock.calls.every(([, method]) => method === "thread/turns/list")).toBe(true);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("does not revert a replacement session after reading a boundary", async () => {
    const { manager, context, requireSession, sendRequest } = createRequestHarness();
    sendRequest.mockImplementation(async () => {
      requireSession.mockReturnValue({ ...context, lifecycleGeneration: "replacement" });
      return { data: [{ id: "last" }], nextCursor: null };
    });
    await expect(manager.rollbackThread(ThreadId.makeUnsafe("thread_1"), 1)).rejects.toThrow(
      "session changed",
    );
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("does not treat a failed native rollback as permission to discard history", async () => {
    const { manager, sendRequest } = createRequestHarness();
    sendRequest.mockRejectedValue(new Error("rollback failed: storage unavailable"));
    await expect(manager.rollbackThread(ThreadId.makeUnsafe("thread_1"), 1)).rejects.toThrow(
      "storage unavailable",
    );
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("cancels the exact gateway turn even when Codex omits MCP cancellation notifications", async () => {
    const { manager, context, sendRequest } = createRequestHarness();
    let settleCancellation: (() => void) | undefined;
    context.session.status = "running";
    context.session.activeTurnId = "turn-with-live-browser-wait";
    const { cancelTurn, release } = attachFakeGatewayLease(context, {
      cancelTurn: () =>
        new Promise<void>((resolve) => {
          settleCancellation = resolve;
        }),
    });
    sendRequest.mockResolvedValue({});

    let interruptSettled = false;
    const interrupt = manager.interruptTurn(ThreadId.makeUnsafe("thread_1")).then(() => {
      interruptSettled = true;
    });
    await vi.waitFor(() => expect(cancelTurn).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(interruptSettled).toBe(false);
    expect(cancelTurn).toHaveBeenCalledWith("turn-with-live-browser-wait");
    expect(release).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/interrupt", {
      threadId: "thread_1",
      turnId: "turn-with-live-browser-wait",
    });
    settleCancellation?.();
    await interrupt;
    expect(interruptSettled).toBe(true);
  });

  it("tombstones the parent gateway turn when stopping one collab child", async () => {
    const { manager, context, sendRequest } = createRequestHarness();
    context.session.status = "running";
    context.session.activeTurnId = "turn-parent";
    const { cancelTurn, release } = attachFakeGatewayLease(context);
    sendRequest.mockResolvedValue({});

    await manager.interruptTurn(
      ThreadId.makeUnsafe("thread_1"),
      TurnId.makeUnsafe("turn-child"),
      "provider-child",
    );

    expect(cancelTurn).toHaveBeenCalledOnce();
    expect(cancelTurn).toHaveBeenCalledWith("turn-parent");
    expect(release).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/interrupt", {
      threadId: "provider-child",
      turnId: "turn-child",
    });
  });
});
