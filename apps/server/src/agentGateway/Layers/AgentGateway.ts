import { computerSpaceDesignationForMessages } from "../../computer/computerSpaceDesignation.ts";
import { randomUUID } from "node:crypto";

import {
  COMPUTER_SETUP_REQUIRED_ACTIVITY_KIND,
  COMPUTER_CONTROL_DENIED_ACTIVITY_KIND,
  type ComputerBuildSignature,
  type ComputerPermission,
  type ComputerSetupRequiredPayload,
} from "@glade/contracts/computer/computer";
import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type ProviderKind,
} from "@glade/contracts/core/baseSchemas";
import { GLADE_GATEWAY_MAX_THREADS_PER_OPERATION } from "@glade/contracts/provider/agentGateway";

import {
  type ProviderApprovalDecision,
  type RuntimeMode,
  type TurnDispatchMode,
} from "@glade/contracts/provider/sessionPolicy";
import { type ServerProviderStatus } from "@glade/contracts/server/server";
import { runtimeModeEscalatesPrivilege } from "@glade/shared/threads/runtimeMode";
import { Effect, Layer, Option } from "effect";

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
import {
  AGENT_GATEWAY_TARGET_OPTIONS_DESCRIPTION,
  type AgentGatewayProviderAvailability,
} from "../targetResolver.ts";
import { mcpToolResultError, mcpToolResultJson } from "../protocol.ts";
import { gatewayIsoNow as isoNow, stableGatewayDigest } from "../creationUtils.ts";
import {
  MODEL_SELECTION_INPUT_SCHEMA,
  PROVIDER_KINDS,
  ToolInputError,
  buildModelSelection,
  decodeCreateThreadsInput,
  errorText,
  parseProviderKind,
  readBooleanArg,
  readRecordArg,
  readStringArg,
} from "../toolInput.ts";
import { WRITE_TOOL_ANNOTATIONS, type ToolContext, type ToolEntry } from "../toolRuntime.ts";
import { makeAgentGatewayMcpTransport } from "../mcpTransport.ts";
import { deliverGatewayCompletions } from "../completionDelivery.ts";
import { recoverInterruptedAgentGatewayOperations } from "../startupRecovery.ts";
import { makeCreateThreadsHandler } from "../creationCoordinator.ts";
import { makeAgentGatewayBrowserTools } from "../browserTools.ts";
import { makeAgentGatewayComputerBrowserTools } from "../computerBrowserTools.ts";
import { computerApprovalDisplayArgs } from "../computerApprovalDisplay.ts";
import {
  COMPUTER_CONTROL_CAPABILITY,
  makeAgentGatewayComputerTools,
  type AgentGatewayComputerToolsOptions,
} from "../computerTools.ts";
import { isGladeComputerToolFamilyName } from "../computerToolPermission.ts";
import { ComputerService } from "../../computer/Services/ComputerService.ts";
import { computerApprovalGate } from "../../computer/ComputerApprovalGate.ts";
import { makeComputerForegroundConsent } from "../computerForegroundConsent.ts";
import { BrowserAutomationHost } from "../../browserAutomation/Services/BrowserAutomationHost.ts";
import { makeBrowserAutomationHost } from "../../browserAutomation/Layers/BrowserAutomationHost.ts";
import { makeThreadReadTools } from "../threadReadTools.ts";
import { makeThreadDiagnosticTools } from "../threadDiagnosticTools.ts";
import { pruneProjectedArchivedManagedWorktrees } from "../../git/managedWorktrees.ts";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";

// Providers already receive the versioned host policy exactly once in their private prompt. MCP
// clients prepend initialize.instructions to every exposed tool definition, so repeating the full
// policy here adds tens of thousands of context characters per round without adding authority or
// safety.
const AGENT_GATEWAY_INSTRUCTIONS =
  "Glade tools are thread-scoped. Use browser_* only for Glade's shared in-app browser runtime; follow the provider-delivered <glade_host_context> for full policy.";

const makeAgentGateway = Effect.gen(function* () {
  const credentials = yield* AgentGatewayCredentials;
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
  const browserAutomationHost = Option.getOrElse(
    yield* Effect.serviceOption(BrowserAutomationHost),
    () => makeBrowserAutomationHost({}),
  );
  const computerService = Option.getOrUndefined(yield* Effect.serviceOption(ComputerService));
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
        "Create an exact batch of 1–20 standalone Glade threads. Worktree threads start on a Glade-managed temporary branch pinned at baseRef (or the selected checkout's HEAD) and copy local checkout changes plus .worktreeinclude files when the ref is that checkout's HEAD; on the first turn Glade may rename the branch after the prompt and publish it. Validation/preflight failures create nothing and may be corrected with the same requestId; durable retries replay the exact operation.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            maxLength: 256,
            description: "Stable id for this exact user-requested creation plan.",
          },
          threads: {
            type: "array",
            minItems: 1,
            maxItems: GLADE_GATEWAY_MAX_THREADS_PER_OPERATION,
            items: {
              type: "object",
              properties: {
                notifyCreatorOnComplete: {
                  type: "boolean",
                  description:
                    "Passively return the initial run result to this creating thread. Does not wake the creator.",
                },
                prompt: { type: "string" },
                title: { type: "string" },
                target: {
                  ...MODEL_SELECTION_INPUT_SCHEMA,
                },
                projectId: { type: "string" },
                environment: { type: "string", enum: ["local", "worktree"] },
                baseRef: {
                  type: "string",
                  description:
                    "Local Git revision, #PR, or GitHub pull-request URL the worktree is pinned at. Defaults to the selected checkout's HEAD.",
                },
                runtimeMode: {
                  type: "string",
                  enum: ["approval-required", "full-access"],
                },
              },
              required: ["prompt", "target"],
              additionalProperties: false,
            },
          },
        },
        required: ["requestId", "threads"],
        additionalProperties: false,
      },
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
        "Create exactly one standalone Glade thread. Worktree threads start on a Glade-managed temporary branch pinned at baseRef; on the first turn Glade may rename the branch after the prompt and publish it. For two or more threads use one glade_create_threads call instead.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: { type: "string", maxLength: 256 },
          notifyCreatorOnComplete: {
            type: "boolean",
            description:
              "Passively return the initial run result to this creating thread. Does not wake the creator.",
          },
          prompt: { type: "string" },
          title: { type: "string" },
          target: {
            ...MODEL_SELECTION_INPUT_SCHEMA,
          },
          provider: { type: "string", enum: [...PROVIDER_KINDS] },
          model: { type: "string" },
          options: {
            type: "object",
            description: AGENT_GATEWAY_TARGET_OPTIONS_DESCRIPTION,
          },
          projectId: { type: "string" },
          environment: { type: "string", enum: ["local", "worktree"] },
          baseRef: {
            type: "string",
            description:
              "Local Git revision, #PR, or GitHub pull-request URL the worktree is pinned at. Defaults to the selected checkout's HEAD.",
          },
          runtimeMode: {
            type: "string",
            enum: ["approval-required", "full-access"],
          },
        },
        required: ["requestId", "prompt"],
        additionalProperties: false,
      },
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
        const explicitTarget = readRecordArg(args, "target");
        let target: Record<string, unknown>;
        if (explicitTarget) {
          target = explicitTarget;
        } else {
          const provider = parseProviderKind(readStringArg(args, "provider", { required: true })!);
          let model = readStringArg(args, "model");
          if (!model) {
            const catalog = yield* providerDiscovery.listModels({ provider });
            model = catalog.models.find((entry) => entry.isDefault)?.slug;
          }
          const modelSelection = buildModelSelection(provider, model);
          const options = readRecordArg(args, "options");
          target = { ...modelSelection, ...(options ? { options } : {}) };
        }
        const spec: Record<string, unknown> = {
          prompt: readStringArg(args, "prompt", { required: true })!,
          target,
        };
        for (const key of [
          "title",
          "projectId",
          "environment",
          "baseRef",
          "baseBranch",
          "branchName",
          "runtimeMode",
          "notifyCreatorOnComplete",
        ]) {
          const value = args[key];
          if (value !== undefined) spec[key] = value;
        }
        return yield* runCreateThreads(
          decodeCreateThreadsInput({
            requestId: readStringArg(args, "requestId", { required: true }),
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
        "Associate a pull request with a Glade thread. Use this after successfully creating the pull request that represents that thread's own deliverable. Do not associate pull requests that the thread only reviews, references, or discusses. Defaults to your own thread when threadId is omitted.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "Thread that owns the pull request. Defaults to your own thread.",
          },
          reference: {
            type: "string",
            description: "GitHub pull request URL or number resolvable from the thread repository.",
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

  const resolveWorkspaceRoot = (context: ToolContext) =>
    Effect.gen(function* () {
      const thread = yield* requireThreadShell(context.callerThreadId);
      const project = yield* snapshotQuery
        .getProjectShellById(thread.projectId)
        .pipe(Effect.map(Option.getOrNull));
      if (!project) return null;
      return (
        resolveThreadWorkspaceCwd({
          thread,
          projects: [project],
        }) ?? null
      );
    }).pipe(Effect.orElseSucceed(() => null));
  const browserTools = makeAgentGatewayBrowserTools(browserAutomationHost, {
    resolveWorkspaceRoot,
  });

  const surfacedComputerControlDenials = new Set<string>();
  const SURFACED_DENIALS_MAX = 512;
  const surfaceCapabilityDenial: NonNullable<
    Parameters<typeof makeAgentGatewayMcpTransport>[0]["onCapabilityDenied"]
  > = (denial) => {
    if (denial.requiredCapability !== COMPUTER_CONTROL_CAPABILITY) return Effect.void;
    const dedupeKey = `${denial.callerThreadId}:${denial.callerTurnId ?? "no-turn"}:${denial.toolName}`;
    if (surfacedComputerControlDenials.has(dedupeKey)) return Effect.void;

    while (surfacedComputerControlDenials.size >= SURFACED_DENIALS_MAX) {
      surfacedComputerControlDenials.delete(surfacedComputerControlDenials.keys().next().value!);
    }
    surfacedComputerControlDenials.add(dedupeKey);
    const marker = stableGatewayDigest({
      kind: "computer-control-denied",
      threadId: denial.callerThreadId,
      turnId: denial.callerTurnId,

      toolName: denial.toolName,
    });
    const createdAt = isoNow();
    return orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe(`agent:${marker}:computer-control-denied`),
        threadId: ThreadId.makeUnsafe(denial.callerThreadId),
        activity: {
          id: EventId.makeUnsafe(`gateway:${marker}:computer-control-denied`),
          tone: "error",
          kind: COMPUTER_CONTROL_DENIED_ACTIVITY_KIND,
          summary: "Computer control is off for this chat",
          payload: { toolName: denial.toolName },
          turnId: denial.callerTurnId === null ? null : TurnId.makeUnsafe(denial.callerTurnId),
          createdAt,
        },
        createdAt,
      })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("agent gateway could not surface computer-control denial", {
            callerThreadId: denial.callerThreadId,
            toolName: denial.toolName,
            error: errorText(error),
          }),
        ),
        Effect.asVoid,
      );
  };

  const COMPUTER_CONTROL_ON_DISCLOSURE =
    "Computer control ON for this turn: the agent is driving the desktop and the user can switch it off in Settings.";
  const surfacedComputerControlDisclosures = new Set<string>();
  const SURFACED_CONTROL_DISCLOSURES_MAX = 512;
  const surfaceComputerControlDisclosure = (
    threadId: string,
    turnId: string | null,
  ): Effect.Effect<void> => {
    const dedupeKey = `${threadId}:${turnId ?? "no-turn"}`;
    if (surfacedComputerControlDisclosures.has(dedupeKey)) return Effect.void;
    while (surfacedComputerControlDisclosures.size >= SURFACED_CONTROL_DISCLOSURES_MAX) {
      surfacedComputerControlDisclosures.delete(
        surfacedComputerControlDisclosures.keys().next().value!,
      );
    }
    surfacedComputerControlDisclosures.add(dedupeKey);
    const marker = stableGatewayDigest({
      kind: "computer-control-disclosure",
      threadId,
      turnId,
    });
    const createdAt = isoNow();
    return orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe(`agent:${marker}:computer-control-on`),
        threadId: ThreadId.makeUnsafe(threadId),
        activity: {
          id: EventId.makeUnsafe(`gateway:${marker}:computer-control-on`),
          tone: "info",
          kind: "computer.control-disclosure",
          summary: COMPUTER_CONTROL_ON_DISCLOSURE,
          payload: { disclosure: COMPUTER_CONTROL_ON_DISCLOSURE },
          turnId: turnId === null ? null : TurnId.makeUnsafe(turnId),
          createdAt,
        },
        createdAt,
      })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("agent gateway could not surface computer-control disclosure", {
            callerThreadId: threadId,
            error: errorText(error),
          }),
        ),
        Effect.asVoid,
      );
  };

  const surfacedComputerSetupPrompts = new Set<string>();
  const SURFACED_SETUP_PROMPTS_MAX = 512;
  const surfaceComputerSetupRequired = (input: {
    readonly toolName: string;
    readonly missing: readonly ComputerPermission[];
    readonly buildSignature?: ComputerBuildSignature;

    readonly bundleId?: string;
    readonly context: ToolContext;
  }): Effect.Effect<void> => {
    const callerThreadId = input.context.callerThreadId;
    const callerTurnId = input.context.callerTurnId;

    const missingKey = [...input.missing].toSorted().join(",");
    const dedupeKey = `${callerThreadId}:${callerTurnId ?? "no-turn"}:${missingKey}`;
    if (surfacedComputerSetupPrompts.has(dedupeKey)) return Effect.void;

    while (surfacedComputerSetupPrompts.size >= SURFACED_SETUP_PROMPTS_MAX) {
      surfacedComputerSetupPrompts.delete(surfacedComputerSetupPrompts.keys().next().value!);
    }
    surfacedComputerSetupPrompts.add(dedupeKey);
    const marker = stableGatewayDigest({
      kind: "computer-setup-required",
      threadId: callerThreadId,
      turnId: callerTurnId,

      missing: missingKey,
    });
    const createdAt = isoNow();
    return orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe(`agent:${marker}:computer-setup-required`),
        threadId: ThreadId.makeUnsafe(callerThreadId),
        activity: {
          id: EventId.makeUnsafe(`gateway:${marker}:computer-setup-required`),
          tone: "error",
          kind: COMPUTER_SETUP_REQUIRED_ACTIVITY_KIND,
          summary: "Computer control needs setup",
          // The grant names ride along so the card can say which permission is missing rather than "a
          // permission Glade needs"; an empty list is a backend that refused without naming one, and the card
          // falls back. The build signature rides with them because on a locally built copy the switch in
          // System Settings can already be on — its grant pinned to a binary a rebuild replaced — and the
          // card has to say so.
          payload: {
            toolName: input.toolName,
            missing: [...input.missing],
            ...(input.buildSignature === undefined ? {} : { buildSignature: input.buildSignature }),
            ...(input.bundleId === undefined ? {} : { bundleId: input.bundleId }),
          } satisfies ComputerSetupRequiredPayload,
          turnId: callerTurnId === null ? null : TurnId.makeUnsafe(callerTurnId),
          createdAt,
        },
        createdAt,
      })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("agent gateway could not surface a computer setup prompt", {
            callerThreadId,
            toolName: input.toolName,
            error: errorText(error),
          }),
        ),
        Effect.asVoid,
      );
  };

  const publishComputerApproval =
    (
      name: string,
      args: Record<string, unknown>,
      context: Parameters<NonNullable<AgentGatewayComputerToolsOptions["authorizeAction"]>>[2],
      approvalScope: "computer-task" | "computer-foreground" | undefined,
    ) =>
    async (requestId: string, decision?: ProviderApprovalDecision): Promise<void> => {
      const createdAt = isoNow();
      const eventKey = `${requestId}:${decision === undefined ? "open" : "resolved"}`;
      await Effect.runPromise(
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.makeUnsafe(eventKey),
          threadId: ThreadId.makeUnsafe(context.callerThreadId),
          activity: {
            id: EventId.makeUnsafe(eventKey),
            tone: "info",
            kind: decision === undefined ? "approval.requested" : "approval.resolved",
            summary:
              decision !== undefined
                ? "Computer approval resolved"
                : approvalScope === "computer-foreground"
                  ? "Show Computer on screen for this task"
                  : approvalScope === "computer-task"
                    ? "Allow Computer for this task"
                    : "Computer action needs approval",
            payload: {
              requestId,
              requestKind: "tool",
              requestType: "tool",
              toolName: name,
              toolParamsDisplay: computerApprovalDisplayArgs(args),
              sessionApprovalAvailable: false,
              ...(approvalScope !== undefined ? { approvalScope } : {}),
              ...(decision === undefined ? {} : { decision }),
            },
            turnId: context.callerTurnId ? TurnId.makeUnsafe(context.callerTurnId) : null,
            createdAt,
          },
          createdAt,
        }),
      );
    };

  const authorizeComputerAction: NonNullable<
    AgentGatewayComputerToolsOptions["authorizeAction"]
  > = async (name, args, context, signal) => {
    await Effect.runPromise(context.assertCallerTurnActive(), { signal });
    const caller = await Effect.runPromise(
      snapshotQuery.getThreadShellById(ThreadId.makeUnsafe(context.callerThreadId)),
      { signal },
    );
    if (Option.isNone(caller)) return false;

    if (caller.value.runtimeMode === "full-access") {
      await Effect.runPromise(
        surfaceComputerControlDisclosure(context.callerThreadId, context.callerTurnId),
        { signal },
      ).catch(() => undefined);
      return true;
    }
    const taskConsent = name !== "computer_read_clipboard" && context.callerTurnId !== null;
    const requestApproval = taskConsent
      ? computerApprovalGate.requestTask.bind(computerApprovalGate)
      : computerApprovalGate.request.bind(computerApprovalGate);
    const approved = await requestApproval({
      threadId: context.callerThreadId,
      turnId: context.callerTurnId ?? "",
      signal,
      publish: publishComputerApproval(
        name,
        args,
        context,
        taskConsent ? "computer-task" : undefined,
      ),
    });
    if (approved) {
      await Effect.runPromise(
        surfaceComputerControlDisclosure(context.callerThreadId, context.callerTurnId),
        { signal },
      ).catch(() => undefined);
    }
    return approved;
  };

  const {
    resolveForegroundAuthorization: resolveComputerForegroundAuthorization,
    requestForegroundConsent: requestComputerForegroundConsent,
  } = makeComputerForegroundConsent({
    gate: computerApprovalGate,
    loadMessages: async (threadId) => {
      const detail = await Effect.runPromise(
        snapshotQuery.getThreadDetailById(ThreadId.makeUnsafe(threadId)),
      );
      return Option.isNone(detail) ? undefined : detail.value.messages;
    },
    knownAppNames: () => computerService?.manager.observedAppNames() ?? [],
    publish: (name, args, context) =>
      publishComputerApproval(name, args, context, "computer-foreground"),
  });

  const resolveComputerSpaceDesignation: NonNullable<
    AgentGatewayComputerToolsOptions["resolveSpaceDesignation"]
  > = async (context) => {
    const detail = await Effect.runPromise(
      snapshotQuery.getThreadDetailById(ThreadId.makeUnsafe(context.callerThreadId)),
    );
    return Option.isNone(detail) ? [] : computerSpaceDesignationForMessages(detail.value.messages);
  };

  const computerBrowserTools =
    computerService?.supported === true && computerService.manager.supportsBrowser
      ? makeAgentGatewayComputerBrowserTools({
          manager: computerService.manager,
          authorizeAction: authorizeComputerAction,
          resolveForegroundAuthorization: resolveComputerForegroundAuthorization,
          requestForegroundConsent: requestComputerForegroundConsent,
          resolveWorkspaceRoot,
        })
      : [];

  const tools: ReadonlyArray<ToolEntry> = [
    ...readTools,
    ...diagnosticTools,
    createThreads,
    createThread,
    sendMessage,
    interruptThread,
    setThreadTitle,
    setThreadPullRequest,
    setThreadArchived,
    ...browserTools,
    ...(computerService?.supported === true
      ? makeAgentGatewayComputerTools({
          manager: computerService.manager,
          onSetupRequired: surfaceComputerSetupRequired,
          authorizeAction: authorizeComputerAction,
          resolveForegroundAuthorization: resolveComputerForegroundAuthorization,
          requestForegroundConsent: requestComputerForegroundConsent,
          resolveSpaceDesignation: resolveComputerSpaceDesignation,
          relatedTools: computerBrowserTools,
        })
      : []),
    ...computerBrowserTools,
  ];

  const computerToolNames = new Set(
    tools
      .filter((tool) => tool.requiredCapability === COMPUTER_CONTROL_CAPABILITY)
      .map((tool) => tool.definition.name),
  );

  return {
    handleMcpPost: makeAgentGatewayMcpTransport({
      credentials,
      snapshotQuery,
      tools,
      onCapabilityDenied: surfaceCapabilityDenial,

      isComputerToolName: (toolName) =>
        computerToolNames.has(toolName) || isGladeComputerToolFamilyName(toolName),
      computerControlCapability: COMPUTER_CONTROL_CAPABILITY,
      instructions: AGENT_GATEWAY_INSTRUCTIONS,
      requireThreadShell,
    }),
  } satisfies AgentGatewayShape;
});

export const AgentGatewayLive = Layer.effect(AgentGateway, makeAgentGateway);
