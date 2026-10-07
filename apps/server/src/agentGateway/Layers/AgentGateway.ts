import { makeVisualReplyTools } from "../visualReplyTools";
import { VisualReplyPreview } from "../../visualReplies/Services/VisualReplyPreview";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments";
import { FileSystem, Path } from "effect";
import { AppPresentation } from "../Services/AppPresentation";
import { CheckpointDiffQuery } from "../../checkpointing/Services/CheckpointDiffQuery";
import { makeThreadDiffTools } from "../threadDiffTools";
import { makeForkThreadTool } from "../forkThreadTool";
import { makeAppPresentationTool } from "../appPresentationTool";
import { AgentGatewayDiscovery } from "../Services/AgentGatewayDiscovery";
import { randomUUID } from "node:crypto";

import {
  CommandId,
  MessageId,
  ThreadId,
  type ProviderKind,
} from "@glade/contracts/core/baseSchemas";
import {
  GladeCreateThreadInput,
  GladeCreateThreadsInput,
} from "@glade/contracts/provider/agentGateway";

import { type RuntimeMode, type TurnDispatchMode } from "@glade/contracts/provider/sessionPolicy";
import { type ServerProviderStatus } from "@glade/contracts/server/server";
import { runtimeModeEscalatesPrivilege } from "@glade/shared/threads/runtimeMode";
import { Effect, Layer, Option, Schema } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { GitManager } from "../../git/Services/GitManager.ts";
import { ServerConfig } from "../../server/config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationEventDeliveryRepository } from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import { ProviderRuntimeEventRepository } from "../../persistence/Services/ProviderRuntimeEvents.ts";
import { ThreadDiagnosticsQuery } from "../../diagnostics/Services/ThreadDiagnosticsQuery.ts";
import { AgentGateway, type AgentGatewayShape } from "../Services/AgentGateway.ts";
import { AgentGatewayCredentials } from "../Services/AgentGatewayCredentials.ts";
import { AgentGatewayOperationRepository } from "../Services/AgentGatewayOperationRepository.ts";
import { ProviderDiscoveryService } from "../../provider/Services/ProviderDiscoveryService.ts";
import { ProviderHealth } from "../../provider/Services/ProviderHealth.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { type AgentGatewayProviderAvailability } from "../targetResolver.ts";
import { mcpToolResultError, mcpToolResultJson, toolInputSchema } from "../protocol.ts";
import { gatewayIsoNow as isoNow } from "../creationUtils.ts";
import {
  PROVIDER_KINDS,
  ToolInputError,
  decodeCreateThreadsInput,
  errorText,
  readBooleanArg,
  readStringArg,
} from "../toolInput.ts";
import { WRITE_TOOL_ANNOTATIONS, type ToolEntry } from "../toolRuntime.ts";
import { makeAgentGatewayMcpTransport } from "../mcpTransport.ts";
import { deliverGatewayCompletions } from "../completionDelivery.ts";
import { recoverInterruptedAgentGatewayOperations } from "../startupRecovery.ts";
import { makeCreateThreadsHandler } from "../creationCoordinator.ts";
import { makeThreadReadTools } from "../threadReadTools.ts";
import { makeThreadDiagnosticTools } from "../threadDiagnosticTools.ts";
import { pruneProjectedArchivedManagedWorktrees } from "../../git/managedWorktrees.ts";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";

// Providers already receive the versioned host policy exactly once in their private prompt. MCP
// clients prepend initialize.instructions to every exposed tool definition, so repeating the full
// policy here adds tens of thousands of context characters per round without adding authority or
// safety.
const AGENT_GATEWAY_INSTRUCTIONS =
  "Glade tools operate under this session's thread identity and capabilities. Use the provider-delivered <glade_host_context> for host policy and each tool's description for its inputs, effects and recovery rules.";

const makeAgentGateway = Effect.gen(function* () {
  const visualPreview = yield* VisualReplyPreview;
  const managedAttachments = yield* ManagedAttachmentRepository;
  const diffs = yield* CheckpointDiffQuery;
  const presentation = yield* AppPresentation;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const credentials = yield* AgentGatewayCredentials;
  const discovery = yield* AgentGatewayDiscovery;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const git = yield* GitCore;
  const gitManager = yield* GitManager;
  const providerDiscovery = yield* ProviderDiscoveryService;
  const providerHealth = yield* ProviderHealth;
  const serverSettings = yield* ServerSettingsService;
  const operationRepository = yield* AgentGatewayOperationRepository;
  const projectionTurns = yield* ProjectionTurnRepository;
  const eventStore = yield* OrchestrationEventStore;
  const eventDeliveries = yield* OrchestrationEventDeliveryRepository;
  const providerRuntimeEvents = yield* ProviderRuntimeEventRepository;
  const diagnostics = yield* ThreadDiagnosticsQuery;
  const serverConfig = yield* ServerConfig;
  const loadProviderAvailabilities = Effect.gen(function* () {
    const [settings, statuses] = yield* Effect.all([
      serverSettings.getSettings,
      providerHealth.getStatuses,
    ]);
    const statusByProvider = new Map<ProviderKind, ServerProviderStatus>(
      statuses.map((status) => [status.provider, status]),
    );
    return new Map<ProviderKind, AgentGatewayProviderAvailability>(
      PROVIDER_KINDS.map((provider) => {
        const status = statusByProvider.get(provider);
        return [
          provider,
          {
            enabled: settings.providers[provider].enabled,
            ...(status
              ? {
                  available: status.available,
                  authStatus: status.authStatus,
                  ...(status.message ? { message: status.message } : {}),
                }
              : {}),
          },
        ];
      }),
    );
  });

  yield* recoverInterruptedAgentGatewayOperations({
    operationRepository,
    snapshotQuery,
    orchestrationEngine,
    git,
  });

  yield* Effect.forkScoped(
    Effect.forever(
      deliverGatewayCompletions({
        repository: operationRepository.completions,
        snapshotQuery,
        projectionTurns,
        orchestrationEngine,
      }).pipe(
        Effect.catch((error) => Effect.logWarning("gateway completion scan failed", { error })),
        Effect.andThen(Effect.sleep(1000)),
      ),
    ),
  );

  const requireThreadShell = (threadId: string) =>
    snapshotQuery.getThreadShellById(ThreadId.makeUnsafe(threadId)).pipe(
      Effect.mapError((error) => new ToolInputError(errorText(error))),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new ToolInputError(`Thread "${threadId}" was not found.`)),
          onSome: (shell) => Effect.succeed(shell),
        }),
      ),
    );

  // Privilege boundary shared by every tool that makes another thread execute work or mutates another
  // thread's state: a caller must not drive a thread that runs with more privileges than the user
  // granted the caller itself — otherwise an approval-required or worktree-isolated agent escalates
  // by proxy.
  const assertCallerMayDriveThread = (
    caller: { readonly runtimeMode: RuntimeMode; readonly envMode?: string | null | undefined },
    target: {
      readonly id: string;
      readonly runtimeMode: RuntimeMode;
      readonly envMode?: string | null | undefined;
    },
  ) =>
    Effect.gen(function* () {
      if (runtimeModeEscalatesPrivilege(caller.runtimeMode, target.runtimeMode)) {
        return yield* Effect.fail(
          new ToolInputError(
            `Thread "${target.id}" runs in "${target.runtimeMode}" mode but your thread runs in "${caller.runtimeMode}"; you cannot drive higher-privileged threads. Ask the user to do this or to elevate your thread.`,
          ),
        );
      }
      if (caller.envMode === "worktree" && (target.envMode ?? "local") === "local") {
        return yield* Effect.fail(
          new ToolInputError(
            `Thread "${target.id}" runs on the shared local checkout but your thread is isolated in a worktree; you cannot drive local-checkout threads. Ask the user to do this from a local thread.`,
          ),
        );
      }
    });

  const readTools = makeThreadReadTools({
    discovery,
    eventStore,
    snapshotQuery,
    projectionTurns,
    providerDiscovery,
    loadProviderAvailabilities,
    requireThreadShell,
    workspacePaths: {
      homeDir: serverConfig.homeDir,
      chatWorkspaceRoot: serverConfig.chatWorkspaceRoot,
    },
  });
  const diagnosticTools = makeThreadDiagnosticTools({
    snapshotQuery,
    diagnostics,
    eventStore,
    providerRuntimeEvents,
    eventDeliveries,
    requireThreadShell,
  });

  const runCreateThreads = yield* makeCreateThreadsHandler({
    snapshotQuery,
    orchestrationEngine,
    git,
    providerDiscovery,
    operationRepository,
    serverConfig,
    loadProviderAvailabilities,
    requireThreadShell,
  });

  const createThreads: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_create_threads",
      description:
        "Create one exact plan of 1-20 standalone Glade threads. For a plural request, the array length must equal the requested count; do not add candidates, retries or verification workers.\nSelect targets from glade_capabilities and respect its operation limits. Worktree threads start on a managed temporary branch pinned at baseRef or the selected checkout's HEAD. When pinned at that HEAD, they copy local checkout changes and .worktreeinclude files. The first turn may rename and publish the branch.\nA confirmed validation/preflight rejection before an operationId creates no durable work: correct that rejected plan using the same requestId. Once an operationId exists, retries must use the same requestId and unchanged plan. After an ambiguous response, retry the unchanged request to recover its outcome; never assume nothing was created. A terminal failure does not authorize replacement threads.\nReport per-thread failures. Acceptance is not completion; use glade_wait_for_threads when the user requested outcomes.",
      inputSchema: toolInputSchema(GladeCreateThreadsInput),
      annotations: {
        title: "Create Glade threads",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    handler: (args, context) =>
      runCreateThreads(decodeCreateThreadsInput(args), {
        kind: "provider-session",
        callerThreadId: context.callerThreadId,
        callerTurnId: context.callerTurnId,
        assertAuthority: context.assertCallerTurnActive,
      }),
  };

  const createThread: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_create_thread",
      description:
        "Create one standalone Glade thread for user-requested work. Use glade_create_threads for two or more threads; do not satisfy a plural request with repeated single-thread calls.\nSelect a provider/model and options from glade_capabilities. Worktree threads start on a Glade-managed temporary branch pinned at baseRef; the first turn may rename and publish that branch.\nA confirmed validation/preflight rejection before an operationId creates no durable work: correct that rejected plan using the same requestId. Once an operationId exists, retries must use the same requestId and unchanged plan. After an ambiguous response, retry the unchanged request to recover its outcome; never assume nothing was created. A terminal failure does not authorize replacement threads.\nCreation acceptance is not task completion. When results are requested, wait for the returned thread with glade_wait_for_threads.",
      inputSchema: toolInputSchema(GladeCreateThreadInput),
      annotations: {
        title: "Create a Glade thread",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const { requestId, ...spec } = Schema.decodeUnknownSync(GladeCreateThreadInput)(args);
        return yield* runCreateThreads(
          decodeCreateThreadsInput({
            requestId,
            threads: [spec],
          }),
          {
            kind: "provider-session",
            callerThreadId: context.callerThreadId,
            callerTurnId: context.callerTurnId,
            assertAuthority: context.assertCallerTurnActive,
          },
        ).pipe(
          Effect.map((result) => {
            if (result.isError) return result;
            const content = result.content[0];
            const batch = JSON.parse(content?.type === "text" ? content.text : "{}") as {
              operationId?: string;
              requestId?: string;
              threads?: Array<Record<string, unknown>>;
            };
            return mcpToolResultJson({
              operationId: batch.operationId,
              requestId: batch.requestId,
              ...batch.threads?.[0],
            });
          }),
        );
      }).pipe(
        Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error)))),
        Effect.catchDefect((error) => Effect.succeed(mcpToolResultError(errorText(error)))),
      ),
  };

  const sendMessage: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_send_message",
      description:
        'Send a Glade follow-up message to an existing thread. mode "queue" (default) waits for the current turn; "steer" redirects a running turn where the provider supports it (otherwise it is queued).',
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Target thread." },
          message: { type: "string", description: "Message text." },
          mode: { type: "string", enum: ["queue", "steer"], description: "Dispatch mode." },
        },
        required: ["threadId", "message"],
        additionalProperties: false,
      },
      annotations: { title: "Send a Glade message", ...WRITE_TOOL_ANNOTATIONS },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const threadId = readStringArg(args, "threadId", { required: true })!;
        const message = readStringArg(args, "message", { required: true })!;
        const modeArg = readStringArg(args, "mode") ?? "queue";
        if (modeArg !== "queue" && modeArg !== "steer") {
          throw new ToolInputError(`Argument "mode" must be "queue" or "steer".`);
        }
        const caller = yield* requireThreadShell(context.callerThreadId);
        const target = yield* requireThreadShell(threadId);
        yield* assertCallerMayDriveThread(caller, target);

        const dispatchMode: TurnDispatchMode = modeArg;
        const suffix = randomUUID();
        yield* orchestrationEngine
          .dispatch({
            type: "thread.turn.start",
            commandId: CommandId.makeUnsafe(`agent:${suffix}:send`),
            threadId: target.id,
            message: {
              messageId: MessageId.makeUnsafe(`agent:${suffix}:message`),
              role: "user",
              text: message,
              attachments: [],
            },
            dispatchMode,
            dispatchOrigin: "agent",
            runtimeMode: target.runtimeMode,

            createdAt: isoNow(),
          })
          .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));
        return mcpToolResultJson({ threadId: target.id, dispatched: dispatchMode });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  const interruptThread: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_interrupt_thread",
      description: "Interrupt the running turn of a Glade thread.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Thread whose turn should be interrupted." },
        },
        required: ["threadId"],
        additionalProperties: false,
      },
      annotations: { title: "Interrupt a Glade thread", ...WRITE_TOOL_ANNOTATIONS },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const threadId = readStringArg(args, "threadId", { required: true })!;
        const caller = yield* requireThreadShell(context.callerThreadId);
        const target = yield* requireThreadShell(threadId);

        yield* assertCallerMayDriveThread(caller, target);
        const activeTurnId = target.session?.activeTurnId ?? null;
        const hadActiveTurn = activeTurnId !== null || target.latestTurn?.state === "running";
        const dispatched = yield* orchestrationEngine
          .dispatch({
            type: "thread.turn.interrupt",
            commandId: CommandId.makeUnsafe(`agent:${randomUUID()}:interrupt`),
            threadId: target.id,
            createdAt: isoNow(),
          })
          .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));

        return mcpToolResultJson({
          threadId: target.id,
          interruptRequested: true,
          hadActiveTurn,
          activeTurnId,
          eventSequence: dispatched.sequence,
        });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  const setThreadTitle: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_set_thread_title",
      description: "Rename a Glade thread.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Thread to rename." },
          title: { type: "string", description: "New title." },
        },
        required: ["threadId", "title"],
        additionalProperties: false,
      },
      annotations: { title: "Rename a Glade thread", ...WRITE_TOOL_ANNOTATIONS },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const threadId = readStringArg(args, "threadId", { required: true })!;
        const title = readStringArg(args, "title", { required: true })!;
        const caller = yield* requireThreadShell(context.callerThreadId);
        const target = yield* requireThreadShell(threadId);
        yield* assertCallerMayDriveThread(caller, target);
        yield* orchestrationEngine
          .dispatch({
            type: "thread.meta.update",
            commandId: CommandId.makeUnsafe(`agent:${randomUUID()}:rename`),
            threadId: target.id,
            title,
          })
          .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));
        return mcpToolResultJson({ threadId: target.id, title });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  const setThreadPullRequest: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_set_thread_pull_request",
      description:
        "Associate a PR with the Glade thread that owns its deliverable. Use after successfully creating that PR. A PR only reviewed, referenced or discussed must not be associated.\nThis tool records an association; it does not create, push or merge a PR. Confirm the association result and report any failure rather than claiming the PR is linked.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "Deliverable owner; defaults to the caller's thread when omitted.",
          },
          reference: {
            type: "string",
            description: "GitHub PR URL or number resolvable in the owning thread's repository.",
          },
        },
        required: ["reference"],
        additionalProperties: false,
      },
      annotations: { title: "Associate a pull request", ...WRITE_TOOL_ANNOTATIONS },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const threadId = readStringArg(args, "threadId") ?? context.callerThreadId;
        const reference = readStringArg(args, "reference", { required: true })!;
        const caller = yield* requireThreadShell(context.callerThreadId);
        const target = yield* requireThreadShell(threadId);
        yield* assertCallerMayDriveThread(caller, target);

        const project = Option.getOrUndefined(
          yield* snapshotQuery
            .getProjectShellById(target.projectId)
            .pipe(Effect.mapError((error) => new ToolInputError(errorText(error)))),
        );
        if (!project) {
          return yield* Effect.fail(
            new ToolInputError(`Project for thread "${threadId}" was not found.`),
          );
        }
        const cwd = resolveThreadWorkspaceCwd({ thread: target, projects: [project] });
        if (!cwd) {
          return yield* Effect.fail(
            new ToolInputError(`Git workspace for thread "${threadId}" is unavailable.`),
          );
        }

        const { pullRequest } = yield* gitManager
          .resolvePullRequest({ cwd, reference })
          .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));
        yield* orchestrationEngine
          .dispatch({
            type: "thread.meta.update",
            commandId: CommandId.makeUnsafe(`agent:${randomUUID()}:pull-request`),
            threadId: target.id,
            lastKnownPr: pullRequest,
          })
          .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));
        return mcpToolResultJson({ threadId: target.id, pullRequest });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  const setThreadArchived: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_set_thread_archived",
      description:
        "Archive or unarchive a Glade thread. Defaults to your own thread when threadId is omitted.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Thread to archive/unarchive." },
          archived: { type: "boolean", description: "true to archive, false to unarchive." },
        },
        required: ["archived"],
        additionalProperties: false,
      },
      annotations: { title: "Update a Glade thread", ...WRITE_TOOL_ANNOTATIONS },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const threadId = readStringArg(args, "threadId") ?? context.callerThreadId;
        const archived = readBooleanArg(args, "archived");
        if (archived === undefined) {
          throw new ToolInputError(`Missing required argument "archived".`);
        }
        const caller = yield* requireThreadShell(context.callerThreadId);
        const target = yield* requireThreadShell(threadId);
        yield* assertCallerMayDriveThread(caller, target);
        yield* orchestrationEngine
          .dispatch({
            type: archived ? "thread.archive" : "thread.unarchive",
            commandId: CommandId.makeUnsafe(`agent:${randomUUID()}:archive`),
            threadId: target.id,
          })
          .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));
        if (archived) {
          yield* Effect.forkDetach(
            pruneProjectedArchivedManagedWorktrees({
              homeDir: serverConfig.homeDir,
              worktreesDir: serverConfig.worktreesDir,
              snapshotQuery,
              git,
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("agent gateway managed worktree retention failed", {
                  cause: String(cause),
                }),
              ),
            ),
          );
        }
        return mcpToolResultJson({ threadId: target.id, archived });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  const tools: ReadonlyArray<ToolEntry> = [
    ...makeVisualReplyTools({
      preview: visualPreview,
      snapshots: snapshotQuery,
      engine: orchestrationEngine,
      attachments: managedAttachments,
      config: serverConfig,
    }),
    ...readTools,
    ...makeThreadDiffTools(diffs, snapshotQuery),
    makeForkThreadTool(orchestrationEngine, snapshotQuery, eventStore),
    makeAppPresentationTool(presentation, snapshotQuery, fs, path),
    ...diagnosticTools,
    createThreads,
    createThread,
    sendMessage,
    interruptThread,
    setThreadTitle,
    setThreadPullRequest,
    setThreadArchived,
  ];

  return {
    handleMcpPost: makeAgentGatewayMcpTransport({
      credentials,
      snapshotQuery,
      tools,
      instructions: AGENT_GATEWAY_INSTRUCTIONS,
      requireThreadShell,
    }),
  } satisfies AgentGatewayShape;
});

export const AgentGatewayLive = Layer.effect(AgentGateway, makeAgentGateway);
