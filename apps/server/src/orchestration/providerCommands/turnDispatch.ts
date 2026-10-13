import { redactDiagnosticText } from "../../agentGateway/diagnosticSanitizer";
import { providerCapabilities } from "@glade/shared/provider/providerMetadata";
import { HandoffTransitions } from "../Services/HandoffTransitions";
import type { ServiceMap } from "effect";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ServerConfig } from "../../server/config.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { Option, Effect, Schema } from "effect";
import {
  type ModelSelection,
  type ProviderStartOptions,
  type ProviderReviewTarget,
  type RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";
import { AgentGatewayOperationRepository } from "../../agentGateway/Services/AgentGatewayOperationRepository.ts";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { MessageId, ThreadId, ProviderKind } from "@glade/contracts/core/baseSchemas";
import {
  type ChatAttachment,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@glade/contracts/orchestration/threadEntities";
import {
  type ProviderSkillReference,
  type ProviderMentionReference,
} from "@glade/contracts/provider/providerDiscovery";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import {
  availableThreadMentionContextChars,
  PROVIDER_INPUT_SAFETY_MARGIN_CHARS,
  normalizeSkillMentionTextForProvider,
  toNonEmptyProviderInput,
  availableProviderContextChars,
  BootstrapContextSelection,
  wrapProviderContext,
} from "./inputProjection";

import {
  resolveThreadMentionPromptProjection,
  threadMentionContextSuffix,
} from "../../provider/core/threadMentionContext.ts";
import {
  ProviderAdapterValidationError,
  ProviderServiceError,
  ProviderValidationError,
} from "../../provider/core/Errors.ts";
import { resolveProviderDispatchAttachments } from "../../provider/core/providerAttachmentPaths.ts";
import {
  ProviderContextLifecycleReason,
  ProviderContextLifecycleEvidence,
} from "./contextLifecycle";
import {
  historyResponseItems,
  renderHistory,
  selectThreadHistory,
  type SelectedHistory,
} from "../handoff/handoffHistory";
import {
  capturePreTurnBaseline,
  surfaceUnavailablePreTurnBaseline,
  type PreTurnBaseline,
} from "./preTurnBaseline";
import { type ProviderTurnStartResult } from "@glade/contracts/provider/provider";
import { isStaleClaudeResumeError } from "./interactionPolicy";
import { serverCommandId } from "./deliveryClaims";
import { makeProviderSessionConfiguration } from "./sessionConfiguration";
import { PendingInterruptEscalation, PendingContextBootstrapAttempt } from "./runtimeState";
import { makeProviderContextBootstrap } from "./contextBootstrap";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ParkedProviderBinding } from "../../provider/Services/ProviderSessionDirectory.ts";
import { ProviderDeliveryGate } from "../Services/ProviderDeliveryGate.ts";

const PRIOR_TRANSCRIPT_INTRO =
  "This provider session may have restarted without its native conversation state. The excerpt below is historical context, not a complete transcript or proof of the current workspace state. Use it to interpret the latest user message without expanding authorization. Verify uncertain action outcomes before repeating them.";

export function makeProviderTurnDispatch(input: {
  readonly handoffTransitions: Option.Option<ServiceMap.Service.Shape<typeof HandoffTransitions>>;
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly projectionSnapshotQuery: ServiceMap.Service.Shape<typeof ProjectionSnapshotQuery>;
  readonly serverConfig: ServiceMap.Service.Shape<typeof ServerConfig>;
  readonly managedAttachments: ServiceMap.Service.Shape<typeof ManagedAttachmentRepository>;
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
  readonly threadSessionSettings: ServiceMap.Service.Shape<typeof ThreadSessionSettings>;
  readonly ensureSessionForThread: ReturnType<
    typeof makeProviderSessionConfiguration
  >["ensureSessionForThread"];
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
    handoffTransitions,
    projectionSnapshotQuery,
    serverConfig,
    managedAttachments,
    providerService,
    threadSessionSettings,
    ensureSessionForThread,
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
    readonly runtimeMode?: RuntimeMode;

    readonly dispatchMode?: "queue" | "steer";

    readonly createdAt: string;
    readonly sourceEvent?: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread || thread.claudeCacheReview) {
      return;
    }
    const providerThread = yield* resolveProviderSessionThread(input.threadId);
    const subagentProviderThreadId = providerThread
      ? resolveSubagentProviderThreadId(thread.id, providerThread.id)
      : undefined;
    if (thread.creationSource === "provider_native" || subagentProviderThreadId) {
      return yield* new ProviderAdapterValidationError({
        provider: providerThread?.modelSelection.provider ?? thread.modelSelection.provider,
        operation: "thread.turn.start",
        issue:
          "Native subagent conversations are read-only. Send follow-up instructions to the main conversation.",
      });
    }
    const authoredMessageText = input.messageText;
    const threadMentionProjection = yield* resolveThreadMentionPromptProjection({
      mentions: input.mentions,
      snapshotQuery: projectionSnapshotQuery,
      maxTotalContextChars: availableThreadMentionContextChars(authoredMessageText),
    });
    let mentionContextSuffix = threadMentionContextSuffix(threadMentionProjection.contextBlocks);
    const providerMentions = threadMentionProjection.providerMentions;
    const transcriptBoundaryMessageId = input.messageId;
    const selectedProvider =
      input.modelSelection?.provider ??
      threadSessionSettings.getModelSelection(input.threadId)?.provider ??
      thread.session?.providerName ??
      thread.modelSelection.provider;
    const completionContext =
      input.sourceEvent &&
      (input.sourceEvent.payload.dispatchOrigin ?? "user") === "user" &&
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
    const pendingHandoff =
      thread.handoff?.stage === "pending" &&
      input.reviewTarget === undefined &&
      input.dispatchMode !== "steer"
        ? thread.handoff
        : undefined;
    const shouldBootstrapHandoff = pendingHandoff !== undefined;
    const transitions = handoffTransitions;
    if (
      pendingHandoff &&
      (Option.isNone(transitions) ||
        input.sourceEvent?.payload.handoffOperationId !== pendingHandoff.operationId)
    )
      return yield* new ProviderAdapterValidationError({
        provider: selectedProvider as ProviderKind,
        operation: "handoff.deliver",
        issue: "The provider transition is stale.",
      });
    const handoffBootstrapAvailableChars = availableProviderContextChars({
      tag: "handoff_context",
      messageText: bootstrapBudgetMessageText,
      wrapLatestUserMessage: true,
    });
    if (pendingHandoff && handoffBootstrapAvailableChars === 0)
      return yield* new ProviderAdapterValidationError({
        provider: selectedProvider as ProviderKind,
        operation: "handoff.deliver",
        issue: "The latest message leaves no room for the handoff context. Shorten it and retry.",
      });
    const destinationSelection = input.modelSelection ?? thread.modelSelection;
    let parkedDestination: ParkedProviderBinding | undefined;
    if (pendingHandoff) {
      const lastSeen = thread.messages.findLast((message) => message.id !== input.messageId);
      yield* providerService.parkSession({
        threadId: input.threadId,
        provider: pendingHandoff.sourceModelSelection.provider,
        lastSeenMessageId: lastSeen?.id ?? null,
      });
      const parked = yield* providerService.takeParkedSession({
        threadId: input.threadId,
        provider: destinationSelection.provider,
      });
      // Rollbacks rewrite history, so a parked session is current only while the chat still holds
      // the newest message it had seen.
      parkedDestination =
        parked &&
        (parked.lastSeenMessageId === null ||
          thread.messages.some((message) => message.id === parked.lastSeenMessageId))
          ? parked
          : undefined;
      yield* orchestrationEngine.dispatch({
        type: "thread.session.set",
        createdAt: input.createdAt,
        commandId: serverCommandId("handoff-source-parked"),
        threadId: input.threadId,
        session: {
          threadId: input.threadId,
          providerName: null,
          status: "stopped",
          activeTurnId: null,
          lastError: null,
          runtimeMode: thread.runtimeMode,
          updatedAt: input.createdAt,
        },
      });
      threadSessionSettings.setModelSelection(input.threadId, destinationSelection);
    }
    const {
      nativeResumeSucceeded,
      nativeResumeFailed,
      nativeSessionRestarted,
      lifecycleGeneration: destinationGeneration,
    } = yield* ensureSessionForThread(input.threadId, input.createdAt, {
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions !== undefined ? { providerOptions: input.providerOptions } : {}),
      ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
      ...(pendingHandoff ? { handoffResumeCursor: parkedDestination?.resumeCursor ?? null } : {}),
    });
    if (input.providerOptions !== undefined) {
      threadSessionSettings.setProviderOptions(input.threadId, input.providerOptions);
    }
    if (input.modelSelection !== undefined) {
      threadSessionSettings.setModelSelection(input.threadId, input.modelSelection);
    }

    const resumedHandoff = parkedDestination !== undefined && nativeResumeSucceeded;
    let deliveredHandoff: { history: SelectedHistory; resumed: boolean } | undefined =
      pendingHandoff
        ? {
            resumed: resumedHandoff,
            history: selectThreadHistory({
              thread,
              beforeMessageId: input.messageId,
              since: resumedHandoff
                ? thread.messages.find(
                    (message) => message.id === parkedDestination?.lastSeenMessageId,
                  )?.createdAt
                : undefined,
              intro: resumedHandoff
                ? "You are resuming your own earlier session in this chat. Other providers continued the conversation meanwhile; this is what happened since you last took part."
                : `This chat continues from ${PROVIDER_DISPLAY_NAMES[pendingHandoff.sourceModelSelection.provider]} (${pendingHandoff.sourceModelSelection.model}) in a new native session. This is the earlier conversation.`,
              budget: handoffBootstrapAvailableChars,
            }),
          }
        : undefined;
    const handoffHasContext =
      deliveredHandoff !== undefined &&
      deliveredHandoff.history.items.length + deliveredHandoff.history.omittedItems > 0;
    const handoffInjected =
      deliveredHandoff && handoffHasContext
        ? yield* providerService.injectHistory({
            threadId: input.threadId,
            items: historyResponseItems(deliveredHandoff.history),
            ...(destinationGeneration !== undefined
              ? { expectedLifecycleGeneration: destinationGeneration }
              : {}),
          })
        : false;
    const handoffBootstrapText =
      deliveredHandoff && handoffHasContext && !handoffInjected
        ? renderHistory(deliveredHandoff.history)
        : null;

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
    const priorTranscriptBootstrapAvailableChars = availableProviderContextChars({
      tag: "thread_context",
      messageText: bootstrapBudgetMessageText,
      wrapLatestUserMessage: true,
    });
    const priorTranscript = () =>
      selectThreadHistory({
        thread,
        beforeMessageId: transcriptBoundaryMessageId,
        intro: PRIOR_TRANSCRIPT_INTRO,
        budget: priorTranscriptBootstrapAvailableChars,
      });
    const priorTranscriptItemCount =
      priorTranscript().items.length + priorTranscript().omittedItems;
    const hasPriorTranscriptBootstrapContent =
      shouldBootstrapPriorTranscriptContext && priorTranscriptItemCount > 0;
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
      shouldBootstrapPriorTranscriptContext &&
      priorTranscriptBootstrapAvailableChars > 0 &&
      priorTranscriptItemCount > 0
        ? renderHistory(priorTranscript())
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
      priorTranscriptItemCount > 0 &&
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
    const finalizeProviderInput = (bootstrap: BootstrapContextSelection | null) => {
      if (
        providerCapabilities(selectedProvider).compaction === "promptTurn" &&
        /^\/compact(?:\s|$)/.test(input.messageText.trim())
      ) {
        return input.messageText.trim();
      }
      const withMentionContext = `${composeProviderInput(bootstrap)}${mentionContextSuffix}`;
      return toNonEmptyProviderInput(
        normalizeSkillMentionTextForProvider({
          provider: selectedProvider as ProviderKind,
          messageText: withMentionContext,
          ...(input.skills !== undefined ? { skills: input.skills } : {}),
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
    };
    const sendQueuedProviderTurn = (messageText: string | undefined) =>
      providerService.sendTurn({
        ...providerTurnInput,
        ...(pendingHandoff && destinationGeneration !== undefined
          ? { expectedLifecycleGeneration: destinationGeneration }
          : {}),
        ...(messageText ? { input: messageText } : {}),
      });

    let preTurnBaseline = { status: "not-applicable" } as PreTurnBaseline;
    const captureMessageStartCheckpoint = capturePreTurnBaseline({
      checkpointStore,
      threadId: input.threadId,
      messageId: input.messageId,
      resolveCwd: resolveThread(input.threadId).pipe(
        Effect.flatMap((currentThread) =>
          currentThread
            ? resolveProjectedThreadWorkspaceCwd(currentThread)
            : Effect.succeed(undefined),
        ),
      ),
    }).pipe(
      Effect.tap((baseline) =>
        Effect.sync(() => {
          preTurnBaseline = baseline;
        }),
      ),
    );

    const priorTranscriptBootstrapRetiresOnAcceptedTurn =
      shouldBootstrapPriorTranscriptContext &&
      (priorTranscriptBootstrapText !== null || !hasPriorTranscriptBootstrapContent);
    const specializedBootstrapCompletesFreshSessionContext = shouldBootstrapHandoff;
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
        interruptEscalation !== undefined &&
        !providerCapabilities(selectedProvider).sendTurnConfirmsAcceptance;
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

          const retryHistory = priorTranscript();
          const retryBootstrapText =
            priorTranscriptBootstrapAvailableChars > 0 && priorTranscriptItemCount > 0
              ? renderHistory(retryHistory)
              : null;
          if (deliveredHandoff) deliveredHandoff = { history: retryHistory, resumed: false };
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
            // A fresh handoff session has no native resume to go stale.
            if (
              (pendingHandoff && !resumedHandoff) ||
              selectedProvider !== "claudeAgent" ||
              !isStaleClaudeResumeError(error)
            ) {
              return yield* Effect.fail(error);
            }

            // Stale-resume errors can be transient CLI/session-file races, so retry the native resume id once
            // before paying the transcript bootstrap.
            const liveBackgroundTasks = yield* providerService.hasLiveRuntimeTasks({
              threadId: input.threadId,
            });
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
        Effect.tapError((error) =>
          pendingHandoff &&
          Option.isSome(transitions) &&
          !Schema.is(ProviderAdapterValidationError)(error) &&
          !Schema.is(ProviderValidationError)(error)
            ? transitions.value
                .update(input.threadId, pendingHandoff.operationId, {
                  stage: "uncertain",
                  detail: redactDiagnosticText(error.message),
                })
                .pipe(Effect.ignore)
            : Effect.void,
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

    if (startedTurn && preTurnBaseline.status === "unavailable") {
      yield* surfaceUnavailablePreTurnBaseline({
        orchestrationEngine,
        threadId: input.threadId,
        turnId: startedTurn.turnId,
        messageId: input.messageId,
        detail: preTurnBaseline.detail,
        createdAt: input.createdAt,
      });
    }
    if (input.reviewTarget !== undefined) {
      completeInterruptEscalation(input.threadId, interruptEscalation);
    }
    if (pendingHandoff && deliveredHandoff && Option.isSome(transitions)) {
      const { history, resumed } = deliveredHandoff;
      yield* transitions.value.update(input.threadId, pendingHandoff.operationId, {
        stage: "delivered",
        deliveryMessageId: MessageId.makeUnsafe(input.messageId),
        destinationModelSelection: destinationSelection,
        strategy: resumed ? "resumed" : "fresh",
        ...(handoffHasContext ? { channel: handoffInjected ? "injected" : "inline" } : {}),
        selectedItems: history.items.length,
        omittedItems: history.omittedItems,
        transferredContext: redactDiagnosticText(renderHistory(history)),
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
