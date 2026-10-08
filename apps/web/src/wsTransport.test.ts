import { Cause, Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { WS_CHANNELS, WS_METHODS } from "@glade/contracts/transport/ws/ws";
import { WS_PROJECT_FILE_WATCH_CAPABILITY } from "@glade/contracts/transport/ws/wsCompatibility";
import {
  getProjectFileWatchRetryDelayMs,
  getSnapshotFaultRetryDelayMs,
  isRuntimeInterruptFailure,
  MAX_PROJECT_FILE_WATCH_RETRY_ATTEMPTS,
  projectFileChangeStreamKey,
  resolveStreamAdmissionRetry,
  shouldReconnectAfterStreamFailure,
  SNAPSHOT_FAULT_RETRY_MS,
  type StreamAdmissionRetry,
  type WsThreadStreamFailure,
} from "./wsTransport.support";
import { MAX_UNARY_RPC_CAPACITY_RETRY_ATTEMPTS } from "./lib/expensiveReadRetry";
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
  type WsTransportInternals,
} from "./wsTransport.testFixtures";
setupWsTransportTests();

const EXPENSIVE_READ_CAPACITY_ERROR = {
  code: "RPC_EXPENSIVE_READ_CAPACITY_EXCEEDED",
  retryable: true,
  retryAfterMs: 250,
  message: "WebSocket expensive-read request capacity exceeded.",
};

function makeReadFileTransport(runPromise: (...args: unknown[]) => Promise<unknown>): WsTransport {
  const { transport, internals } = makeBareTransport();
  Object.assign(internals, {
    getClient: vi.fn(async () => ({
      "projects.readFile": () => Effect.succeed({ contents: "ok" }),
    })),
    getClientRuntime: () => ({ runPromise }),
  });
  return transport;
}

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

  it.each([
    {
      name: "GitHub provisioning",
      runner: "runProjectProvisionStream",
      method: WS_METHODS.projectsProvisionFromGitHub,
      channel: WS_CHANNELS.projectProvisionProgress,
      params: { repository: "openai/codex" },
      phase: {
        operationId: "operation-1",
        kind: "phase",
        phase: "cloning",
        message: "Cloning openai/codex",
      },
      result: {
        operationId: "operation-1",
        repository: "openai/codex",
        workspaceRoot: "/projects/codex",
        projectId: "project-1",
        checkout: "created",
      },
    },
    {
      name: "worktree setup",
      runner: "runWorktreeSetupStream",
      method: WS_METHODS.gitCreateDetachedWorktree,
      channel: WS_CHANNELS.gitWorktreeSetupProgress,
      params: { cwd: "/repo", ref: "main" },
      phase: { progressId: "progress-1", kind: "phase_started", phase: "worktree" },
      result: {
        worktree: {
          path: "/repo/.codex/worktrees/generated/glade",
          ref: "0123456789abcdef0123456789abcdef01234567",
          branch: "glade/abcd1234",
        },
      },
    },
  ])(
    "returns the completed $name result and emits each progress event",
    async ({ runner, method, channel, params, phase, result }) => {
      const completed = { ...phase, kind: "completed", result };
      const emit = vi.fn();
      const transport = Object.create(WsTransport.prototype) as WsTransport;
      Object.assign(transport, {
        emit,
        getClientRuntime: () => ({ runPromise: Effect.runPromise }),
      });
      const run = (
        transport as unknown as Record<
          string,
          (
            client: Record<string, () => Stream.Stream<unknown>>,
            params: unknown,
          ) => Promise<unknown>
        >
      )[runner]!.bind(transport);

      await expect(run({ [method]: () => Stream.make(phase, completed) }, params)).resolves.toEqual(
        result,
      );
      expect(emit).toHaveBeenNthCalledWith(1, channel, phase);
      expect(emit).toHaveBeenNthCalledWith(2, channel, completed);
    },
  );

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

  it.each([
    {
      name: "surfaces a stalled-snapshot verdict as a thread stream failure",
      key: "orchestration.thread:thread-stalled",
      error: { code: "ORCHESTRATION_SNAPSHOT_STALLED", retryable: false },
      exhaustedResnapshot: false,
      reportsFailure: true,
    },
    {
      name: "slow-retries a shell stream killed by a projection-state fault",
      key: "orchestration.shell",
      error: { code: "ORCHESTRATION_PROJECTION_STATE_INCOMPLETE", retryable: false },
      exhaustedResnapshot: false,
      reportsFailure: false,
    },
    {
      name: "keeps slow-retrying an exhausted resnapshot demand",
      key: "orchestration.shell",
      error: { code: "ORCHESTRATION_RESNAPSHOT_REQUIRED", retryable: true },
      exhaustedResnapshot: true,
      reportsFailure: false,
    },
  ])("$name without reconnecting", async ({ key, error, exhaustedResnapshot, reportsFailure }) => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      if (key.startsWith("orchestration.thread:")) {
        const threadId = key.slice("orchestration.thread:".length);
        internals.threadSubscriptions.set(threadId, { threadId });
      }
      if (exhaustedResnapshot) {
        internals.streamResnapshotRetries.set(key, 2);
      }
      const failures: WsThreadStreamFailure[] = [];
      internals.threadStreamFailureListeners.add((failure) => failures.push(failure));
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream({}, key, Stream.fail(error), () => undefined, restart);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(SNAPSHOT_FAULT_RETRY_MS - 1);

      expect(restart).not.toHaveBeenCalled();
      expect(failures.map((failure) => failure.code)).toEqual(reportsFailure ? [error.code] : []);

      await vi.advanceTimersByTimeAsync(1);
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

  it("retries capacity-rejected unary requests in place with the server-provided delay", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const runPromise = vi
        .fn()
        .mockRejectedValueOnce(EXPENSIVE_READ_CAPACITY_ERROR)
        .mockResolvedValueOnce({ contents: "ok" });
      const transport = makeReadFileTransport(runPromise);

      const pending = transport.request(WS_METHODS.projectsReadFile, {}, { timeoutMs: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(runPromise).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(249);
      expect(runPromise).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ contents: "ok" });
      expect(runPromise).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying a unary capacity rejection after the bounded attempt budget", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const runPromise = vi.fn().mockRejectedValue({
        code: "RPC_REQUEST_CAPACITY_EXCEEDED",
        retryable: true,
        retryAfterMs: 250,
        message: "WebSocket standard request capacity exceeded.",
      });
      const transport = makeReadFileTransport(runPromise);

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
      const runPromise = vi.fn().mockRejectedValue(EXPENSIVE_READ_CAPACITY_ERROR);
      const transport = makeReadFileTransport(runPromise);

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
    const failure = new Error("file missing");
    const runPromise = vi.fn().mockRejectedValue(failure);
    const transport = makeReadFileTransport(runPromise);

    await expect(
      transport.request(WS_METHODS.projectsReadFile, {}, { timeoutMs: null }),
    ).rejects.toBe(failure);
    expect(runPromise).toHaveBeenCalledTimes(1);
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

  it.each([
    {
      name: "the stream is unsubscribed",
      interrupt: (internals: WsTransportInternals, key: string) => internals.stopStream(key),
    },
    {
      name: "its session generation is superseded",
      interrupt: (internals: WsTransportInternals) => {
        internals.sessionVersion += 1;
      },
    },
  ])("does not restart a normally-completed stream after $name", async ({ interrupt }) => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const { internals } = makeBareTransport();
      const key = "orchestration.domain";
      const restart = vi.fn();
      const reconnect = vi.mocked(internals.reconnect);

      internals.startStream({}, key, Stream.empty, () => undefined, restart);
      await Promise.resolve();
      await interrupt(internals, key);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(restart).not.toHaveBeenCalled();
      expect(reconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

const failure = (code: string, extra: Record<string, unknown> = {}) =>
  Cause.fail({ code, retryable: false, ...extra });

describe("stream failure policy", () => {
  it.each<{
    name: string;
    cause: Cause.Cause<unknown>;
    attempts: readonly [number, number, number, number];
    admission: StreamAdmissionRetry | null;
    reconnect?: boolean;
    snapshotFault: number | null;
  }>([
    {
      name: "a server-delayed capacity rejection after earlier capacity retries",
      cause: failure("STREAM_CAPACITY_EXCEEDED", { retryable: true, retryAfterMs: 1_000 }),
      attempts: [5, 0, 0, 0],
      admission: { kind: "capacity", attempt: 6, delayMs: 1_000 },
      reconnect: false,
      snapshotFault: null,
    },
    {
      name: "a thread capacity rejection without a server delay",
      cause: failure("THREAD_STREAM_CAPACITY_EXCEEDED", { retryable: true }),
      attempts: [0, 0, 0, 0],
      admission: { kind: "capacity", attempt: 1, delayMs: 1_000 },
      reconnect: false,
      snapshotFault: null,
    },
    {
      name: "a duplicate rejection independent of prior capacity retries",
      cause: failure("STREAM_DUPLICATE_SUBSCRIPTION"),
      attempts: [5, 0, 0, 0],
      admission: { kind: "duplicate", attempt: 1, delayMs: 250 },
      reconnect: false,
      snapshotFault: null,
    },
    {
      name: "a thread duplicate rejection with a server delay",
      cause: failure("THREAD_STREAM_DUPLICATE_SUBSCRIPTION", { retryAfterMs: 400 }),
      attempts: [0, 1, 0, 0],
      admission: { kind: "duplicate", attempt: 2, delayMs: 400 },
      snapshotFault: null,
    },
    {
      name: "a draft snapshot that is not projected yet",
      cause: failure("THREAD_SNAPSHOT_NOT_FOUND"),
      attempts: [0, 0, 0, 0],
      admission: { kind: "thread-bootstrap", attempt: 1, delayMs: 100 },
      reconnect: false,
      snapshotFault: null,
    },
    {
      name: "a resnapshot demand",
      cause: failure("ORCHESTRATION_RESNAPSHOT_REQUIRED", { retryable: true }),
      attempts: [0, 0, 0, 0],
      admission: { kind: "resnapshot", attempt: 1, delayMs: 250 },
      reconnect: false,
      snapshotFault: SNAPSHOT_FAULT_RETRY_MS,
    },
    {
      name: "an exhausted resnapshot demand",
      cause: failure("ORCHESTRATION_RESNAPSHOT_REQUIRED", { retryable: true }),
      attempts: [0, 0, 0, 2],
      admission: null,
      reconnect: false,
      snapshotFault: SNAPSHOT_FAULT_RETRY_MS,
    },
    {
      name: "a stalled snapshot",
      cause: failure("ORCHESTRATION_SNAPSHOT_STALLED"),
      attempts: [0, 0, 0, 0],
      admission: null,
      reconnect: false,
      snapshotFault: SNAPSHOT_FAULT_RETRY_MS,
    },
    {
      name: "an incomplete projection",
      cause: failure("ORCHESTRATION_PROJECTION_STATE_INCOMPLETE"),
      attempts: [0, 0, 0, 0],
      admission: null,
      reconnect: false,
      snapshotFault: SNAPSHOT_FAULT_RETRY_MS,
    },
    {
      name: "a failed file watcher",
      cause: failure("PROJECT_FILE_WATCH_FAILED"),
      attempts: [0, 0, 0, 0],
      admission: null,
      reconnect: false,
      snapshotFault: null,
    },
    {
      name: "an incompatible protocol",
      cause: failure("WS_PROTOCOL_INCOMPATIBLE"),
      attempts: [0, 0, 0, 0],
      admission: null,
      reconnect: false,
      snapshotFault: null,
    },
    {
      name: "a transient error",
      cause: Cause.fail(new Error("transient")),
      attempts: [0, 0, 0, 0],
      admission: null,
      reconnect: true,
      snapshotFault: null,
    },
  ])("classifies $name", ({ cause, attempts, admission, reconnect, snapshotFault }) => {
    expect(resolveStreamAdmissionRetry(cause, ...attempts)).toEqual(admission);
    expect(getSnapshotFaultRetryDelayMs(cause)).toBe(snapshotFault);
    if (reconnect !== undefined) expect(shouldReconnectAfterStreamFailure(cause)).toBe(reconnect);
  });

  const admissionDelay =
    (cause: Cause.Cause<unknown>, slot: 1 | 2 | 3) =>
    (previousAttempts: number): number | null => {
      const attempts: [number, number, number, number] = [0, 0, 0, 0];
      attempts[slot] = previousAttempts;
      return resolveStreamAdmissionRetry(cause, ...attempts)?.delayMs ?? null;
    };

  it.each([
    {
      name: "duplicate",
      delay: admissionDelay(failure("STREAM_DUPLICATE_SUBSCRIPTION"), 1),
      maxAttempts: 5,
      first: 250,
    },
    {
      name: "draft snapshot",
      delay: admissionDelay(failure("THREAD_SNAPSHOT_NOT_FOUND"), 2),
      maxAttempts: 12,
      first: 100,
    },
    {
      name: "resnapshot",
      delay: admissionDelay(failure("ORCHESTRATION_RESNAPSHOT_REQUIRED", { retryable: true }), 3),
      maxAttempts: 2,
      first: 250,
    },
    {
      name: "file watcher",
      delay: (attempts: number) =>
        getProjectFileWatchRetryDelayMs(failure("PROJECT_FILE_WATCH_FAILED"), attempts),
      maxAttempts: MAX_PROJECT_FILE_WATCH_RETRY_ATTEMPTS,
      first: 500,
    },
  ])("bounds $name retries at their attempt budget", ({ delay, maxAttempts, first }) => {
    expect(delay(0)).toBe(first);
    expect(delay(maxAttempts - 1)).not.toBeNull();
    expect(delay(maxAttempts)).toBeNull();
  });
});
