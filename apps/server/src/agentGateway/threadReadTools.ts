import { GladeListThreadsInput } from "@glade/contracts/provider/agentGatewayDiscovery";
import type { AgentGatewayDiscoveryShape } from "./Services/AgentGatewayDiscovery";
import type { OrchestrationEventStoreShape } from "../persistence/Services/OrchestrationEventStore";
import { readHandoffSourceSnapshot } from "../orchestration/handoff/sourceSnapshot";
import type { TaggedFailure } from "../platform/operationError.ts";
import { GLADE_GATEWAY_MAX_THREADS_PER_OPERATION } from "@glade/contracts/provider/agentGateway";
import { ThreadId, TurnId, type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationThreadShell } from "@glade/contracts/orchestration/threadEntities";
import { Effect, Option, Schema } from "effect";

import {
  isOrdinaryProjectRow,
  type SpaceAssignmentWorkspacePaths,
} from "../orchestration/commandInvariants.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProjectionTurnRepositoryShape } from "../persistence/Services/ProjectionTurns.ts";
import type { ProviderDiscoveryServiceShape } from "../provider/Services/ProviderDiscoveryService.ts";
import { GLADE_HARNESS_POLICY_VERSION } from "./harnessPolicy.ts";
import { mcpToolResultError, mcpToolResultJson, toolInputSchema } from "./protocol.ts";
import {
  agentGatewayTargetOptionGuidance,
  loadAgentGatewayProviderCatalog,
  type AgentGatewayProviderAvailability,
} from "./targetResolver.ts";
import {
  READ_THREAD_MAX_MESSAGE_CHARS,
  READ_THREAD_MAX_MESSAGE_LIMIT,
  summarizeThreadDetail,
  summarizeThreadShell,
  summarizeWaitThreadText,
  WAIT_THREAD_SUMMARY_MAX_CHARS,
} from "./threadSummary.ts";
import {
  decodeWaitForThreadsInput,
  errorText,
  PROVIDER_KINDS,
  readNumberArg,
  readStringArg,
  ToolInputError,
} from "./toolInput.ts";
import {
  gatewayToolErrorResult,
  GatewayToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolEntry,
} from "./toolRuntime.ts";

export interface ThreadReadToolsInput {
  readonly eventStore: OrchestrationEventStoreShape;
  readonly discovery: AgentGatewayDiscoveryShape;
  readonly snapshotQuery: ProjectionSnapshotQueryShape;
  readonly projectionTurns: ProjectionTurnRepositoryShape;
  readonly providerDiscovery: ProviderDiscoveryServiceShape;
  readonly loadProviderAvailabilities: Effect.Effect<
    ReadonlyMap<ProviderKind, AgentGatewayProviderAvailability>,
    TaggedFailure,
    never
  >;
  readonly requireThreadShell: (
    threadId: string,
  ) => Effect.Effect<OrchestrationThreadShell, TaggedFailure, never>;
  readonly workspacePaths: SpaceAssignmentWorkspacePaths;
}

export function makeThreadReadTools(input: ThreadReadToolsInput): ReadonlyArray<ToolEntry> {
  const {
    discovery,
    snapshotQuery,
    projectionTurns,
    providerDiscovery,
    loadProviderAvailabilities,
    requireThreadShell,
    workspacePaths,
  } = input;

  const contextTool: ToolEntry = {
    requiredCapability: "thread:read",
    definition: {
      name: "glade_context",
      description:
        "Inspect the current Glade harness identity, caller thread/turn, and authorized coordination capabilities.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: {
        title: "Glade context",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    handler: (_args, context) =>
      Effect.gen(function* () {
        const caller = yield* requireThreadShell(context.callerThreadId);
        const turnId = caller.latestTurn?.state === "running" ? caller.latestTurn.turnId : null;
        return mcpToolResultJson({
          harness: { name: "Glade", policyVersion: GLADE_HARNESS_POLICY_VERSION },
          caller: {
            threadId: caller.id,
            turnId,
            provider: context.callerProvider,
            projectId: caller.projectId,
          },
          capabilities: {
            threadRead: context.callerCapabilities.has("thread:read"),
            threadCreate: turnId !== null && context.callerCapabilities.has("thread:write"),
            threadWait: context.callerCapabilities.has("thread:read"),
            diagnostics: context.callerCapabilities.has("diagnostics:read"),
          },
        });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  const capabilitiesTool: ToolEntry = {
    requiredCapability: "thread:read",
    definition: {
      name: "glade_capabilities",
      description:
        "Discover canonical provider/model targets, provider option contracts and limits for Glade thread creation. Use returned providers[].models[].slug values for model identifiers and check availability before selecting a requested target. Do not guess a slug or silently switch models.\n\nFor the selected provider/model, use targetConstruction[provider].optionsByModel[model] when supplied, otherwise providerOptions. Preserve exact option keys and valueType; use allowedValues unless allowsCustomValue explicitly permits another value. Omit options the user did not request to inherit provider settings. Do not drop or substitute an explicitly requested unsupported option; report the mismatch.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: {
        title: "Glade capabilities",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    handler: (_args, context) =>
      Effect.gen(function* () {
        const caller = yield* requireThreadShell(context.callerThreadId);
        const project = yield* snapshotQuery.getProjectShellById(caller.projectId).pipe(
          Effect.mapError((error) => new ToolInputError(errorText(error))),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new ToolInputError(`Project "${caller.projectId}" was not found.`)),
              onSome: Effect.succeed,
            }),
          ),
        );
        const availabilities = yield* loadProviderAvailabilities;
        const providers = yield* Effect.forEach(PROVIDER_KINDS, (provider) =>
          loadAgentGatewayProviderCatalog({
            provider,
            discovery: providerDiscovery,
            ...(availabilities.get(provider) !== undefined
              ? { availability: availabilities.get(provider)! }
              : {}),
            cwd: project.workspaceRoot,
          }),
        );
        const targetConstruction = Object.fromEntries(
          providers.map((provider) => [
            provider.provider,
            {
              modelValueSource: "providers[].models[].slug",
              ...agentGatewayTargetOptionGuidance(provider),
            },
          ]),
        );
        return mcpToolResultJson({
          targetConstruction,
          providers,
          limits: {
            maxThreadsPerOperation: GLADE_GATEWAY_MAX_THREADS_PER_OPERATION,
            maxWaitMs: 60_000,
            oneCreationPlanPerActiveTurn: true,
          },
        });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  const listProjects: ToolEntry = {
    requiredCapability: "thread:read",
    definition: {
      name: "glade_list_projects",
      description:
        "List Glade projects with their ids, titles and workspace roots. The system-managed Chats container is excluded.\nUse this tool before creating a thread in another project. Match the requested project to returned evidence; do not invent a projectId or choose between ambiguous matches without resolving the ambiguity.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "List Glade projects", ...READ_ONLY_TOOL_ANNOTATIONS },
    },
    handler: () =>
      discovery.listProjects.pipe(
        Effect.map((projects) =>
          mcpToolResultJson({
            projects: projects
              .filter((project) =>
                isOrdinaryProjectRow({
                  projectKind: project.kind,
                  projectTitle: project.title,
                  projectWorkspaceRoot: project.workspaceRoot,
                  workspacePaths,
                }),
              )
              .map((project) => ({
                projectId: project.id,
                title: project.title,
                workspaceRoot: project.workspaceRoot,
                isPinned: project.isPinned,
              })),
          }),
        ),
        Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error)))),
      ),
  };

  const listThreads: ToolEntry = {
    requiredCapability: "thread:read",
    definition: {
      name: "glade_list_threads",
      description:
        "Discover Glade threads by project, hierarchy, provider, model, status, title, creation source, or update window. Archived threads are hidden unless includeArchived is true. Returns 20 threads by default (maximum 100). Follow nextCursor with unchanged filters to retrieve older results; active threads can move forward between pages.",
      inputSchema: toolInputSchema(GladeListThreadsInput),
      annotations: { title: "List Glade threads", ...READ_ONLY_TOOL_ANNOTATIONS },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const page = yield* discovery.listThreads(
          Schema.decodeUnknownSync(GladeListThreadsInput)(args),
        );
        return mcpToolResultJson({
          threads: page.threads.map((thread) =>
            summarizeThreadShell(thread, context.callerThreadId),
          ),
          nextCursor: page.nextCursor,
        });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  const readThread: ToolEntry = {
    requiredCapability: "thread:read",
    definition: {
      name: "glade_read_thread",
      description:
        "Read one Glade thread's status and conversation. Use this for user requests, assistant replies and reported task results; use activity/runtime tools for execution evidence absent from the transcript.\nTranscript pages are newest-last. Pass returned nextCursor as cursor to read older messages. A bounded message summary is not its complete text.\nFor a settled message that needs full inspection, pass messageIndex from its returned summary index, plus messageId and messageVersion with messageOffsetChars 0. Follow messagePage.nextOffsetChars using that same identity and version until absent. If coordinates are stale, refresh the summary instead of combining slices from different versions.\nFor frozen handoff evidence, keep throughSequence unchanged on every page. Later history is excluded; frozen evidence does not prove current workspace state.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Thread to read." },
          cursor: {
            type: "string",
            description: "Opaque nextCursor from a previous transcript page; do not construct one.",
          },
          throughSequence: {
            type: "integer",
            minimum: 1,
            description: "Frozen handoff event boundary, unchanged throughout retrieval.",
          },
          messageLimit: {
            type: "integer",
            minimum: 1,
            maximum: READ_THREAD_MAX_MESSAGE_LIMIT,
            description: `Transcript messages per page; default 20, maximum ${READ_THREAD_MAX_MESSAGE_LIMIT}.`,
          },
          maxMessageChars: {
            type: "integer",
            minimum: 50,
            maximum: READ_THREAD_MAX_MESSAGE_CHARS,
            description: `Characters per summary or single-message slice; default 1500, maximum ${READ_THREAD_MAX_MESSAGE_CHARS}. Inspect the reported effective value.`,
          },
          messageIndex: {
            type: "integer",
            minimum: 0,
            description:
              "Returned index of the settled message; requires its messageId and messageVersion.",
          },
          messageOffsetChars: {
            type: "integer",
            minimum: 0,
            description:
              "Character offset for that message; start at 0 and follow messagePage.nextOffsetChars.",
          },
          messageId: {
            type: "string",
            description: "Returned message identity, required for messageIndex.",
          },
          messageVersion: {
            type: "string",
            description:
              "Returned snapshot version, required for messageIndex and unchanged across its slices.",
          },
        },
        required: ["threadId"],
        additionalProperties: false,
      },
      annotations: { title: "Read a Glade thread", ...READ_ONLY_TOOL_ANNOTATIONS },
    },
    handler: (args, _context) =>
      Effect.gen(function* () {
        const threadId = readStringArg(args, "threadId", { required: true })!;
        const cursor = readStringArg(args, "cursor");
        const messageLimit = readNumberArg(args, "messageLimit");
        const maxMessageChars = readNumberArg(args, "maxMessageChars");
        const messageIndex = readNumberArg(args, "messageIndex");
        const messageOffsetChars = readNumberArg(args, "messageOffsetChars");
        const messageId = readStringArg(args, "messageId");
        const messageVersion = readStringArg(args, "messageVersion");
        const throughSequence = readNumberArg(args, "throughSequence");
        const detail = yield* snapshotQuery.getThreadDetailById(ThreadId.makeUnsafe(threadId)).pipe(
          Effect.mapError((error) => new ToolInputError(errorText(error))),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new ToolInputError(`Thread "${threadId}" was not found.`)),
              onSome: (thread) => Effect.succeed(thread),
            }),
          ),
        );
        return mcpToolResultJson(
          summarizeThreadDetail({
            thread:
              throughSequence === undefined
                ? detail
                : yield* readHandoffSourceSnapshot(
                    input.eventStore,
                    ThreadId.makeUnsafe(threadId),
                    throughSequence,
                  ),
            cursor,
            messageLimit,
            maxMessageChars,
            messageIndex,
            messageOffsetChars,
            messageId,
            messageVersion,
          }),
        );
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  const waitForThreads: ToolEntry = {
    requiredCapability: "thread:read",
    definition: {
      name: "glade_wait_for_threads",
      description: `Wait for pinned turns of 1-20 Glade threads. Outcomes are returned in input order. Inspect each outcome's status; a failed or interrupted turn is not a successful task.
Reuse returned pinned runIds when continuing the same wait so a later turn is not mistaken for the requested run. On timeout, preserve the targets and pins and continue waiting when results are still requested; timeout never retries, replaces, cancels or creates work.
Assistant summaries are capped at ${WAIT_THREAD_SUMMARY_MAX_CHARS} characters. Use each result's supplied readThread call and lossless message pages when the full output is needed to assess or synthesize results. Report every requested outcome, including failures and unresolved work.`,
      inputSchema: {
        type: "object",
        properties: {
          threadIds: {
            type: "array",
            minItems: 1,
            maxItems: GLADE_GATEWAY_MAX_THREADS_PER_OPERATION,
            items: { type: "string" },
          },
          runIds: {
            type: "array",
            maxItems: GLADE_GATEWAY_MAX_THREADS_PER_OPERATION,
            items: { type: ["string", "null"] },
            description:
              "Optional pinned turn ids from an earlier wait; must match threadIds length and order.",
          },
          timeoutMs: {
            type: "integer",
            minimum: 0,
            maximum: 60_000,
            description:
              "Long-poll duration; default 30000ms. A timeout is a progress result, not task completion.",
          },
        },
        required: ["threadIds"],
        additionalProperties: false,
      },
      annotations: {
        title: "Wait for Glade threads",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const waitInput = decodeWaitForThreadsInput(args);
        if (waitInput.runIds && waitInput.runIds.length !== waitInput.threadIds.length) {
          throw new ToolInputError('Argument "runIds" must have the same length as "threadIds".');
        }
        const timeoutMs = waitInput.timeoutMs ?? 30_000;
        const deadline = Date.now() + timeoutMs;
        const pinned = yield* Effect.forEach(waitInput.threadIds, (threadId, index) =>
          snapshotQuery.getThreadShellById(threadId).pipe(
            Effect.mapError((error) => new ToolInputError(errorText(error))),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new GatewayToolError("thread_not_found", `Thread "${threadId}" was not found.`),
                  ),
                onSome: (thread) =>
                  Effect.succeed({
                    threadId,
                    runId: waitInput.runIds?.[index] ?? thread.latestTurn?.turnId ?? null,
                    shell: thread,
                  }),
              }),
            ),
          ),
        );

        const initialStateByKey = new Map(
          pinned.map((pin) => {
            const shell = pin.shell;
            return [
              `${pin.threadId}\u0000${pin.runId ?? ""}`,
              shell.latestTurn?.turnId === pin.runId ? shell.latestTurn.state : "pending",
            ] as const;
          }),
        );
        const readPinnedStates = () =>
          projectionTurns
            .getManyWaitSnapshot({
              threadIds: pinned.map((pin) => ThreadId.makeUnsafe(pin.threadId)),
              turns: pinned.flatMap((pin) =>
                pin.runId === null
                  ? []
                  : [{ threadId: pin.threadId, turnId: TurnId.makeUnsafe(pin.runId) }],
              ),
            })
            .pipe(
              Effect.mapError((error) => new ToolInputError(errorText(error))),
              Effect.flatMap((snapshot) => {
                const existingThreadIds = new Set(snapshot.existingThreadIds);
                const missing = pinned.find((pin) => !existingThreadIds.has(pin.threadId));
                if (missing) {
                  return Effect.fail(
                    new GatewayToolError(
                      "thread_not_found",
                      `Thread "${missing.threadId}" was not found.`,
                    ),
                  );
                }
                const turnsByKey = new Map(
                  snapshot.turns.map(
                    (turn) => [`${turn.threadId}\u0000${turn.turnId}`, turn] as const,
                  ),
                );
                return Effect.succeed(
                  pinned.map((pin) => {
                    const state =
                      pin.runId === null
                        ? ("idle" as const)
                        : (turnsByKey.get(`${pin.threadId}\u0000${pin.runId}`)?.state ??
                          initialStateByKey.get(`${pin.threadId}\u0000${pin.runId}`) ??
                          "pending");
                    const terminal =
                      state === "idle" ||
                      state === "completed" ||
                      state === "error" ||
                      state === "interrupted";
                    return {
                      threadId: pin.threadId,
                      runId: pin.runId,
                      state,
                      terminal,
                      timedOut: false,
                      summary: null as string | null,
                      summaryTruncated: false,
                      error: null as string | null,
                      readThread: {
                        tool: "glade_read_thread" as const,
                        arguments: { threadId: pin.threadId },
                      },
                    };
                  }),
                );
              }),
            );

        let results = yield* readPinnedStates();
        let pollDelayMs = 200;
        while (results.some((result) => !result.terminal) && Date.now() < deadline) {
          yield* Effect.sleep(Math.min(pollDelayMs, Math.max(1, deadline - Date.now())));
          results = yield* readPinnedStates();
          pollDelayMs = Math.min(1_000, Math.ceil(pollDelayMs * 1.5));
        }
        const timedOut = results.some((result) => !result.terminal);
        const finalResults = yield* Effect.forEach(results, (result) =>
          Effect.gen(function* () {
            if (!result.terminal || result.runId === null) {
              return { ...result, timedOut: !result.terminal && timedOut };
            }
            const detail = yield* snapshotQuery.getThreadDetailById(result.threadId).pipe(
              Effect.mapError((error) => new ToolInputError(errorText(error))),
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      new GatewayToolError(
                        "thread_not_found",
                        `Thread "${result.threadId}" was not found.`,
                      ),
                    ),
                  onSome: Effect.succeed,
                }),
              ),
            );
            const assistantMessage = detail.messages.findLast(
              (message) => message.role === "assistant" && message.turnId === result.runId,
            );
            const summary = summarizeWaitThreadText(assistantMessage?.text);
            return {
              ...result,
              timedOut: false,
              summary: summary.summary,
              summaryTruncated: summary.truncated,
              error:
                result.state === "error" ? (detail.session?.lastError ?? "Turn failed.") : null,
            };
          }),
        );
        return mcpToolResultJson({
          callerThreadId: context.callerThreadId,
          runIds: pinned.map((pin) => pin.runId),
          allTerminal: finalResults.every((result) => result.terminal),
          timedOut,
          threads: finalResults,
        });
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            error instanceof GatewayToolError
              ? gatewayToolErrorResult(error)
              : mcpToolResultError(errorText(error)),
          ),
        ),
      ),
  };

  return [contextTool, capabilitiesTool, listProjects, listThreads, readThread, waitForThreads];
}
