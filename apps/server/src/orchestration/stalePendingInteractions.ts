import type { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { EventId } from "@glade/contracts/core/baseSchemas";
import {
  buildStalePendingRequestFailureDetail,
  type PendingThreadRequestKind,
} from "@glade/shared/threads/threadSummary";

import type { ProjectionPendingInteraction } from "../persistence/Services/ProjectionPendingInteractions.ts";

export type ThreadActivityAppendCommand = Extract<
  OrchestrationCommand,
  { readonly type: "thread.activity.append" }
>;

// True when a durable interaction row still expects an answer. `confirmed` rows were answered.
// `uncertain` rows were already reported as unanswerable, so re-reporting them would append a
// duplicate failure activity on every settlement signal. Everything else (`pending`, `retryable`,
// and a `responding` claim whose response never landed) is still holding a question open.
export function isUnsettledPendingInteraction(
  row: Pick<ProjectionPendingInteraction, "status">,
): boolean {
  return row.status !== "confirmed" && row.status !== "uncertain";
}

export function pendingInteractionRequestKind(
  interactionKind: ProjectionPendingInteraction["interactionKind"],
): PendingThreadRequestKind {
  return interactionKind === "approval" ? "approval" : "user-input";
}

export function buildStalePendingRequestSettlementCommand(input: {
  readonly threadId: ThreadId;
  readonly commandId: CommandId;
  readonly requestKind: PendingThreadRequestKind;
  readonly requestId: string;
  readonly lifecycleGeneration?: string | null;
  readonly now: string;
}): ThreadActivityAppendCommand {
  const isApproval = input.requestKind === "approval";
  return {
    type: "thread.activity.append",
    commandId: input.commandId,
    threadId: input.threadId,
    activity: {
      id: EventId.makeUnsafe(input.commandId),
      tone: "error",
      kind: isApproval ? "provider.approval.respond.failed" : "provider.user-input.respond.failed",
      summary: isApproval
        ? "Provider approval response failed"
        : "Provider user input response failed",
      payload: {
        detail: buildStalePendingRequestFailureDetail(input.requestKind, input.requestId),
        requestId: input.requestId,
        ...(input.lifecycleGeneration ? { lifecycleGeneration: input.lifecycleGeneration } : {}),
      },
      turnId: null,
      createdAt: input.now,
    },
    createdAt: input.now,
  };
}
