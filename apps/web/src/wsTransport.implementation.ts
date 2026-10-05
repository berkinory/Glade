import type { GladeAppOpenRequest } from "@glade/contracts/provider/agentGatewayTools";
import type { GitStatusWatchInput, GitStatusStreamEvent } from "@glade/contracts/git/git";
import {
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
} from "@glade/contracts/orchestration/rpc";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type {
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "@glade/contracts/orchestration/snapshots";
import { WS_PROJECT_FILE_WATCH_CAPABILITY } from "@glade/contracts/transport/ws/wsCompatibility";
import { WS_CHANNELS, WS_METHODS, type WsPushChannel } from "@glade/contracts/transport/ws/ws";
import {
  COMPUTER_WS_CHANNELS,
  COMPUTER_WS_METHODS,
  type ComputerEvent,
} from "@glade/contracts/computer/computer";
import type {
  GitActionProgressEvent,
  GitCreateDetachedWorktreeResult,
  GitRunStackedActionResult,
  GitWorktreeSetupProgressEvent,
} from "@glade/contracts/git/git";
import type {
  GitHubProjectProvisionProgressEvent,
  GitHubProjectProvisionResult,
} from "@glade/contracts/git/githubProjectProvisioning";
import type { ProjectFileChangeEvent } from "@glade/contracts/workspace/project";
import type {
  ServerConfigStreamEvent,
  ServerLifecycleStreamEvent,
  ServerProviderStatusesUpdatedPayload,
  ServerSettingsUpdatedPayload,
} from "@glade/contracts/server/server";
import type { TerminalStreamItem } from "@glade/contracts/transport/ws/terminalRpc";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Cause, Effect, Exit, Stream } from "effect";
import {
  buildThreadSubscribeInput,
  clearThreadDetailResumeCursor,
} from "./threadDetailResumeCursors";
import {
  MAX_STREAM_CAPACITY_RETRY_MS,
  SNAPSHOT_FAULT_RETRY_MS,
  STABLE_STREAM_LIFETIME_MS,
  WsTransportRpcError,
  causeToError,
  getProjectFileWatchRetryDelayMs,
  getSnapshotFaultRetryDelayMs,
  getStreamFailureCode,
  isServerLifecyclePushChannel,
  isTerminalCompatibilityFailure,
  resolveStreamAdmissionRetry,
  shouldKeepServerLifecycleStream,
  shouldReconnectAfterStreamFailure,
  threadIdFromStreamKey,
  threadStreamInputsEqual,
} from "./wsTransport.support";
import type { ProjectFileChangeSubscription, RpcClientInstance } from "./wsTransport.support";
import { WsTransportBase } from "./wsTransport.base";
export class WsTransport extends WsTransportBase {
  protected startChannelStream(channel: WsPushChannel): void {
    const requestedSessionVersion = this.sessionVersion;
    void this.getClient()
      .then((client) => {
        if (
          this.disposed ||
          this.sessionVersion !== requestedSessionVersion ||
          !this.listeners.has(channel)
        ) {
          return;
        }
        const restartChannel = () => {
          if (this.listeners.has(channel)) {
            this.startChannelStream(channel);
          }
        };

        if (channel === WS_CHANNELS.appPresentation) {
          this.startStream(
            client,
            "app.presentation",
            client[WS_METHODS.subscribeAppPresentation]({}),
            (event: GladeAppOpenRequest) => this.emit(WS_CHANNELS.appPresentation, event),
            restartChannel,
          );
        } else if (isServerLifecyclePushChannel(channel)) {
          this.startLifecycleStream(client);
        } else if (channel === WS_CHANNELS.serverConfigUpdated) {
          this.startStream(
            client,
            "server.config",
            client[WS_METHODS.subscribeServerConfig]({}),
            (event: ServerConfigStreamEvent) => {
              if (event.type === "snapshot") {
                this.emit(WS_CHANNELS.serverConfigUpdated, {
                  issues: event.config.issues,
                  providers: event.config.providers,
                });
              } else if (event.type === "configUpdated") {
                this.emit(WS_CHANNELS.serverConfigUpdated, event.payload);
              }
            },
            restartChannel,
          );
        } else if (channel === WS_CHANNELS.serverProviderStatusesUpdated) {
          this.startStream(
            client,
            "server.providers",
            client[WS_METHODS.subscribeServerProviderStatuses]({}),
            (payload: ServerProviderStatusesUpdatedPayload) =>
              this.emit(WS_CHANNELS.serverProviderStatusesUpdated, payload),
            restartChannel,
          );
        } else if (channel === WS_CHANNELS.serverSettingsUpdated) {
          this.startStream(
            client,
            "server.settings",
            client[WS_METHODS.subscribeServerSettings]({}),
            (payload: ServerSettingsUpdatedPayload) =>
              this.emit(WS_CHANNELS.serverSettingsUpdated, payload),
            restartChannel,
          );
        } else if (channel === WS_CHANNELS.terminalEvent) {
          this.startStream(
            client,
            "terminal.events",
            client[WS_METHODS.subscribeTerminalEvents]({}),
            (event: TerminalStreamItem) => {
              if (event.type === "ready") this.markTerminalOutputReady();
              else this.emit(WS_CHANNELS.terminalEvent, event);
            },
            restartChannel,
          );
        } else if (channel === COMPUTER_WS_CHANNELS.event) {
          this.startStream(
            client,
            "computer.events",
            client[COMPUTER_WS_METHODS.subscribeEvents]({}),
            (event: ComputerEvent) => this.emit(COMPUTER_WS_CHANNELS.event, event),
            restartChannel,
          );
        } else if (channel === ORCHESTRATION_WS_CHANNELS.domainEvent) {
          this.startStream(
            client,
            "orchestration.domain",
            client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
            (event: OrchestrationEvent) => this.emit(ORCHESTRATION_WS_CHANNELS.domainEvent, event),
            restartChannel,
          );
        }
      })
      .catch((error) => {
        if (
          !this.disposed &&
          this.sessionVersion === requestedSessionVersion &&
          this.listeners.has(channel) &&
          !isTerminalCompatibilityFailure(error)
        ) {
          console.warn("WebSocket RPC channel failed to start", error);
          window.setTimeout(() => this.startChannelStream(channel), 500);
        }
      });
  }
  protected stopChannelStream(channel: WsPushChannel): void {
    if (isServerLifecyclePushChannel(channel)) {
      if (!this.shouldKeepLifecycleStream()) void this.stopStream("server.lifecycle");
    } else if (channel === WS_CHANNELS.serverConfigUpdated) void this.stopStream("server.config");
    else if (channel === WS_CHANNELS.serverProviderStatusesUpdated)
      void this.stopStream("server.providers");
    else if (channel === WS_CHANNELS.serverSettingsUpdated) void this.stopStream("server.settings");
    else if (channel === WS_CHANNELS.terminalEvent) void this.stopStream("terminal.events");
    else if (channel === COMPUTER_WS_CHANNELS.event) void this.stopStream("computer.events");
    else if (channel === ORCHESTRATION_WS_CHANNELS.domainEvent)
      void this.stopStream("orchestration.domain");
  }
  protected shouldKeepLifecycleStream(): boolean {
    return shouldKeepServerLifecycleStream(new Set(this.listeners.keys()));
  }
  protected startLifecycleStream(client: RpcClientInstance): void {
    if (this.disposed || !this.shouldKeepLifecycleStream()) return;
    const restartLifecycle = () => {
      if (!this.shouldKeepLifecycleStream()) return;
      void this.getClient()
        .then((nextClient) => this.startLifecycleStream(nextClient))
        .catch((error) => console.warn("WebSocket RPC lifecycle stream failed to restart", error));
    };
    this.startStream(
      client,
      "server.lifecycle",
      client[WS_METHODS.subscribeServerLifecycle]({}),
      (event: ServerLifecycleStreamEvent) => {
        if (event.type === "welcome") {
          this.emit(WS_CHANNELS.serverWelcome, event.payload);
        } else if (event.type === "maintenance") {
          this.emit(WS_CHANNELS.serverMaintenanceUpdated, event);
        }
      },
      restartLifecycle,
    );
  }
  protected async startShellStream(client: RpcClientInstance, forceRestart = false): Promise<void> {
    if (this.disposed || !this.shellSubscribed) return;
    if (forceRestart) {
      const sessionVersion = this.sessionVersion;
      await this.stopStream("orchestration.shell", { resetCapacityRetry: false });
      if (this.disposed || this.sessionVersion !== sessionVersion || !this.shellSubscribed) {
        return;
      }
    }
    const restartShell = () => {
      if (!this.shellSubscribed) return;
      void this.getClient()
        .then((nextClient) => this.startShellStream(nextClient))
        .catch((error) => console.warn("WebSocket RPC shell stream failed to restart", error));
    };
    if (!this.streamCleanups.has("orchestration.shell")) {
      this.shellSnapshotDelivered = false;
    }
    this.startStream(
      client,
      "orchestration.shell",
      client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
      (event: OrchestrationShellStreamItem) => {
        if (event.kind === "snapshot") {
          this.shellSnapshotDelivered = true;
        }
        this.emit(ORCHESTRATION_WS_CHANNELS.shellEvent, event);
      },
      restartShell,
    );
  }
  protected refreshThreadSubscriptionInput(threadId: string): unknown {
    if (!this.threadSubscriptions.has(threadId)) return undefined;
    const existingInput = this.threadSubscriptions.get(threadId);
    const rebuiltInput: unknown = buildThreadSubscribeInput(ThreadId.makeUnsafe(threadId));
    const input = threadStreamInputsEqual(existingInput, rebuiltInput)
      ? existingInput
      : rebuiltInput;
    this.threadSubscriptions.set(threadId, input);
    return input;
  }
  protected async startThreadStream(
    client: RpcClientInstance,
    threadId: string,
    input: unknown,
    forceRestart = false,
  ): Promise<void> {
    const key = `orchestration.thread:${threadId}`;
    if (this.disposed || this.threadSubscriptions.get(threadId) !== input) {
      return;
    }
    if (
      !forceRestart &&
      this.streamCleanups.has(key) &&
      this.activeThreadStreamInputs.get(key) === input
    ) {
      return;
    }
    const sessionVersion = this.sessionVersion;
    await this.stopStream(key, { resetCapacityRetry: false });
    if (
      this.disposed ||
      this.sessionVersion !== sessionVersion ||
      this.threadSubscriptions.get(threadId) !== input
    ) {
      return;
    }
    const restartThread = () => {
      const desiredInput = this.refreshThreadSubscriptionInput(threadId);
      if (desiredInput === undefined) return;
      void this.getClient()
        .then((nextClient) => this.startThreadStream(nextClient, threadId, desiredInput))
        .catch((error) => console.warn("WebSocket RPC thread stream failed to restart", error));
    };
    this.activeThreadStreamInputs.set(key, input);
    this.startStream(
      client,
      key,
      client[ORCHESTRATION_WS_METHODS.subscribeThread](input as never),
      (event: OrchestrationThreadStreamItem) =>
        this.emit(ORCHESTRATION_WS_CHANNELS.threadEvent, event),
      restartThread,
    );
  }
  protected startProjectFileChangeStream(
    client: RpcClientInstance,
    key: string,
    subscription: ProjectFileChangeSubscription,
  ): void {
    if (
      this.disposed ||
      this.projectFileSubscriptions.get(key) !== subscription ||
      !this.compatibility?.capabilities.includes(WS_PROJECT_FILE_WATCH_CAPABILITY)
    ) {
      return;
    }
    const restart = () => {
      if (this.projectFileSubscriptions.get(key) !== subscription) return;
      void this.getClient()
        .then((nextClient) => this.startProjectFileChangeStream(nextClient, key, subscription))
        .catch(() => undefined);
    };
    this.startStream<ProjectFileChangeEvent>(
      client,
      key,
      client[WS_METHODS.projectsSubscribeFileChange](subscription.input),
      (event) => {
        for (const subscribedListener of subscription.listeners) {
          try {
            subscribedListener(event);
          } catch {
            // One panel listener must not prevent another from revalidating.
          }
        }
      },
      restart,
    );
  }
  protected startGitStatusStream(
    client: RpcClientInstance,
    key: string,
    input: GitStatusWatchInput,
    emit: (event: GitStatusStreamEvent) => void,
    restart: () => void,
  ): void {
    if (this.disposed) return;
    this.startStream(client, key, client[WS_METHODS.gitSubscribeStatus](input), emit, restart);
  }
  protected startStream<T>(
    client: RpcClientInstance,
    key: string,
    stream: unknown,
    listener: (event: T) => void,
    restart?: (() => void) | undefined,
  ): void {
    if (this.streamCleanups.has(key)) return;
    this.clearStreamCapacityRetryTimer(key);
    this.clearStreamCompletionRetryTimer(key);
    const streamSessionVersion = this.sessionVersion;
    const streamStartedAt = performance.now();
    const runnableStream = stream as Stream.Stream<T, WsTransportRpcError, never>;
    let resolveSettled: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const cancel = this.getClientRuntime(client).runCallback(
      Stream.runForEach(runnableStream, (event) =>
        Effect.sync(() => {
          if (this.disposed || this.sessionVersion !== streamSessionVersion) return;
          if (this.streamCapacityRetries.has(key)) {
            this.streamCapacityRetries.delete(key);
          }
          if (this.streamDuplicateRetries.has(key)) {
            this.streamDuplicateRetries.delete(key);
          }
          if (this.streamThreadBootstrapRetries.has(key)) {
            this.streamThreadBootstrapRetries.delete(key);
          }
          if (this.streamResnapshotRetries.has(key)) {
            this.streamResnapshotRetries.delete(key);
          }
          listener(event);
        }),
      ),
      {
        onExit: (exit) => {
          if (this.streamSettled.get(key) === settled) {
            this.streamSettled.delete(key);
          }
          resolveSettled();
          const wasReplacedOrStopped = this.streamCleanups.get(key) !== cancel;
          if (!wasReplacedOrStopped) {
            this.streamCleanups.delete(key);
            this.activeThreadStreamInputs.delete(key);
          }
          if (!wasReplacedOrStopped && key === "terminal.events") this.terminalOutputReady = false;
          if (
            wasReplacedOrStopped ||
            this.disposed ||
            this.sessionVersion !== streamSessionVersion
          ) {
            return;
          }
          if (Exit.isSuccess(exit) && restart) {
            this.scheduleUnexpectedStreamCompletionReconnect(
              key,
              streamSessionVersion,
              streamStartedAt,
              restart,
            );
            return;
          }
          if (Exit.isFailure(exit)) {
            this.streamCompletionRetries.delete(key);
          }
          if (restart && Exit.isFailure(exit)) {
            const admissionRetry = resolveStreamAdmissionRetry(
              exit.cause,
              this.streamCapacityRetries.get(key) ?? 0,
              this.streamDuplicateRetries.get(key) ?? 0,
              this.streamThreadBootstrapRetries.get(key) ?? 0,
              this.streamResnapshotRetries.get(key) ?? 0,
            );
            if (admissionRetry !== null) {
              const retries =
                admissionRetry.kind === "capacity"
                  ? this.streamCapacityRetries
                  : admissionRetry.kind === "duplicate"
                    ? this.streamDuplicateRetries
                    : admissionRetry.kind === "thread-bootstrap"
                      ? this.streamThreadBootstrapRetries
                      : this.streamResnapshotRetries;
              retries.set(key, admissionRetry.attempt);
              if (admissionRetry.kind === "resnapshot") {
                // The server refused the stream because its snapshot trails the journal beyond the replay limit. A
                // resume cursor makes the retry ask for the same gap replay again; dropping it makes the restart
                // request a full fresh snapshot instead. The store discards its cached detail when the new snapshot
                // arrives, so the cursor's coherence invariant is preserved.
                const threadId = threadIdFromStreamKey(key);
                if (threadId !== null) {
                  clearThreadDetailResumeCursor(ThreadId.makeUnsafe(threadId));
                }
              }
              this.clearStreamCapacityRetryTimer(key);
              const timeoutId = window.setTimeout(
                () => {
                  if (this.streamCapacityRetryTimers.get(key) !== timeoutId) return;
                  this.streamCapacityRetryTimers.delete(key);
                  if (
                    !this.disposed &&
                    this.sessionVersion === streamSessionVersion &&
                    !this.streamCleanups.has(key)
                  ) {
                    restart();
                  }
                },
                Math.min(
                  admissionRetry.delayMs * admissionRetry.attempt,
                  MAX_STREAM_CAPACITY_RETRY_MS,
                ),
              );
              this.streamCapacityRetryTimers.set(key, timeoutId);
              return;
            }

            const previousFileWatchAttempts =
              performance.now() - streamStartedAt >= STABLE_STREAM_LIFETIME_MS
                ? 0
                : (this.projectFileWatchRetries.get(key) ?? 0);
            const fileWatchRetryDelayMs = getProjectFileWatchRetryDelayMs(
              exit.cause,
              previousFileWatchAttempts,
            );
            if (fileWatchRetryDelayMs !== null) {
              this.projectFileWatchRetries.set(key, previousFileWatchAttempts + 1);
              this.clearStreamCapacityRetryTimer(key);
              const timeoutId = window.setTimeout(() => {
                if (this.streamCapacityRetryTimers.get(key) !== timeoutId) return;
                this.streamCapacityRetryTimers.delete(key);
                if (
                  !this.disposed &&
                  this.sessionVersion === streamSessionVersion &&
                  !this.streamCleanups.has(key)
                ) {
                  restart();
                }
              }, fileWatchRetryDelayMs);
              this.streamCapacityRetryTimers.set(key, timeoutId);
              return;
            }
          }
          if (restart && Exit.isFailure(exit) && shouldReconnectAfterStreamFailure(exit.cause)) {
            window.setTimeout(
              () => {
                if (
                  !this.disposed &&
                  this.sessionVersion === streamSessionVersion &&
                  !this.streamCleanups.has(key)
                ) {
                  void this.reconnect()
                    .then(() => restart())
                    .catch((error) => {
                      if (!this.disposed) {
                        console.warn("WebSocket RPC stream reconnect failed", error);
                      }
                    });
                }
              },
              Cause.hasInterruptsOnly(exit.cause) ? 0 : 500,
            );
            return;
          }
          if (Exit.isFailure(exit) && !this.disposed && !Cause.hasInterruptsOnly(exit.cause)) {
            const error = causeToError(exit.cause);
            console.warn("WebSocket RPC stream failed", error);
            const threadId = threadIdFromStreamKey(key);
            if (threadId !== null && this.threadSubscriptions.has(threadId)) {
              this.emitThreadStreamFailure({
                threadId,
                code: getStreamFailureCode(exit.cause),
                error,
              });
            }

            if (restart && getSnapshotFaultRetryDelayMs(exit.cause) !== null) {
              this.clearStreamCapacityRetryTimer(key);
              const timeoutId = window.setTimeout(() => {
                if (this.streamCapacityRetryTimers.get(key) !== timeoutId) return;
                this.streamCapacityRetryTimers.delete(key);
                if (
                  !this.disposed &&
                  this.sessionVersion === streamSessionVersion &&
                  !this.streamCleanups.has(key)
                ) {
                  restart();
                }
              }, SNAPSHOT_FAULT_RETRY_MS);
              this.streamCapacityRetryTimers.set(key, timeoutId);
            }
          }
        },
      },
    );
    this.streamCleanups.set(key, cancel);
    this.streamSettled.set(key, settled);
  }
  protected stopStream(
    key: string,
    options?: { readonly resetCapacityRetry?: boolean },
  ): Promise<void> {
    if (key === "terminal.events") this.terminalOutputReady = false;
    this.clearStreamCapacityRetryTimer(key);
    this.clearStreamCompletionRetryTimer(key);
    if (options?.resetCapacityRetry !== false) {
      this.streamCapacityRetries.delete(key);
      this.streamDuplicateRetries.delete(key);
      this.streamThreadBootstrapRetries.delete(key);
      this.streamResnapshotRetries.delete(key);
      this.projectFileWatchRetries.delete(key);
    }
    this.streamCompletionRetries.delete(key);
    this.activeThreadStreamInputs.delete(key);
    const cleanup = this.streamCleanups.get(key);
    const settled = this.streamSettled.get(key) ?? Promise.resolve();
    if (!cleanup) return settled;
    this.streamCleanups.delete(key);
    cleanup();
    return settled;
  }
  protected async runGitActionStream(
    client: RpcClientInstance,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<GitRunStackedActionResult> {
    let result: GitRunStackedActionResult | null = null;
    await this.getClientRuntime(client).runPromise(
      Stream.runForEach(client[WS_METHODS.gitRunStackedAction](params as never), (event) =>
        Effect.sync(() => {
          this.emit(WS_CHANNELS.gitActionProgress, event as GitActionProgressEvent);
          if ((event as GitActionProgressEvent).kind === "action_finished") {
            result = (event as Extract<GitActionProgressEvent, { kind: "action_finished" }>).result;
          }
        }),
      ),
      signal ? { signal } : undefined,
    );
    if (!result) throw new Error("Git action stream completed without a final result.");
    return result;
  }
  protected async runWorktreeSetupStream(
    client: RpcClientInstance,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<GitCreateDetachedWorktreeResult> {
    let result: GitCreateDetachedWorktreeResult | null = null;
    await this.getClientRuntime(client).runPromise(
      Stream.runForEach(client[WS_METHODS.gitCreateDetachedWorktree](params as never), (event) =>
        Effect.sync(() => {
          const progressEvent = event as GitWorktreeSetupProgressEvent;
          this.emit(WS_CHANNELS.gitWorktreeSetupProgress, progressEvent);
          if (progressEvent.kind === "completed") {
            result = progressEvent.result;
          }
        }),
      ),
      signal ? { signal } : undefined,
    );
    if (!result) throw new Error("Worktree creation completed without a final result.");
    return result;
  }
  protected async runProjectProvisionStream(
    client: RpcClientInstance,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<GitHubProjectProvisionResult> {
    let result: GitHubProjectProvisionResult | null = null;
    await this.getClientRuntime(client).runPromise(
      Stream.runForEach(client[WS_METHODS.projectsProvisionFromGitHub](params as never), (event) =>
        Effect.sync(() => {
          const progressEvent = event as GitHubProjectProvisionProgressEvent;
          this.emit(WS_CHANNELS.projectProvisionProgress, progressEvent);
          if (progressEvent.kind === "completed") {
            result = progressEvent.result;
          }
        }),
      ),
      signal ? { signal } : undefined,
    );
    if (!result) throw new Error("Project provisioning completed without a final result.");
    return result;
  }
}
