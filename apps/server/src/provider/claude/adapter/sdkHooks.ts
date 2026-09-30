import type { Fiber } from "effect";
import { Effect, Ref, Random, Deferred } from "effect";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import {
  ClaudeSessionContext,
  PendingUserInput,
  PendingApproval,
  PendingUserInputResult,
  PROVIDER,
  ClaudeSubagentRun,
} from "./sessionTypes";
import { EventId, ApprovalRequestId } from "@glade/contracts/core/baseSchemas";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { makeClaudeInteractionSettlement } from "./interactionSettlement";
import { makeClaudeToolTracking } from "./toolTracking";

import { acquireAgentGatewaySessionLease } from "../../../agentGateway/sessionLease.ts";
import type {
  HookInput,
  HookJSONOutput,
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { type UserInputQuestion } from "@glade/contracts/provider/runtimePayloads";
import {
  asCanonicalTurnId,
  asRuntimeRequestId,
  nativeProviderRefs,
  remapAnswersToClaudeQuestionText,
} from "./messageContent";
import { claudeSubagentSteerContext } from "./promptPolicy";
import { shouldAllowGladeComputerProviderTool } from "../../../agentGateway/computerToolPermission.ts";
import { classifyRequestType, summarizeToolRequest } from "./toolPresentation";
import { redactSensitiveJsonFields } from "../../../diagnostics/sensitiveKeys.ts";
import { type ProviderApprovalDecision } from "@glade/contracts/provider/sessionPolicy";
import { approvalRequestKindFromRequestType } from "@glade/shared/threads/threadSummary";
import { approvalSessionGrantWidensSessionPolicy } from "@glade/shared/threads/approvalSessionGrant";
import { isClaudeSkillAllowed } from "../claudeSkillBridge.ts";
import type { ServerSettingsError } from "@glade/contracts/settings/settings";

export function makeClaudeSdkHooks(dependencies: {
  readonly input: Parameters<ClaudeAdapterShape["startSession"]>[0];
  readonly contextRef: Ref.Ref<ClaudeSessionContext | undefined>;
  readonly runSdkFork: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E>;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
  readonly settlePendingUserInput: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingUserInput"];
  readonly pendingSubagentSteers: Map<string, Array<string>>;
  readonly runSdkPromise: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Promise<A>;
  readonly emitSubagentSteerDelivered: ReturnType<
    typeof makeClaudeToolTracking
  >["emitSubagentSteerDelivered"];

  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly settlePendingApproval: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingApproval"];
  readonly gatewaySessionLease: ReturnType<typeof acquireAgentGatewaySessionLease>;
  readonly getDisabledSkillNames: Effect.Effect<ReadonlyArray<string>, ServerSettingsError, never>;
}) {
  const {
    input,
    contextRef,
    runSdkFork,
    makeEventStamp,
    pendingUserInputs,
    offerRuntimeEvent,
    settlePendingUserInput,
    pendingSubagentSteers,
    runSdkPromise,
    emitSubagentSteerDelivered,

    pendingApprovals,
    settlePendingApproval,
    gatewaySessionLease,
    getDisabledSkillNames,
  } = dependencies;
  const handleAskUserQuestion = (
    context: ClaudeSessionContext,
    toolInput: Record<string, unknown>,
    callbackOptions: Parameters<CanUseTool>[2],
  ) =>
    Effect.gen(function* () {
      if (
        callbackOptions.signal.aborted ||
        context.stopped ||
        (callbackOptions.agentID !== undefined &&
          context.terminalTaskIds.has(callbackOptions.agentID))
      ) {
        return {
          behavior: "deny",
          message: "User cancelled tool execution.",
        } satisfies PermissionResult;
      }
      const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
      const interactionTurnId =
        context.turnState?.turnId ??
        (callbackOptions.agentID !== undefined ? context.lastTurnId : undefined);

      const rawQuestions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
      const questions: Array<UserInputQuestion> = rawQuestions.map(
        (q: Record<string, unknown>, idx: number) => ({
          id: typeof q.header === "string" ? q.header : `q-${idx}`,
          header: typeof q.header === "string" ? q.header : `Question ${idx + 1}`,
          question: typeof q.question === "string" ? q.question : "",
          options: Array.isArray(q.options)
            ? q.options.map((opt: Record<string, unknown>) => ({
                label: typeof opt.label === "string" ? opt.label : "",
                description: typeof opt.description === "string" ? opt.description : "",
              }))
            : [],
          multiSelect: typeof q.multiSelect === "boolean" ? q.multiSelect : false,
        }),
      );

      const resultDeferred = yield* Deferred.make<PendingUserInputResult>();
      const settledDeferred = yield* Deferred.make<PendingUserInputResult>();
      const pendingInput: PendingUserInput = {
        questions,
        result: resultDeferred,
        settled: settledDeferred,
        ...(interactionTurnId !== undefined ? { turnId: interactionTurnId } : {}),
        ...(callbackOptions.toolUseID ? { providerItemId: callbackOptions.toolUseID } : {}),
        ...(callbackOptions.agentID !== undefined ? { agentId: callbackOptions.agentID } : {}),
        settlementStarted: false,
      };

      const requestedStamp = yield* makeEventStamp();
      pendingUserInputs.set(requestId, pendingInput);

      yield* offerRuntimeEvent(context, {
        type: "user-input.requested",
        eventId: requestedStamp.eventId,
        provider: PROVIDER,
        createdAt: requestedStamp.createdAt,
        threadId: context.session.threadId,
        ...(interactionTurnId !== undefined
          ? { turnId: asCanonicalTurnId(interactionTurnId) }
          : {}),
        requestId: asRuntimeRequestId(requestId),
        payload: { questions },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: callbackOptions.toolUseID,
        }),
        raw: {
          source: "claude.sdk.permission",
          method: "canUseTool/AskUserQuestion",
          payload: { toolName: "AskUserQuestion", input: toolInput },
        },
      });

      if (
        callbackOptions.agentID !== undefined &&
        context.terminalTaskIds.has(callbackOptions.agentID)
      ) {
        yield* settlePendingUserInput(context, requestId, pendingInput, {
          answers: {},
          cancelled: true,
        });
      }

      const onAbort = () => {
        runSdkFork(
          settlePendingUserInput(context, requestId, pendingInput, {
            answers: {},
            cancelled: true,
          }),
        );
      };
      callbackOptions.signal.addEventListener("abort", onAbort, { once: true });

      if (callbackOptions.signal.aborted) onAbort();

      const result = yield* Deferred.await(resultDeferred).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            callbackOptions.signal.removeEventListener("abort", onAbort);
          }),
        ),
      );

      if (result.cancelled) {
        return {
          behavior: "deny",
          message: "User cancelled tool execution.",
        } satisfies PermissionResult;
      }

      return {
        behavior: "allow",
        updatedInput: {
          questions: toolInput.questions,
          answers: remapAnswersToClaudeQuestionText(questions, result.answers),
        },
      } satisfies PermissionResult;
    });

  const subagentSteerHook = async (hookInput: HookInput): Promise<HookJSONOutput> => {
    const agentId = "agent_id" in hookInput ? hookInput.agent_id : undefined;
    if (pendingSubagentSteers.size === 0 || typeof agentId !== "string") {
      return {};
    }
    return runSdkPromise(
      Effect.gen(function* () {
        const context = yield* Ref.get(contextRef);
        if (!context) {
          return {};
        }
        let run: ClaudeSubagentRun | undefined;
        for (const candidate of context.subagentRuns.values()) {
          if (candidate.taskId === agentId) {
            run = candidate;
            break;
          }
        }
        const pending = run ? pendingSubagentSteers.get(run.toolUseId) : undefined;
        if (!run || !pending || pending.length === 0) {
          return {};
        }
        pendingSubagentSteers.delete(run.toolUseId);
        const message = pending.join("\n\n");
        yield* emitSubagentSteerDelivered(run, message);
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: claudeSubagentSteerContext(message),
          },
        } satisfies HookJSONOutput;
      }),
    ).catch(() => ({}));
  };

  const canUseTool: CanUseTool = (toolName, toolInput, callbackOptions) =>
    runSdkPromise(
      Effect.gen(function* () {
        const context = yield* Ref.get(contextRef);
        if (!context) {
          return {
            behavior: "deny",
            message: "Claude session context is unavailable.",
          } satisfies PermissionResult;
        }

        if (toolName === "AskUserQuestion") {
          return yield* handleAskUserQuestion(context, toolInput, callbackOptions);
        }

        if (toolName === "Skill") {
          const skillName = typeof toolInput.skill === "string" ? toolInput.skill : undefined;
          const disabled = yield* Effect.result(getDisabledSkillNames);
          if (
            !skillName ||
            !context.allowedSkillNames.has(skillName) ||
            disabled._tag === "Failure" ||
            !isClaudeSkillAllowed(skillName, disabled.success)
          ) {
            return {
              behavior: "deny",
              message: "This skill is not enabled for this Claude session.",
            } satisfies PermissionResult;
          }
        }

        const runtimeMode = input.runtimeMode ?? "full-access";
        const interactionTurnId =
          context.turnState?.turnId ??
          (callbackOptions.agentID !== undefined ? context.lastTurnId : undefined);
        if (
          shouldAllowGladeComputerProviderTool({
            computerControlEnabled:
              input.enableComputerControl === true && context.gatewaySessionLease !== undefined,
            activeTurn: context.turnState !== undefined && interactionTurnId !== undefined,
            interactionMode: context.turnState?.interactionMode,
            runtimeMode,
            permission: { name: toolName },
          })
        ) {
          return {
            behavior: "allow",
            updatedInput: toolInput,
          } satisfies PermissionResult;
        }
        if (runtimeMode === "full-access" || context.approvalsAlwaysAllowedForSession) {
          return {
            behavior: "allow",
            updatedInput: toolInput,
          } satisfies PermissionResult;
        }

        const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
        const requestType = classifyRequestType(toolName);

        const detail = summarizeToolRequest(
          toolName,
          toolInput,
          JSON.stringify(toolInput, redactSensitiveJsonFields),
        );
        const decisionDeferred = yield* Deferred.make<ProviderApprovalDecision>();
        const settledDeferred = yield* Deferred.make<ProviderApprovalDecision>();
        const pendingApproval: PendingApproval = {
          requestType,
          detail,
          decision: decisionDeferred,
          settled: settledDeferred,
          ...(interactionTurnId !== undefined ? { turnId: interactionTurnId } : {}),
          ...(callbackOptions.toolUseID ? { providerItemId: callbackOptions.toolUseID } : {}),
          ...(callbackOptions.agentID !== undefined ? { agentId: callbackOptions.agentID } : {}),
          settlementStarted: false,
          ...(callbackOptions.suggestions && callbackOptions.suggestions.length > 0
            ? { suggestions: callbackOptions.suggestions }
            : {}),
        };

        const requestedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "request.opened",
          eventId: requestedStamp.eventId,
          provider: PROVIDER,
          createdAt: requestedStamp.createdAt,
          threadId: context.session.threadId,
          ...(interactionTurnId !== undefined
            ? { turnId: asCanonicalTurnId(interactionTurnId) }
            : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: {
            requestType,
            detail,
            args: {
              toolName,
              input: toolInput,
              sessionApprovalAvailable:
                callbackOptions.suggestions !== undefined && callbackOptions.suggestions.length > 0,
              ...(callbackOptions.toolUseID ? { toolUseId: callbackOptions.toolUseID } : {}),
            },
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: callbackOptions.toolUseID,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/request",
            payload: {
              toolName,
              input: toolInput,
            },
          },
        });

        pendingApprovals.set(requestId, pendingApproval);
        if (
          callbackOptions.agentID !== undefined &&
          context.terminalTaskIds.has(callbackOptions.agentID)
        ) {
          yield* settlePendingApproval(context, requestId, pendingApproval, "cancel");
        }

        const onAbort = () => {
          runSdkFork(settlePendingApproval(context, requestId, pendingApproval, "cancel"));
        };

        callbackOptions.signal.addEventListener("abort", onAbort, {
          once: true,
        });

        const decision = yield* Deferred.await(decisionDeferred).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              callbackOptions.signal.removeEventListener("abort", onAbort);
            }),
          ),
        );

        if (decision === "accept" || decision === "acceptForSession") {
          const requestKind = approvalRequestKindFromRequestType(requestType);
          if (
            decision === "acceptForSession" &&
            runtimeMode !== "auto" &&
            requestKind !== null &&
            approvalSessionGrantWidensSessionPolicy(requestKind)
          ) {
            context.approvalsAlwaysAllowedForSession = true;
          }
          return {
            behavior: "allow",
            updatedInput: toolInput,
            ...(decision === "acceptForSession" && pendingApproval.suggestions
              ? { updatedPermissions: [...pendingApproval.suggestions] }
              : {}),
          } satisfies PermissionResult;
        }

        return {
          behavior: "deny",
          message:
            decision === "cancel"
              ? "User cancelled tool execution."
              : "User declined tool execution.",
        } satisfies PermissionResult;
      }),
    );

  const gatewayToolHook = async (hookInput: HookInput): Promise<HookJSONOutput> => {
    if (
      hookInput.hook_event_name !== "PreToolUse" ||
      !hookInput.tool_name.startsWith("mcp__glade__")
    )
      return {};
    const context = await runSdkPromise(Ref.get(contextRef));
    if (!context) return {};
    const agentId = "agent_id" in hookInput ? hookInput.agent_id : undefined;
    const turnId =
      typeof agentId === "string"
        ? [...context.subagentRuns.values()].find((run) => run.taskId === agentId)
            ?.gatewayParentTurnId
        : context.turnState?.turnId;
    if (turnId)
      gatewaySessionLease?.registerNativeToolCall?.({
        callId: hookInput.tool_use_id,
        toolName: hookInput.tool_name.slice("mcp__glade__".length),
        turnId,
      });
    return {};
  };
  return {
    subagentSteerHook,
    canUseTool,
    gatewayToolHook,
  };
}
