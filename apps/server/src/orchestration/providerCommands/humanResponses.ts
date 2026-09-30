import { ServiceMap, Effect, Option, Cause } from "effect";
import { ProjectionPendingInteractionRepository } from "../../persistence/Services/ProjectionPendingInteractions.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  InteractionResponseEvent,
  isUnavailableInteractionRuntime,
  isUnknownPendingApprovalRequestError,
  interactionFailureSettlementStatus,
  isUnknownPendingUserInputRequestError,
} from "./interactionPolicy";
import { type OrchestrationDispatchError } from "../Errors.ts";
import { buildStalePendingRequestFailureDetail } from "@glade/shared/threads/threadSummary";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import { makeProviderThreadProjection } from "./threadProjection";
import { makeProviderProjectionAccess } from "./projectionAccess";

export function makeProviderHumanResponses(input: {
  readonly appendProviderFailureActivity: ReturnType<
    typeof makeProviderThreadProjection
  >["appendProviderFailureActivity"];
  readonly pendingInteractions: ServiceMap.Service.Shape<
    typeof ProjectionPendingInteractionRepository
  >;
  readonly resolveProviderSessionThread: ReturnType<
    typeof makeProviderProjectionAccess
  >["resolveProviderSessionThread"];
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
}) {
  const {
    appendProviderFailureActivity,
    pendingInteractions,
    resolveProviderSessionThread,
    providerService,
  } = input;
  const appendInteractionResponseFailure = (
    event: InteractionResponseEvent,
    input: {
      readonly interactionKind: "approval" | "userInput";
      readonly detail: string;
      readonly settlementStatus: "retryable" | "uncertain";
    },
  ): Effect.Effect<void, OrchestrationDispatchError> =>
    event.commandId === null
      ? Effect.void
      : appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind:
            input.interactionKind === "approval"
              ? "provider.approval.respond.failed"
              : "provider.user-input.respond.failed",
          summary:
            input.interactionKind === "approval"
              ? "Provider approval response failed"
              : "Provider user input response failed",
          detail: input.detail,
          turnId: null,
          createdAt: event.payload.createdAt,
          requestId: event.payload.requestId,
          responseCommandId: event.commandId,
          settlementStatus: input.settlementStatus,
          ...(event.payload.lifecycleGeneration === undefined
            ? {}
            : { lifecycleGeneration: event.payload.lifecycleGeneration }),
        });

  const claimInteractionResponse = Effect.fnUntraced(function* (input: {
    readonly event: InteractionResponseEvent;
    readonly interactionKind: "approval" | "userInput";
    readonly decision: Parameters<typeof pendingInteractions.claimResponse>[0]["decision"];
  }) {
    const { event } = input;
    if (event.commandId === null) return null;
    const claimed = yield* pendingInteractions.claimResponse({
      threadId: event.payload.threadId,
      interactionKind: input.interactionKind,
      requestId: event.payload.requestId,
      lifecycleGeneration: event.payload.lifecycleGeneration ?? null,
      responseCommandId: event.commandId,
      decision: input.decision,
      requestedAt: event.payload.createdAt,
    });
    const pending = yield* pendingInteractions.getByIdentity({
      threadId: event.payload.threadId,
      interactionKind: input.interactionKind,
      requestId: event.payload.requestId,
    });
    if (
      !claimed &&
      (Option.isNone(pending) ||
        pending.value.status !== "responding" ||
        pending.value.responseCommandId !== event.commandId)
    ) {
      const pendingRow = Option.getOrUndefined(pending);
      if (pendingRow?.status === "responding" || pendingRow?.status === "confirmed") {
        return null;
      }
      if (
        pendingRow?.lifecycleGeneration != null &&
        event.payload.lifecycleGeneration === undefined
      ) {
        yield* appendInteractionResponseFailure(event, {
          interactionKind: input.interactionKind,
          detail:
            "Refresh this thread before answering: the provider lifecycle generation is missing.",
          settlementStatus: "retryable",
        });
        return null;
      }
      // No durable row, or a row this command can never claim (e.g. a lifecycle generation mismatch).
      // Silence here permanently stranded the prompt: the client saw neither a resolution nor a failure,
      // so every retry was swallowed again. Fail loudly so the stale prompt gets cleared.
      yield* Effect.logWarning("provider.interaction.response.unclaimable", {
        threadId: event.payload.threadId,
        interactionKind: input.interactionKind,
        requestId: event.payload.requestId,
        commandId: event.commandId,
        rowStatus: pendingRow?.status ?? "missing",
        rowLifecycleGeneration: pendingRow?.lifecycleGeneration ?? null,
        commandLifecycleGeneration: event.payload.lifecycleGeneration ?? null,
      });
      yield* appendInteractionResponseFailure(event, {
        interactionKind: input.interactionKind,
        detail: buildStalePendingRequestFailureDetail(
          input.interactionKind === "approval" ? "approval" : "user-input",
          event.payload.requestId,
        ),
        settlementStatus: "uncertain",
      });
      return null;
    }
    const providerThread = yield* resolveProviderSessionThread(event.payload.threadId);
    if (!providerThread) {
      yield* appendInteractionResponseFailure(event, {
        interactionKind: input.interactionKind,
        detail: buildStalePendingRequestFailureDetail(
          input.interactionKind === "approval" ? "approval" : "user-input",
          event.payload.requestId,
        ),
        settlementStatus: "uncertain",
      });
      return null;
    }
    if (providerThread.session?.status !== "stopped") return providerThread.id;
    yield* appendInteractionResponseFailure(event, {
      interactionKind: input.interactionKind,
      detail: buildStalePendingRequestFailureDetail(
        input.interactionKind === "approval" ? "approval" : "user-input",
        event.payload.requestId,
      ),
      settlementStatus: "uncertain",
    });
    return null;
  });

  const processApprovalResponseRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.approval-response-requested" }>,
  ) {
    const providerThreadId = yield* claimInteractionResponse({
      event,
      interactionKind: "approval",
      decision: event.payload.decision,
    });
    if (providerThreadId === null) return;

    yield* providerService
      .respondToRequest({
        threadId: providerThreadId,
        requestId: event.payload.requestId,
        ...(event.payload.lifecycleGeneration !== undefined
          ? { lifecycleGeneration: event.payload.lifecycleGeneration }
          : {}),
        decision: event.payload.decision,
      })
      .pipe(
        Effect.asVoid,
        Effect.catchCause((cause) => {
          const unknownPendingRequest =
            isUnavailableInteractionRuntime(cause) || isUnknownPendingApprovalRequestError(cause);
          return appendInteractionResponseFailure(event, {
            interactionKind: "approval",
            detail: unknownPendingRequest
              ? buildStalePendingRequestFailureDetail("approval", event.payload.requestId)
              : Cause.pretty(cause),
            settlementStatus: interactionFailureSettlementStatus(cause, unknownPendingRequest),
          });
        }),
      );
  });

  const processUserInputResponseRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.user-input-response-requested" }>,
  ) {
    const providerThreadId = yield* claimInteractionResponse({
      event,
      interactionKind: "userInput",
      decision: null,
    });
    if (providerThreadId === null) return;

    yield* providerService
      .respondToUserInput({
        threadId: providerThreadId,
        requestId: event.payload.requestId,
        ...(event.payload.lifecycleGeneration !== undefined
          ? { lifecycleGeneration: event.payload.lifecycleGeneration }
          : {}),
        answers: event.payload.answers,
      })
      .pipe(
        Effect.asVoid,
        Effect.catchCause((cause) => {
          const unknownPendingRequest =
            isUnavailableInteractionRuntime(cause) || isUnknownPendingUserInputRequestError(cause);
          return appendInteractionResponseFailure(event, {
            interactionKind: "userInput",
            detail: unknownPendingRequest
              ? buildStalePendingRequestFailureDetail("user-input", event.payload.requestId)
              : Cause.pretty(cause),
            settlementStatus: interactionFailureSettlementStatus(cause, unknownPendingRequest),
          });
        }),
      );
  });
  return { processApprovalResponseRequested, processUserInputResponseRequested };
}
