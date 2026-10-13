import { randomUUID } from "node:crypto";

import { EventId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Effect, Queue, Stream } from "effect";

import { renderGladeHarnessPolicy } from "../../agentGateway/harnessPolicy.ts";
import type { AgentGatewayCredentialsShape } from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../core/Errors.ts";
import type { RuntimeEventDraft } from "../core/runtimeEventDraft.ts";
import {
  PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
  type ProviderAdapterShape,
  type ProviderStructuredRequestInput,
} from "../Services/ProviderAdapter.ts";
import { callMsp } from "./mspConnection.ts";
import { MspModelListResult } from "./mspProtocol.ts";
import {
  startRequestSession,
  withEphemeralMuseHost,
  type MuseHostSpawn,
  type MuseTeardown,
} from "./museHost.ts";
import {
  museModelCatalog,
  museReasoningEffort,
  MUSE_EFFORT_OPTION_ID,
} from "./museModelCatalog.ts";
import {
  MUSE_PROVIDER,
  openMuseThread,
  readMuseResumeCursor,
  type MuseThread,
} from "./museThread.ts";
import type { MuseTurnInputPart } from "./museSession.ts";
import { runMuseStructuredRequest } from "./museStructuredRequest.ts";

export interface MuseAdapterDependencies {
  readonly spawn: MuseHostSpawn;
  readonly defaultCwd: string;
  readonly gatewayCredentials: AgentGatewayCredentialsShape | undefined;
  readonly teardownProcessTree?: MuseTeardown;
}

const SLASH_COMMAND = /^\/(\S+)(?:\s+([\s\S]*))?$/u;

export const makeMuseAdapter = (dependencies: MuseAdapterDependencies) =>
  Effect.gen(function* () {
    const provider = MUSE_PROVIDER;
    const services = yield* Effect.services<never>();
    const runFork = Effect.runForkWith(services);
    const events = yield* Queue.bounded<ProviderRuntimeEvent>(
      PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
    );
    const threads = new Map<ThreadId, MuseThread>();
    const teardown = dependencies.teardownProcessTree
      ? { teardownProcessTree: dependencies.teardownProcessTree }
      : {};

    const emit = (
      threadId: ThreadId,
      lifecycleGeneration: string | undefined,
      draft: RuntimeEventDraft,
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
      // Host output arrives on stdio callbacks; the queue applies backpressure to the pump.
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

    const retire = (threadId: ThreadId, thread: MuseThread, reason: string) =>
      Effect.promise(async () => {
        if (threads.get(threadId) === thread) threads.delete(threadId);
        await thread.close();
        emit(threadId, thread.lifecycleGeneration, {
          type: "session.exited",
          payload: { reason, exitKind: "graceful" },
        });
      });

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
      Effect.gen(function* () {
        const existing = threads.get(input.threadId);
        if (existing) yield* retire(input.threadId, existing, "Session replaced");
        const lifecycleGeneration = input.lifecycleGeneration;
        const thread = yield* Effect.tryPromise({
          try: () =>
            openMuseThread({
              ...dependencies,
              ...teardown,
              cwd: input.cwd ?? dependencies.defaultCwd,
              threadId: input.threadId,
              runtimeMode: input.runtimeMode,
              binaryPath: input.providerOptions?.museCode?.binaryPath,
              modelId: input.modelSelection?.model,
              resumeCursor: input.resumeCursor,
              lifecycleGeneration,
              emit: (draft, turnId) => emit(input.threadId, lifecycleGeneration, draft, turnId),
              onExit: (thread, error) => {
                if (threads.get(input.threadId) !== thread) return;
                threads.delete(input.threadId);
                emit(input.threadId, lifecycleGeneration, {
                  type: "session.exited",
                  payload: { reason: error.message, exitKind: "error" },
                });
              },
            }),
          catch: (cause) =>
            requestError(input.resumeCursor ? "session/resume" : "session/start", cause),
        });
        threads.set(input.threadId, thread);
        emit(input.threadId, lifecycleGeneration, {
          type: "session.started",
          payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
        });
        emit(input.threadId, lifecycleGeneration, {
          type: "thread.started",
          payload: { providerThreadId: thread.session.sessionId },
        });
        emit(input.threadId, lifecycleGeneration, {
          type: "session.state.changed",
          payload: { state: "ready" },
        });
        return thread.record;
      });

    // `/selector args` invokes one of the session's skills natively; anything else is plain text.
    const turnParts = async (thread: MuseThread, text: string | undefined) => {
      const parts: MuseTurnInputPart[] = [];
      if (thread.policyPending) {
        parts.push({
          type: "text",
          text: renderGladeHarnessPolicy({
            gatewayControlAvailable: thread.gatewayAvailable,
            computerUseAllowed: false,
          }),
        });
      }
      const slash = text ? SLASH_COMMAND.exec(text) : null;
      const skills = slash ? await thread.session.skills() : [];
      const skill = slash ? skills.find((entry) => entry.selector === slash[1]) : undefined;
      if (skill) {
        const args = slash?.[2]?.trim();
        parts.push({
          type: "skill",
          selector: skill.selector,
          ...(args ? { arguments: args } : {}),
        });
      } else if (text) {
        parts.push({ type: "text", text });
      }
      return parts;
    };

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const thread = yield* requireThread(input.threadId);
        if (thread.session.activeTurnId()) {
          return yield* new ProviderAdapterRequestError({
            provider,
            method: "turn/start",
            detail: "A turn is already running in this session.",
          });
        }
        const model = input.modelSelection?.model;
        const effort = museReasoningEffort(input.modelSelection?.options?.[MUSE_EFFORT_OPTION_ID]);
        const turnId = yield* Effect.tryPromise({
          try: async () => {
            if (model) await thread.session.setModel(model);
            const parts = await turnParts(thread, input.input);
            const started = await thread.session.startTurn({
              parts,
              reasoningEffort: effort,
              model: model ?? thread.session.modelId(),
            });
            thread.policyPending = false;
            return started;
          },
          catch: (cause) => requestError("turn/start", cause),
        });
        thread.record = {
          ...thread.record,
          ...(model ? { model } : {}),
          updatedAt: new Date().toISOString(),
        };
        return {
          threadId: input.threadId,
          turnId: TurnId.makeUnsafe(turnId),
          resumeCursor: thread.record.resumeCursor,
        };
      });

    const structuredRequest = (input: ProviderStructuredRequestInput) =>
      Effect.tryPromise({
        try: (signal) =>
          withEphemeralMuseHost({
            spawn: dependencies.spawn,
            cwd: input.cwd,
            binaryPath: input.binaryPath,
            signal,
            ...teardown,
            use: async (connection) =>
              runMuseStructuredRequest(
                connection,
                await startRequestSession(connection, input.cwd, input.model),
                input,
              ),
          }),
        catch: (cause) => requestError("structuredRequest", cause),
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
      // Skills are the session's own slash commands, so only a chat with a live session lists them.
      listCommands: (input) => {
        const thread = input.threadId
          ? threads.get(ThreadId.makeUnsafe(input.threadId))
          : undefined;
        if (!thread) return Effect.succeed({ commands: [], source: "msp-session" });
        return Effect.tryPromise({
          try: async () => ({
            commands: (await thread.session.skills()).flatMap((skill) => {
              const name = skill.selector.trim();
              const description = skill.description.trim();
              return name ? [{ name, ...(description ? { description } : {}) }] : [];
            }),
            source: "msp-session",
          }),
          catch: (cause) => requestError("skill/list", cause),
        });
      },
      startSession,
      sendTurn,
      canResumeNativeConversation: (cursor) => readMuseResumeCursor(cursor) !== undefined,
      resumedNativeConversation: (cursor, session) =>
        readMuseResumeCursor(cursor)?.sessionId ===
        readMuseResumeCursor(session.resumeCursor)?.sessionId,
      interruptTurn: (threadId) =>
        requireThread(threadId).pipe(
          Effect.flatMap((thread) =>
            Effect.tryPromise({
              try: () => thread.session.interrupt(),
              catch: (cause) => requestError("turn/interrupt", cause),
            }),
          ),
        ),
      respondToRequest: (threadId, requestId, decision) =>
        requireThread(threadId).pipe(
          Effect.flatMap((thread) =>
            Effect.tryPromise({
              try: () => thread.session.interactions.decideApproval(requestId, decision),
              catch: (cause) => requestError("approval/decide", cause),
            }),
          ),
          Effect.flatMap((known) =>
            known
              ? Effect.void
              : Effect.fail(
                  new ProviderAdapterRequestError({
                    provider,
                    method: "approval/decide",
                    detail: `Unknown pending approval request: ${requestId}`,
                  }),
                ),
          ),
        ),
      respondToUserInput: (threadId, requestId, answers) =>
        requireThread(threadId).pipe(
          Effect.flatMap((thread) =>
            Effect.tryPromise({
              try: () => thread.session.interactions.answerUserInput(requestId, answers),
              catch: (cause) => requestError("userInput/answer", cause),
            }),
          ),
          Effect.flatMap((known) =>
            known
              ? Effect.void
              : Effect.fail(
                  new ProviderAdapterRequestError({
                    provider,
                    method: "userInput/answer",
                    detail: `Unknown pending user-input request: ${requestId}`,
                  }),
                ),
          ),
        ),
      // Stopping a chat without a live session is already done.
      stopSession: (threadId) =>
        Effect.suspend(() => {
          const thread = threads.get(threadId);
          return thread ? retire(threadId, thread, "Session stopped") : Effect.void;
        }),
      // MSP can neither delete nor archive a stored session, and its rename lowercases the name, so
      // Muse keeps its own session files and names.
      updateNativeHistory: () => Effect.void,
      listSessions: () =>
        Effect.sync(() =>
          [...threads.values()].map((thread) => {
            const activeTurnId = thread.session.activeTurnId();
            return activeTurnId
              ? {
                  ...thread.record,
                  status: "running",
                  activeTurnId: TurnId.makeUnsafe(activeTurnId),
                }
              : thread.record;
          }),
        ),
      hasSession: (threadId) => Effect.sync(() => threads.has(threadId)),
      readThread: (threadId) => requireThread(threadId).pipe(Effect.as({ threadId, turns: [] })),
      rollbackThread: () =>
        Effect.fail(
          new ProviderAdapterValidationError({
            provider,
            operation: "rollbackThread",
            issue: "Muse Code cannot rewind its native conversation.",
          }),
        ),
      stopAll: () =>
        Effect.forEach(
          [...threads.entries()],
          ([threadId, thread]) => retire(threadId, thread, "Session stopped"),
          { discard: true },
        ),
      streamEvents: Stream.fromQueue(events),
      titleGeneration: { generate: structuredRequest },
      structuredRequest,
      listModels: (input) =>
        Effect.tryPromise({
          try: (signal) =>
            withEphemeralMuseHost({
              spawn: dependencies.spawn,
              cwd: input.cwd ?? dependencies.defaultCwd,
              binaryPath: input.binaryPath,
              signal,
              ...teardown,
              use: async (connection) => ({
                models: museModelCatalog(
                  (await callMsp(connection, "model/list", {}, MspModelListResult)).models,
                ),
                source: "msp",
                discoveredAt: new Date().toISOString(),
              }),
            }),
          catch: (cause) => requestError("model/list", cause),
        }),
    };
    return adapter;
  });
