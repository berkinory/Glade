import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { ContentBlock, McpServer } from "@agentclientprotocol/sdk";
import { EventId, ThreadId, TurnId, type ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import type { ModelSelection, RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { Effect, Queue, Stream } from "effect";

import { renderGladeHarnessPolicy } from "../../agentGateway/harnessPolicy.ts";
import { GLADE_MCP_SERVER_NAME } from "../../agentGateway/mcpInjection.ts";
import {
  acquireAgentGatewaySessionLease,
  type AgentGatewaySessionLease,
} from "../../agentGateway/sessionLease.ts";
import type { AgentGatewayCredentialsShape } from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import type { teardownChildProcessTree } from "../../platform/supervisedProcessTeardown.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../core/Errors.ts";
import {
  PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
  type ProviderAdapterShape,
  type ProviderStructuredRequestInput,
} from "../Services/ProviderAdapter.ts";
import { openAcpConnection, type AcpConnection } from "./acpConnection.ts";
import { makeAcpConnectionPool } from "./acpConnectionPool.ts";
import { withEphemeralAcpSession } from "./acpEphemeralSession.ts";
import { acpConfigIdFor, acpModelOption, acpOffersValue } from "./acpModelCatalog.ts";
import { discoverAcpModels } from "./acpModelDiscovery.ts";
import type { AcpProviderProfile } from "./acpProviderProfile.ts";
import { openAcpSession, type AcpSession } from "./acpSession.ts";
import { runAcpStructuredRequest } from "./acpStructuredRequest.ts";
import type { AcpRuntimeEventDraft } from "./acpTurnProjection.ts";

const RESUME_CURSOR_VERSION = 1;

interface AcpResumeCursor {
  readonly schemaVersion: typeof RESUME_CURSOR_VERSION;
  readonly sessionId: string;
}

function readResumeCursor(value: unknown): AcpResumeCursor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === RESUME_CURSOR_VERSION &&
    typeof record.sessionId === "string" &&
    record.sessionId.length > 0
    ? { schemaVersion: RESUME_CURSOR_VERSION, sessionId: record.sessionId }
    : undefined;
}

interface AcpThread {
  readonly connection: AcpConnection;
  readonly releaseConnection: () => Promise<void>;
  unwatchExit: () => void;
  readonly session: AcpSession;
  readonly gatewayLease: AgentGatewaySessionLease | undefined;
  readonly lifecycleGeneration: string | undefined;
  record: ProviderSession;
  // The harness policy rides on the first prompt of a fresh native session; a loaded session
  // already carries it in its history.
  policyPending: boolean;
  stopping: boolean;
}

export interface AcpAdapterDependencies {
  readonly profile: AcpProviderProfile;
  readonly spawn: (input: {
    readonly cwd: string;
    readonly runtimeMode: RuntimeMode;
    readonly binaryPath: string | undefined;
  }) => ChildProcessWithoutNullStreams;
  readonly defaultCwd: string;
  readonly gatewayCredentials: AgentGatewayCredentialsShape | undefined;
  readonly teardownProcessTree?: Parameters<typeof teardownChildProcessTree>[1];
}

// Model selection maps onto the agent's own session config options: the model option by category,
// then each selected value by its config id. Settings belong to a model, so a value the agent does
// not offer for the selected model (one carried over from another model) is not applied.
async function applySelection(session: AcpSession, selection: ModelSelection | undefined) {
  if (!selection) return;
  const model = acpModelOption(session.configOptions());
  if (model) await session.setConfigOption(model.id, selection.model);
  for (const [optionId, value] of Object.entries(selection.options ?? {})) {
    const options = session.configOptions();
    const configId = acpConfigIdFor(options, optionId);
    if (typeof value === "string" && configId && acpOffersValue(options, configId, value)) {
      await session.setConfigOption(configId, value);
    }
  }
}

export const makeAcpAdapter = (dependencies: AcpAdapterDependencies) =>
  Effect.gen(function* () {
    const { profile } = dependencies;
    const provider: ProviderKind = profile.provider;
    const services = yield* Effect.services<never>();
    const runFork = Effect.runForkWith(services);
    const events = yield* Queue.bounded<ProviderRuntimeEvent>(
      PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
    );
    const threads = new Map<ThreadId, AcpThread>();
    const connections = makeAcpConnectionPool();
    const teardown = dependencies.teardownProcessTree
      ? { teardownProcessTree: dependencies.teardownProcessTree }
      : {};

    const emit = (
      threadId: ThreadId,
      lifecycleGeneration: string | undefined,
      draft: AcpRuntimeEventDraft,
      turnId?: string,
    ) => {
      const event = {
        ...draft,
        eventId: EventId.makeUnsafe(randomUUID()),
        provider,
        threadId,
        createdAt: new Date().toISOString(),
        ...(turnId ? { turnId: TurnId.makeUnsafe(turnId) } : {}),
        ...(lifecycleGeneration ? { lifecycleGeneration } : {}),
      } as ProviderRuntimeEvent;
      // Agent output arrives on stdio callbacks; the queue applies backpressure to the pump.
      runFork(Queue.offer(events, event));
    };

    const requestError = (method: string, cause: unknown) =>
      new ProviderAdapterRequestError({
        provider,
        method,
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      });

    const requireThread = (threadId: ThreadId) =>
      Effect.suspend(() => {
        const thread = threads.get(threadId);
        return thread
          ? Effect.succeed(thread)
          : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider, threadId }));
      });

    // Without a reason the chat never announced a session, so it ends silently.
    const retire = (threadId: ThreadId, thread: AcpThread, reason: string | undefined) =>
      Effect.promise(async () => {
        if (threads.get(threadId) === thread) threads.delete(threadId);
        thread.unwatchExit();
        thread.session.detach();
        thread.gatewayLease?.release();
        // The process may host other chats, so only this session ends unless it was the last.
        if (thread.connection.initialize.agentCapabilities?.sessionCapabilities?.close) {
          await thread.connection.agent
            .closeSession({ sessionId: thread.session.sessionId })
            .catch(() => undefined);
        }
        await thread.releaseConnection().catch(() => undefined);
        if (reason === undefined) return;
        emit(threadId, thread.lifecycleGeneration, {
          type: "session.exited",
          payload: { reason, exitKind: "graceful" },
        });
      });

    const mcpServers = (
      connection: AcpConnection,
      lease: AgentGatewaySessionLease | undefined,
    ): McpServer[] =>
      lease && connection.initialize.agentCapabilities?.mcpCapabilities?.http
        ? [
            {
              type: "http",
              name: GLADE_MCP_SERVER_NAME,
              url: lease.connection.url,
              headers: [{ name: "Authorization", value: `Bearer ${lease.connection.bearerToken}` }],
            },
          ]
        : [];

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
      Effect.gen(function* () {
        const existing = threads.get(input.threadId);
        if (existing) yield* retire(input.threadId, existing, "Session replaced");
        const cwd = input.cwd ?? dependencies.defaultCwd;
        const binaryPath = input.providerOptions?.[provider]?.binaryPath;
        // Sessions carry their own working directory, so the process key is what the spawn
        // environment depends on: the executable and the runtime mode's environment.
        const poolKey = JSON.stringify([
          binaryPath ?? null,
          profile.env?.({ runtimeMode: input.runtimeMode }) ?? {},
        ]);
        const { connection, release: releaseConnection } = yield* Effect.tryPromise({
          try: () =>
            connections.lease(poolKey, () =>
              openAcpConnection({
                child: dependencies.spawn({ cwd, runtimeMode: input.runtimeMode, binaryPath }),
                profile,
                ...teardown,
              }),
            ),
          catch: (cause) => requestError("initialize", cause),
        });
        const gatewayLease = acquireAgentGatewaySessionLease(
          dependencies.gatewayCredentials,
          input.threadId,
          provider,
          {},
        );
        const servers = mcpServers(connection, gatewayLease);
        const resume = readResumeCursor(input.resumeCursor);
        const opened = yield* Effect.tryPromise({
          try: async () => {
            if (resume && connection.initialize.agentCapabilities?.loadSession) {
              // Updates replayed during the load go nowhere: the session is attached afterwards.
              const loaded = await connection.agent.loadSession({
                sessionId: resume.sessionId,
                cwd,
                mcpServers: servers,
              });
              return {
                sessionId: resume.sessionId,
                configOptions: loaded.configOptions,
                resumed: true,
              };
            }
            const created = await connection.agent.newSession({ cwd, mcpServers: servers });
            return {
              sessionId: created.sessionId,
              configOptions: created.configOptions,
              resumed: false,
            };
          },
          catch: (cause) => requestError(resume ? "session/load" : "session/new", cause),
        }).pipe(
          Effect.tapError(() =>
            Effect.promise(async () => {
              gatewayLease?.release();
              await releaseConnection().catch(() => undefined);
            }),
          ),
        );
        const lifecycleGeneration = input.lifecycleGeneration;
        const session = openAcpSession({
          connection,
          sessionId: opened.sessionId,
          configOptions: opened.configOptions ?? [],
          runtimeMode: input.runtimeMode,
          sink: {
            emit: (draft, turnId) => emit(input.threadId, lifecycleGeneration, draft, turnId),
          },
        });
        const now = new Date().toISOString();
        const thread: AcpThread = {
          connection,
          releaseConnection,
          unwatchExit: () => undefined,
          session,
          gatewayLease,
          lifecycleGeneration,
          policyPending: !opened.resumed,
          stopping: false,
          record: {
            provider,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            ...(input.modelSelection ? { model: input.modelSelection.model } : {}),
            threadId: input.threadId,
            resumeCursor: { schemaVersion: RESUME_CURSOR_VERSION, sessionId: opened.sessionId },
            createdAt: now,
            updatedAt: now,
          },
        };
        threads.set(input.threadId, thread);
        thread.unwatchExit = connection.onExit((error) => {
          if (thread.stopping || threads.get(input.threadId) !== thread) return;
          threads.delete(input.threadId);
          session.detach();
          gatewayLease?.release();
          void releaseConnection();
          emit(input.threadId, lifecycleGeneration, {
            type: "session.exited",
            payload: { reason: error.message, exitKind: "error" },
          });
        });
        yield* Effect.tryPromise({
          try: async () => {
            const profileConfig = (
              profile.sessionConfig?.({ runtimeMode: input.runtimeMode }) ?? []
            ).filter(({ configId }) =>
              session.configOptions().some((option) => option.id === configId),
            );
            for (const { configId, value } of profileConfig) {
              await session.setConfigOption(configId, value);
            }
            await applySelection(session, input.modelSelection);
          },
          catch: (cause) => requestError("session/set_config_option", cause),
        }).pipe(Effect.tapError(() => retire(input.threadId, thread, undefined)));
        emit(input.threadId, lifecycleGeneration, {
          type: "session.started",
          payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
        });
        emit(input.threadId, lifecycleGeneration, {
          type: "thread.started",
          payload: { providerThreadId: opened.sessionId },
        });
        emit(input.threadId, lifecycleGeneration, {
          type: "session.state.changed",
          payload: { state: "ready" },
        });
        return thread.record;
      });

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const thread = yield* requireThread(input.threadId);
        if (thread.session.activeTurnId()) {
          return yield* new ProviderAdapterRequestError({
            provider,
            method: "session/prompt",
            detail: "A turn is already running in this session.",
          });
        }
        yield* Effect.tryPromise({
          try: () => applySelection(thread.session, input.modelSelection),
          catch: (cause) => requestError("session/set_config_option", cause),
        });
        const turnId = `acp-turn-${randomUUID()}`;
        const blocks: ContentBlock[] = [];
        if (thread.policyPending) {
          thread.policyPending = false;
          blocks.push({
            type: "text",
            text: renderGladeHarnessPolicy({
              gatewayControlAvailable: thread.gatewayLease !== undefined,
              computerUseAllowed: false,
            }),
          });
        }
        if (input.input) blocks.push({ type: "text", text: input.input });
        const model = input.modelSelection?.model ?? thread.record.model;
        thread.record = {
          ...thread.record,
          status: "running",
          activeTurnId: TurnId.makeUnsafe(turnId),
          ...(model ? { model } : {}),
          updatedAt: new Date().toISOString(),
        };
        emit(
          input.threadId,
          thread.lifecycleGeneration,
          { type: "turn.started", payload: model ? { model } : {} },
          turnId,
        );
        runFork(
          Effect.promise(() => thread.session.prompt(turnId, blocks)).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                const { activeTurnId: _ended, ...idle } = thread.record;
                thread.record = { ...idle, status: "ready", updatedAt: new Date().toISOString() };
              }),
            ),
          ),
        );
        return {
          threadId: input.threadId,
          turnId: TurnId.makeUnsafe(turnId),
          resumeCursor: thread.record.resumeCursor,
        };
      });

    const structuredRequest = (input: ProviderStructuredRequestInput) =>
      Effect.tryPromise({
        try: (signal) =>
          withEphemeralAcpSession({
            profile,
            // Supervised, so the agent asks before any tool and the request rejects it.
            child: dependencies.spawn({
              cwd: input.cwd,
              runtimeMode: "approval-required",
              binaryPath: input.binaryPath,
            }),
            cwd: input.cwd,
            signal,
            ...teardown,
            use: (connection, session) =>
              runAcpStructuredRequest(
                connection,
                session,
                input,
                !profile.savesModelChoiceGlobally,
              ),
          }),
        catch: (cause) => requestError("session/prompt", cause),
      });

    const adapter: ProviderAdapterShape<ProviderAdapterError> = {
      provider,
      capabilities: {
        supportsTurnSteering: false,
        supportsLiveTurnDiffPatch: false,
        supportsNativeSlashCommandDiscovery: true,
        supportsRuntimeModelList: true,
      },
      getComposerCapabilities: () =>
        Effect.succeed({
          provider,
          supportsSkillMentions: false,
          supportsSkillDiscovery: false,
          supportsNativeSlashCommandDiscovery: true,
          supportsPluginMentions: false,
          supportsPluginDiscovery: false,
          supportsRuntimeModelList: true,
          supportsThreadCompaction: false,
        }),
      // Agents announce their commands once a session opens, so only a chat with a live session
      // lists them.
      listCommands: (input) =>
        Effect.sync(() => {
          const thread = input.threadId
            ? threads.get(ThreadId.makeUnsafe(input.threadId))
            : undefined;
          return {
            commands: (thread?.session.availableCommands() ?? []).flatMap((command) =>
              profile.hiddenCommands.has(command.name)
                ? []
                : [
                    {
                      name: command.name,
                      ...(command.description.trim()
                        ? { description: command.description.trim() }
                        : {}),
                    },
                  ],
            ),
            source: "acp-session",
          };
        }),
      startSession,
      sendTurn,
      canResumeNativeConversation: (cursor) => readResumeCursor(cursor) !== undefined,
      interruptTurn: (threadId) =>
        requireThread(threadId).pipe(
          Effect.flatMap((thread) =>
            Effect.tryPromise({
              try: () => thread.session.cancel(),
              catch: (cause) => requestError("session/cancel", cause),
            }),
          ),
        ),
      respondToRequest: (threadId, requestId, decision) =>
        requireThread(threadId).pipe(
          Effect.flatMap((thread) =>
            thread.session.respondToPermission(requestId, decision)
              ? Effect.void
              : Effect.fail(
                  new ProviderAdapterRequestError({
                    provider,
                    method: "session/request_permission",
                    detail: `Unknown pending approval request: ${requestId}`,
                  }),
                ),
          ),
        ),
      respondToUserInput: (_threadId, requestId) =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider,
            method: "item/tool/respondToUserInput",
            detail: `Unknown pending user-input request: ${requestId}`,
          }),
        ),
      // Stopping a chat without a live session is already done.
      stopSession: (threadId) =>
        Effect.suspend(() => {
          const thread = threads.get(threadId);
          if (!thread) return Effect.void;
          thread.stopping = true;
          return retire(threadId, thread, "Session stopped");
        }),
      // ACP has no rename or archive. A deleted chat's native session is removed only by agents that
      // offer deletion; the others keep their own session files.
      updateNativeHistory: (input) => {
        const cursor = readResumeCursor(input.resumeCursor);
        if (input.action.type !== "delete" || !cursor) return Effect.void;
        return Effect.tryPromise({
          try: async () => {
            const connection = await openAcpConnection({
              child: dependencies.spawn({
                cwd: input.cwd ?? dependencies.defaultCwd,
                runtimeMode: "full-access",
                binaryPath: input.providerOptions?.[provider]?.binaryPath,
              }),
              profile,
              ...teardown,
            });
            try {
              if (connection.initialize.agentCapabilities?.sessionCapabilities?.delete) {
                await connection.agent.deleteSession({ sessionId: cursor.sessionId });
              }
            } finally {
              await connection.close();
            }
          },
          catch: (cause) => requestError("session/delete", cause),
        });
      },
      listSessions: () => Effect.sync(() => [...threads.values()].map((thread) => thread.record)),
      hasSession: (threadId) => Effect.sync(() => threads.has(threadId)),
      readThread: (threadId) => requireThread(threadId).pipe(Effect.as({ threadId, turns: [] })),
      rollbackThread: () =>
        Effect.fail(
          new ProviderAdapterValidationError({
            provider,
            operation: "rollbackThread",
            issue: `${profile.displayName} cannot rewind its native conversation.`,
          }),
        ),
      stopAll: () =>
        Effect.forEach(
          [...threads.entries()],
          ([threadId, thread]) => {
            thread.stopping = true;
            return retire(threadId, thread, "Session stopped");
          },
          { discard: true },
        ),
      streamEvents: Stream.fromQueue(events),
      titleGeneration: {
        ...(profile.titleModel ? { preferredModel: profile.titleModel } : {}),
        generate: structuredRequest,
      },
      structuredRequest,
      listModels: (input) =>
        Effect.tryPromise({
          try: (signal) => {
            const cwd = input.cwd ?? dependencies.defaultCwd;
            return withEphemeralAcpSession({
              profile,
              child: dependencies.spawn({
                cwd,
                runtimeMode: "full-access",
                binaryPath: input.binaryPath,
              }),
              cwd,
              signal,
              ...teardown,
              use: async (connection, session) => ({
                models: await discoverAcpModels({ profile, connection, session, signal }),
                source: "acp-session",
                discoveredAt: new Date().toISOString(),
              }),
            });
          },
          catch: (cause) => requestError("listModels", cause),
        }),
    };
    return adapter;
  });
