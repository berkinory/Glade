import { Cause, Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { WS_CHANNELS, WS_METHODS } from "@glade/contracts/transport/ws/ws";
import { WS_PROJECT_FILE_WATCH_CAPABILITY } from "@glade/contracts/transport/ws/wsCompatibility";
import {
  getUnexpectedStreamCompletionRetryDelayMs,
  getProjectFileWatchRetryDelayMs,
  getStreamCapacityRetryDelayMs,
  getStreamDuplicateRetryDelayMs,
  isTerminalCompatibilityFailure,
  getResnapshotRetryDelayMs,
  getSnapshotFaultRetryDelayMs,
  MAX_PROJECT_FILE_WATCH_RETRY_ATTEMPTS,
  SNAPSHOT_FAULT_RETRY_MS,
  isRuntimeInterruptFailure,
  MAX_RESNAPSHOT_RETRY_ATTEMPTS,
  MAX_STREAM_DUPLICATE_RETRY_ATTEMPTS,
  resolveStreamAdmissionRetry,
  shouldReconnectAfterStreamFailure,
  projectFileChangeStreamKey,
  type WsThreadStreamFailure,
} from "./wsTransport.support";
import {
  getUnaryRpcCapacityRetryDelayMs,
  MAX_UNARY_RPC_CAPACITY_RETRY_ATTEMPTS,
} from "./lib/expensiveReadRetry";
import { WsTransport } from "./wsTransport.implementation";
import {
  advanceThreadDetailResumeCursor,
  hasThreadDetailResumeCursor,
  resetThreadDetailResumeCursors,
} from "./threadDetailResumeCursors";
import {
  setupWsTransportTests,
  makeBareTransport,
  bindWindowTimersToCurrentGlobals,
} from "./wsTransport.testFixtures";
setupWsTransportTests();

describe("WsTransport", () => {
  it("shares one stream per watched file and stops it after the last listener leaves", async () => {
    const { transport, internals } = makeBareTransport();
    const input = { cwd: "/repo", relativePath: "src/app.ts" };
    const key = projectFileChangeStreamKey(input);
    const client = {};
    internals.getClient = vi.fn(async () => client);
    internals.startProjectFileChangeStream = vi.fn();
    internals.stopStream = vi.fn(async () => undefined);

    const unsubscribeFirst = transport.subscribeProjectFileChange(input, vi.fn());
    const unsubscribeSecond = transport.subscribeProjectFileChange(input, vi.fn());

    await vi.waitFor(() => expect(internals.startProjectFileChangeStream).toHaveBeenCalledOnce());
    expect(internals.projectFileSubscriptions.size).toBe(1);

    unsubscribeFirst();
    expect(internals.stopStream).not.toHaveBeenCalled();
    unsubscribeSecond();

    expect(internals.projectFileSubscriptions.size).toBe(0);
    expect(internals.stopStream).toHaveBeenCalledWith(key);
  });

  it("does not open a file stream after its subscription is cancelled during connection", async () => {
    const { transport, internals } = makeBareTransport();
    let resolveClient!: (client: unknown) => void;
    internals.getClient = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveClient = resolve;
        }),
    );
    const subscribeFile = vi.fn(() => Stream.never);
    Object.assign(internals, {
      compatibility: { capabilities: [WS_PROJECT_FILE_WATCH_CAPABILITY] },
    });
    const unsubscribe = transport.subscribeProjectFileChange(
      { cwd: "/repo", relativePath: "app.ts" },
      vi.fn(),
    );
    unsubscribe();
    resolveClient({ [WS_METHODS.projectsSubscribeFileChange]: subscribeFile });
    await Promise.resolve();
    await Promise.resolve();
    expect(subscribeFile).not.toHaveBeenCalled();
    expect(internals.projectFileSubscriptions.size).toBe(0);
  });

  it("returns the completed GitHub provisioning result and emits each progress event", async () => {
    const phase = {
      operationId: "operation-1",
      kind: "phase" as const,
      phase: "cloning" as const,
      message: "Cloning openai/codex",
    };
    const completed = {
      operationId: "operation-1",
      kind: "completed" as const,
      result: {
        operationId: "operation-1",
        repository: "openai/codex",
        workspaceRoot: "/projects/codex",
        projectId: "project-1",
        checkout: "created" as const,
      },
    };
    const emit = vi.fn();
    const transport = Object.create(WsTransport.prototype) as WsTransport;
    Object.assign(transport, {
      emit,
      getClientRuntime: () => ({ runPromise: Effect.runPromise }),
    });
    const runProjectProvisionStream = (
      transport as unknown as {
        runProjectProvisionStream: (
          client: Record<string, () => Stream.Stream<typeof phase | typeof completed>>,
          params: unknown,
        ) => Promise<typeof completed.result>;
      }
    ).runProjectProvisionStream.bind(transport);

    await expect(
      runProjectProvisionStream(
        {
          [WS_METHODS.projectsProvisionFromGitHub]: () => Stream.make(phase, completed),
        },
        { repository: "openai/codex" },
      ),
    ).resolves.toEqual(completed.result);
    expect(emit).toHaveBeenNthCalledWith(1, WS_CHANNELS.projectProvisionProgress, phase);
    expect(emit).toHaveBeenNthCalledWith(2, WS_CHANNELS.projectProvisionProgress, completed);
  });

  it("returns the completed worktree setup result and emits each progress event", async () => {
    const phase = {
      progressId: "progress-1",
      kind: "phase_started" as const,
      phase: "worktree" as const,
    };
    const completed = {
      progressId: "progress-1",
      kind: "completed" as const,
      result: {
        worktree: {
          path: "/repo/.codex/worktrees/generated/glade",
          ref: "0123456789abcdef0123456789abcdef01234567",
          branch: "glade/abcd1234",
        },
      },
    };
    const emit = vi.fn();
    const transport = Object.create(WsTransport.prototype) as WsTransport;
    Object.assign(transport, {
      emit,
      getClientRuntime: () => ({ runPromise: Effect.runPromise }),
    });
    const runWorktreeSetupStream = (
      transport as unknown as {
        runWorktreeSetupStream: (
          client: Record<string, () => Stream.Stream<typeof phase | typeof completed>>,
          params: unknown,
        ) => Promise<typeof completed.result>;
      }
    ).runWorktreeSetupStream.bind(transport);

    await expect(
      runWorktreeSetupStream(
        {
          [WS_METHODS.gitCreateDetachedWorktree]: () => Stream.make(phase, completed),
        },
        { cwd: "/repo", ref: "main" },
      ),
    ).resolves.toEqual(completed.result);
    expect(emit).toHaveBeenNthCalledWith(1, WS_CHANNELS.gitWorktreeSetupProgress, phase);
    expect(emit).toHaveBeenNthCalledWith(2, WS_CHANNELS.gitWorktreeSetupProgress, completed);
  });

  it("does not reconnect the socket for typed stream-admission failures", () => {
    expect(
      shouldReconnectAfterStreamFailure(
        Cause.fail({
          code: "STREAM_CAPACITY_EXCEEDED",
          retryable: true,
          retryAfterMs: 1_000,
        }),
      ),
    ).toBe(false);
    expect(
      shouldReconnectAfterStreamFailure(
        Cause.fail({ code: "STREAM_DUPLICATE_SUBSCRIPTION", retryable: false }),
      ),
    ).toBe(false);
    expect(
      shouldReconnectAfterStreamFailure(
        Cause.fail({ code: "THREAD_SNAPSHOT_NOT_FOUND", retryable: false }),
      ),
    ).toBe(false);
    expect(
      shouldReconnectAfterStreamFailure(
        Cause.fail({ code: "PROJECT_FILE_WATCH_FAILED", retryable: false }),
      ),
    ).toBe(false);
    expect(shouldReconnectAfterStreamFailure(Cause.fail(new Error("transient")))).toBe(true);
    expect(
      shouldReconnectAfterStreamFailure(
        Cause.fail({ code: "WS_PROTOCOL_INCOMPATIBLE", retryable: false }),
      ),
    ).toBe(false);
    expect(
      isTerminalCompatibilityFailure({
        code: "WS_PROTOCOL_INCOMPATIBLE",
        retryable: false,
      }),
    ).toBe(true);
  });

  it("bounds project file watcher retries with exponential backoff", () => {
    const failure = Cause.fail({ code: "PROJECT_FILE_WATCH_FAILED", retryable: false });

    expect(getProjectFileWatchRetryDelayMs(failure, 0)).toBe(500);
    expect(getProjectFileWatchRetryDelayMs(failure, 4)).toBe(8_000);
    expect(
      getProjectFileWatchRetryDelayMs(failure, MAX_PROJECT_FILE_WATCH_RETRY_ATTEMPTS),
    ).toBeNull();
    expect(getProjectFileWatchRetryDelayMs(Cause.fail(new Error("transient")), 0)).toBeNull();
  });

  it("retries a failed project file watcher in place without reconnecting the socket", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      const key = "projects.file-change:/repo\0src/app.ts";
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream(
        {},
        key,
        Stream.fail({ code: "PROJECT_FILE_WATCH_FAILED", retryable: false }),
        () => undefined,
        restart,
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(499);

      expect(restart).not.toHaveBeenCalled();
      expect(reconnect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(restart).toHaveBeenCalledTimes(1);
      expect(reconnect).not.toHaveBeenCalled();
      expect(internals.projectFileWatchRetries.get(key)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries resnapshot demands in place with bounded attempts", () => {
    const resnapshot = Cause.fail({
      code: "ORCHESTRATION_RESNAPSHOT_REQUIRED",
      retryable: true,
    });

    expect(getResnapshotRetryDelayMs(resnapshot, 0)).toBe(250);
    expect(getResnapshotRetryDelayMs(resnapshot, MAX_RESNAPSHOT_RETRY_ATTEMPTS)).toBeNull();

    expect(
      getResnapshotRetryDelayMs(
        Cause.fail({ code: "ORCHESTRATION_SNAPSHOT_STALLED", retryable: false }),
        0,
      ),
    ).toBeNull();
    expect(getResnapshotRetryDelayMs(Cause.fail(new Error("transient")), 0)).toBeNull();

    expect(resolveStreamAdmissionRetry(resnapshot, 0, 0, 0, 0)).toEqual({
      kind: "resnapshot",
      attempt: 1,
      delayMs: 250,
    });
    expect(resolveStreamAdmissionRetry(resnapshot, 0, 0, 0, MAX_RESNAPSHOT_RETRY_ATTEMPTS)).toBe(
      null,
    );
  });

  it("clears the thread resume cursor and retries in place on a resnapshot demand", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    resetThreadDetailResumeCursors();
    try {
      const { internals } = makeBareTransport();
      const threadId = "thread-resnapshot";
      const key = `orchestration.thread:${threadId}`;
      advanceThreadDetailResumeCursor(ThreadId.makeUnsafe(threadId), 100);
      internals.threadSubscriptions.set(threadId, { threadId, afterSequence: 100 });
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream(
        {},
        key,
        Stream.fail({ code: "ORCHESTRATION_RESNAPSHOT_REQUIRED", retryable: true }),
        () => undefined,
        restart,
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(hasThreadDetailResumeCursor(ThreadId.makeUnsafe(threadId))).toBe(false);
      expect(reconnect).not.toHaveBeenCalled();
      expect(restart).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(250);
      expect(restart).toHaveBeenCalledTimes(1);
      expect(reconnect).not.toHaveBeenCalled();
    } finally {
      resetThreadDetailResumeCursors();
      vi.useRealTimers();
    }
  });

  it("surfaces a stalled-snapshot verdict as a thread stream failure without reconnecting", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      const threadId = "thread-stalled";
      const key = `orchestration.thread:${threadId}`;
      internals.threadSubscriptions.set(threadId, { threadId });
      const failures: WsThreadStreamFailure[] = [];
      internals.threadStreamFailureListeners.add((failure) => failures.push(failure));
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream(
        {},
        key,
        Stream.fail({ code: "ORCHESTRATION_SNAPSHOT_STALLED", retryable: false }),
        () => undefined,
        restart,
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(SNAPSHOT_FAULT_RETRY_MS - 1);

      expect(reconnect).not.toHaveBeenCalled();
      expect(restart).not.toHaveBeenCalled();
      expect(failures).toHaveLength(1);
      expect(failures[0]?.code).toBe("ORCHESTRATION_SNAPSHOT_STALLED");

      await vi.advanceTimersByTimeAsync(1);
      expect(restart).toHaveBeenCalledTimes(1);
      expect(reconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("slow-retries a shell stream killed by a projection-state fault instead of leaving it dead", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      const key = "orchestration.shell";
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream(
        {},
        key,
        Stream.fail({ code: "ORCHESTRATION_PROJECTION_STATE_INCOMPLETE", retryable: false }),
        () => undefined,
        restart,
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(reconnect).not.toHaveBeenCalled();
      expect(restart).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(SNAPSHOT_FAULT_RETRY_MS);
      expect(restart).toHaveBeenCalledTimes(1);
      expect(reconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending snapshot-fault retry when the stream is stopped", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      const key = "orchestration.shell";
      const restart = vi.fn();

      internals.startStream(
        {},
        key,
        Stream.fail({ code: "ORCHESTRATION_SNAPSHOT_STALLED", retryable: false }),
        () => undefined,
        restart,
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await internals.stopStream(key);
      await vi.advanceTimersByTimeAsync(SNAPSHOT_FAULT_RETRY_MS * 2);

      expect(restart).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies snapshot faults for the slow retry and nothing else", () => {
    expect(
      getSnapshotFaultRetryDelayMs(
        Cause.fail({ code: "ORCHESTRATION_SNAPSHOT_STALLED", retryable: false }),
      ),
    ).toBe(SNAPSHOT_FAULT_RETRY_MS);
    expect(
      getSnapshotFaultRetryDelayMs(
        Cause.fail({ code: "ORCHESTRATION_PROJECTION_STATE_INCOMPLETE", retryable: false }),
      ),
    ).toBe(SNAPSHOT_FAULT_RETRY_MS);

    expect(
      getSnapshotFaultRetryDelayMs(
        Cause.fail({ code: "ORCHESTRATION_RESNAPSHOT_REQUIRED", retryable: true }),
      ),
    ).toBe(SNAPSHOT_FAULT_RETRY_MS);
    expect(getSnapshotFaultRetryDelayMs(Cause.fail(new Error("transient")))).toBeNull();
  });

  it("keeps slow-retrying an exhausted resnapshot demand instead of leaving the stream dead", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      const key = "orchestration.shell";
      internals.streamResnapshotRetries.set(key, MAX_RESNAPSHOT_RETRY_ATTEMPTS);
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream(
        {},
        key,
        Stream.fail({ code: "ORCHESTRATION_RESNAPSHOT_REQUIRED", retryable: true }),
        () => undefined,
        restart,
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(SNAPSHOT_FAULT_RETRY_MS - 1);
      expect(restart).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(restart).toHaveBeenCalledTimes(1);
      expect(reconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets resnapshot retry state when a stream is explicitly stopped", async () => {
    const { internals } = makeBareTransport();
    const key = "orchestration.thread:stopped-resnapshot";
    internals.streamResnapshotRetries.set(key, MAX_RESNAPSHOT_RETRY_ATTEMPTS);

    await internals.stopStream(key);

    expect(internals.streamResnapshotRetries.has(key)).toBe(false);
  });

  it("classifies transport-runtime interrupts as retryable typed failures", () => {
    expect(isRuntimeInterruptFailure(new Error("All fibers interrupted without error"))).toBe(true);
    expect(isRuntimeInterruptFailure(new Error("Missing runtime for WebSocket RPC client"))).toBe(
      true,
    );
    expect(isRuntimeInterruptFailure(new Error("ManagedRuntime disposed"))).toBe(true);
    expect(isRuntimeInterruptFailure(new Error("boom"))).toBe(false);
    expect(isRuntimeInterruptFailure("All fibers interrupted without error")).toBe(false);
  });

  it("rejects an in-flight unary request with a typed retryable error across a reconnect", async () => {
    const { transport, internals } = makeBareTransport();
    const client = { "some.method": () => Effect.never };
    Object.assign(internals, {
      getClient: vi.fn(async () => client),
      getClientRuntime: () => ({
        runPromise: () => Promise.reject(new Error("All fibers interrupted without error")),
      }),
    });

    await expect(transport.request("some.method", {}, { timeoutMs: null })).rejects.toMatchObject({
      _tag: "WsTransportRequestInterruptedError",
      code: "WS_REQUEST_RECONNECTED",
      method: "some.method",
      retryable: true,
    });
  });

  it("retries capacity-rejected streams in place with the server-provided delay", () => {
    expect(
      getStreamCapacityRetryDelayMs(
        Cause.fail({
          code: "THREAD_STREAM_CAPACITY_EXCEEDED",
          retryable: true,
          retryAfterMs: 1_000,
        }),
      ),
    ).toBe(1_000);
    expect(
      getStreamCapacityRetryDelayMs(
        Cause.fail({ code: "STREAM_CAPACITY_EXCEEDED", retryable: true }),
      ),
    ).toBe(1_000);
    expect(
      getStreamCapacityRetryDelayMs(
        Cause.fail({ code: "STREAM_DUPLICATE_SUBSCRIPTION", retryable: false }),
      ),
    ).toBeNull();
    expect(getStreamCapacityRetryDelayMs(Cause.fail(new Error("transient")))).toBeNull();
    expect(
      getStreamCapacityRetryDelayMs(
        Cause.fail({ code: "WS_PROTOCOL_INCOMPATIBLE", retryable: false }),
      ),
    ).toBeNull();
  });

  it("retries capacity-rejected unary requests in place with the server-provided delay", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { transport, internals } = makeBareTransport();
      const capacityError = {
        code: "RPC_EXPENSIVE_READ_CAPACITY_EXCEEDED",
        retryable: true,
        retryAfterMs: 250,
        message: "WebSocket expensive-read request capacity exceeded.",
      };
      const runPromise = vi
        .fn()
        .mockRejectedValueOnce(capacityError)
        .mockResolvedValueOnce({ contents: "ok" });
      Object.assign(internals, {
        getClient: vi.fn(async () => ({
          "projects.readFile": () => Effect.succeed({ contents: "ok" }),
        })),
        getClientRuntime: () => ({ runPromise }),
      });

      const pending = transport.request(WS_METHODS.projectsReadFile, {}, { timeoutMs: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(runPromise).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(249);
      expect(runPromise).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ contents: "ok" });
      expect(runPromise).toHaveBeenCalledTimes(2);
      expect(getUnaryRpcCapacityRetryDelayMs(capacityError, 0)).toBe(250);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying a unary capacity rejection after the bounded attempt budget", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { transport, internals } = makeBareTransport();
      const capacityError = {
        code: "RPC_REQUEST_CAPACITY_EXCEEDED",
        retryable: true,
        retryAfterMs: 250,
        message: "WebSocket standard request capacity exceeded.",
      };
      const runPromise = vi.fn().mockRejectedValue(capacityError);
      Object.assign(internals, {
        getClient: vi.fn(async () => ({
          "projects.readFile": () => Effect.succeed({ contents: "ok" }),
        })),
        getClientRuntime: () => ({ runPromise }),
      });

      const pending = transport.request(WS_METHODS.projectsReadFile, {}, { timeoutMs: null });
      const rejected = expect(pending).rejects.toMatchObject({
        code: "RPC_REQUEST_CAPACITY_EXCEEDED",
      });
      await vi.advanceTimersByTimeAsync(0);
      for (let attempt = 0; attempt < MAX_UNARY_RPC_CAPACITY_RETRY_ATTEMPTS; attempt += 1) {
        await vi.advanceTimersByTimeAsync(250);
      }

      await rejected;
      expect(runPromise).toHaveBeenCalledTimes(MAX_UNARY_RPC_CAPACITY_RETRY_ATTEMPTS + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts an in-place unary capacity retry when the request signal aborts", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { transport, internals } = makeBareTransport();
      const capacityError = {
        code: "RPC_EXPENSIVE_READ_CAPACITY_EXCEEDED",
        retryable: true,
        retryAfterMs: 250,
        message: "WebSocket expensive-read request capacity exceeded.",
      };
      const runPromise = vi.fn().mockRejectedValue(capacityError);
      Object.assign(internals, {
        getClient: vi.fn(async () => ({
          "projects.readFile": () => Effect.succeed({ contents: "ok" }),
        })),
        getClientRuntime: () => ({ runPromise }),
      });

      const controller = new AbortController();
      const pending = transport.request(
        WS_METHODS.projectsReadFile,
        {},
        {
          timeoutMs: null,
          signal: controller.signal,
        },
      );
      const rejected = expect(pending).rejects.toMatchObject({
        code: "WS_REQUEST_ABORTED",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(runPromise).toHaveBeenCalledTimes(1);

      controller.abort();
      await rejected;
      await vi.advanceTimersByTimeAsync(250);
      expect(runPromise).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a non-capacity unary failure in place", async () => {
    const { transport, internals } = makeBareTransport();
    const failure = new Error("file missing");
    const runPromise = vi.fn().mockRejectedValue(failure);
    Object.assign(internals, {
      getClient: vi.fn(async () => ({
        "projects.readFile": () => Effect.succeed({ contents: "ok" }),
      })),
      getClientRuntime: () => ({ runPromise }),
    });

    await expect(
      transport.request(WS_METHODS.projectsReadFile, {}, { timeoutMs: null }),
    ).rejects.toBe(failure);
    expect(runPromise).toHaveBeenCalledTimes(1);
  });

  it("backs off unexpected normal stream completions with a bounded delay", () => {
    expect(getUnexpectedStreamCompletionRetryDelayMs(1)).toBe(100);
    expect(getUnexpectedStreamCompletionRetryDelayMs(2)).toBe(200);
    expect(getUnexpectedStreamCompletionRetryDelayMs(7)).toBe(5_000);
    expect(getUnexpectedStreamCompletionRetryDelayMs(100)).toBe(5_000);
  });

  it("reconnects after an unexpected normal completion instead of reopening a zombie stream", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      const key = "orchestration.domain";
      const snapshots: string[] = [];
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream<string>(
        {},
        key,
        Stream.make("snapshot"),
        (event) => snapshots.push(event),
        restart,
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(internals.streamCompletionRetryTimers.has(key)).toBe(true);
      expect(internals.streamCleanups.has(key)).toBe(false);
      expect(snapshots).toEqual(["snapshot"]);

      expect(reconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(99);
      expect(reconnect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(reconnect).toHaveBeenCalledTimes(1);
      expect(restart).not.toHaveBeenCalled();
      expect(snapshots).toEqual(["snapshot"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending normal-completion restart when the stream is unsubscribed", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      const key = "orchestration.domain";
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream({}, key, Stream.empty, () => undefined, restart);
      await Promise.resolve();
      await internals.stopStream(key);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(restart).not.toHaveBeenCalled();
      expect(reconnect).not.toHaveBeenCalled();
      expect(internals.streamCompletionRetryTimers.has(key)).toBe(false);
      expect(internals.streamCompletionRetries.has(key)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restart a normally-completed stream from a superseded session generation", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      const key = "orchestration.domain";
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream({}, key, Stream.empty, () => undefined, restart);
      await Promise.resolve();
      internals.sessionVersion += 1;
      await vi.advanceTimersByTimeAsync(5_000);

      expect(restart).not.toHaveBeenCalled();
      expect(reconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries duplicate-rejected streams in place despite the non-retryable marker", () => {
    const duplicate = Cause.fail({
      code: "STREAM_DUPLICATE_SUBSCRIPTION",
      retryable: false,
    });

    expect(getStreamDuplicateRetryDelayMs(duplicate, 0)).toBe(250);
    expect(
      getStreamDuplicateRetryDelayMs(
        Cause.fail({
          code: "THREAD_STREAM_DUPLICATE_SUBSCRIPTION",
          retryable: false,
          retryAfterMs: 400,
        }),
        1,
      ),
    ).toBe(400);
    expect(
      getStreamDuplicateRetryDelayMs(duplicate, MAX_STREAM_DUPLICATE_RETRY_ATTEMPTS),
    ).toBeNull();
    expect(
      getStreamDuplicateRetryDelayMs(
        Cause.fail({ code: "STREAM_CAPACITY_EXCEEDED", retryable: true }),
        0,
      ),
    ).toBeNull();
    expect(getStreamDuplicateRetryDelayMs(Cause.fail(new Error("transient")), 0)).toBeNull();
  });
});
