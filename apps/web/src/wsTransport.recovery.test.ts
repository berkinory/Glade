import { ConnectionStatusTracker } from "./connectionStatus";
import { CommandId, MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { usePendingTurnDispatchStore } from "./pendingTurnDispatch";
import { WS_TURN_DISPATCH_SETTLEMENT_CAPABILITY } from "@glade/contracts/transport/ws/wsCompatibility";
import { describe, expect, it, vi } from "vitest";
import { ORCHESTRATION_WS_METHODS } from "@glade/contracts/orchestration/rpc";
import { WS_CHANNELS } from "@glade/contracts/transport/ws/ws";
import {
  WS_COMPATIBILITY_QUERY,
  WS_NEGOTIATE_QUERY,
  WS_PROTOCOL_EPOCH,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
  WsCompatibilityError,
  type WsBootstrapNegotiateResult,
} from "@glade/contracts/transport/ws/wsCompatibility";
import {
  isTerminalCompatibilityFailure,
  makeFeatureSocketUrl,
  makeRequestAbortScope,
  negotiateOverHttp,
  projectFileChangeStreamKey,
  type WsThreadStreamFailure,
} from "./wsTransport.support";
import { WsTransport } from "./wsTransport.implementation";
import {
  setupWsTransportTests,
  sockets,
  WsTransportInternals,
  makeBareTransport,
  bindWindowTimersToCurrentGlobals,
  NEGOTIATION_RESULT,
  jsonResponse,
  waitForSockets,
} from "./wsTransport.testFixtures";
setupWsTransportTests();

describe("WsTransport", () => {
  it("delivers thread stream failures to listeners until they unsubscribe", () => {
    const { transport, internals } = makeBareTransport();
    const failure: WsThreadStreamFailure = {
      threadId: "thread-failed",
      code: "THREAD_SNAPSHOT_NOT_FOUND",
      error: new Error("snapshot missing"),
    };
    const throwing = vi.fn(() => {
      throw new Error("listener exploded");
    });
    const listener = vi.fn();

    const unsubscribeThrowing = transport.onThreadStreamFailure(throwing);
    const unsubscribe = transport.onThreadStreamFailure(listener);
    internals.emitThreadStreamFailure(failure);

    expect(throwing).toHaveBeenCalledWith(failure);
    expect(listener).toHaveBeenCalledWith(failure);

    unsubscribe();
    unsubscribeThrowing();
    internals.emitThreadStreamFailure(failure);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("waits for a thread stream to settle before resolving unsubscribe", async () => {
    const { transport, internals } = makeBareTransport();
    const threadId = "thread-release-order";
    const key = `orchestration.thread:${threadId}`;
    let settleStream: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settleStream = resolve;
    });
    const cleanup = vi.fn();
    internals.threadSubscriptions.set(threadId, { threadId });
    internals.streamCleanups.set(key, cleanup);
    internals.streamSettled.set(key, settled);

    let unsubscribeResolved = false;
    const unsubscribe = transport
      .request(ORCHESTRATION_WS_METHODS.unsubscribeThread, { threadId })
      .then(() => {
        unsubscribeResolved = true;
      });
    await Promise.resolve();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(unsubscribeResolved).toBe(false);

    settleStream();
    await unsubscribe;
    expect(unsubscribeResolved).toBe(true);
  });

  it("cancels owned capacity retry timers when a stream stops", async () => {
    vi.useFakeTimers();
    try {
      const { transport, internals } = makeBareTransport();
      const key = "orchestration.thread:thread-cancel-retry";
      const retry = vi.fn();
      const timeoutId = window.setTimeout(retry, 1_000);
      internals.streamCapacityRetries.set(key, 2);
      internals.projectFileWatchRetries.set(key, 2);
      internals.streamResnapshotRetries.set(key, 2);
      internals.streamCapacityRetryTimers.set(key, timeoutId);

      await transport.request(ORCHESTRATION_WS_METHODS.unsubscribeThread, {
        threadId: "thread-cancel-retry",
      });
      await vi.advanceTimersByTimeAsync(1_000);

      expect(retry).not.toHaveBeenCalled();
      expect(internals.streamCapacityRetryTimers.has(key)).toBe(false);
      expect(internals.streamCapacityRetries.has(key)).toBe(false);
      expect(internals.projectFileWatchRetries.has(key)).toBe(false);
      expect(internals.streamResnapshotRetries.has(key)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let stale or duplicate thread restarts replace the active stream", async () => {
    const { internals } = makeBareTransport();
    const threadId = "thread-current-generation";
    const key = `orchestration.thread:${threadId}`;
    const currentInput = { threadId, generation: "current" };
    const staleInput = { threadId, generation: "stale" };
    const cleanup = vi.fn();
    internals.threadSubscriptions.set(threadId, currentInput);
    internals.streamCleanups.set(key, cleanup);
    internals.activeThreadStreamInputs.set(key, currentInput);

    await internals.startThreadStream({}, threadId, staleInput);
    await internals.startThreadStream({}, threadId, currentInput);

    expect(cleanup).not.toHaveBeenCalled();
    expect(internals.streamCleanups.get(key)).toBe(cleanup);
  });

  it("force-restarts an identical live thread stream for a fresh snapshot", async () => {
    const { internals } = makeBareTransport();
    const threadId = "thread-force-snapshot";
    const key = `orchestration.thread:${threadId}`;
    const input = { threadId };
    const cleanup = vi.fn();
    const subscribeThread = vi.fn(() => ({}));
    const stopStream = vi.fn(async () => {
      internals.streamCleanups.delete(key);
      internals.activeThreadStreamInputs.delete(key);
    });
    const startStream = vi.fn();
    Object.assign(internals, {
      disposed: false,
      sessionVersion: 7,
      stopStream,
      startStream,
    });
    internals.threadSubscriptions.set(threadId, input);
    internals.streamCleanups.set(key, cleanup);
    internals.activeThreadStreamInputs.set(key, input);

    await internals.startThreadStream(
      { [ORCHESTRATION_WS_METHODS.subscribeThread]: subscribeThread },
      threadId,
      input,
      true,
    );

    expect(stopStream).toHaveBeenCalledWith(key, { resetCapacityRetry: false });
    expect(subscribeThread).toHaveBeenCalledWith(input);
    expect(startStream).toHaveBeenCalledWith(
      expect.anything(),
      key,
      {},
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("treats an explicit identical thread subscribe as a forced snapshot refresh", async () => {
    const { transport, internals } = makeBareTransport();
    const threadId = "thread-explicit-snapshot";
    const input = { threadId };
    const client = {};
    const startThreadStream = vi.fn(async () => undefined);
    Object.assign(internals, {
      disposed: false,
      getClient: vi.fn(async () => client),
      startThreadStream,
    });
    internals.threadSubscriptions.set(threadId, input);

    await transport.request(ORCHESTRATION_WS_METHODS.subscribeThread, { threadId });

    expect(startThreadStream).toHaveBeenCalledWith(client, threadId, input, true);
  });

  it("retains shell and thread subscription intent while the initial connection is unavailable", async () => {
    vi.useFakeTimers();
    try {
      const { transport, internals } = makeBareTransport();
      const threadId = "thread-slow-start";
      Object.assign(internals, {
        shellSubscribed: false,
        getClient: vi.fn(() => new Promise(() => {})),
      });

      const shellRequest = transport
        .request(ORCHESTRATION_WS_METHODS.subscribeShell, {}, { timeoutMs: 25 })
        .catch((error: unknown) => error);
      const threadRequest = transport
        .request(ORCHESTRATION_WS_METHODS.subscribeThread, { threadId }, { timeoutMs: 25 })
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(25);

      await expect(shellRequest).resolves.toMatchObject({ code: "WS_REQUEST_TIMEOUT" });
      await expect(threadRequest).resolves.toMatchObject({ code: "WS_REQUEST_TIMEOUT" });
      expect(internals.shellSubscribed).toBe(true);
      expect(internals.threadSubscriptions.get(threadId)).toEqual({ threadId });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restart an automatically restored shell stream for the initial subscriber", async () => {
    const { transport, internals } = makeBareTransport();
    const client = {};
    let resolveClient!: (client: unknown) => void;
    const startShellStream = vi.fn(async () => undefined);
    Object.assign(internals, {
      shellSubscribed: false,
      shellSnapshotDelivered: false,
      getClient: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveClient = resolve;
          }),
      ),
      startShellStream,
    });

    const subscription = transport.request(ORCHESTRATION_WS_METHODS.subscribeShell, {});

    Object.assign(internals, { shellSnapshotDelivered: true });
    resolveClient(client);
    await subscription;

    expect(startShellStream).toHaveBeenCalledWith(client, false);
  });

  it("joins an active reconnect instead of returning the detached prior client", async () => {
    const transport = Object.create(WsTransport.prototype) as WsTransport;
    const internals = transport as unknown as WsTransportInternals;
    const recoveredClient = { generation: "recovered" };
    Object.assign(internals, {
      reconnectPromise: Promise.resolve(recoveredClient),
      clientPromise: Promise.resolve({ generation: "stale" }),
    });

    await expect(internals.getClient()).resolves.toBe(recoveredClient);
  });

  it("keeps reconnecting and restores shell, thread and file subscriptions after recovery", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const transport = Object.create(WsTransport.prototype) as WsTransport;
      const internals = transport as unknown as WsTransportInternals;
      const threadId = "thread-reconnect";
      const input = { threadId };
      const client = { connected: true };
      const createSession = vi
        .fn()
        .mockImplementationOnce(() => ({
          clientPromise: Promise.reject(new Error("starting-1")),
        }))
        .mockImplementationOnce(() => ({
          clientPromise: Promise.reject(new Error("starting-2")),
        }))
        .mockImplementationOnce(() => ({ clientPromise: Promise.resolve(client) }));
      const startChannelStream = vi.fn();
      const startShellStream = vi.fn(async () => undefined);
      const startThreadStream = vi.fn(async () => undefined);
      const startProjectFileChangeStream = vi.fn();
      const watchedFile = {
        input: { cwd: "/repo", relativePath: "app.ts" },
        listeners: new Set([vi.fn()]),
      };
      const fileKey = projectFileChangeStreamKey(watchedFile.input);
      Object.assign(internals, {
        disposed: false,
        state: "closed",
        stateListeners: new Set(),
        connectionStatus: new ConnectionStatusTracker(() => null),
        reconnectFailures: 0,
        lifetime: new AbortController(),
        listeners: new Map([[WS_CHANNELS.serverWelcome, new Set([vi.fn()])]]),
        shellSubscribed: true,
        threadSubscriptions: new Map([[threadId, input]]),
        projectFileSubscriptions: new Map([[fileKey, watchedFile]]),
        startProjectFileChangeStream,
        runtime: null,
        clientScope: null,
        createSession,
        takeCurrentRuntime: () => null,
        closeRuntime: vi.fn(async () => undefined),
        startChannelStream,
        startShellStream,
        refreshThreadSubscriptionInput: () => input,
        startThreadStream,
      });

      const recovery = internals.openReconnectSession();
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(recovery).resolves.toBe(client);
      expect(createSession).toHaveBeenCalledTimes(3);
      expect(startChannelStream).toHaveBeenCalledOnce();
      expect(startShellStream).toHaveBeenCalledOnce();
      expect(startThreadStream).toHaveBeenCalledOnce();
      expect(startThreadStream).toHaveBeenCalledWith(client, threadId, input);
      expect(startProjectFileChangeStream).toHaveBeenCalledExactlyOnceWith(
        client,
        fileKey,
        watchedFile,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending reconnect delay during transport shutdown", async () => {
    vi.useFakeTimers();
    bindWindowTimersToCurrentGlobals();
    try {
      const transport = Object.create(WsTransport.prototype) as WsTransport;
      const internals = transport as unknown as WsTransportInternals & {
        disposed: boolean;
        lifetime: AbortController;
      };
      const lifetime = new AbortController();
      const createSession = vi.fn();
      Object.assign(internals, {
        disposed: false,
        state: "closed",
        stateListeners: new Set(),
        connectionStatus: new ConnectionStatusTracker(() => null),
        reconnectFailures: 0,
        lifetime,
        createSession,
      });

      const recovery = internals.openReconnectSession();
      internals.disposed = true;
      lifetime.abort(new Error("Transport disposed"));

      await expect(recovery).rejects.toThrow("Transport disposed");
      expect(createSession).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("owns request deadlines and external aborts without leaving timers active", async () => {
    vi.useFakeTimers();
    try {
      const deadline = makeRequestAbortScope({ timeoutMs: 25 });
      expect(deadline.signal?.aborted).toBe(false);
      expect(deadline.didTimeout()).toBe(false);

      await vi.advanceTimersByTimeAsync(25);
      expect(deadline.signal?.aborted).toBe(true);
      expect(deadline.didTimeout()).toBe(true);
      deadline.cleanup();
      deadline.cleanup();

      const external = new AbortController();
      const cancelled = makeRequestAbortScope({ timeoutMs: 1_000, signal: external.signal });
      external.abort(new Error("cancelled by caller"));
      expect(cancelled.signal?.aborted).toBe(true);
      expect(cancelled.didTimeout()).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(cancelled.didTimeout()).toBe(false);
      cancelled.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it("negotiates over HTTP so a connect opens only the feature socket", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request) =>
      Promise.resolve(jsonResponse(200, NEGOTIATION_RESULT)),
    );
    vi.stubGlobal("fetch", fetchMock);

    const transport = new WsTransport("ws://localhost:3020");
    await waitForSockets(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const negotiateUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(negotiateUrl.protocol).toBe("http:");
    expect(negotiateUrl.pathname).toBe("/ws/negotiate");
    expect(negotiateUrl.searchParams.get(WS_NEGOTIATE_QUERY.protocolEpoch)).toBe(
      String(WS_PROTOCOL_EPOCH),
    );
    expect(sockets).toHaveLength(1);
    const featureUrl = new URL(sockets[0]!.url);
    expect(featureUrl.pathname).toBe("/ws");
    expect(featureUrl.searchParams.get(WS_COMPATIBILITY_QUERY.serverInstanceId)).toBe(
      NEGOTIATION_RESULT.serverInstanceId,
    );

    await transport.dispose();
  });

  it("surfaces a 426 HTTP negotiation refusal as a terminal compatibility error", async () => {
    const refusal = new WsCompatibilityError({
      message: "Update this client.",
      code: "WS_PROTOCOL_INCOMPATIBLE",
      retryable: false,
      action: "update-client",
      serverBuild: "0.5.2",
      protocolEpoch: WS_PROTOCOL_EPOCH,
      minRevision: WS_PROTOCOL_MIN_REVISION,
      maxRevision: WS_PROTOCOL_MAX_REVISION,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(426, JSON.parse(JSON.stringify(refusal))))),
    );

    await expect(negotiateOverHttp("ws://localhost:3020")).rejects.toSatisfy((error) =>
      isTerminalCompatibilityFailure(error),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(404, null))),
    );
    await expect(negotiateOverHttp("ws://localhost:3020")).resolves.toBeNull();
  });

  it("discards an unusable HTTP response without waiting for its stalled body", async () => {
    const cancel = vi.fn(async () => undefined);
    const json = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, body: { cancel }, json })),
    );
    await expect(negotiateOverHttp("ws://localhost:3020")).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(json).not.toHaveBeenCalled();
  });

  it("rebuilds the feature client after protocol failure and stops recovery on disposal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, NEGOTIATION_RESULT)),
    );
    const transport = new WsTransport("ws://localhost:3020");
    const internals = transport as unknown as { clientPromise: Promise<unknown> };
    await waitForSockets(1);
    sockets[0]!.serveVoidRpc();
    await internals.clientPromise;
    sockets[0]!.close(1006);
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(2), { timeout: 3_000 });
    sockets[1]!.serveVoidRpc();
    await expect(
      transport.request(ORCHESTRATION_WS_METHODS.unsubscribeShell),
    ).resolves.toBeUndefined();
    await transport.dispose();
    const count = sockets.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(sockets).toHaveLength(count);
  });

  it.each(["accepted", "rejected", "cancelled"] as const)(
    "settles a lost dispatch response as %s without another turn request",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse(200, {
            ...NEGOTIATION_RESULT,
            capabilities: [WS_TURN_DISPATCH_SETTLEMENT_CAPABILITY],
          }),
        ),
      );
      const transport = new WsTransport("ws://localhost:3020");
      const internals = transport as unknown as { clientPromise: Promise<unknown> };
      const command = {
        type: "thread.turn.start" as const,
        commandId: CommandId.makeUnsafe(`lost-${status}`),
        threadId: ThreadId.makeUnsafe(`lost-${status}`),
        message: {
          messageId: MessageId.makeUnsafe(`lost-${status}`),
          role: "user" as const,
          text: "hello",
          attachments: [],
        },
        runtimeMode: "approval-required" as const,
        createdAt: new Date().toISOString(),
      };
      try {
        await waitForSockets(1);
        sockets[0]!.serveVoidRpc();
        await internals.clientPromise;
        sockets[0]!.onSend = (raw) => {
          const frame = JSON.parse(raw);
          if (frame.tag === ORCHESTRATION_WS_METHODS.dispatchCommand) sockets[0]!.close(1006);
        };
        const send = transport.dispatchTurn(command);
        const checked =
          status === "accepted"
            ? expect(send).resolves.toEqual({ sequence: 17 })
            : status === "rejected"
              ? expect(send).rejects.toMatchObject({
                  _tag: "WsTransportRpcError",
                  message: "not accepted",
                })
              : expect(send).rejects.toMatchObject({
                  _tag: "WsTransportRequestInterruptedError",
                  code: "WS_TURN_SETTLEMENT_UNAVAILABLE",
                });
        await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(2), {
          timeout: 3_000,
        });
        const socket = sockets[1]!;
        socket.onSend = (raw) => {
          const frame = JSON.parse(raw);
          if (frame._tag === "Ping") socket.receive(JSON.stringify({ _tag: "Pong" }));
          if (frame._tag !== "Request") return;
          if (status === "cancelled" && frame.tag === ORCHESTRATION_WS_METHODS.settleTurnDispatch)
            return;
          const value =
            frame.tag === ORCHESTRATION_WS_METHODS.settleTurnDispatch
              ? status === "accepted"
                ? { status, sequence: 17 }
                : { status, message: "not accepted" }
              : null;
          socket.receive(
            JSON.stringify({ _tag: "Exit", requestId: frame.id, exit: { _tag: "Success", value } }),
          );
        };
        socket.open();
        if (status === "cancelled") {
          await vi.waitFor(() =>
            expect(
              usePendingTurnDispatchStore.getState().deliveryByThreadId[command.threadId]?.status,
            ).toBe("recovering"),
          );
          expect(usePendingTurnDispatchStore.getState().beginSubmission(command.threadId)).toBe(
            false,
          );
          await vi.waitFor(() =>
            expect(
              socket.sent.some(
                (raw) =>
                  JSON.parse(String(raw)).tag === ORCHESTRATION_WS_METHODS.settleTurnDispatch,
              ),
            ).toBe(true),
          );
          await transport.dispose();
        }
        await checked;
        const requests = sockets.flatMap((socket) =>
          socket.sent.map((raw) => JSON.parse(String(raw))),
        );
        expect(
          requests.filter((frame) => frame.tag === ORCHESTRATION_WS_METHODS.dispatchCommand),
        ).toHaveLength(1);
        expect(
          requests.find((frame) => frame.tag === ORCHESTRATION_WS_METHODS.settleTurnDispatch)
            ?.payload,
        ).toEqual({ command });
        if (status === "cancelled") {
          expect(
            usePendingTurnDispatchStore.getState().deliveryByThreadId[command.threadId],
          ).toMatchObject({ status: "uncertain", command });
          expect(usePendingTurnDispatchStore.getState().beginSubmission(command.threadId)).toBe(
            false,
          );
        } else {
          expect(
            usePendingTurnDispatchStore.getState().deliveryByThreadId[command.threadId],
          ).toBeUndefined();
        }
      } finally {
        await transport.dispose();
        usePendingTurnDispatchStore.getState().setDelivery(command.threadId, null);
      }
    },
  );

  it("falls back to bootstrap when the negotiate request never settles", async () => {
    // A connection that accepts and then stalls (WAN/tunnel black hole) must not wedge the transport:
    // browsers apply no default fetch timeout, so without the deadline signal the bootstrap fallback
    // would never run. Fake timers cannot drive AbortSignal.timeout, so the deadline is fired here.
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const fetchMock = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const negotiation = negotiateOverHttp("ws://localhost:3020");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));

    await expect(negotiation).resolves.toBeNull();
  });

  it("aborts a stalled negotiate when the caller's lifetime signal fires", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      ),
    );

    const negotiation = negotiateOverHttp("ws://localhost:3020", controller.signal);
    controller.abort();
    // Resolves well before the 5s deadline because disposal, not the timeout, ended the request.
    await expect(negotiation).resolves.toBeNull();
  });

  it("does not create a bootstrap socket when disposed during negotiation", async () => {
    // dispose() captures a null runtime and returns while the HTTP request is still pending; the
    // transport must not build one afterwards.
    let abortNegotiation: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            abortNegotiation = () =>
              reject(new DOMException("The operation was aborted.", "AbortError"));
            init?.signal?.addEventListener("abort", () => abortNegotiation?.());
          }),
      ),
    );

    const transport = new WsTransport();

    const connecting = transport
      .request(ORCHESTRATION_WS_METHODS.subscribeShell, {})
      .catch(() => null);
    await Promise.resolve();
    const socketsBefore = sockets.length;

    await transport.dispose();
    await connecting;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sockets.length).toBe(socketsBefore);
  }, 10_000);

  it("uses the desktop bridge URL before falling back to the browser location", async () => {
    const getWsUrl = vi.fn().mockReturnValue("ws://127.0.0.1:53036/?token=old");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { protocol: "http:", hostname: "localhost", port: "3020" },
        desktopBridge: { getWsUrl },
      },
    });

    const transport = new WsTransport();
    await waitForSockets(1);

    expect(getWsUrl).toHaveBeenCalled();
    expect(sockets[0]?.url).toBe("ws://127.0.0.1:53036/ws/bootstrap?token=old");

    await transport.dispose();
  });

  it("falls back to the current browser host when no desktop bridge URL exists", async () => {
    const transport = new WsTransport();
    await waitForSockets(1);

    expect(sockets[0]?.url).toBe("ws://localhost:3020/ws/bootstrap");

    await transport.dispose();
  });

  it("reuses cached negotiation on reconnect while the server instance is unchanged", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, NEGOTIATION_RESULT)));
    vi.stubGlobal("fetch", fetchMock);

    const transport = new WsTransport("ws://localhost:3020");
    const internals = transport as unknown as {
      createSession(): { clientPromise: Promise<unknown> };
      probeFeatureConnection: (...args: unknown[]) => Promise<void>;
      compatibility: WsBootstrapNegotiateResult | null;
      clientPromise: Promise<unknown>;
    };
    await waitForSockets(1);
    sockets[0]!.serveVoidRpc();
    await internals.clientPromise;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(internals.compatibility).toEqual(NEGOTIATION_RESULT);

    const probe = vi.fn(async () => undefined);
    internals.probeFeatureConnection = probe;
    await internals.createSession().clientPromise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(2);
    const reconnectUrl = new URL(sockets[1]!.url);
    expect(reconnectUrl.pathname).toBe("/ws");
    expect(reconnectUrl.searchParams.get(WS_COMPATIBILITY_QUERY.serverInstanceId)).toBe(
      NEGOTIATION_RESULT.serverInstanceId,
    );

    await transport.dispose();
  });

  it("renegotiates and resets replayed push state when the server instance changed", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, NEGOTIATION_RESULT)));
    vi.stubGlobal("fetch", fetchMock);

    const transport = new WsTransport("ws://localhost:3020");
    const internals = transport as unknown as {
      createSession(): { clientPromise: Promise<unknown> };
      compatibility: WsBootstrapNegotiateResult | null;
      latestPushByChannel: Map<string, unknown>;
      sequence: number;
      clientPromise: Promise<unknown>;
    };
    await waitForSockets(1);
    sockets[0]!.serveVoidRpc();
    await internals.clientPromise;
    internals.latestPushByChannel.set("server.welcome", { stale: true });
    internals.sequence = 7;

    internals.compatibility = null;
    const restarted = { ...NEGOTIATION_RESULT, serverInstanceId: "server-instance-2" };
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, restarted)));
    const reconnected = internals.createSession().clientPromise;
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(2), { timeout: 3_000 });
    sockets[1]!.serveVoidRpc();
    await reconnected;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(internals.compatibility).toEqual(restarted);
    expect(internals.latestPushByChannel.size).toBe(0);
    expect(internals.sequence).toBe(0);
    const reconnectUrl = new URL(sockets[1]!.url);
    expect(reconnectUrl.searchParams.get(WS_COMPATIBILITY_QUERY.serverInstanceId)).toBe(
      "server-instance-2",
    );

    await transport.dispose();
  });

  it("mirrors the negotiate endpoint onto the WS host with an HTTP scheme", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request) =>
      Promise.resolve(jsonResponse(200, NEGOTIATION_RESULT)),
    );
    vi.stubGlobal("fetch", fetchMock);

    await negotiateOverHttp("wss://remote.example:8443/?token=old");

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("remote.example:8443");
    expect(url.pathname).toBe("/ws/negotiate");
    expect(url.searchParams.get("token")).toBe("old");
    expect(url.searchParams.get(WS_NEGOTIATE_QUERY.minRevision)).toBe(
      String(WS_PROTOCOL_MIN_REVISION),
    );
    expect(url.searchParams.get(WS_NEGOTIATE_QUERY.maxRevision)).toBe(
      String(WS_PROTOCOL_MAX_REVISION),
    );
  });

  it("pins the feature socket to the negotiated revision and server generation", () => {
    const resolved = new URL(
      makeFeatureSocketUrl("ws://127.0.0.1:53036/?token=old", {
        protocolEpoch: WS_PROTOCOL_EPOCH,
        negotiatedRevision: WS_PROTOCOL_MAX_REVISION,
        serverBuild: "0.5.2",
        serverInstanceId: "server-instance",
        capabilities: ["orchestration.cursor-safe-streams"],
      }),
    );

    expect(resolved.pathname).toBe("/ws");
    expect(resolved.searchParams.get("token")).toBe("old");
    expect(resolved.searchParams.get(WS_COMPATIBILITY_QUERY.protocolRevision)).toBe(
      String(WS_PROTOCOL_MAX_REVISION),
    );
    expect(resolved.searchParams.get(WS_COMPATIBILITY_QUERY.serverInstanceId)).toBe(
      "server-instance",
    );
  });

  it("notifies state listeners and replays the current state on demand", async () => {
    const transport = new WsTransport();
    const listener = vi.fn();

    const unsubscribe = transport.onStateChange(listener, { replayCurrent: true });

    expect(listener).toHaveBeenCalledWith("connecting");

    listener.mockClear();
    await transport.dispose();

    expect(listener).toHaveBeenCalledWith("disposed");

    listener.mockClear();
    unsubscribe();
    await transport.dispose();

    expect(listener).not.toHaveBeenCalled();
  });
});
