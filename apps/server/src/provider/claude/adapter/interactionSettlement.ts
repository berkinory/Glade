import { Effect, Deferred } from "effect";
import { EventId, ApprovalRequestId, TurnId } from "@glade/contracts/core/baseSchemas";
import {
  ClaudeSessionContext,
  PendingApproval,
  PROVIDER,
  PendingUserInput,
  PendingUserInputResult,
} from "./sessionTypes";
import { type ProviderApprovalDecision } from "@glade/contracts/provider/sessionPolicy";
import {
  asRuntimeRequestId,
  nativeProviderRefs,
  remapAnswersToClaudeQuestionText,
} from "./messageContent";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";

export function makeClaudeInteractionSettlement(input: {
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
}) {
  const { makeEventStamp, offerRuntimeEvent } = input;
  const settlePendingApproval = (
    context: ClaudeSessionContext,
    requestId: ApprovalRequestId,
    pending: PendingApproval,
    decision: ProviderApprovalDecision,
  ): Effect.Effect<ProviderApprovalDecision> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const ownsSettlement = yield* Effect.sync(() => {
          if (context.pendingApprovals.get(requestId) !== pending) {
            return false;
          }
          if (pending.settlementStarted) {
            return false;
          }
          pending.settlementStarted = true;
          return true;
        });
        if (!ownsSettlement) {
          return yield* Deferred.await(pending.settled);
        }

        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "request.resolved",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(pending.turnId ? { turnId: pending.turnId } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: {
            requestType: pending.requestType,
            decision,
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: pending.providerItemId,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/decision",
            payload: { decision },
          },
        });
        context.pendingApprovals.delete(requestId);
        yield* Deferred.succeed(pending.decision, decision);
        yield* Deferred.succeed(pending.settled, decision);
        return decision;
      }),
    );

  const settlePendingUserInput = (
    context: ClaudeSessionContext,
    requestId: ApprovalRequestId,
    pending: PendingUserInput,
    result: PendingUserInputResult,
  ): Effect.Effect<PendingUserInputResult> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const ownsSettlement = yield* Effect.sync(() => {
          if (context.pendingUserInputs.get(requestId) !== pending) {
            return false;
          }
          if (pending.settlementStarted) {
            return false;
          }
          pending.settlementStarted = true;
          return true;
        });
        if (!ownsSettlement) {
          return yield* Deferred.await(pending.settled);
        }

        const answers = pending.elicitation
          ? result.answers
          : remapAnswersToClaudeQuestionText(pending.questions, result.answers);
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "user-input.resolved",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(pending.turnId ? { turnId: pending.turnId } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: { answers },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: pending.providerItemId,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: pending.elicitation
              ? "onElicitation/resolved"
              : "canUseTool/AskUserQuestion/resolved",
            payload: { answers, cancelled: result.cancelled },
          },
        });
        context.pendingUserInputs.delete(requestId);
        yield* Deferred.succeed(pending.result, result);
        yield* Deferred.succeed(pending.settled, result);
        return result;
      }),
    );

  type PendingInteractionSettlementScope =
    | { readonly type: "session" }
    | { readonly type: "foregroundTurn"; readonly turnId: TurnId };

  const pendingBelongsToSettlementScope = (
    context: ClaudeSessionContext,
    pending: Pick<PendingApproval, "agentId" | "turnId">,
    scope: PendingInteractionSettlementScope,
  ): boolean =>
    scope.type === "session" ||
    (pending.turnId === scope.turnId &&
      (pending.agentId === undefined || context.terminalTaskIds.has(pending.agentId)));

  const settlePendingHumanInteractions = (
    context: ClaudeSessionContext,
    scope: PendingInteractionSettlementScope,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const [requestId, pending] of context.pendingApprovals) {
        if (!pendingBelongsToSettlementScope(context, pending, scope)) {
          continue;
        }
        yield* settlePendingApproval(context, requestId, pending, "cancel");
      }
      for (const [requestId, pending] of context.pendingUserInputs) {
        if (!pendingBelongsToSettlementScope(context, pending, scope)) {
          continue;
        }
        yield* settlePendingUserInput(context, requestId, pending, {
          answers: {},
          cancelled: true,
        });
      }
    });

  const settlePendingHumanInteractionsForAgent = (
    context: ClaudeSessionContext,
    agentId: string,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const [requestId, pending] of context.pendingApprovals) {
        if (pending.agentId === agentId) {
          yield* settlePendingApproval(context, requestId, pending, "cancel");
        }
      }
      for (const [requestId, pending] of context.pendingUserInputs) {
        if (pending.agentId === agentId) {
          yield* settlePendingUserInput(context, requestId, pending, {
            answers: {},
            cancelled: true,
          });
        }
      }
    });
  return {
    settlePendingHumanInteractions,
    settlePendingHumanInteractionsForAgent,
    settlePendingUserInput,
    settlePendingApproval,
  };
}
