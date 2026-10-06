import { dispatchRecoverableTurn } from "./wsTurnDispatch";
import type { ClientOrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { WsScopedSubscriptions } from "./wsScopedSubscriptions";
import type { GitStatusWatchInput, GitStatusStreamEvent } from "@glade/contracts/git/git";
import { ORCHESTRATION_WS_METHODS } from "@glade/contracts/orchestration/rpc";
import {
  WS_GIT_ACTION_REATTACH_CAPABILITY,
  WS_TURN_DISPATCH_SETTLEMENT_CAPABILITY,
  WS_BOOTSTRAP_METHOD,
  WS_BOOTSTRAP_PATH,
  WS_CLIENT_REQUIRED_CAPABILITIES,
  WS_PROTOCOL_EPOCH,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
  WsBootstrapNegotiateResult,
  WsCompatibilityError,
} from "@glade/contracts/transport/ws/wsCompatibility";
import {
  WS_METHODS,
  type WsPush,
  type WsPushChannel,
  type WsPushMessage,
} from "@glade/contracts/transport/ws/ws";
import type {
  GitCreateDetachedWorktreeResult,
  GitRunStackedActionResult,
} from "@glade/contracts/git/git";
import type { GitHubProjectProvisionResult } from "@glade/contracts/git/githubProjectProvisioning";
import type {
  ProjectFileChangeEvent,
  ProjectWatchFileInput,
} from "@glade/contracts/workspace/project";
import { Effect, Exit, ManagedRuntime, Schema, Scope } from "effect";
import { RpcClient, RpcClientError } from "effect/unstable/rpc";
import { APP_VERSION } from "./branding";
import { useComputerStateStore } from "./computerStateStore";
import { getUnaryRpcCapacityRetryDelayMs } from "./lib/expensiveReadRetry";
import { resetThreadDetailResumeCursors } from "./threadDetailResumeCursors";
import type { WsTransportState } from "./wsTransportEvents";
import {
  FEATURE_CONNECTION_PROBE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  STABLE_STREAM_LIFETIME_MS,
  WsTransportRequestInterruptedError,
  WsTransportRpcError,
  awaitWithAbort,
  delayMs,
  delayWithAbort,
  getReconnectRetryDelayMs,
  getTerminalCompatibilityError,
  getUnexpectedStreamCompletionRetryDelayMs,
  isRuntimeInterruptFailure,
  isTerminalCompatibilityFailure,
  makeBootstrapRpcClient,
  makeFeatureSocketUrl,
  makeProtocolLayer,
  makeRequestAbortScope,
  makeRpcClient,
  makeSocketUrl,
  negotiateOverHttp,
  omitNullUserInputAnswers,
  projectFileChangeStreamKey,
  serverIdentityChanged,
  threadStreamInputsEqual,
} from "./wsTransport.support";
import type {
  ProjectFileChangeSubscription,
  PushListener,
  RpcClientInstance,
  WsRequestOptions,
  WsThreadStreamFailure,
} from "./wsTransport.support";
const MAX_GIT_ACTION_REATTACH_ATTEMPTS = 8;

export abstract class WsTransportBase {
  protected abstract stopStream(
    key: string,
    options?: { readonly resetCapacityRetry?: boolean },
  ): Promise<void>;
  protected abstract startShellStream(
    client: RpcClientInstance,
    forceRestart?: boolean,
  ): Promise<void>;
  protected abstract startThreadStream(
    client: RpcClientInstance,
    threadId: string,
    input: unknown,
    forceRestart?: boolean,
  ): Promise<void>;
  protected abstract runGitActionStream(
    client: RpcClientInstance,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<GitRunStackedActionResult>;
  protected abstract runWorktreeSetupStream(
    client: RpcClientInstance,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<GitCreateDetachedWorktreeResult>;
  protected abstract runProjectProvisionStream(
    client: RpcClientInstance,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<GitHubProjectProvisionResult>;
  protected abstract startChannelStream(channel: WsPushChannel): void;
  protected abstract stopChannelStream(channel: WsPushChannel): void;
  protected abstract startProjectFileChangeStream(
    client: RpcClientInstance,
    key: string,
    subscription: ProjectFileChangeSubscription,
  ): void;
  protected abstract startGitStatusStream(
    client: RpcClientInstance,
    key: string,
    input: GitStatusWatchInput,
    emit: (event: GitStatusStreamEvent) => void,
    restart: () => void,
  ): void;
  protected abstract refreshThreadSubscriptionInput(threadId: string): unknown;

  protected readonly explicitUrl: string | null;
  protected readonly listeners = new Map<string, Set<(message: WsPush) => void>>();
  protected readonly stateListeners = new Set<(state: WsTransportState) => void>();
  protected readonly compatibilityListeners = new Set<
    (issue: WsCompatibilityError | null) => void
  >();
  protected readonly compatibilityResultListeners = new Set<
    (compatibility: WsBootstrapNegotiateResult | null) => void
  >();
  protected readonly threadStreamFailureListeners = new Set<
    (failure: WsThreadStreamFailure) => void
  >();
  protected readonly latestPushByChannel = new Map<string, WsPush>();
  protected terminalOutputReady = false;
  private readonly terminalOutputWaiters = new Set<() => void>();
  protected markTerminalOutputReady(): void {
    this.terminalOutputReady = true;
    for (const resolve of this.terminalOutputWaiters) resolve();
    this.terminalOutputWaiters.clear();
  }
  private async waitForTerminalOutput(signal: AbortSignal | undefined): Promise<void> {
    if (this.terminalOutputReady) return;
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    this.terminalOutputWaiters.add(resolveReady);
    try {
      await awaitWithAbort(awaitWithAbort(ready, this.lifetime.signal), signal);
    } finally {
      this.terminalOutputWaiters.delete(resolveReady);
    }
  }
  protected sequence = 0;
  protected sessionVersion = 0;
  protected state: WsTransportState = "connecting";
  protected disposed = false;
  protected readonly runtimeByClient = new WeakMap<
    RpcClientInstance,
    ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>
  >();
  protected runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never> | null = null;
  protected clientScope: Scope.Closeable | null = null;
  protected readonly lifetime = new AbortController();
  protected clientPromise: Promise<RpcClientInstance>;
  protected reconnectPromise: Promise<RpcClientInstance> | null = null;
  protected reconnectFailures = 0;
  protected readonly streamCleanups = new Map<string, () => void>();
  protected readonly streamSettled = new Map<string, Promise<void>>();
  protected readonly streamCapacityRetries = new Map<string, number>();
  protected readonly streamDuplicateRetries = new Map<string, number>();
  protected readonly streamThreadBootstrapRetries = new Map<string, number>();
  protected readonly streamResnapshotRetries = new Map<string, number>();
  protected readonly projectFileWatchRetries = new Map<string, number>();
  protected readonly streamCapacityRetryTimers = new Map<string, number>();
  protected readonly streamCompletionRetries = new Map<string, number>();
  protected readonly streamCompletionRetryTimers = new Map<string, number>();
  protected readonly activeThreadStreamInputs = new Map<string, unknown>();
  protected shellSubscribed = false;
  protected shellSnapshotDelivered = false;
  protected readonly threadSubscriptions = new Map<string, unknown>();
  protected readonly projectFileSubscriptions = new Map<string, ProjectFileChangeSubscription>();
  private gitStatusSubscriptions: WsScopedSubscriptions<
    RpcClientInstance,
    GitStatusWatchInput,
    GitStatusStreamEvent
  > | null = null;
  protected compatibility: WsBootstrapNegotiateResult | null = null;
  protected compatibilityIssue: WsCompatibilityError | null = null;
  protected lastServerInstanceId: string | null = null;
  constructor(url?: string) {
    this.explicitUrl = url ?? null;
    this.clientPromise = this.createSession().clientPromise;
    const initialVersion = this.sessionVersion;
    void this.clientPromise.catch((error) => {
      if (
        this.disposed ||
        this.sessionVersion !== initialVersion ||
        isTerminalCompatibilityFailure(error)
      )
        return;
      void this.reconnect().catch((reconnectError) => {
        if (!this.disposed && !isTerminalCompatibilityFailure(reconnectError)) {
          console.warn("WebSocket reconnect loop stopped unexpectedly", reconnectError);
        }
      });
    });
  }
  dispatchTurn(command: Extract<ClientOrchestrationCommand, { type: "thread.turn.start" }>) {
    return dispatchRecoverableTurn(this, command, this.lifetime.signal);
  }
  async request<T = unknown>(
    method: string,
    params?: unknown,
    options?: WsRequestOptions,
  ): Promise<T> {
    if (this.disposed) throw new Error("Transport disposed");
    const requestOptions: WsRequestOptions =
      options?.timeoutMs === undefined ? { ...options, timeoutMs: REQUEST_TIMEOUT_MS } : options;
    const abortScope = makeRequestAbortScope(requestOptions);
    try {
      if (method === ORCHESTRATION_WS_METHODS.unsubscribeShell) {
        this.shellSubscribed = false;
        await awaitWithAbort(this.stopStream("orchestration.shell"), abortScope.signal);
        return undefined as T;
      }
      if (method === ORCHESTRATION_WS_METHODS.unsubscribeThread) {
        const threadId = (params as { threadId: string }).threadId;
        this.threadSubscriptions.delete(threadId);
        await awaitWithAbort(
          this.stopStream(`orchestration.thread:${threadId}`),
          abortScope.signal,
        );
        return undefined as T;
      }

      if (method === ORCHESTRATION_WS_METHODS.subscribeShell) {
        const wasSubscribed = this.shellSubscribed;
        this.shellSubscribed = true;
        this.resetStreamCapacityRetry("orchestration.shell");
        this.resetStreamCompletionRetry("orchestration.shell");
        const client = await awaitWithAbort(this.getClient(), abortScope.signal);
        await this.startShellStream(client, wasSubscribed && this.shellSnapshotDelivered);
        return undefined as T;
      }
      if (method === ORCHESTRATION_WS_METHODS.subscribeThread) {
        const threadId = (params as { threadId: string }).threadId;
        this.resetStreamCapacityRetry(`orchestration.thread:${threadId}`);
        this.resetStreamCompletionRetry(`orchestration.thread:${threadId}`);
        // Preserve the stored input identity across explicit refreshes so stale restart callbacks cannot
        // supersede the newly requested stream.
        const existingInput = this.threadSubscriptions.get(threadId);
        const wasSubscribed = existingInput !== undefined;
        const input = threadStreamInputsEqual(existingInput, params) ? existingInput : params;
        this.threadSubscriptions.set(threadId, input);
        const client = await awaitWithAbort(this.getClient(), abortScope.signal);
        await this.startThreadStream(client, threadId, input as never, wasSubscribed);
        return undefined as T;
      }

      const client = await awaitWithAbort(this.getClient(), abortScope.signal);
      if (
        method === ORCHESTRATION_WS_METHODS.settleTurnDispatch &&
        !this.compatibility?.capabilities.includes(WS_TURN_DISPATCH_SETTLEMENT_CAPABILITY)
      )
        throw new WsTransportRequestInterruptedError({
          message: "This server cannot settle message delivery.",
          code: "WS_TURN_SETTLEMENT_UNAVAILABLE",
          method,
          retryable: false,
        });

      if (method === WS_METHODS.gitRunStackedAction) {
        return (await this.runReattachableGitAction(client, params, abortScope.signal)) as T;
      }
      if (method === WS_METHODS.gitCreateDetachedWorktree) {
        return (await this.runWorktreeSetupStream(client, params, abortScope.signal)) as T;
      }
      if (method === WS_METHODS.projectsProvisionFromGitHub) {
        return (await this.runProjectProvisionStream(client, params, abortScope.signal)) as T;
      }

      if (method === WS_METHODS.terminalOpen) {
        await this.waitForTerminalOutput(abortScope.signal);
      }

      const rpcInput =
        method === ORCHESTRATION_WS_METHODS.dispatchCommand
          ? (params as { command: unknown }).command
          : (params ?? {});
      const normalizedRpcInput = omitNullUserInputAnswers(rpcInput);
      const call = (
        client as unknown as Record<
          string,
          (input: unknown) => Effect.Effect<unknown, WsTransportRpcError, never>
        >
      )[method];
      if (!call) throw new WsTransportRpcError({ message: `Unknown RPC method: ${method}` });
      const clientRuntime = this.getClientRuntime(client);
      const runOptions = abortScope.signal ? { signal: abortScope.signal } : undefined;
      let capacityAttempts = 0;
      while (true) {
        try {
          return (await clientRuntime.runPromise(call(normalizedRpcInput), runOptions)) as T;
        } catch (error) {
          const retryDelayMs = getUnaryRpcCapacityRetryDelayMs(error, capacityAttempts);
          if (retryDelayMs === null) throw error;
          capacityAttempts += 1;
          await delayMs(retryDelayMs, abortScope.signal);
        }
      }
    } catch (error) {
      if (abortScope.didTimeout()) {
        throw new WsTransportRequestInterruptedError({
          message: `WebSocket RPC ${method} timed out after ${requestOptions.timeoutMs}ms.`,
          code: "WS_REQUEST_TIMEOUT",
          method,
          ...(requestOptions.timeoutMs !== undefined && requestOptions.timeoutMs !== null
            ? { timeoutMs: requestOptions.timeoutMs }
            : {}),
          cause: error,
        });
      }
      if (requestOptions.signal?.aborted) {
        throw new WsTransportRequestInterruptedError({
          message: `WebSocket RPC ${method} was cancelled.`,
          code: "WS_REQUEST_ABORTED",
          method,
          cause: requestOptions.signal.reason ?? error,
        });
      }
      if (isRuntimeInterruptFailure(error) || Schema.is(RpcClientError.RpcClientError)(error)) {
        throw new WsTransportRequestInterruptedError({
          message: `WebSocket RPC ${method} was interrupted by a transport reconnect.`,
          code: "WS_REQUEST_RECONNECTED",
          method,
          cause: error,
          retryable: true,
        });
      }
      throw error;
    } finally {
      abortScope.cleanup();
    }
  }
  // A dropped socket leaves the server-owned action running. Reattach to it by ID; never resend it.
  private async runReattachableGitAction(
    initialClient: RpcClientInstance,
    params: unknown,
    callerSignal: AbortSignal | undefined,
  ): Promise<GitRunStackedActionResult> {
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, this.lifetime.signal])
      : this.lifetime.signal;
    const unknownOutcome = (cause: unknown) =>
      new WsTransportRpcError({
        message:
          "The connection dropped during the Git action and its result is unknown. Check the repository status before trying again.",
        cause,
      });
    const canReattach = () =>
      this.compatibility?.capabilities.includes(WS_GIT_ACTION_REATTACH_CAPABILITY) === true;
    let client = initialClient;
    let resume = false;
    for (let attempt = 0; ; attempt += 1) {
      try {
        if (resume) {
          client = await awaitWithAbort(this.getClient(), signal);
          // An older server ignores `resume` and would run the mutation a second time.
          if (!canReattach()) throw unknownOutcome(null);
        }
        return await this.runGitActionStream(
          client,
          resume ? { ...(params as object), resume: true } : params,
          signal,
        );
      } catch (error) {
        if (
          signal.aborted ||
          this.disposed ||
          !(isRuntimeInterruptFailure(error) || Schema.is(RpcClientError.RpcClientError)(error))
        )
          throw error;
        if (attempt >= MAX_GIT_ACTION_REATTACH_ATTEMPTS || !canReattach())
          throw unknownOutcome(error);
        resume = true;
        await delayMs(getReconnectRetryDelayMs(attempt), signal);
      }
    }
  }
  subscribe<C extends WsPushChannel>(
    channel: C,
    listener: PushListener<C>,
    options?: { readonly replayLatest?: boolean },
  ): () => void {
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set<(message: WsPush) => void>();
      this.listeners.set(channel, channelListeners);
      this.startChannelStream(channel);
    }

    const wrappedListener = (message: WsPush) => listener(message as WsPushMessage<C>);
    channelListeners.add(wrappedListener);

    if (options?.replayLatest) {
      const latest = this.latestPushByChannel.get(channel);
      if (latest) wrappedListener(latest);
    }

    return () => {
      channelListeners?.delete(wrappedListener);
      if (channelListeners?.size === 0) {
        this.listeners.delete(channel);
        this.stopChannelStream(channel);
      }
    };
  }
  subscribeProjectFileChange(
    input: ProjectWatchFileInput,
    listener: (event: ProjectFileChangeEvent) => void,
  ): () => void {
    const key = projectFileChangeStreamKey(input);
    let subscription = this.projectFileSubscriptions.get(key);
    const isNewSubscription = subscription === undefined;
    if (!subscription) {
      subscription = { input, listeners: new Set() };
      this.projectFileSubscriptions.set(key, subscription);
    }
    subscription.listeners.add(listener);
    const desiredSubscription = subscription;
    if (isNewSubscription) {
      void this.getClient()
        .then((client) => this.startProjectFileChangeStream(client, key, desiredSubscription))
        .catch(() => undefined);
    }

    return () => {
      desiredSubscription.listeners.delete(listener);
      if (
        desiredSubscription.listeners.size > 0 ||
        this.projectFileSubscriptions.get(key) !== desiredSubscription
      ) {
        return;
      }
      this.projectFileSubscriptions.delete(key);
      void this.stopStream(key);
    };
  }
  subscribeGitStatus(
    input: GitStatusWatchInput,
    listener: (event: GitStatusStreamEvent) => void,
  ): () => void {
    this.gitStatusSubscriptions ??= new WsScopedSubscriptions({
      key: (watch) => `git.status:${watch.summaryOnly ? "summary" : "full"}:${watch.cwd}`,
      getClient: () => this.getClient(),
      stop: (key) => this.stopStream(key),
      start: (client, key, watch, emit, restart) =>
        this.startGitStatusStream(client, key, watch, emit, restart),
    });
    return this.gitStatusSubscriptions.subscribe(input, listener);
  }
  getLatestPush<C extends WsPushChannel>(channel: C): WsPushMessage<C> | null {
    const latest = this.latestPushByChannel.get(channel);
    return latest ? (latest as WsPushMessage<C>) : null;
  }
  onStateChange(
    listener: (state: WsTransportState) => void,
    options?: { readonly replayCurrent?: boolean },
  ): () => void {
    this.stateListeners.add(listener);
    if (options?.replayCurrent) {
      listener(this.state);
    }

    return () => {
      this.stateListeners.delete(listener);
    };
  }
  getState(): WsTransportState {
    return this.state;
  }
  getCompatibility(): WsBootstrapNegotiateResult | null {
    return this.compatibility;
  }
  onCompatibilityChange(
    listener: (compatibility: WsBootstrapNegotiateResult | null) => void,
    options?: { readonly replayCurrent?: boolean },
  ): () => void {
    this.compatibilityResultListeners.add(listener);
    if (options?.replayCurrent) listener(this.compatibility);
    return () => {
      this.compatibilityResultListeners.delete(listener);
    };
  }
  onCompatibilityIssue(
    listener: (issue: WsCompatibilityError | null) => void,
    options?: { readonly replayCurrent?: boolean },
  ): () => void {
    this.compatibilityListeners.add(listener);
    if (options?.replayCurrent) listener(this.compatibilityIssue);
    return () => {
      this.compatibilityListeners.delete(listener);
    };
  }
  onThreadStreamFailure(listener: (failure: WsThreadStreamFailure) => void): () => void {
    this.threadStreamFailureListeners.add(listener);
    return () => {
      this.threadStreamFailureListeners.delete(listener);
    };
  }
  protected emitThreadStreamFailure(failure: WsThreadStreamFailure): void {
    for (const listener of this.threadStreamFailureListeners) {
      try {
        listener(failure);
      } catch {
        // Listener errors must not break transport streams.
      }
    }
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.lifetime.abort(new Error("Transport disposed"));
    this.setState("disposed");
    this.resetAllStreamCapacityRetries();
    this.resetAllStreamCompletionRetries();
    for (const cleanup of this.streamCleanups.values()) cleanup();
    this.streamCleanups.clear();
    this.activeThreadStreamInputs.clear();
    this.projectFileSubscriptions.clear();
    this.gitStatusSubscriptions?.dispose();
    this.threadStreamFailureListeners.clear();
    // Dispose can race with initial connection or reconnect promises. Mark them handled before closing
    // the runtime so test/browser teardown stays quiet.
    void this.clientPromise.catch(() => undefined);
    void this.reconnectPromise?.catch(() => undefined);
    const resources = this.takeCurrentRuntime();
    if (resources) await this.closeRuntime(resources);
  }
  protected async negotiateCompatibility(): Promise<WsBootstrapNegotiateResult> {
    const httpResult = await negotiateOverHttp(this.explicitUrl, this.lifetime.signal);
    if (httpResult) return httpResult;

    if (this.disposed) {
      throw new Error("WebSocket transport was disposed during negotiation.");
    }
    const runtime = ManagedRuntime.make(
      makeProtocolLayer(makeSocketUrl(this.explicitUrl, WS_BOOTSTRAP_PATH)),
    );
    const clientScope = runtime.runSync(Scope.make());

    this.runtime = runtime;
    this.clientScope = clientScope;
    try {
      const bootstrapClient = await runtime.runPromise(
        Scope.provide(clientScope)(makeBootstrapRpcClient),
      );
      return await runtime.runPromise(
        bootstrapClient[WS_BOOTSTRAP_METHOD]({
          protocolEpoch: WS_PROTOCOL_EPOCH,
          minRevision: WS_PROTOCOL_MIN_REVISION,
          maxRevision: WS_PROTOCOL_MAX_REVISION,
          clientBuild: APP_VERSION,
          requiredCapabilities: [...WS_CLIENT_REQUIRED_CAPABILITIES],
        }),
      );
    } finally {
      await runtime.runPromise(Scope.close(clientScope, Exit.void)).catch(() => undefined);
      await runtime.dispose().catch(() => undefined);
      if (this.runtime === runtime) {
        this.runtime = null;
        this.clientScope = null;
      }
    }
  }
  protected adoptNegotiation(compatibility: WsBootstrapNegotiateResult): void {
    if (serverIdentityChanged(this.lastServerInstanceId, compatibility.serverInstanceId)) {
      this.latestPushByChannel.clear();
      this.sequence = 0;
      // A resume cursor is only valid against the journal that issued its sequences. A new server
      // instance may serve a different journal (fresh install, restored backup), so every cursor must
      // reset to force full snapshots. `lastServerInstanceId` survives failed reconnects, unlike
      // `compatibility`, so an outage longer than the first retry still detects the change.
      resetThreadDetailResumeCursors();

      useComputerStateStore.getState().clear();
    }
    this.lastServerInstanceId = compatibility.serverInstanceId;
    this.setCompatibility(compatibility);
    this.setCompatibilityIssue(null);
  }
  protected async probeFeatureConnection(
    client: RpcClientInstance,
    runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>,
  ): Promise<void> {
    const probe = (
      client as unknown as Record<
        string,
        (input: unknown) => Effect.Effect<unknown, WsTransportRpcError>
      >
    )[ORCHESTRATION_WS_METHODS.unsubscribeShell];
    if (!probe) return;
    try {
      await runtime.runPromise(probe({}).pipe(Effect.timeout(FEATURE_CONNECTION_PROBE_TIMEOUT_MS)));
    } catch (error) {
      this.setCompatibility(null);
      throw error;
    }
  }
  protected createSession() {
    const sessionVersion = ++this.sessionVersion;

    const cachedCompatibility = this.compatibility;
    const clientPromise = (async () => {
      const compatibility = cachedCompatibility ?? (await this.negotiateCompatibility());
      if (this.disposed || this.sessionVersion !== sessionVersion) {
        throw new Error("WebSocket session superseded during compatibility negotiation.");
      }

      const featureRuntime = ManagedRuntime.make(
        makeProtocolLayer(makeFeatureSocketUrl(this.explicitUrl, compatibility), () => {
          // Teardown must leave the failing protocol fiber before closing its scope.
          queueMicrotask(() => {
            if (this.disposed || this.sessionVersion !== sessionVersion || this.reconnectPromise)
              return;
            if (this.state !== "open") this.setCompatibility(null);
            void this.reconnect().catch(() => undefined);
          });
        }),
      );
      const featureScope = featureRuntime.runSync(Scope.make());
      this.runtime = featureRuntime;
      this.clientScope = featureScope;
      const client = await featureRuntime.runPromise(Scope.provide(featureScope)(makeRpcClient));
      this.runtimeByClient.set(client, featureRuntime);
      await this.probeFeatureConnection(client, featureRuntime);
      if (this.disposed || this.sessionVersion !== sessionVersion)
        throw new Error("WebSocket session superseded during connection probe.");
      if (!this.disposed && this.sessionVersion === sessionVersion) {
        this.adoptNegotiation(compatibility);
        this.setState("open");
      }
      return client;
    })().catch((error) => {
      if (!this.disposed && this.sessionVersion === sessionVersion) {
        this.setCompatibility(null);
        const compatibilityError = getTerminalCompatibilityError(error);
        if (compatibilityError) {
          this.setCompatibilityIssue(compatibilityError);
          this.setState("incompatible");
        } else {
          this.setState("closed");
        }
      }
      throw error;
    });
    return { clientPromise };
  }
  protected async getClient(): Promise<RpcClientInstance> {
    if (this.reconnectPromise) return this.reconnectPromise;
    try {
      return await this.clientPromise;
    } catch (error) {
      if (this.disposed) throw new Error("Transport disposed", { cause: error });
      if (isTerminalCompatibilityFailure(error)) throw error;
      return this.reconnect();
    }
  }
  protected getClientRuntime(
    client: RpcClientInstance,
  ): ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never> {
    const runtime = this.runtimeByClient.get(client);
    if (!runtime) {
      throw new Error("Missing runtime for WebSocket RPC client");
    }
    return runtime;
  }
  protected takeCurrentRuntime(): {
    readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
    readonly clientScope: Scope.Closeable | null;
  } | null {
    const runtime = this.runtime;
    if (!runtime) return null;
    const clientScope = this.clientScope;
    this.runtime = null;
    this.clientScope = null;
    return { runtime, clientScope };
  }
  protected async closeRuntime(resources: {
    readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
    readonly clientScope: Scope.Closeable | null;
  }): Promise<void> {
    if (resources.clientScope) {
      await resources.runtime
        .runPromise(Scope.close(resources.clientScope, Exit.void))
        .catch(() => undefined);
    }
    await resources.runtime.dispose().catch(() => undefined);
  }
  protected reconnect(): Promise<RpcClientInstance> {
    if (this.reconnectPromise) return this.reconnectPromise;

    if (this.disposed) return Promise.reject(new Error("Transport disposed"));
    this.sessionVersion += 1;
    this.terminalOutputReady = false;
    const oldResources = this.takeCurrentRuntime();
    this.resetAllStreamCapacityRetries();
    this.resetAllStreamCompletionRetries();
    for (const cleanup of this.streamCleanups.values()) cleanup();
    this.streamCleanups.clear();
    this.activeThreadStreamInputs.clear();

    this.setState("connecting");

    this.reconnectPromise = (async () => {
      if (oldResources) await this.closeRuntime(oldResources);
      return this.openReconnectSession();
    })().finally(() => {
      this.reconnectPromise = null;
    });
    return this.reconnectPromise;
  }
  protected setState(state: WsTransportState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch {
        // Listener errors must not break reconnect or RPC state transitions.
      }
    }
  }
  protected clearStreamCapacityRetryTimer(key: string): void {
    const timeoutId = this.streamCapacityRetryTimers.get(key);
    if (timeoutId === undefined) return;
    window.clearTimeout(timeoutId);
    this.streamCapacityRetryTimers.delete(key);
  }
  protected resetStreamCapacityRetry(key: string): void {
    this.clearStreamCapacityRetryTimer(key);
    this.streamCapacityRetries.delete(key);
    this.streamDuplicateRetries.delete(key);
    this.streamThreadBootstrapRetries.delete(key);
    this.streamResnapshotRetries.delete(key);
    this.projectFileWatchRetries.delete(key);
  }
  protected resetAllStreamCapacityRetries(): void {
    for (const timeoutId of this.streamCapacityRetryTimers.values()) {
      window.clearTimeout(timeoutId);
    }
    this.streamCapacityRetryTimers.clear();
    this.streamCapacityRetries.clear();
    this.streamDuplicateRetries.clear();
    this.streamThreadBootstrapRetries.clear();
    this.streamResnapshotRetries.clear();
    this.projectFileWatchRetries.clear();
  }
  protected clearStreamCompletionRetryTimer(key: string): void {
    const timeoutId = this.streamCompletionRetryTimers.get(key);
    if (timeoutId === undefined) return;
    window.clearTimeout(timeoutId);
    this.streamCompletionRetryTimers.delete(key);
  }
  protected resetStreamCompletionRetry(key: string): void {
    this.clearStreamCompletionRetryTimer(key);
    this.streamCompletionRetries.delete(key);
  }
  protected resetAllStreamCompletionRetries(): void {
    for (const timeoutId of this.streamCompletionRetryTimers.values()) {
      window.clearTimeout(timeoutId);
    }
    this.streamCompletionRetryTimers.clear();
    this.streamCompletionRetries.clear();
  }
  protected scheduleUnexpectedStreamCompletionReconnect(
    key: string,
    streamSessionVersion: number,
    streamStartedAt: number,
    restart: () => void,
  ): void {
    if (this.sessionVersion !== streamSessionVersion) return;

    const streamLifetimeMs = performance.now() - streamStartedAt;
    const previousAttempt =
      streamLifetimeMs >= STABLE_STREAM_LIFETIME_MS
        ? 0
        : (this.streamCompletionRetries.get(key) ?? 0);
    const attempt = previousAttempt + 1;
    this.streamCompletionRetries.set(key, attempt);
    this.clearStreamCompletionRetryTimer(key);

    const timeoutId = window.setTimeout(() => {
      if (this.streamCompletionRetryTimers.get(key) !== timeoutId) return;
      this.streamCompletionRetryTimers.delete(key);
      if (
        this.disposed ||
        this.sessionVersion !== streamSessionVersion ||
        this.streamCleanups.has(key)
      ) {
        return;
      }

      void this.reconnect().catch((error) => {
        if (!this.disposed && !this.streamCleanups.has(key)) {
          console.warn("WebSocket RPC stream reconnect failed", error);

          restart();
        }
      });
    }, getUnexpectedStreamCompletionRetryDelayMs(attempt));
    this.streamCompletionRetryTimers.set(key, timeoutId);
  }
  protected setCompatibilityIssue(issue: WsCompatibilityError | null): void {
    if (this.compatibilityIssue === issue) return;
    this.compatibilityIssue = issue;
    for (const listener of this.compatibilityListeners) {
      try {
        listener(issue);
      } catch {
        // Compatibility UI listeners must not break transport teardown.
      }
    }
  }
  protected setCompatibility(compatibility: WsBootstrapNegotiateResult | null): void {
    if (this.compatibility === compatibility) return;
    this.compatibility = compatibility;
    for (const listener of this.compatibilityResultListeners) {
      try {
        listener(compatibility);
      } catch {
        // Capability listeners must not break transport connection lifecycle.
      }
    }
  }
  protected async openReconnectSession(): Promise<RpcClientInstance> {
    for (;;) {
      if (this.disposed) throw new Error("Transport disposed");
      this.setState("connecting");
      const delayMs = getReconnectRetryDelayMs(this.reconnectFailures);
      this.reconnectFailures += 1;
      await delayWithAbort(delayMs, this.lifetime.signal);

      const session = this.createSession();
      this.clientPromise = session.clientPromise;
      try {
        const client = await session.clientPromise;
        for (const channel of this.listeners.keys()) {
          this.startChannelStream(channel as WsPushChannel);
        }
        if (this.shellSubscribed) {
          await this.startShellStream(client);
        }

        for (const threadId of this.threadSubscriptions.keys()) {
          const input = this.refreshThreadSubscriptionInput(threadId);
          if (input === undefined) continue;
          await this.startThreadStream(client, threadId, input);
        }
        for (const [key, subscription] of this.projectFileSubscriptions) {
          this.startProjectFileChangeStream(client, key, subscription);
        }
        this.gitStatusSubscriptions?.restart(client);
        this.reconnectFailures = 0;
        return client;
      } catch (error) {
        const failedResources = this.takeCurrentRuntime();
        if (failedResources) await this.closeRuntime(failedResources);
        if (this.disposed) throw new Error("Transport disposed", { cause: error });
        if (isTerminalCompatibilityFailure(error)) throw error;
      }
    }
  }
  protected emit<C extends WsPushChannel>(channel: C, data: WsPushMessage<C>["data"]): void {
    const message = {
      type: "push" as const,
      sequence: ++this.sequence,
      channel,
      data,
    } as WsPush;
    this.latestPushByChannel.set(channel, message);
    const listeners = this.listeners.get(channel);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(message);
      } catch {
        // Listener errors must not break transport streams.
      }
    }
  }
}
