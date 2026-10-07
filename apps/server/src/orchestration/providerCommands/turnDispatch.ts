import { redactDiagnosticText } from "../../agentGateway/diagnosticSanitizer";
import { HandoffTransitions } from "../Services/HandoffTransitions";
import type { ServiceMap } from "effect";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ServerConfig } from "../../server/config.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { Option, Effect, Cause } from "effect";
import {
  type ModelSelection,
  type ProviderStartOptions,
  type ProviderReviewTarget,
  type RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";
import { AgentGatewayOperationRepository } from "../../agentGateway/Services/AgentGatewayOperationRepository.ts";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ThreadId, ProviderKind, MessageId } from "@glade/contracts/core/baseSchemas";
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
} from "../../provider/core/Errors.ts";
import { resolveProviderDispatchAttachments } from "../../provider/core/providerAttachmentPaths.ts";
import {
  ProviderContextLifecycleReason,
  ProviderContextLifecycleEvidence,
} from "./contextLifecycle";
import { listPriorTranscriptMessages, buildPriorTranscriptBootstrapText } from "../handoff.ts";
import { checkpointRefForThreadMessageStart } from "../../checkpointing/Utils.ts";
import { type ProviderTurnStartResult } from "@glade/contracts/provider/provider";
import { isStaleClaudeResumeError } from "./interactionPolicy";
import { serverCommandId } from "./deliveryClaims";
import { makeProviderSessionConfiguration } from "./sessionConfiguration";
import { PendingInterruptEscalation, PendingContextBootstrapAttempt } from "./runtimeState";
import { makeProviderContextBootstrap } from "./contextBootstrap";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";
import { HandoffPreparation } from "../Services/HandoffPreparation";
import { ProviderDeliveryGate } from "../Services/ProviderDeliveryGate.ts";

export function makeProviderTurnDispatch(input: {
  readonly handoffPreparation: Option.Option<ServiceMap.Service.Shape<typeof HandoffPreparation>>;
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
    handoffPreparation,
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
    const shouldBootstrapHandoff =
      thread.handoff?.bootstrapStatus === "pending" && thread.handoff.stage !== "cancelled";
    const handoffBootstrapAvailableChars = availableProviderContextChars({
      tag: "handoff_context",
      messageText: bootstrapBudgetMessageText,
      wrapLatestUserMessage: true,
    });
    const handoffBootstrapText =
      shouldBootstrapHandoff && input.reviewTarget === undefined
        ? yield* Effect.gen(function* () {
            const preparation = handoffPreparation;
            if (Option.isNone(preparation) || handoffBootstrapAvailableChars === 0) {
              return yield* new ProviderAdapterValidationError({
                provider: selectedProvider as ProviderKind,
                operation: "thread.turn.start",
                issue:
                  "The handoff context cannot be prepared. Retry preparation or shorten the latest message.",
              });
            }
            return yield* preparation.value.prepare({
              threadId: input.threadId,
              modelSelection: input.modelSelection ?? thread.modelSelection,
              providerOptions: input.providerOptions,
              latestRequest: bootstrapBudgetMessageText,
              attachmentCount: input.attachments?.length ?? 0,
            });
          })
        : null;

    const transitions = handoffTransitions;
    const operationId = thread.handoff?.operationId;
    if (handoffBootstrapText && operationId) {
      if (
        Option.isNone(transitions) ||
        input.sourceEvent?.payload.handoffOperationId !== operationId
      )
        return yield* new ProviderAdapterValidationError({
          provider: selectedProvider as ProviderKind,
          operation: "handoff.activate",
          issue: "The provider transition is stale.",
        });
      yield* transitions.value.validate(input.threadId, operationId);
      yield* transitions.value.update(input.threadId, operationId, { stage: "activating" });
      // Retirement removes the source binding and gateway authority before destination admission.
      yield* providerService.stopSession({
        threadId: input.threadId,
        expectedLifecycleGeneration: thread.handoff?.sourceGeneration,
      });
      yield* transitions.value.update(input.threadId, operationId, {
        stage: "activating",
        sourceRetired: true,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.session.set",
        createdAt: input.createdAt,
        commandId: serverCommandId("handoff-source-retired"),
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
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: serverCommandId("handoff-target-selected"),
        threadId: input.threadId,
        expectedHandoffOperationId: operationId,
        modelSelection: thread.handoff!.destinationModelSelection!,
      });
      threadSessionSettings.setModelSelection(
        input.threadId,
        thread.handoff!.destinationModelSelection!,
      );
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
    });
    const validateHandoffAdmission =
      operationId && handoffBootstrapText && Option.isSome(transitions)
        ? transitions.value.validate(input.threadId, operationId).pipe(
            Effect.tapError(() =>
              providerService
                .stopSession({
                  threadId: input.threadId,
                  ...(destinationGeneration !== undefined
                    ? { expectedLifecycleGeneration: destinationGeneration }
                    : {}),
                })
                .pipe(Effect.ignore),
            ),
            Effect.asVoid,
          )
        : Effect.void;
    if (operationId && handoffBootstrapText && destinationGeneration === undefined)
      return yield* new ProviderAdapterValidationError({
        provider: selectedProvider as ProviderKind,
        operation: "handoff.activate",
        issue: "Destination startup did not return its session generation.",
      });
    yield* validateHandoffAdmission;
    if (input.providerOptions !== undefined) {
      threadSessionSettings.setProviderOptions(input.threadId, input.providerOptions);
    }
    if (input.modelSelection !== undefined) {
      threadSessionSettings.setModelSelection(input.threadId, input.modelSelection);
    }

    if (handoffBootstrapText && operationId && Option.isSome(transitions))
      yield* transitions.value.update(input.threadId, operationId, {
        stage: "activated",
        transferredContext: redactDiagnosticText(handoffBootstrapText),
      });

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
    const finalizeProviderInput = (bootstrap: BootstrapContextSelection | null) => {
      if (
        selectedProvider === "claudeAgent" &&
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
      validateHandoffAdmission.pipe(
        Effect.andThen(() =>
          providerService.sendTurn({
            ...providerTurnInput,
            ...(operationId && destinationGeneration !== undefined
              ? { expectedLifecycleGeneration: destinationGeneration }
              : {}),
            ...(messageText ? { input: messageText } : {}),
          }),
        ),
      );

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
            if (
              handoffBootstrapText ||
              selectedProvider !== "claudeAgent" ||
              !isStaleClaudeResumeError(error)
            ) {
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
      if (operationId && Option.isSome(transitions)) {
        yield* transitions.value.update(input.threadId, operationId, {
          stage: "delivered",
          bootstrapStatus: "completed",
        });
      } else {
        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: serverCommandId("handoff-bootstrap-complete"),
          threadId: input.threadId,
          handoff: { ...thread.handoff, bootstrapStatus: "completed" },
        });
      }
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
