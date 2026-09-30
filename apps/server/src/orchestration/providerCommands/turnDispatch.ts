import type { ServiceMap } from "effect";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ServerConfig } from "../../server/config.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { Option, Effect, Cause } from "effect";
import { ComputerService } from "../../computer/Services/ComputerService";
import {
  type ModelSelection,
  type ProviderStartOptions,
  type ProviderReviewTarget,
  type RuntimeMode,
  type ProviderInteractionMode,
} from "@glade/contracts/provider/sessionPolicy";
import { makeProviderThreadProjection } from "./threadProjection";
import { AgentGatewayOperationRepository } from "../../agentGateway/Services/AgentGatewayOperationRepository.ts";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ThreadId, ProviderKind, MessageId } from "@glade/contracts/core/baseSchemas";
import {
  type ChatAttachment,
  type PendingClaudeCacheReview,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@glade/contracts/orchestration/threadEntities";
import {
  type ProviderSkillReference,
  type ProviderMentionReference,
} from "@glade/contracts/provider/providerDiscovery";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import {
  debugModePromptOverheadChars,
  availableThreadMentionContextChars,
  PROVIDER_INPUT_SAFETY_MARGIN_CHARS,
  withProviderThreadStatePrompts,
  normalizeSkillMentionTextForProvider,
  providerPromptOverflowIssue,
  toNonEmptyProviderInput,
  availableProviderContextChars,
  BootstrapContextSelection,
  wrapProviderContext,
} from "./inputProjection";
import { providerGoalPromptOverheadChars, activeThreadGoal } from "../../provider/core/goalMode.ts";
import { parseComputerInvocation } from "@glade/shared/computer/computerInvocation";
import {
  resolveThreadMentionPromptProjection,
  appendThreadMentionContextBlocks,
  threadMentionContextSuffix,
} from "../../provider/core/threadMentionContext.ts";
import { buildInlineSkillInstructions } from "../../provider/core/skillPromptInjection.ts";
import {
  ProviderAdapterValidationError,
  ProviderServiceError,
} from "../../provider/core/Errors.ts";
import { resolveProviderDispatchAttachments } from "../../provider/core/providerAttachmentPaths.ts";
import { computerActivationMetadata } from "../../computer/computerActivation.ts";
import { claudeCacheForModel } from "../../provider/claude/claudeCacheObservation.ts";
import { resolveApiModelId } from "@glade/shared/provider/model";
import { assessClaudeCache } from "@glade/shared/provider/claudeCache";
import {
  claudeCacheReviewCoversObservation,
  ProviderContextLifecycleReason,
  ProviderContextLifecycleEvidence,
} from "./contextLifecycle";
import {
  hasNativeAssistantMessagesBefore,
  buildHandoffBootstrapText,
  listPriorTranscriptMessages,
  buildPriorTranscriptBootstrapText,
} from "../handoff.ts";
import { checkpointRefForThreadMessageStart } from "../../checkpointing/Utils.ts";
import { type ProviderTurnStartResult } from "@glade/contracts/provider/provider";
import { isStaleClaudeResumeError } from "./interactionPolicy";
import { serverCommandId } from "./deliveryClaims";
import { makeProviderSessionConfiguration } from "./sessionConfiguration";
import { PendingInterruptEscalation, PendingContextBootstrapAttempt } from "./runtimeState";
import { makeProviderContextBootstrap } from "./contextBootstrap";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";
import { ProviderDeliveryGate } from "../Services/ProviderDeliveryGate.ts";

export function makeProviderTurnDispatch(input: {
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly projectionSnapshotQuery: ServiceMap.Service.Shape<typeof ProjectionSnapshotQuery>;
  readonly serverConfig: ServiceMap.Service.Shape<typeof ServerConfig>;
  readonly managedAttachments: ServiceMap.Service.Shape<typeof ManagedAttachmentRepository>;
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
  readonly computerService: Option.Option<ServiceMap.Service.Shape<typeof ComputerService>>;
  readonly threadSessionSettings: ServiceMap.Service.Shape<typeof ThreadSessionSettings>;
  readonly ensureSessionForThread: ReturnType<
    typeof makeProviderSessionConfiguration
  >["ensureSessionForThread"];
  readonly isClaudeReviewAuthorized: ReturnType<
    typeof makeProviderThreadProjection
  >["isClaudeReviewAuthorized"];
  readonly setClaudeCacheReview: ReturnType<
    typeof makeProviderThreadProjection
  >["setClaudeCacheReview"];
  readonly pauseActiveThreadGoal: ReturnType<
    typeof makeProviderThreadProjection
  >["pauseActiveThreadGoal"];
  readonly appendProviderFailureActivity: ReturnType<
    typeof makeProviderThreadProjection
  >["appendProviderFailureActivity"];
  readonly gatewayOperations: ServiceMap.Service.Shape<typeof AgentGatewayOperationRepository>;
  readonly pendingInterruptEscalations: Map<string, PendingInterruptEscalation>;
  readonly freshSessionContextBootstrapThreadIds: Set<string>;
  readonly checkpointStore: ServiceMap.Service.Shape<typeof CheckpointStore>;
  readonly pendingContextBootstrapAttempts: Map<string, PendingContextBootstrapAttempt>;
  readonly clearStaleProviderResumeState: ReturnType<
    typeof makeProviderSessionConfiguration
  >["clearStaleProviderResumeState"];
  readonly deliveryGate: ServiceMap.Service.Shape<typeof ProviderDeliveryGate>;
  readonly completeInterruptEscalation: ReturnType<
    typeof makeProviderContextBootstrap
  >["completeInterruptEscalation"];
  readonly completePendingContextBootstrapAttempt: ReturnType<
    typeof makeProviderContextBootstrap
  >["completePendingContextBootstrapAttempt"];
  readonly retainAndAppendProviderContextLifecycleActivity: ReturnType<
    typeof makeProviderContextBootstrap
  >["retainAndAppendProviderContextLifecycleActivity"];
  readonly toProviderContextLifecycleActivityRecord: ReturnType<
    typeof makeProviderContextBootstrap
  >["toProviderContextLifecycleActivityRecord"];
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly persistPriorTranscriptBootstrapCompletion: ReturnType<
    typeof makeProviderContextBootstrap
  >["persistPriorTranscriptBootstrapCompletion"];
}) {
  const {
    projectionSnapshotQuery,
    serverConfig,
    managedAttachments,
    providerService,
    computerService,
    threadSessionSettings,
    ensureSessionForThread,
    isClaudeReviewAuthorized,
    setClaudeCacheReview,
    pauseActiveThreadGoal,
    appendProviderFailureActivity,
    gatewayOperations,
    pendingInterruptEscalations,
    freshSessionContextBootstrapThreadIds,
    checkpointStore,
    pendingContextBootstrapAttempts,
    clearStaleProviderResumeState,
    deliveryGate,
    completeInterruptEscalation,
    completePendingContextBootstrapAttempt,
    retainAndAppendProviderContextLifecycleActivity,
    toProviderContextLifecycleActivityRecord,
    orchestrationEngine,
    persistPriorTranscriptBootstrapCompletion,
    projectionAccess,
  } = input;
  const {
    resolveThread,
    resolveProviderSessionThread,
    resolveSubagentProviderThreadId,
    resolveProjectedThreadWorkspaceCwd,
  } = projectionAccess;
  const dispatchTurnForThread = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly sourceEventSequence: number;
    readonly completionEventSequence?: number;
    readonly messageId: string;
    readonly messageText: string;
    readonly dispatchOrigin?: "user" | "automation" | "agent";
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly skills?: ReadonlyArray<ProviderSkillReference>;
    readonly mentions?: ReadonlyArray<ProviderMentionReference>;
    readonly reviewTarget?: ProviderReviewTarget;
    readonly modelSelection?: ModelSelection;
    readonly providerOptions?: ProviderStartOptions;
    readonly enableComputerControl?: boolean;
    readonly computerControlMode?: "off" | "request" | "chat";
    readonly computerControlGeneration?: number;
    readonly runtimeMode?: RuntimeMode;
    readonly interactionMode?: ProviderInteractionMode;
    readonly dispatchMode?: "queue" | "steer";
    readonly turnKind?: "user" | "goal-continuation";
    readonly createdAt: string;
    readonly cacheReviewSource?: Extract<
      ProviderIntentEvent,
      { type: "thread.turn-start-requested" }
    >;
    readonly acceptedCacheReview?: PendingClaudeCacheReview;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return;
    }
    const debugPromptOverheadChars = debugModePromptOverheadChars(input.interactionMode);
    const goalPromptOverheadChars = providerGoalPromptOverheadChars(activeThreadGoal(thread));
    const providerPromptOverheadChars = debugPromptOverheadChars + goalPromptOverheadChars;
    const computerInvocation =
      input.dispatchOrigin === undefined || input.dispatchOrigin === "user"
        ? parseComputerInvocation(input.messageText)
        : null;

    const authoredMessageText = computerInvocation
      ? computerInvocation.prompt || "Use Glade Computer for this task."
      : input.messageText;
    const threadMentionProjection = yield* resolveThreadMentionPromptProjection({
      mentions: input.mentions,
      snapshotQuery: projectionSnapshotQuery,
      maxTotalContextChars: availableThreadMentionContextChars(
        authoredMessageText,
        providerPromptOverheadChars,
      ),
    });
    const messageText = appendThreadMentionContextBlocks({
      text: authoredMessageText,
      contextBlocks: threadMentionProjection.contextBlocks,
    });
    let mentionContextSuffix = threadMentionContextSuffix(threadMentionProjection.contextBlocks);
    const providerMentions = threadMentionProjection.providerMentions;
    // Subagent threads have no provider session of their own: their messages steer the running child
    // task through the parent session (mirrors the interrupt seam), never the session-bootstrap path
    // below. Parent metadata may be absent on older/local-only rows, so synthetic ids use the same
    // projection-backed parent inference as interrupt routing.
    const providerThread = yield* resolveProviderSessionThread(input.threadId);
    const subagentProviderThreadId = providerThread
      ? resolveSubagentProviderThreadId(thread.id, providerThread.id)
      : undefined;
    if (providerThread && subagentProviderThreadId) {
      const steerProvider = (providerThread.session?.providerName ??
        providerThread.modelSelection.provider) as ProviderKind;
      const steerSkillInlineText =
        input.skills !== undefined && input.skills.length > 0
          ? yield* Effect.tryPromise(() =>
              buildInlineSkillInstructions({
                provider: steerProvider,
                skills: input.skills ?? [],
                maxChars: Math.max(
                  0,
                  PROVIDER_SEND_TURN_MAX_INPUT_CHARS -
                    messageText.length -
                    PROVIDER_INPUT_SAFETY_MARGIN_CHARS -
                    providerPromptOverheadChars,
                ),
              }),
            ).pipe(
              Effect.catch((error) =>
                Effect.logWarning("failed to inline portable skill instructions", {
                  threadId: input.threadId,
                  error,
                }).pipe(Effect.as("")),
              ),
            )
          : "";
      const steerMessageWithSkills = steerSkillInlineText
        ? `${messageText}\n\n${steerSkillInlineText}`
        : messageText;
      const composedSteerInput = withProviderThreadStatePrompts({
        interactionMode: input.interactionMode,
        goal: activeThreadGoal(thread),
        text: normalizeSkillMentionTextForProvider({
          provider: steerProvider,
          messageText: steerMessageWithSkills,
          ...(input.skills !== undefined ? { skills: input.skills } : {}),
        }),
      });
      if (
        providerPromptOverheadChars > 0 &&
        composedSteerInput.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: steerProvider,
          operation: "thread.turn.start",
          issue: providerPromptOverflowIssue(goalPromptOverheadChars),
        });
      }
      const normalizedSteerInput = toNonEmptyProviderInput(composedSteerInput);
      const normalizedSteerAttachments = yield* resolveProviderDispatchAttachments({
        attachments: input.attachments,
        attachmentsDir: serverConfig.attachmentsDir,
        repository: managedAttachments,
        threadId: input.threadId,
        messageId: input.messageId,
        provider: steerProvider,
        operation: "thread.turn.start",
      });
      yield* providerService.steerSubagent({
        threadId: providerThread.id,
        providerThreadId: subagentProviderThreadId,
        ...(normalizedSteerInput ? { input: normalizedSteerInput } : {}),
        ...(normalizedSteerAttachments.length > 0
          ? { attachments: normalizedSteerAttachments }
          : {}),
        ...(input.skills !== undefined ? { skills: input.skills } : {}),
        ...(providerMentions !== undefined ? { mentions: providerMentions } : {}),
      });
      return;
    }
    const activation = computerActivationMetadata(input);

    const requestedMode = activation.computerControlMode;
    const generation = activation.computerControlGeneration;
    const enableComputerControl = Option.isNone(computerService)
      ? activation.enableComputerControl
      : input.turnKind === "goal-continuation"
        ? computerService.value.manager.canContinueChatControl(input.threadId)
        : input.dispatchMode === "steer" && requestedMode === "off"
          ? false
          : yield* Effect.promise(() =>
              computerService.value.manager.admitControl(
                input.threadId,
                requestedMode,
                generation,
                requestedMode === "request" && computerInvocation !== null,
              ),
            );
    yield* Effect.logDebug("provider command reactor computer inputs", {
      threadId: input.threadId,
      mode: activation.computerControlMode,
      generation,
      enableComputerControl,
    });
    const transcriptBoundaryMessageId =
      input.turnKind === "goal-continuation" ? undefined : input.messageId;
    const selectedProvider =
      input.modelSelection?.provider ??
      threadSessionSettings.getModelSelection(input.threadId)?.provider ??
      thread.session?.providerName ??
      thread.modelSelection.provider;
    const {
      activeSession,
      nativeResumeSucceeded,
      nativeResumeFailed,
      nativeSessionRestarted,
      computerControlRestartDeferred,
      forkComputerControl,
    } = yield* ensureSessionForThread(input.threadId, input.createdAt, {
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions !== undefined ? { providerOptions: input.providerOptions } : {}),
      ...(input.dispatchMode === "steer" ? {} : { enableComputerControl }),
      ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
    });
    if (activeSession.provider === "claudeAgent" && input.dispatchMode !== "steer") {
      const latestThread = yield* resolveThread(input.threadId);
      const pendingReview = latestThread?.claudeCacheReview;
      if (input.acceptedCacheReview) {
        if (
          !(yield* isClaudeReviewAuthorized(
            input.threadId,
            input.acceptedCacheReview.reviewId,
            "responding",
          ))
        )
          return;
      } else if (pendingReview) return;
      const nativeObservation = providerService.getClaudeCacheObservation
        ? yield* providerService
            .getClaudeCacheObservation(input.threadId)
            .pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined;
      // In-session model controls run inside sendTurn, after this preflight. Assess the requested model
      // now without changing the native session.
      const requestedSelection = input.modelSelection ?? thread.modelSelection;
      const observation = claudeCacheForModel(
        nativeObservation,
        requestedSelection.provider === "claudeAgent"
          ? resolveApiModelId(requestedSelection)
          : undefined,
      );
      const assessment = assessClaudeCache(observation, Date.now());
      if (
        observation &&
        assessment.requiresConfirmation &&
        (!input.acceptedCacheReview ||
          !claudeCacheReviewCoversObservation(input.acceptedCacheReview, observation))
      ) {
        const createdAt = new Date().toISOString();
        const hold = {
          sourceEventSequence: input.sourceEventSequence,
          session: {
            threadId: input.threadId,
            runtimeMode: activeSession.runtimeMode,
            providerName: activeSession.provider,
            status: "ready" as const,
            lastError: null,
            activeTurnId: null,
            updatedAt: createdAt,
          },
        };
        if (input.cacheReviewSource) {
          yield* setClaudeCacheReview(
            input.threadId,
            {
              reviewId: `claude-cache:${input.cacheReviewSource.eventId}:${crypto.randomUUID()}`,
              messageId: MessageId.makeUnsafe(input.messageId),
              sourceEventSequence: input.cacheReviewSource.sequence,
              assessment: { ...observation, state: assessment.state },
              requestedAt: input.cacheReviewSource.payload.createdAt,
              ...(input.cacheReviewSource.payload.sourceProposedPlan
                ? { sourceProposedPlan: input.cacheReviewSource.payload.sourceProposedPlan }
                : {}),
              status: "pending",
              createdAt,
            },
            pendingReview?.reviewId ?? null,
            hold,
          );
        } else {
          yield* pauseActiveThreadGoal({
            threadId: input.threadId,
            expectedGoalStartedAt: thread.goalStartedAt ?? null,
          });
          yield* appendProviderFailureActivity({
            threadId: input.threadId,
            kind: "provider.turn.start.failed",
            summary: "Goal paused for Claude cache review",
            detail:
              "Claude's large context is likely no longer cached. Send a message to review continuing.",
            turnId: null,
            createdAt: new Date().toISOString(),
          });
          yield* setClaudeCacheReview(input.threadId, null, null, hold);
        }
        return;
      }
    }
    if (input.providerOptions !== undefined) {
      threadSessionSettings.setProviderOptions(input.threadId, input.providerOptions);
    }
    if (input.modelSelection !== undefined) {
      threadSessionSettings.setModelSelection(input.threadId, input.modelSelection);
    }
    if (input.dispatchMode !== "steer" && computerControlRestartDeferred !== true) {
      // A fork provisions the parent-derived flag, not this turn's resolved value; a deferred
      // control-only restart provisions nothing yet. In both cases the resolved value must not overwrite
      // the authoritative cache.
      threadSessionSettings.setComputerControl(
        input.threadId,
        forkComputerControl ?? enableComputerControl,
      );
    }
    const completionContext =
      input.cacheReviewSource &&
      (input.cacheReviewSource.payload.dispatchOrigin ?? "user") === "user" &&
      input.dispatchMode !== "steer" &&
      input.reviewTarget === undefined &&
      !input.messageText.trimStart().startsWith("/")
        ? yield* gatewayOperations.completions.claimContext(
            input.threadId,
            input.completionEventSequence ?? input.sourceEventSequence,
            Math.max(
              0,
              Math.min(
                16_000,
                PROVIDER_SEND_TURN_MAX_INPUT_CHARS -
                  input.messageText.length -
                  mentionContextSuffix.length -
                  providerPromptOverheadChars -
                  PROVIDER_INPUT_SAFETY_MARGIN_CHARS,
              ),
            ),
          )
        : "";
    mentionContextSuffix += completionContext;
    // Bootstrap prompts wrap the user message in `<latest_user_message>` tags; mentioned-thread context
    // is appended after the assembled provider input instead so it never reads as part of the user's
    // own words.
    const boundaryMessageText = authoredMessageText;
    const bootstrapBudgetMessageText = `${boundaryMessageText}${mentionContextSuffix}`;
    const shouldBootstrapHandoff =
      thread.handoff?.bootstrapStatus === "pending" &&
      !hasNativeAssistantMessagesBefore(thread, transcriptBoundaryMessageId);
    const handoffBootstrapAvailableChars = availableProviderContextChars({
      tag: "handoff_context",
      messageText: bootstrapBudgetMessageText,
      wrapLatestUserMessage: true,
      reservedChars: providerPromptOverheadChars,
    });
    const handoffBootstrapText =
      shouldBootstrapHandoff && handoffBootstrapAvailableChars > 0
        ? buildHandoffBootstrapText(thread, handoffBootstrapAvailableChars)
        : null;
    if (
      providerPromptOverheadChars > 0 &&
      withProviderThreadStatePrompts({
        interactionMode: input.interactionMode,
        goal: activeThreadGoal(thread),
        text: bootstrapBudgetMessageText,
      }).length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS
    ) {
      return yield* new ProviderAdapterValidationError({
        provider: selectedProvider as ProviderKind,
        operation: "thread.turn.start",
        issue: providerPromptOverflowIssue(goalPromptOverheadChars),
      });
    }
    const interruptEscalation = pendingInterruptEscalations.get(input.threadId);
    const priorEscalationEvidence = interruptEscalation?.evidence;
    const hasPendingFreshSessionTranscriptBootstrap = freshSessionContextBootstrapThreadIds.has(
      input.threadId,
    );
    const hasPendingPriorTranscriptBootstrap =
      hasPendingFreshSessionTranscriptBootstrap ||
      (input.dispatchMode !== "steer" && priorEscalationEvidence?.recapText != null);
    const shouldBootstrapPriorTranscriptContext =
      hasPendingPriorTranscriptBootstrap && !shouldBootstrapHandoff;
    const priorTranscriptMessages = listPriorTranscriptMessages(
      thread,
      transcriptBoundaryMessageId,
    );
    const hasPriorTranscriptBootstrapContent =
      shouldBootstrapPriorTranscriptContext && priorTranscriptMessages.length > 0;
    const priorTranscriptBootstrapAvailableChars = availableProviderContextChars({
      tag: "thread_context",
      messageText: bootstrapBudgetMessageText,
      wrapLatestUserMessage: true,
      reservedChars: providerPromptOverheadChars,
    });
    if (
      input.reviewTarget === undefined &&
      hasPendingPriorTranscriptBootstrap &&
      shouldBootstrapPriorTranscriptContext &&
      priorTranscriptBootstrapAvailableChars === 0 &&
      hasPriorTranscriptBootstrapContent
    ) {
      return yield* new ProviderAdapterValidationError({
        provider: selectedProvider as ProviderKind,
        operation: "thread.turn.start",
        issue:
          "The latest message is too long to include the transcript context required by the restarted provider session. Shorten the message and retry.",
      });
    }
    const priorTranscriptBootstrapText =
      shouldBootstrapPriorTranscriptContext && priorTranscriptBootstrapAvailableChars > 0
        ? buildPriorTranscriptBootstrapText(
            thread,
            transcriptBoundaryMessageId,
            priorTranscriptBootstrapAvailableChars,
          )
        : null;
    const restartReason: ProviderContextLifecycleReason = interruptEscalation
      ? "interrupt-escalation"
      : nativeResumeFailed
        ? "native-resume-failed"
        : freshSessionContextBootstrapThreadIds.has(input.threadId)
          ? "fresh-session"
          : "native-history-unavailable";
    let providerContextLifecycleEvidence: ProviderContextLifecycleEvidence | null =
      input.reviewTarget === undefined &&
      input.dispatchMode !== "steer" &&
      !shouldBootstrapHandoff &&
      priorTranscriptMessages.length > 0 &&
      (priorTranscriptBootstrapText !== null ||
        (nativeSessionRestarted && !nativeResumeSucceeded) ||
        priorEscalationEvidence != null)
        ? {
            nativeHistory:
              priorEscalationEvidence?.nativeHistory ??
              (nativeResumeSucceeded ? "available" : "unavailable"),
            recapText: priorTranscriptBootstrapText,
            reason: restartReason,
            sessionRestarted:
              nativeSessionRestarted || priorEscalationEvidence?.sessionRestarted === true,
          }
        : null;
    if (interruptEscalation && providerContextLifecycleEvidence !== null) {
      interruptEscalation.evidence = providerContextLifecycleEvidence;
    }

    const selectedBootstrapContext: BootstrapContextSelection | null =
      handoffBootstrapText !== null
        ? { tag: "handoff_context", contextText: handoffBootstrapText, wrapLatestUserMessage: true }
        : priorTranscriptBootstrapText !== null
          ? {
              tag: "thread_context",
              contextText: priorTranscriptBootstrapText,
              wrapLatestUserMessage: true,
            }
          : null;
    const composeProviderInput = (bootstrap: BootstrapContextSelection | null): string =>
      bootstrap
        ? wrapProviderContext({ ...bootstrap, messageText: boundaryMessageText })
        : boundaryMessageText;
    const providerInputWithMentionContext = withProviderThreadStatePrompts({
      interactionMode: input.interactionMode,
      goal: activeThreadGoal(thread),
      text: `${composeProviderInput(selectedBootstrapContext)}${mentionContextSuffix}`,
    });

    const skillInlineText =
      input.skills !== undefined && input.skills.length > 0
        ? yield* Effect.tryPromise(() =>
            buildInlineSkillInstructions({
              provider: selectedProvider as ProviderKind,
              skills: input.skills ?? [],
              maxChars: Math.max(
                0,
                PROVIDER_SEND_TURN_MAX_INPUT_CHARS -
                  providerInputWithMentionContext.length -
                  PROVIDER_INPUT_SAFETY_MARGIN_CHARS,
              ),
            }),
          ).pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to inline portable skill instructions", {
                threadId: input.threadId,
                error,
              }).pipe(Effect.as("")),
            ),
          )
        : "";
    const finalizeProviderInput = (bootstrap: BootstrapContextSelection | null) => {
      if (
        selectedProvider === "claudeAgent" &&
        /^\/compact(?:\s|$)/.test(input.messageText.trim())
      ) {
        return input.messageText.trim();
      }
      const withMentionContext = `${composeProviderInput(bootstrap)}${mentionContextSuffix}`;
      const withSkills = skillInlineText
        ? `${withMentionContext}\n\n${skillInlineText}`
        : withMentionContext;
      return toNonEmptyProviderInput(
        withProviderThreadStatePrompts({
          interactionMode: input.interactionMode,
          goal: activeThreadGoal(thread),
          text: normalizeSkillMentionTextForProvider({
            provider: selectedProvider as ProviderKind,
            messageText: withSkills,
            ...(input.skills !== undefined ? { skills: input.skills } : {}),
          }),
        }),
      );
    };
    const normalizedInput = finalizeProviderInput(selectedBootstrapContext);
    const normalizedAttachments = yield* resolveProviderDispatchAttachments({
      attachments: input.attachments,
      attachmentsDir: serverConfig.attachmentsDir,
      repository: managedAttachments,
      threadId: input.threadId,
      messageId: input.messageId,
      provider: selectedProvider as ProviderKind,
      operation: "thread.turn.start",
    });
    const requestedModelSelection = input.modelSelection ?? thread.modelSelection;
    const providerTurnInput = {
      threadId: input.threadId,
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      ...(input.skills !== undefined ? { skills: input.skills } : {}),
      ...(providerMentions !== undefined ? { mentions: providerMentions } : {}),
      ...(requestedModelSelection !== undefined ? { modelSelection: requestedModelSelection } : {}),
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    };
    const sendQueuedProviderTurn = (messageText: string | undefined) =>
      Effect.gen(function* () {
        if (
          input.acceptedCacheReview &&
          !(yield* isClaudeReviewAuthorized(
            input.threadId,
            input.acceptedCacheReview.reviewId,
            "responding",
          ))
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: selectedProvider,
            operation: "thread.turn.start",
            issue: "The saved send was cancelled before delivery.",
          });
        }
        return yield* providerService.sendTurn({
          ...providerTurnInput,
          ...(messageText ? { input: messageText } : {}),
        });
      });

    const captureMessageStartCheckpoint = Effect.gen(function* () {
      if ((input.dispatchMode ?? "queue") === "steer") {
        return;
      }

      const currentThread = yield* resolveThread(input.threadId);
      if (!currentThread) {
        return;
      }

      const cwd = yield* resolveProjectedThreadWorkspaceCwd(currentThread);
      if (!cwd || !(yield* checkpointStore.isGitRepository(cwd))) {
        return;
      }

      yield* checkpointStore.captureCheckpoint({
        cwd,
        checkpointRef: checkpointRefForThreadMessageStart(
          input.threadId,
          MessageId.makeUnsafe(input.messageId),
        ),
        skipIfExists: true,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to capture provider turn start checkpoint", {
          threadId: input.threadId,
          messageId: input.messageId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

    const priorTranscriptBootstrapRetiresOnAcceptedTurn =
      shouldBootstrapPriorTranscriptContext &&
      (priorTranscriptBootstrapText !== null || !hasPriorTranscriptBootstrapContent);
    const specializedBootstrapCompletesFreshSessionContext = handoffBootstrapText !== null;
    let pendingContextBootstrapAttempt: PendingContextBootstrapAttempt | undefined;
    let startedTurn: ProviderTurnStartResult | undefined;

    if (input.reviewTarget !== undefined) {
      yield* captureMessageStartCheckpoint;
      startedTurn = yield* providerService.startReview({
        threadId: input.threadId,
        target: input.reviewTarget,
      });
    } else if (input.dispatchMode === "steer") {
      startedTurn = yield* providerService.steerTurn({
        ...providerTurnInput,
        ...(normalizedInput ? { input: normalizedInput } : {}),
      });
    } else {
      yield* captureMessageStartCheckpoint;
      const tracksDurableContextAcceptance =
        hasPendingFreshSessionTranscriptBootstrap &&
        (priorTranscriptBootstrapRetiresOnAcceptedTurn ||
          specializedBootstrapCompletesFreshSessionContext);

      const tracksEscalationAcceptance =
        interruptEscalation !== undefined && selectedProvider !== "codex";
      pendingContextBootstrapAttempt =
        tracksDurableContextAcceptance || tracksEscalationAcceptance
          ? {
              clearFreshSessionTranscript:
                priorTranscriptBootstrapText !== null ||
                (tracksDurableContextAcceptance && hasPendingFreshSessionTranscriptBootstrap),
              completeDurablePriorTranscript:
                tracksDurableContextAcceptance && hasPendingFreshSessionTranscriptBootstrap,
              lifecycleEvidence: providerContextLifecycleEvidence,
              lifecycleEvidenceCreatedAt: input.createdAt,
              ...(interruptEscalation ? { interruptEscalation } : {}),
            }
          : undefined;
      if (pendingContextBootstrapAttempt) {
        pendingContextBootstrapAttempts.set(input.threadId, pendingContextBootstrapAttempt);
      }
      const ensureSessionForStaleRetry = ensureSessionForThread(input.threadId, input.createdAt, {
        ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
        ...(input.providerOptions !== undefined ? { providerOptions: input.providerOptions } : {}),
        enableComputerControl,
        ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
      });
      const replayWithTranscriptBootstrap = (
        cause: ProviderServiceError,
        preserveActiveRuntime = false,
      ) =>
        Effect.gen(function* () {
          yield* clearStaleProviderResumeState({
            threadId: input.threadId,
            cause,
            ...(preserveActiveRuntime ? { preserveActiveRuntime: true } : {}),
          });
          yield* ensureSessionForStaleRetry;

          const retryBootstrapText =
            priorTranscriptBootstrapAvailableChars > 0
              ? buildPriorTranscriptBootstrapText(
                  thread,
                  transcriptBoundaryMessageId,
                  priorTranscriptBootstrapAvailableChars,
                )
              : null;
          providerContextLifecycleEvidence = {
            nativeHistory: "unavailable",
            recapText: retryBootstrapText,
            reason: interruptEscalation ? "interrupt-escalation" : "native-resume-failed",
            sessionRestarted: !preserveActiveRuntime,
          };
          if (interruptEscalation) {
            interruptEscalation.evidence = providerContextLifecycleEvidence;
          }
          const retryNormalizedInput = finalizeProviderInput(
            retryBootstrapText !== null
              ? {
                  tag: "thread_context",
                  contextText: retryBootstrapText,
                  wrapLatestUserMessage: true,
                }
              : null,
          );

          yield* Effect.logWarning(
            "provider command reactor retrying claude turn after stale resume",
            {
              threadId: input.threadId,
              messageId: input.messageId,
              bootstrappedPriorTranscript: retryBootstrapText !== null,
            },
          );
          return yield* sendQueuedProviderTurn(retryNormalizedInput);
        });
      const sentTurn = yield* sendQueuedProviderTurn(normalizedInput).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (selectedProvider !== "claudeAgent" || !isStaleClaudeResumeError(error)) {
              return yield* Effect.fail(error);
            }

            // Stale-resume errors can be transient CLI/session-file races, so retry the native resume id once
            // before paying the transcript bootstrap.
            if (!providerService.stopRuntimeSession) {
              return yield* replayWithTranscriptBootstrap(error);
            }

            const liveBackgroundTasks = providerService.hasLiveRuntimeTasks
              ? yield* providerService.hasLiveRuntimeTasks({ threadId: input.threadId })
              : false;
            if (liveBackgroundTasks) {
              yield* Effect.logWarning(
                "provider command reactor skipping native resume retry: live background tasks",
                {
                  threadId: input.threadId,
                  messageId: input.messageId,
                },
              );
              return yield* replayWithTranscriptBootstrap(error, true);
            }
            yield* providerService
              .stopRuntimeSession({ threadId: input.threadId })
              .pipe(Effect.catch(() => Effect.void));
            yield* ensureSessionForStaleRetry;
            yield* Effect.logWarning(
              "provider command reactor retrying claude turn with native resume",
              {
                threadId: input.threadId,
                messageId: input.messageId,
              },
            );
            return yield* sendQueuedProviderTurn(normalizedInput).pipe(
              Effect.catch((retryError) =>
                isStaleClaudeResumeError(retryError)
                  ? replayWithTranscriptBootstrap(retryError)
                  : Effect.fail(retryError),
              ),
            );
          }),
        ),
        Effect.onError(() =>
          Effect.gen(function* () {
            yield* Effect.sync(() => {
              if (
                pendingContextBootstrapAttempt &&
                pendingContextBootstrapAttempts.get(input.threadId) ===
                  pendingContextBootstrapAttempt
              ) {
                pendingContextBootstrapAttempts.delete(input.threadId);
              }
            });
          }),
        ),
      );
      startedTurn = sentTurn;
      if (completionContext)
        deliveryGate.markCompletionContext(
          input.completionEventSequence ?? input.sourceEventSequence,
        );
      if (!pendingContextBootstrapAttempt) {
        completeInterruptEscalation(input.threadId, interruptEscalation);
      }
      if (pendingContextBootstrapAttempt) {
        pendingContextBootstrapAttempt.lifecycleEvidence = providerContextLifecycleEvidence;
        pendingContextBootstrapAttempt.turnId = sentTurn.turnId;
        const terminalEvent = pendingContextBootstrapAttempt.terminalEvent;
        if (terminalEvent?.turnId === sentTurn.turnId) {
          if (
            terminalEvent.type !== "turn.completed" ||
            terminalEvent.payload.state !== "completed"
          ) {
            pendingContextBootstrapAttempts.delete(input.threadId);
          } else {
            yield* completePendingContextBootstrapAttempt(
              input.threadId,
              pendingContextBootstrapAttempt,
              terminalEvent,
            );
          }
        }
      }
      if (
        providerContextLifecycleEvidence !== null &&
        pendingContextBootstrapAttempt === undefined
      ) {
        yield* retainAndAppendProviderContextLifecycleActivity(
          toProviderContextLifecycleActivityRecord({
            threadId: input.threadId,
            turnId: sentTurn.turnId,
            provider: selectedProvider as ProviderKind,
            evidence: providerContextLifecycleEvidence,
            createdAt: input.createdAt,
          }),
        );
      }
    }

    if (input.reviewTarget !== undefined) {
      completeInterruptEscalation(input.threadId, interruptEscalation);
    }
    if (handoffBootstrapText && thread.handoff !== null && input.reviewTarget === undefined) {
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: serverCommandId("handoff-bootstrap-complete"),
        threadId: input.threadId,
        handoff: {
          ...thread.handoff,
          bootstrapStatus: "completed",
        },
      });
    }
    const retiresPriorTranscriptBootstrap =
      priorTranscriptBootstrapRetiresOnAcceptedTurn &&
      input.reviewTarget === undefined &&
      pendingContextBootstrapAttempt === undefined;
    const completesSpecializedBootstrapImmediately =
      specializedBootstrapCompletesFreshSessionContext &&
      input.reviewTarget === undefined &&
      pendingContextBootstrapAttempt === undefined;
    if (retiresPriorTranscriptBootstrap || completesSpecializedBootstrapImmediately) {
      let durableCompletionSucceeded = true;
      if (
        hasPendingFreshSessionTranscriptBootstrap &&
        providerService.completePriorTranscriptBootstrap
      ) {
        durableCompletionSucceeded = yield* persistPriorTranscriptBootstrapCompletion(
          input.threadId,
          selectedProvider as ProviderKind,
        );
      }
      if (durableCompletionSucceeded) {
        freshSessionContextBootstrapThreadIds.delete(input.threadId);
      }
    }
    return startedTurn;
  });
  return { dispatchTurnForThread };
}
