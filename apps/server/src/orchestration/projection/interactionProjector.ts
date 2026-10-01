import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { ApprovalRequestId, CommandId } from "@glade/contracts/core/baseSchemas";
import type { ServiceMap } from "effect";
import { ProjectionPendingInteractionRepository } from "../../persistence/Services/ProjectionPendingInteractions.ts";
import { Effect, Option } from "effect";
import { type ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { createStalePendingInteractionMatcher } from "@glade/shared/threads/pendingInteractions";
import { makeThreadProjector } from "./threadProjector";
import { ProjectorDefinition } from "./projectorRegistration";

function payloadNonEmptyString(payload: unknown, key: string): string | null {
  const value = (asObjectRecord(payload) ?? undefined)?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  const requestId = (asObjectRecord(payload) ?? undefined)?.requestId;
  return typeof requestId === "string" ? ApprovalRequestId.makeUnsafe(requestId) : null;
}

function extractApprovalFailureSettlementStatus(
  payload: unknown,
): "retryable" | "uncertain" | null {
  const status = (asObjectRecord(payload) ?? undefined)?.settlementStatus;
  return status === "retryable" || status === "uncertain" ? status : null;
}

export function makeInteractionProjector(input: {
  readonly updateThreadProjection: ReturnType<typeof makeThreadProjector>["updateThreadProjection"];
  readonly projectionPendingInteractionRepository: ServiceMap.Service.Shape<
    typeof ProjectionPendingInteractionRepository
  >;
}) {
  const { updateThreadProjection, projectionPendingInteractionRepository } = input;
  const updatePendingInteractionShellCount = Effect.fn(function* (input: {
    readonly threadId: ProjectionThread["threadId"];
    readonly interactionKind: "approval" | "userInput";
    readonly previousStatus: string | null;
    readonly nextStatus: string;
    readonly updatedAt: string;
  }) {
    const delta =
      Number(input.nextStatus === "pending" || input.nextStatus === "retryable") -
      Number(input.previousStatus === "pending" || input.previousStatus === "retryable");
    return yield* updateThreadProjection(input.threadId, (thread) => ({
      ...thread,
      ...(input.interactionKind === "approval"
        ? {
            pendingApprovalCount: Math.max(0, thread.pendingApprovalCount + delta),
          }
        : {
            pendingUserInputCount: Math.max(0, thread.pendingUserInputCount + delta),
          }),
      updatedAt: input.updatedAt,
    }));
  });

  const applyPendingInteractionsProjection: ProjectorDefinition["apply"] = (
    event,
    _attachmentSideEffects,
  ) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.activity-appended": {
          const activity = event.payload.activity;
          const interactionKind =
            activity.kind === "approval.requested" ||
            activity.kind === "approval.resolved" ||
            activity.kind === "provider.approval.respond.failed"
              ? ("approval" as const)
              : activity.kind === "user-input.requested" ||
                  activity.kind === "user-input.resolved" ||
                  activity.kind === "provider.user-input.respond.failed"
                ? ("userInput" as const)
                : null;
          if (interactionKind === null) return;
          const requestId =
            extractActivityRequestId(activity.payload) ?? event.metadata.requestId ?? null;
          if (requestId === null) {
            return;
          }
          const existingRow = yield* projectionPendingInteractionRepository.getByIdentity({
            threadId: event.payload.threadId,
            interactionKind,
            requestId,
          });
          const lifecycleGeneration = payloadNonEmptyString(
            activity.payload,
            "lifecycleGeneration",
          );
          let nextRow: Parameters<typeof projectionPendingInteractionRepository.upsert>[0];
          if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
            if (
              lifecycleGeneration !== null &&
              Option.isSome(existingRow) &&
              existingRow.value.lifecycleGeneration !== lifecycleGeneration
            ) {
              return;
            }
            const resolvedDecisionRaw =
              interactionKind === "approval"
                ? (asObjectRecord(activity.payload) ?? undefined)?.decision
                : null;
            nextRow = {
              interactionKind,
              requestId,
              threadId: event.payload.threadId,
              turnId: Option.isSome(existingRow) ? existingRow.value.turnId : activity.turnId,
              lifecycleGeneration: Option.isSome(existingRow)
                ? existingRow.value.lifecycleGeneration
                : lifecycleGeneration,
              status: "confirmed",
              decision:
                resolvedDecisionRaw === "accept" ||
                resolvedDecisionRaw === "acceptForSession" ||
                resolvedDecisionRaw === "decline" ||
                resolvedDecisionRaw === "cancel"
                  ? resolvedDecisionRaw
                  : null,
              responseCommandId: Option.isSome(existingRow)
                ? existingRow.value.responseCommandId
                : null,
              responseRequestedAt: Option.isSome(existingRow)
                ? existingRow.value.responseRequestedAt
                : null,
              createdAt: Option.isSome(existingRow)
                ? existingRow.value.createdAt
                : activity.createdAt,
              resolvedAt: activity.createdAt,
            } as const;
          } else if (
            activity.kind === "provider.approval.respond.failed" ||
            activity.kind === "provider.user-input.respond.failed"
          ) {
            if (Option.isNone(existingRow)) {
              return;
            }
            const responseCommandIdValue = payloadNonEmptyString(
              activity.payload,
              "responseCommandId",
            );
            if (responseCommandIdValue === null) {
              // Reconciliation (server restart, provider session restart) reports stale requests without a
              // claiming response command: no response was in flight, but the provider callback that could
              // consume the interaction is gone. Settle the row anyway — leaving it `pending` kept threads
              // answerable-looking forever while every actual response hit a dead provider.
              if (
                existingRow.value.status === "confirmed" ||
                !createStalePendingInteractionMatcher([activity])(existingRow.value)
              ) {
                return;
              }
              nextRow = {
                ...existingRow.value,
                status: "uncertain",
                resolvedAt: null,
              };
            } else {
              if (existingRow.value.status !== "responding") {
                return;
              }
              if (
                lifecycleGeneration !== null &&
                existingRow.value.lifecycleGeneration !== lifecycleGeneration
              ) {
                return;
              }
              const responseCommandId = CommandId.makeUnsafe(responseCommandIdValue);
              if (existingRow.value.responseCommandId !== responseCommandId) {
                return;
              }
              const nextStatus =
                extractApprovalFailureSettlementStatus(activity.payload) ?? "uncertain";
              nextRow = {
                ...existingRow.value,
                status: nextStatus,
                resolvedAt: null,
              };
            }
          } else {
            if (
              activity.kind !== "approval.requested" &&
              activity.kind !== "user-input.requested"
            ) {
              return;
            }
            if (
              Option.isSome(existingRow) &&
              (existingRow.value.status === "responding" ||
                existingRow.value.status === "confirmed" ||
                existingRow.value.status === "uncertain") &&
              existingRow.value.lifecycleGeneration === lifecycleGeneration
            ) {
              return;
            }
            nextRow = {
              interactionKind,
              requestId,
              threadId: event.payload.threadId,
              turnId: activity.turnId,
              lifecycleGeneration,
              status: "pending",
              decision: null,
              responseCommandId: null,
              responseRequestedAt: null,
              createdAt:
                Option.isSome(existingRow) &&
                existingRow.value.lifecycleGeneration === lifecycleGeneration
                  ? existingRow.value.createdAt
                  : activity.createdAt,
              resolvedAt: null,
            } as const;
          }
          yield* projectionPendingInteractionRepository.upsert(nextRow);
          yield* updatePendingInteractionShellCount({
            threadId: event.payload.threadId,
            interactionKind,
            previousStatus: Option.isSome(existingRow) ? existingRow.value.status : null,
            nextStatus: nextRow.status,
            updatedAt: event.occurredAt,
          });
          return;
        }

        case "thread.approval-response-requested":
        case "thread.user-input-response-requested": {
          if (event.commandId === null) {
            return;
          }
          const interactionKind =
            event.type === "thread.approval-response-requested" ? "approval" : "userInput";
          const existingRow = yield* projectionPendingInteractionRepository.getByIdentity({
            threadId: event.payload.threadId,
            interactionKind,
            requestId: event.payload.requestId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          if (
            yield* projectionPendingInteractionRepository.claimResponse({
              threadId: event.payload.threadId,
              interactionKind,
              requestId: event.payload.requestId,
              lifecycleGeneration: event.payload.lifecycleGeneration ?? null,
              responseCommandId: event.commandId,
              decision:
                event.type === "thread.approval-response-requested" ? event.payload.decision : null,
              requestedAt: event.payload.createdAt,
            })
          ) {
            yield* updatePendingInteractionShellCount({
              threadId: event.payload.threadId,
              interactionKind,
              previousStatus: existingRow.value.status,
              nextStatus: "responding",
              updatedAt: event.occurredAt,
            });
          }
          return;
        }

        default:
          return;
      }
    });
  return { applyPendingInteractionsProjection };
}
