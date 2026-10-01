import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { createRequestHarness } from "./requestHarness.testSupport";

describe("thread checkpoint control", () => {
  it("uses the requested binary and archive for stopped external history reads", async () => {
    const { manager, context, sendRequest } = createRequestHarness();
    const discovery = vi
      .spyOn(
        manager as unknown as {
          getOrCreateDiscoverySession: (...args: unknown[]) => Promise<unknown>;
        },
        "getOrCreateDiscoverySession",
      )
      .mockResolvedValue(context);
    const providerOptions = { codex: { binaryPath: "/custom/codex", homePath: "/custom/archive" } };
    sendRequest.mockResolvedValue({ thread: { id: "external", turns: [] } });
    await manager.readExternalThread({
      externalThreadId: "external",
      cwd: "/repo",
      providerOptions,
    });
    expect(discovery).toHaveBeenCalledWith("/repo", providerOptions);
  });
  it("does not spawn a fork runtime after import cancellation during version discovery", async () => {
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

  it.each([
    "ordinary",
    "completed",
    "empty",
    "inProgress",
    "legacy-completed",
    "legacy-unknown",
    "legacy-invalid-date",
  ])(
    "forks a provider thread with an explicitly selected Standard tier (%s)",
    async (sourceStatus) => {
      const requireCompletedSource = sourceStatus !== "ordinary";
      const homePath = mkdtempSync(path.join(os.tmpdir(), "glade-codex-fork-tier-"));
      writeFileSync(path.join(homePath, "app-server"), "process.stdin.resume();\n");
      const previousGladeHome = process.env.GLADE_HOME;
      process.env.GLADE_HOME = path.join(homePath, "glade-home");
      const { manager, sendRequest } = createRequestHarness();
      vi.spyOn(
        manager as unknown as { assertSupportedCodexCliVersion: () => Promise<void> },
        "assertSupportedCodexCliVersion",
      ).mockResolvedValue(undefined);
      sendRequest.mockResolvedValue({
        thread: {
          id: "thread_forked",
          turns:
            sourceStatus === "empty"
              ? []
              : [
                  {
                    id: "completed-source-turn",
                    ...(sourceStatus.startsWith("legacy-")
                      ? {}
                      : { status: sourceStatus === "ordinary" ? "completed" : sourceStatus }),
                    ...(sourceStatus === "legacy-completed" ? { completedAt: 1700000005 } : {}),
                    ...(sourceStatus === "legacy-invalid-date" ? { completedAt: "invalid" } : {}),
                    items: [],
                  },
                ],
        },
      });

      try {
        const fork = manager.forkThread({
          sourceThreadId: ThreadId.makeUnsafe("thread_1"),
          sourceResumeCursor: {
            threadId: "thread_1",
          },
          threadId: ThreadId.makeUnsafe("thread_2"),
          lifecycleGeneration: "import-generation",
          requireCompletedSource,
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
        if (["inProgress", "legacy-unknown", "legacy-invalid-date"].includes(sourceStatus)) {
          await expect(fork).rejects.toThrow("finish its turn");
          expect(sendRequest.mock.calls.some(([, method]) => method === "thread/fork")).toBe(false);
          return;
        }
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
        expect(forkRequest?.[2]).toMatchObject(
          requireCompletedSource
            ? {
                lastTurnId: "chosen-earlier-turn",
                excludeTurns: true,
              }
            : {},
        );
        expect(forkRequest?.[0]).toMatchObject({ lifecycleGeneration: "import-generation" });
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
    },
  );

  it("reverts turns at the native boundary and resets session running state", async () => {
    const { manager, context, sendRequest, updateSession } = createRequestHarness();
    sendRequest.mockResolvedValue({
      thread: {
        id: "thread_1",
        turns: [
          { id: "kept", items: [] },
          { id: "edited", items: [] },
          { id: "removed", items: [] },
        ],
      },
    });

    const result = await manager.rollbackThread(ThreadId.makeUnsafe("thread_1"), 2);

    expect(sendRequest).toHaveBeenCalledWith(context, "thread/revert", {
      threadId: "thread_1",
      beforeTurnId: "edited",
    });
    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "ready",
      activeTurnId: undefined,
    });
    expect(result).toEqual({
      threadId: "thread_1",
      cwd: null,
      turns: [{ id: "kept", items: [] }],
    });
  });

  it("uses the exclusive native turn boundary when paginated Codex replaces rollback", async () => {
    const { manager, context, sendRequest } = createRequestHarness();
    sendRequest.mockImplementation(async (_context, method) => {
      if (method === "thread/rollback") throw new Error("unknown variant `thread/rollback`");
      if (method === "thread/read")
        return {
          thread: {
            id: "thread_1",
            turns: [
              { id: "kept", items: [] },
              { id: "edited", items: [] },
              { id: "removed", items: [] },
            ],
          },
        };
      if (method === "thread/revert") return { thread: { id: "thread_1", turns: [] } };
      throw new Error(`Unexpected request: ${method}`);
    });
    const result = await manager.rollbackThread(ThreadId.makeUnsafe("thread_1"), 2);
    expect(sendRequest).toHaveBeenCalledWith(context, "thread/revert", {
      threadId: "thread_1",
      beforeTurnId: "edited",
    });
    expect(result.turns.map((turn) => turn.id)).toEqual(["kept"]);
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
    const cancelTurn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settleCancellation = resolve;
        }),
    );
    const release = vi.fn();
    context.session.status = "running";
    context.session.activeTurnId = "turn-with-live-browser-wait";
    Object.assign(context, {
      gatewaySessionLease: {
        connection: {
          url: "http://127.0.0.1:48123/mcp",
          bearerToken: "gateway-token",
        },
        cancelTurn,
        retireTurn: vi.fn(() => Promise.resolve()),
        release,
      },
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
    const cancelTurn = vi.fn(() => Promise.resolve());
    const release = vi.fn();
    context.session.status = "running";
    context.session.activeTurnId = "turn-parent";
    Object.assign(context, {
      gatewaySessionLease: {
        connection: {
          url: "http://127.0.0.1:48123/mcp",
          bearerToken: "gateway-token",
        },
        cancelTurn,
        retireTurn: vi.fn(() => Promise.resolve()),
        release,
      },
    });
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
