import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { ContentBlock, McpServer, SessionConfigOption } from "@agentclientprotocol/sdk";
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
} from "../Services/ProviderAdapter.ts";
import { openAcpConnection, type AcpConnection } from "./acpConnection.ts";
import { acpConfigIdFor, acpModelCatalog } from "./acpModelCatalog.ts";
import type { AcpProviderProfile } from "./acpProviderProfile.ts";
import { openAcpSession, type AcpSession } from "./acpSession.ts";
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

function configValueFor(
  options: ReadonlyArray<SessionConfigOption>,
  category: string,
): SessionConfigOption | undefined {
  return options.find((option) => option.category === category);
}

// Model selection maps onto the agent's own session config options: the model option by category,
// and every selected option value by its config id.
function selectionConfig(
  options: ReadonlyArray<SessionConfigOption>,
  selection: ModelSelection | undefined,
): ReadonlyArray<{ readonly configId: string; readonly value: string }> {
  if (!selection) return [];
  const model = configValueFor(options, "model");
  const updates: Array<{ configId: string; value: string }> = model
    ? [{ configId: model.id, value: selection.model }]
    : [];
  for (const [optionId, value] of Object.entries(selection.options ?? {})) {
    const configId = acpConfigIdFor(options, optionId);
    if (typeof value === "string" && configId) updates.push({ configId, value });
  }
  return updates;
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

    const retire = (threadId: ThreadId, thread: AcpThread, reason: string) =>
      Effect.promise(async () => {
        if (threads.get(threadId) === thread) threads.delete(threadId);
        thread.session.detach();
        thread.gatewayLease?.release();
        await thread.connection.close().catch(() => undefined);
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
        const connection = yield* Effect.tryPromise({
          try: () =>
            openAcpConnection({
              child: dependencies.spawn({
                cwd,
                runtimeMode: input.runtimeMode,
                binaryPath: input.providerOptions?.[provider]?.binaryPath,
              }),
              profile,
              ...(dependencies.teardownProcessTree
                ? { teardownProcessTree: dependencies.teardownProcessTree }
                : {}),
            }),
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
              await connection.close().catch(() => undefined);
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
        connection.onExit((error) => {
          if (thread.stopping || threads.get(input.threadId) !== thread) return;
          threads.delete(input.threadId);
          session.detach();
          gatewayLease?.release();
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
            for (const { configId, value } of [
              ...profileConfig,
              ...selectionConfig(session.configOptions(), input.modelSelection),
            ]) {
              await session.setConfigOption(configId, value);
            }
          },
          catch: (cause) => requestError("session/set_config_option", cause),
        });
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
          try: async () => {
            for (const { configId, value } of selectionConfig(
              thread.session.configOptions(),
              input.modelSelection,
            )) {
              await thread.session.setConfigOption(configId, value);
            }
          },
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
      stopSession: (threadId) =>
        requireThread(threadId).pipe(
          Effect.flatMap((thread) => {
            thread.stopping = true;
            return retire(threadId, thread, "Session stopped");
          }),
        ),
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
      listModels: (input) =>
        Effect.tryPromise({
          try: async () => {
            const cwd = input.cwd ?? dependencies.defaultCwd;
            const connection = await openAcpConnection({
              child: dependencies.spawn({
                cwd,
                runtimeMode: "full-access",
                binaryPath: input.binaryPath,
              }),
              profile,
              ...(dependencies.teardownProcessTree
                ? { teardownProcessTree: dependencies.teardownProcessTree }
                : {}),
            });
            try {
              const created = await connection.agent.newSession({ cwd, mcpServers: [] });
              // Discovery must not leave an empty conversation in the agent's own history.
              const capabilities = connection.initialize.agentCapabilities?.sessionCapabilities;
              if (capabilities?.delete) {
                await connection.agent
                  .deleteSession({ sessionId: created.sessionId })
                  .catch(() => undefined);
              } else if (capabilities?.close) {
                await connection.agent
                  .closeSession({ sessionId: created.sessionId })
                  .catch(() => undefined);
              }
              return {
                models: acpModelCatalog(created.configOptions ?? []),
                source: "acp-session",
                discoveredAt: new Date().toISOString(),
              };
            } finally {
              await connection.close();
            }
          },
          catch: (cause) => requestError("listModels", cause),
        }),
    };
    return adapter;
  });
