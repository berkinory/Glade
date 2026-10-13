import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { ContentBlock, McpServer } from "@agentclientprotocol/sdk";
import { EventId, ThreadId, TurnId, type ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import type { ModelSelection, RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { Effect, Option, Queue, Stream } from "effect";

import { renderGladeHarnessPolicy } from "../../agentGateway/harnessPolicy.ts";
import { GLADE_MCP_SERVER_NAME } from "../../agentGateway/mcpInjection.ts";
import {
  acquireAgentGatewaySessionLease,
  type AgentGatewaySessionLease,
  type AgentGatewaySessionLeaseCredentials,
} from "../../agentGateway/sessionLease.ts";
import type { teardownChildProcessTree } from "../../platform/supervisedProcessTeardown.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../core/Errors.ts";
import {
  PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
  type ProviderAdapterShape,
  type ProviderStructuredRequestInput,
} from "../Services/ProviderAdapter.ts";
import { CompactionAdmission } from "../Services/CompactionAdmission.ts";
import { openAcpConnection, type AcpConnection } from "./acpConnection.ts";
import { makeAcpConnectionPool } from "./acpConnectionPool.ts";
import { withEphemeralAcpSession } from "./acpEphemeralSession.ts";
import { acpConfigValue, acpModelOption } from "./acpModelCatalog.ts";
import { discoverAcpModels } from "./acpModelDiscovery.ts";
import type { AcpProviderProfile } from "./acpProviderProfile.ts";
import { openAcpSession, type AcpSession } from "./acpSession.ts";
import { acpPromptBlocks } from "./acpPromptBlocks.ts";
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
  // Replaced when a summary compaction moves the chat into a fresh native session.
  session: AcpSession;
  readonly cwd: string;
  readonly mcpServers: McpServer[];
  readonly gatewayLease: AgentGatewaySessionLease | undefined;
  readonly lifecycleGeneration: string | undefined;
  record: ProviderSession;
  // The harness policy rides on the first prompt of a fresh native session; a loaded session
  // already carries it in its history.
  policyPending: boolean;
  // Glade's MCP server reached the agent, so the policy can offer its tools.
  readonly gatewayToolsPassed: boolean;
  // The policy is in the agent's system prompt, so a fresh native session does not need it again.
  readonly systemPromptDelivered: boolean;
  // A compaction summary that opens the next prompt of the fresh native session.
  pendingContext: string | undefined;
  lastSelection: ModelSelection | undefined;
  stopping: boolean;
}

export interface AcpAdapterDependencies {
  readonly profile: AcpProviderProfile;
  readonly spawn: (input: {
    readonly cwd: string;
    readonly runtimeMode: RuntimeMode;
    readonly binaryPath: string | undefined;
    readonly systemPrompt?: string;
  }) => ChildProcessWithoutNullStreams;
  readonly defaultCwd: string;
  readonly attachmentsDir: string;
  readonly gatewayCredentials: AgentGatewaySessionLeaseCredentials | undefined;
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
    const update = acpConfigValue(session.configOptions(), optionId, value);
    if (update) await session.setConfigOption(update.configId, update.value);
  }
}

// Without a system prompt channel the policy rides in the first prompt. Untagged, models read the
// user's own message after it as an injected directive and refuse it; the tag the Glade MCP server
// names marks it as host setup.
function hostContextBlock(policy: string): string {
  return `<glade_host_context>\nThe Glade app, which hosts this session, supplies this context. It is session setup, not a message from the user.\n\n${policy}\n</glade_host_context>`;
}

// Summary compaction for agents without a native compact command: the agent writes a continuation
// summary as a turn, and the chat moves into a fresh native session that opens with it.
function summaryCompactionPrompt(instructions: string | undefined): string {
  return [
    "Compact this conversation: write a concise summary that lets a fresh session continue the work without the earlier messages. Cover the goal, key decisions, the files and commands that matter, the current state and the open next steps. Reply with only the summary.",
    instructions ? `Focus: ${instructions}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
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

    // Sessions carry their own working directory, so the process key is what the spawn depends on:
    // the executable, the runtime mode's environment and the system prompt. Chats, titles, Git
    // writing and model discovery with the same key share one process instead of spawning their own.
    const leaseConnection = (input: {
      readonly cwd: string;
      readonly runtimeMode: RuntimeMode;
      readonly binaryPath: string | undefined;
      readonly systemPrompt?: string;
      // A chat whose MCP servers would leak into other sessions of the process gets its own.
      readonly privateTo?: ThreadId;
    }) =>
      connections.lease(
        JSON.stringify([
          input.binaryPath ?? null,
          profile.env?.({ runtimeMode: input.runtimeMode }) ?? {},
          input.systemPrompt ?? null,
          input.privateTo ?? null,
        ]),
        () =>
          openAcpConnection({
            child: dependencies.spawn({
              cwd: input.cwd,
              runtimeMode: input.runtimeMode,
              binaryPath: input.binaryPath,
              ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
            }),
            profile,
            ...teardown,
          }),
      );

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

    // The agent's normal working mode and anything the runtime mode needs natively, then the model
    // selection.
    const configureSession = async (
      session: AcpSession,
      runtimeMode: RuntimeMode,
      selection: ModelSelection | undefined,
    ) => {
      const profileConfig = (profile.sessionConfig?.({ runtimeMode }) ?? []).filter(
        ({ configId }) => session.configOptions().some((option) => option.id === configId),
      );
      for (const { configId, value } of profileConfig) {
        await session.setConfigOption(configId, value);
      }
      await applySelection(session, selection);
    };

    // Moves a chat into a fresh native session that opens with the compaction summary. The old
    // session ends; its history stays in the agent's own storage like any finished session.
    const replaceWithSummarySession = async (
      threadId: ThreadId,
      thread: AcpThread,
      summary: string,
    ) => {
      const created = await thread.connection.agent.newSession({
        cwd: thread.cwd,
        mcpServers: thread.mcpServers,
      });
      const session = openAcpSession({
        connection: thread.connection,
        sessionId: created.sessionId,
        configOptions: created.configOptions ?? [],
        runtimeMode: thread.record.runtimeMode,
        ...(profile.innerToolCall ? { innerToolCall: profile.innerToolCall } : {}),
        sink: {
          emit: (draft, turnId) => emit(threadId, thread.lifecycleGeneration, draft, turnId),
        },
      });
      await configureSession(session, thread.record.runtimeMode, thread.lastSelection);
      const previous = thread.session;
      thread.session = session;
      previous.detach();
      if (thread.connection.initialize.agentCapabilities?.sessionCapabilities?.close) {
        await thread.connection.agent
          .closeSession({ sessionId: previous.sessionId })
          .catch(() => undefined);
      }
      thread.pendingContext = summary;
      thread.policyPending = !thread.systemPromptDelivered;
      thread.record = {
        ...thread.record,
        resumeCursor: { schemaVersion: RESUME_CURSOR_VERSION, sessionId: created.sessionId },
        updatedAt: new Date().toISOString(),
      };
      emit(threadId, thread.lifecycleGeneration, {
        type: "thread.started",
        payload: { providerThreadId: created.sessionId },
      });
    };

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
      Effect.gen(function* () {
        const existing = threads.get(input.threadId);
        if (existing) yield* retire(input.threadId, existing, "Session replaced");
        const cwd = input.cwd ?? dependencies.defaultCwd;
        const binaryPath = input.providerOptions?.[provider]?.binaryPath;
        // Agents with a system prompt channel serve Glade's tools over HTTP MCP, so the policy can
        // promise them before the process is up.
        const systemPrompt = profile.argsWithSystemPrompt
          ? renderGladeHarnessPolicy({
              gatewayControlAvailable: dependencies.gatewayCredentials !== undefined,
              computerUseAllowed: false,
            })
          : undefined;
        const { connection, release: releaseConnection } = yield* Effect.tryPromise({
          try: () =>
            leaseConnection({
              cwd,
              runtimeMode: input.runtimeMode,
              binaryPath,
              ...(systemPrompt ? { systemPrompt } : {}),
              ...(profile.sharesMcpServersAcrossSessions &&
              dependencies.gatewayCredentials !== undefined
                ? { privateTo: input.threadId }
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
          ...(profile.innerToolCall ? { innerToolCall: profile.innerToolCall } : {}),
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
          cwd,
          mcpServers: servers,
          gatewayLease,
          lifecycleGeneration,
          policyPending: !opened.resumed && systemPrompt === undefined,
          gatewayToolsPassed: servers.length > 0,
          systemPromptDelivered: systemPrompt !== undefined,
          pendingContext: undefined,
          lastSelection: input.modelSelection,
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
          thread.session.detach();
          gatewayLease?.release();
          void releaseConnection();
          emit(input.threadId, lifecycleGeneration, {
            type: "session.exited",
            payload: { reason: error.message, exitKind: "error" },
          });
        });
        yield* Effect.tryPromise({
          try: () => configureSession(session, input.runtimeMode, input.modelSelection),
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

    // A compaction turn runs the agent's native compact command; its successful end tells Glade the
    // context was compacted, as a native compaction event does for other providers.
    const startTurn = (
      input: Parameters<ProviderAdapterShape<ProviderAdapterError>["sendTurn"]>[0],
      compaction: "native" | "summary" | undefined,
    ) =>
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
        if (input.modelSelection) thread.lastSelection = input.modelSelection;
        const turnId = `acp-turn-${randomUUID()}`;
        const blocks: ContentBlock[] = [];
        if (thread.policyPending) {
          thread.policyPending = false;
          blocks.push({
            type: "text",
            text: hostContextBlock(
              renderGladeHarnessPolicy({
                gatewayControlAvailable: thread.gatewayToolsPassed,
                computerUseAllowed: false,
              }),
            ),
          });
        }
        if (thread.pendingContext) {
          blocks.push({
            type: "text",
            text: `This conversation continues in a fresh session after compaction. Summary of the earlier conversation:\n\n${thread.pendingContext}`,
          });
          thread.pendingContext = undefined;
        }
        blocks.push(
          ...(yield* Effect.tryPromise({
            try: () =>
              acpPromptBlocks({
                text: input.input,
                attachments: input.attachments,
                attachmentsDir: dependencies.attachmentsDir,
                acceptsImages:
                  thread.connection.initialize.agentCapabilities?.promptCapabilities?.image ===
                  true,
              }),
            catch: (cause) => requestError("session/prompt", cause),
          })),
        );
        const model = input.modelSelection?.model ?? thread.record.model;
        thread.record = {
          ...thread.record,
          status: "running",
          activeTurnId: TurnId.makeUnsafe(turnId),
          ...(model ? { model } : {}),
          updatedAt: new Date().toISOString(),
        };
        if (compaction !== undefined) {
          const admission = yield* Effect.serviceOption(CompactionAdmission);
          if (Option.isSome(admission)) {
            yield* admission.value.check;
            admission.value.admitted();
          }
        }
        emit(
          input.threadId,
          thread.lifecycleGeneration,
          { type: "turn.started", payload: model ? { model } : {} },
          turnId,
        );
        runFork(
          Effect.promise(() => thread.session.prompt(turnId, blocks)).pipe(
            Effect.tap(({ state, agentText }) =>
              Effect.promise(async () => {
                if (compaction === undefined || state !== "completed") return;
                if (compaction === "summary") {
                  const summary = agentText.trim();
                  const failure = summary
                    ? await replaceWithSummarySession(input.threadId, thread, summary).then(
                        () => undefined,
                        (cause: unknown) =>
                          cause instanceof Error ? cause.message : String(cause),
                      )
                    : "The agent returned no summary.";
                  if (failure !== undefined) {
                    // The chat keeps its current native session, so nothing was lost; say so.
                    emit(
                      input.threadId,
                      thread.lifecycleGeneration,
                      {
                        type: "runtime.warning",
                        payload: { message: `Compaction kept the current session: ${failure}` },
                      },
                      turnId,
                    );
                    return;
                  }
                }
                emit(
                  input.threadId,
                  thread.lifecycleGeneration,
                  { type: "thread.state.changed", payload: { state: "compacted" } },
                  turnId,
                );
              }),
            ),
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

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
      startTurn(input, undefined);

    const structuredRequest = (input: ProviderStructuredRequestInput) =>
      Effect.tryPromise({
        try: (signal) =>
          withEphemeralAcpSession({
            // Supervised, so the agent asks before any tool and the request rejects it.
            lease: () =>
              leaseConnection({
                cwd: input.cwd,
                runtimeMode: "approval-required",
                binaryPath: input.binaryPath,
              }),
            cwd: input.cwd,
            signal,
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
          supportsThreadCompaction: true,
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
      compactThread: (threadId: ThreadId, instructions?: string) =>
        (profile.compactCommand
          ? startTurn(
              {
                threadId,
                input: [`/${profile.compactCommand}`, instructions].filter(Boolean).join(" "),
              },
              "native",
            )
          : startTurn({ threadId, input: summaryCompactionPrompt(instructions) }, "summary")
        ).pipe(Effect.asVoid),
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
            const { connection, release } = await leaseConnection({
              cwd: input.cwd ?? dependencies.defaultCwd,
              runtimeMode: "full-access",
              binaryPath: input.providerOptions?.[provider]?.binaryPath,
            });
            try {
              if (connection.initialize.agentCapabilities?.sessionCapabilities?.delete) {
                await connection.agent.deleteSession({ sessionId: cursor.sessionId });
              }
            } finally {
              await release();
            }
          },
          catch: (cause) => requestError("session/delete", cause),
        });
      },
      listSessions: () => Effect.sync(() => [...threads.values()].map((thread) => thread.record)),
      hasSession: (threadId) => Effect.sync(() => threads.has(threadId)),
      readThread: (threadId) => requireThread(threadId).pipe(Effect.as({ threadId, turns: [] })),
      // ACP has no native rewind, so the chat's native session ends and the next turn starts a
      // fresh one from Glade's trimmed transcript.
      rollbackThread: (threadId) =>
        Effect.suspend(() => {
          const thread = threads.get(threadId);
          if (!thread) return Effect.void;
          thread.stopping = true;
          return retire(threadId, thread, undefined);
        }),
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
              lease: () =>
                leaseConnection({ cwd, runtimeMode: "full-access", binaryPath: input.binaryPath }),
              cwd,
              signal,
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
