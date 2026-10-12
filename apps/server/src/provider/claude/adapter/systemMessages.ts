import { subagentName } from "@glade/shared/threads/subagentName";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { makeClaudeInteractionSettlement } from "./interactionSettlement";
import { makeClaudeWorkflowRuntime } from "./workflowRuntime";
import { Effect, FileSystem } from "effect";
import { EventId, RuntimeTaskId, RuntimeItemId } from "@glade/contracts/core/baseSchemas";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { makeClaudeTurnCompletion } from "./turnCompletion";
import { makeClaudeToolTracking } from "./toolTracking";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";
import type {
  FastModeDisabledReason,
  FastModeState,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  subagentRunForTask,
  sdkNativeMethod,
  runtimeSessionStateFromClaudeTaskStatus,
  readClaudeVcsStateChange,
  claudeTaskTurnStatus,
} from "./sdkMetadata";
import { asCanonicalTurnId, nativeProviderRefs } from "./messageContent";
import {
  parseClaudeWorkflowScriptMeta,
  extractClaudeWorkflowAgentPhases,
  extractClaudeWorkflowAgentPlans,
  parseClaudeWorkflowProgressAgents,
} from "../claudeWorkflowScript.ts";
import { readClaudeWorkflowOutputText } from "../claudeWorkflowRuntime.ts";

export function makeClaudeSystemMessages(input: {
  readonly settlePendingHumanInteractionsForAgent: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingHumanInteractionsForAgent"];
  readonly stopWorkflowRuntimePoller: ReturnType<
    typeof makeClaudeWorkflowRuntime
  >["stopWorkflowRuntimePoller"];
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
  readonly completeTurn: ReturnType<typeof makeClaudeTurnCompletion>["completeTurn"];
  readonly updateResumeCursor: ClaudeRuntimeEventsShape["updateResumeCursor"];
  readonly emitRuntimeWarning: ClaudeRuntimeEventsShape["emitRuntimeWarning"];
  readonly emitCompactionProgress: ClaudeRuntimeEventsShape["emitCompactionProgress"];
  readonly ensureSubagentRun: ReturnType<typeof makeClaudeToolTracking>["ensureSubagentRun"];
  readonly emitRuntimeError: ClaudeRuntimeEventsShape["emitRuntimeError"];
  readonly resolveWorkflowScriptText: ReturnType<
    typeof makeClaudeWorkflowRuntime
  >["resolveWorkflowScriptText"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly warnUnhandledSdkKind: ClaudeRuntimeEventsShape["warnUnhandledSdkKind"];
}) {
  const {
    settlePendingHumanInteractionsForAgent,
    stopWorkflowRuntimePoller,
    makeEventStamp,
    offerRuntimeEvent,
    completeTurn,
    updateResumeCursor,
    emitRuntimeWarning,
    emitCompactionProgress,
    ensureSubagentRun,
    emitRuntimeError,
    resolveWorkflowScriptText,
    fileSystem,
    warnUnhandledSdkKind,
  } = input;
  const handleSystemMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "system") {
        return;
      }

      if (message.subtype === "thinking_tokens") {
        return;
      }

      if (message.subtype === "task_updated") {
        const patch = message.patch;
        const status = patch?.status;
        const isBackgrounded = patch?.is_backgrounded;
        if (status === undefined && isBackgrounded === undefined) {
          return;
        }
        const isTerminalStatus =
          status === "completed" || status === "failed" || status === "killed";
        if (isTerminalStatus) {
          context.terminalTaskIds.add(message.task_id);
          yield* settlePendingHumanInteractionsForAgent(context, message.task_id);
        }

        if (isTerminalStatus || isBackgrounded === false) {
          context.knownBackgroundTaskIds.delete(message.task_id);
        }
        const isSettledRuntimeStatus = isTerminalStatus || status === "paused";
        if (isSettledRuntimeStatus && context.liveWorkflowTaskIds.has(message.task_id)) {
          context.taskTurnIds?.delete(message.task_id);
          context.liveWorkflowTaskIds.delete(message.task_id);
          yield* stopWorkflowRuntimePoller(context, message.task_id);
        }
        const workflowTaskId = context.workflowTaskIdByMemberTaskId.get(message.task_id);
        const run = subagentRunForTask(context, undefined, message.task_id);
        const error = nonEmptyTrimmed(patch?.error);
        const raw = {
          source: "claude.sdk.message" as const,
          method: sdkNativeMethod(message),
          messageType: `${message.type}:${message.subtype}`,
          payload: message,
        };
        const taskStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "task.updated",
          eventId: taskStamp.eventId,
          provider: PROVIDER,
          createdAt: taskStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          payload: {
            taskId: RuntimeTaskId.makeUnsafe(message.task_id),
            ...(status !== undefined ? { status } : {}),
            ...(error ? { error } : {}),
            ...(isBackgrounded !== undefined ? { isBackgrounded } : {}),
            ...(run ? { toolUseId: run.toolUseId } : {}),
            ...(workflowTaskId ? { workflowTaskId: RuntimeTaskId.makeUnsafe(workflowTaskId) } : {}),
          },
          providerRefs: nativeProviderRefs(context),
          raw,
        });
        const state =
          status !== undefined ? runtimeSessionStateFromClaudeTaskStatus(status) : undefined;
        if (!run || state === undefined) {
          return;
        }
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(run.context, {
          type: "session.state.changed",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: run.context.session.threadId,
          ...(run.context.turnState
            ? { turnId: asCanonicalTurnId(run.context.turnState.turnId) }
            : {}),
          payload: {
            state,
            reason: `task:${status}`,
            detail: message,
          },
          providerRefs: nativeProviderRefs(run.context),
          raw,
        });
        if (isTerminalStatus) {
          context.subagentRuns.delete(run.toolUseId);
          context.pendingSubagentStops.delete(run.toolUseId);
          context.settledSubagentToolUseIds.set(
            run.toolUseId,
            status === "completed" ? "completed" : status === "failed" ? "failed" : "stopped",
          );
          if (run.context.turnState) {
            yield* completeTurn(
              run.context,
              status === "completed" ? "completed" : status === "failed" ? "failed" : "interrupted",
            );
          }
        }
        return;
      }

      const stamp = yield* makeEventStamp();
      const base = {
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        providerRefs: nativeProviderRefs(context),
        raw: {
          source: "claude.sdk.message" as const,
          method: sdkNativeMethod(message),
          messageType: `${message.type}:${message.subtype}`,
          payload: message,
        },
      };

      if (message.subtype === "model_refusal_fallback") {
        const refusalFallback = message;
        if (refusalFallback.direction !== "retry") return;
        const sessionFallback = (refusalFallback.scope ?? "session") === "session";
        if (sessionFallback) {
          context.currentApiModelId = refusalFallback.fallback_model;
          context.lastKnownContextWindow = undefined;
          yield* updateResumeCursor(context);
        }
        yield* offerRuntimeEvent(context, {
          ...base,
          type: "model.rerouted",
          payload: {
            fromModel: refusalFallback.original_model,
            toModel: refusalFallback.fallback_model,
            reason: sessionFallback
              ? refusalFallback.content
              : `${refusalFallback.content} (local response only)`,
          },
        });
        return;
      }

      const vcsStateChange = readClaudeVcsStateChange(message);
      if (vcsStateChange) {
        yield* offerRuntimeEvent(context, {
          ...base,
          type: "vcs.state.changed",
          payload: vcsStateChange,
        });
        return;
      }

      switch (message.subtype) {
        case "session_state_changed": {
          const state =
            message.state === "idle"
              ? "ready"
              : message.state === "requires_action"
                ? "waiting"
                : "running";
          context.nativeSessionState = state;
          context.session = {
            ...context.session,
            status: state === "waiting" ? "running" : state,
            ...(state === "ready" ? { activeTurnId: undefined } : {}),
            updatedAt: base.createdAt,
          };
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "session.state.changed",
            payload: { state, reason: `session_state:${message.state}` },
          });
          return;
        }
        case "worker_shutting_down":
          context.workerShutdownReason = message.reason;
          return;
        case "model_refusal_no_fallback":
          yield* emitRuntimeError(context, message.content, message, {
            kind: "access_denied",
            action: null,
            retry: { state: "none" },
            resetsAt: null,
            httpStatus: null,
            message: message.content,
          });
          return;
        case "local_command_output":
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "item.completed",
            itemId: RuntimeItemId.makeUnsafe(message.uuid),
            payload: {
              itemType: "command_execution",
              status: "completed",
              title: "Claude command output",
              ...(context.turnState?.commandText ? { detail: context.turnState.commandText } : {}),
              data: {
                ...(context.turnState?.commandText
                  ? { command: context.turnState.commandText }
                  : {}),
                output: message.content,
              },
            },
            providerRefs: nativeProviderRefs(context, { providerItemId: message.uuid }),
          });
          return;
        case "elicitation_complete":
          yield* emitRuntimeWarning(context, "MCP input request completed.", message);
          return;
        case "informational":
        case "notification":
          yield* emitRuntimeWarning(
            context,
            message.subtype === "informational" ? message.content : message.text,
            message,
          );
          return;
        case "commands_changed":
          return;
        case "init":
          context.initSkillNames = new Set(message.skills);
          context.loadedPluginNames = new Set(message.plugins.map((plugin) => plugin.name));
          yield* syncFastModeState(context, message);
          context.effectiveEffort = message.effort;
          if (Array.isArray(message.tools)) {
            context.initToolNames = new Set(message.tools);
          }
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "session.configured",
            payload: {
              config: message as Record<string, unknown>,
            },
          });
          return;
        case "api_retry": {
          const reason =
            message.error_status === null ? "connection error" : `HTTP ${message.error_status}`;
          yield* emitRuntimeWarning(
            context,
            `Request retry ${message.attempt}/${message.max_retries} in ${Math.ceil(message.retry_delay_ms / 1000)}s (${reason}).`,
            {
              subtype: message.subtype,
              attempt: message.attempt,
              maxRetries: message.max_retries,
              retryDelayMs: message.retry_delay_ms,
              httpStatus: message.error_status,
            },
          );
          return;
        }
        case "permission_denied": {
          const reason =
            message.decision_reason?.trim() ||
            message.message?.trim() ||
            "Claude's automatic permission reviewer denied this action.";
          yield* emitRuntimeWarning(context, `${message.tool_name} was denied: ${reason}`, message);
          return;
        }
        case "status":
          if (message.status === "compacting") yield* emitCompactionProgress(context);
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "session.state.changed",
            payload: {
              state: message.status === "compacting" ? "waiting" : "running",
              reason: `status:${message.status ?? "active"}`,
              detail: message,
            },
          });
          return;
        case "compact_boundary":
          if (context.turnState?.explicitCompaction?.nativeSessionId === message.session_id) {
            context.turnState.explicitCompaction.boundaryObserved = true;
          }
          if (context.turnState) context.turnState.compactionInProgress = false;
          context.lastKnownTokenUsage = undefined;
          context.tokenUsageState = "skip-compaction-call";
          yield* updateResumeCursor(context);
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "thread.state.changed",
            payload: {
              state: "compacted",
              detail: message,
            },
          });
          return;
        case "hook_started":
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "hook.started",
            payload: {
              hookId: message.hook_id,
              hookName: message.hook_name,
              hookEvent: message.hook_event,
            },
          });
          return;
        case "hook_progress":
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "hook.progress",
            payload: {
              hookId: message.hook_id,
              output: message.output,
              stdout: message.stdout,
              stderr: message.stderr,
            },
          });
          return;
        case "hook_response":
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "hook.completed",
            payload: {
              hookId: message.hook_id,
              outcome: message.outcome,
              output: message.output,
              stdout: message.stdout,
              stderr: message.stderr,
              ...(typeof message.exit_code === "number" ? { exitCode: message.exit_code } : {}),
            },
          });
          return;
        case "task_started": {
          // A finished subagent resumed by SendMessage starts again under its agent id. It reopens
          // the run of the Task call that launched it so the work lands on the same child thread.
          const resumedToolUseId = context.subagentToolUseIdByAgentId.get(message.task_id);
          if (resumedToolUseId !== undefined && context.terminalTaskIds.has(message.task_id)) {
            context.terminalTaskIds.delete(message.task_id);
            context.settledSubagentToolUseIds.delete(resumedToolUseId);
            context.taskTurnIds?.delete(message.task_id);
            if (message.tool_use_id && message.tool_use_id !== resumedToolUseId) {
              context.subagentToolUseIdAliases.set(message.tool_use_id, resumedToolUseId);
            }
          }
          if (context.terminalTaskIds.has(message.task_id)) return;
          const subagentToolUseId = resumedToolUseId ?? message.tool_use_id;
          const ownerTurnId = context.turnState?.turnId ?? context.lastTurnId;
          if (ownerTurnId) {
            context.taskTurnIds ??= new Map();
            if (!context.taskTurnIds.has(message.task_id))
              context.taskTurnIds.set(message.task_id, ownerTurnId);
          }

          if (
            subagentToolUseId &&
            (message.subagent_type !== undefined ||
              resumedToolUseId !== undefined ||
              context.subagentRuns.has(subagentToolUseId))
          ) {
            const run = ensureSubagentRun(context, subagentToolUseId);
            run.taskId = message.task_id;
            context.subagentToolUseIdByAgentId.set(message.task_id, subagentToolUseId);

            if (context.pendingSubagentStops.delete(subagentToolUseId)) {
              yield* Effect.tryPromise(() => context.query.stopTask(message.task_id)).pipe(
                Effect.catch((cause) =>
                  emitRuntimeError(
                    context,
                    `Failed to stop subagent task '${message.task_id}'.`,
                    cause,
                  ),
                ),
              );
            }
          }
          if (message.task_type === "local_workflow") {
            context.liveWorkflowTaskIds.add(message.task_id);
            context.knownWorkflowTaskIds.add(message.task_id);
          } else if (
            context.liveWorkflowTaskIds.size === 1 &&
            message.task_type !== "local_bash" &&
            message.skip_transcript !== true &&
            !(message.tool_use_id !== undefined && message.subagent_type !== undefined)
          ) {
            const [workflowTaskId] = context.liveWorkflowTaskIds;
            context.workflowTaskIdByMemberTaskId.set(message.task_id, workflowTaskId!);
          }
          const workflowTaskId = context.workflowTaskIdByMemberTaskId.get(message.task_id);
          const workflowScript =
            message.task_type === "local_workflow"
              ? yield* resolveWorkflowScriptText(context, message)
              : undefined;
          const workflowMeta = workflowScript
            ? parseClaudeWorkflowScriptMeta(workflowScript)
            : undefined;
          const workflowAgentPhases = workflowScript
            ? extractClaudeWorkflowAgentPhases(workflowScript)
            : undefined;
          const workflowAgentPlans = workflowScript
            ? extractClaudeWorkflowAgentPlans(workflowScript)
            : undefined;
          // The journal rejects untrimmed strings, and SDK task descriptions (often a raw Bash
          // command) can end in a newline.
          const description = nonEmptyTrimmed(message.description);
          const taskType = nonEmptyTrimmed(message.task_type);
          const subagentType = nonEmptyTrimmed(message.subagent_type);
          const workflowName = nonEmptyTrimmed(message.workflow_name ?? workflowMeta?.name);
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "task.started",
            payload: {
              taskId: RuntimeTaskId.makeUnsafe(message.task_id),
              ...(description ? { description } : {}),
              ...(taskType ? { taskType } : {}),
              ...(subagentType ? { subagentType } : {}),
              ...(workflowName ? { workflowName } : {}),
              ...(workflowTaskId
                ? { workflowTaskId: RuntimeTaskId.makeUnsafe(workflowTaskId) }
                : {}),
              ...(workflowMeta?.phases ? { workflowPhases: workflowMeta.phases } : {}),
              ...(workflowAgentPhases ? { workflowAgentPhases } : {}),
              ...(workflowAgentPlans ? { workflowAgentPlans } : {}),
              ...(subagentToolUseId ? { toolUseId: subagentToolUseId } : {}),
            },
          });
          return;
        }
        case "task_progress": {
          if (context.terminalTaskIds.has(message.task_id)) return;
          if (context.liveWorkflowTaskIds.has(message.task_id)) {
            const separator = message.description.indexOf(": ");
            const label = (
              separator > 0 ? message.description.slice(separator + 2) : message.description
            ).trim();
            if (label.length > 0) {
              const labels = context.workflowAgentLabels.get(message.task_id) ?? [];
              if (!labels.includes(label)) {
                labels.push(label);
                context.workflowAgentLabels.set(message.task_id, labels);
              }
            }
          }
          const workflowTaskId = context.workflowTaskIdByMemberTaskId.get(message.task_id);
          const summary = nonEmptyTrimmed(message.summary);
          const lastToolName = nonEmptyTrimmed(message.last_tool_name);
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "task.progress",
            payload: {
              taskId: RuntimeTaskId.makeUnsafe(message.task_id),
              description: nonEmptyTrimmed(message.description) ?? "Task",
              ...(summary ? { summary } : {}),
              ...(message.usage ? { usage: message.usage } : {}),
              ...(lastToolName ? { lastToolName } : {}),
              ...(workflowTaskId
                ? { workflowTaskId: RuntimeTaskId.makeUnsafe(workflowTaskId) }
                : {}),
            },
          });
          return;
        }
        case "task_notification": {
          if (context.terminalTaskIds.has(message.task_id)) return;
          context.terminalTaskIds.add(message.task_id);
          const ownerTurnId = context.taskTurnIds?.get(message.task_id) ?? context.lastTurnId;
          const run = subagentRunForTask(context, message.tool_use_id, message.task_id);
          if (ownerTurnId) {
            context.backgroundReplySourceTurnId = ownerTurnId;
            const providerThreadId = run?.toolUseId ?? message.tool_use_id;
            if (providerThreadId) {
              context.backgroundReplySource = {
                providerThreadId,
                nickname: subagentName(providerThreadId),
              };
            } else {
              delete context.backgroundReplySource;
            }
          }
          yield* settlePendingHumanInteractionsForAgent(context, message.task_id);
          context.knownBackgroundTaskIds.delete(message.task_id);
          const workflowTaskId = context.workflowTaskIdByMemberTaskId.get(message.task_id);
          const summary = nonEmptyTrimmed(message.summary);

          const workflowOutputText =
            context.knownWorkflowTaskIds.has(message.task_id) &&
            typeof message.output_file === "string" &&
            message.output_file.length > 0
              ? yield* readClaudeWorkflowOutputText(fileSystem, message.output_file)
              : undefined;
          const parsedWorkflowAgents = workflowOutputText
            ? parseClaudeWorkflowProgressAgents(workflowOutputText)
            : undefined;

          const runtimeEffortByAgentId = new Map(
            Array.from(
              context.workflowRuntimeStates.get(message.task_id)?.agents.values() ?? [],
              (agent) => [agent.agentId, agent.effort] as const,
            ).filter((entry): entry is [string, string] => entry[1] !== undefined),
          );
          const workflowAgents = parsedWorkflowAgents?.map((agent) => {
            const effort = agent.agentId ? runtimeEffortByAgentId.get(agent.agentId) : undefined;
            return agent.effort === undefined && effort !== undefined
              ? Object.assign({}, agent, { effort })
              : agent;
          });
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "task.completed",
            ...(ownerTurnId ? { turnId: ownerTurnId } : {}),
            payload: {
              taskId: RuntimeTaskId.makeUnsafe(message.task_id),
              status: message.status,
              ...(summary ? { summary } : {}),
              ...(message.usage ? { usage: message.usage } : {}),
              ...(workflowTaskId
                ? { workflowTaskId: RuntimeTaskId.makeUnsafe(workflowTaskId) }
                : {}),
              ...(workflowAgents ? { workflowAgents } : {}),
            },
          });
          context.taskTurnIds?.delete(message.task_id);
          context.liveWorkflowTaskIds.delete(message.task_id);
          context.knownWorkflowTaskIds.delete(message.task_id);
          context.workflowTaskIdByMemberTaskId.delete(message.task_id);
          context.workflowRuntimeStates.delete(message.task_id);
          yield* stopWorkflowRuntimePoller(context, message.task_id);
          if (run) {
            context.subagentRuns.delete(run.toolUseId);
            context.pendingSubagentStops.delete(run.toolUseId);
            context.settledSubagentToolUseIds.set(run.toolUseId, message.status);
            if (run.context.turnState) {
              yield* completeTurn(run.context, claudeTaskTurnStatus(message.status));
            }
          }
          return;
        }
        case "files_persisted":
          yield* offerRuntimeEvent(context, {
            ...base,
            type: "files.persisted",
            payload: {
              files: Array.isArray(message.files)
                ? message.files.map((file: { filename: string; file_id: string }) => ({
                    filename: file.filename,
                    fileId: file.file_id,
                  }))
                : [],
              ...(Array.isArray(message.failed)
                ? {
                    failed: message.failed.map((entry: { filename: string; error: string }) => ({
                      filename: entry.filename,
                      error: entry.error,
                    })),
                  }
                : {}),
            },
          });
          return;
        case "background_tasks_changed": {
          const tasks = Array.isArray(message.tasks) ? message.tasks : [];
          const added = tasks.filter(
            (task) =>
              !context.terminalTaskIds.has(task.task_id) &&
              !context.knownBackgroundTaskIds.has(task.task_id),
          );
          context.knownBackgroundTaskIds.clear();
          for (const task of tasks) {
            context.knownBackgroundTaskIds.add(task.task_id);
          }
          for (const task of added) {
            const ownerTurnId =
              context.taskTurnIds?.get(task.task_id) ??
              context.turnState?.turnId ??
              context.lastTurnId;
            if (ownerTurnId) {
              context.taskTurnIds ??= new Map();
              context.taskTurnIds.set(task.task_id, ownerTurnId);
            }
            const stamp = yield* makeEventStamp();
            yield* offerRuntimeEvent(context, {
              ...stamp,
              type: "task.updated",
              provider: PROVIDER,
              threadId: context.session.threadId,
              ...((context.taskTurnIds?.get(task.task_id) ??
              context.turnState?.turnId ??
              context.lastTurnId)
                ? {
                    turnId:
                      context.taskTurnIds?.get(task.task_id) ??
                      context.turnState?.turnId ??
                      context.lastTurnId,
                  }
                : {}),
              payload: { taskId: RuntimeTaskId.makeUnsafe(task.task_id), isBackgrounded: true },
              providerRefs: nativeProviderRefs(context),
            });
          }
          if (added.length === 0) {
            return;
          }
          const labels = added.map((task) =>
            task.description.trim().length > 0 ? task.description.trim() : task.task_type,
          );
          const notice =
            added.length === 1
              ? labels[0]!
              : `${added.length} tasks: ${labels.join(", ")}`.slice(0, 200);
          yield* emitRuntimeWarning(context, notice, message);
          return;
        }
        default:
          yield* warnUnhandledSdkKind(
            context,
            `system:${message.subtype}`,
            `Unhandled Claude system message subtype '${message.subtype}'.`,
            message,
          );
          return;
      }
    });

  // Claude Code serves standard speed without an error when fast mode is blocked (no usage
  // credits, cooldown, org policy), so the client shows the state Claude Code reports, not the toggle.
  const syncFastModeState = (
    context: ClaudeSessionContext,
    report: {
      readonly fast_mode_state?: FastModeState;
      readonly fast_mode_disabled_reason?: FastModeDisabledReason;
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const state = report.fast_mode_state;
      const disabledReason = report.fast_mode_disabled_reason;
      if (state === undefined) return;
      if (state === context.fastModeState && disabledReason === context.fastModeDisabledReason) {
        return;
      }
      context.fastModeState = state;
      context.fastModeDisabledReason = disabledReason;
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "session.configured",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        payload: {
          config: {
            fastModeState: state,
            ...(disabledReason ? { fastModeDisabledReason: disabledReason } : {}),
          },
        },
        providerRefs: nativeProviderRefs(context),
      });
    });

  const handleSdkTelemetryMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const stamp = yield* makeEventStamp();
      const base = {
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        providerRefs: nativeProviderRefs(context),
        raw: {
          source: "claude.sdk.message" as const,
          method: sdkNativeMethod(message),
          messageType: message.type,
          payload: message,
        },
      };

      if (message.type === "tool_progress") {
        yield* offerRuntimeEvent(context, {
          ...base,
          type: "tool.progress",
          payload: {
            toolUseId: message.tool_use_id,
            toolName: message.tool_name,
            elapsedSeconds: message.elapsed_time_seconds,
            ...(message.task_id ? { summary: `task:${message.task_id}` } : {}),
          },
        });
        return;
      }

      if (message.type === "tool_use_summary") {
        const summary = message.summary.trim();
        const ownerTurnId = context.toolTurnIds?.get(message.preceding_tool_use_ids.at(-1) ?? "");
        if (!summary || !ownerTurnId) return;
        yield* offerRuntimeEvent(context, {
          ...base,
          type: "tool.summary",
          turnId: ownerTurnId,
          payload: {
            summary,
            ...(message.preceding_tool_use_ids.length > 0
              ? { precedingToolUseIds: message.preceding_tool_use_ids }
              : {}),
          },
        });
        return;
      }

      if (message.type === "auth_status") {
        context.authenticationInProgress = message.isAuthenticating;
        yield* offerRuntimeEvent(context, {
          ...base,
          type: "auth.status",
          raw: { source: "claude.sdk.message", method: "claude/auth_status", payload: {} },
          payload: {
            isAuthenticating: message.isAuthenticating,
            ...(message.error ? { error: "Authentication needs attention" } : {}),
          },
        });
        return;
      }

      if (message.type === "rate_limit_event") {
        yield* offerRuntimeEvent(context, {
          ...base,
          type: "account.rate-limits.updated",
          payload: {
            rateLimits: message,
          },
        });
        return;
      }
    });
  return { handleSdkTelemetryMessage, handleSystemMessage, syncFastModeState };
}
