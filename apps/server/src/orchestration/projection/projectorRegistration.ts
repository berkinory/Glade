import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { Effect } from "effect";
import { type ProjectionRepositoryError } from "../../persistence/Errors.ts";

export const ORCHESTRATION_PROJECTOR_NAMES = {
  hot: "projection.hot",
  projects: "projection.projects",
  threads: "projection.threads",
  threadShellSummaries: "projection.thread-shell-summaries",
  threadMessages: "projection.thread-messages",

  threadActivities: "projection.thread-activities",
  threadSessions: "projection.thread-sessions",
  threadTurns: "projection.thread-turns",
  checkpoints: "projection.checkpoints",

  pendingInteractions: "projection.pending-approvals",
} as const;

export type ProjectorName =
  (typeof ORCHESTRATION_PROJECTOR_NAMES)[keyof typeof ORCHESTRATION_PROJECTOR_NAMES];

export interface ProjectorDefinition {
  readonly name: ProjectorName;
  readonly phase: "hot" | "deferred";
  readonly shouldApply?: (event: OrchestrationEvent) => boolean;
  readonly replayFilter: {
    readonly eventTypes: ReadonlyArray<OrchestrationEvent["type"]>;
    readonly activityKinds?: ReadonlyArray<string>;
  };
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export interface AttachmentSideEffects {
  readonly deletedThreadIds: Set<string>;
  readonly prunedThreadRelativePaths: Map<string, Set<string>>;
}

export const PROJECT_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "space.created",
  "space.meta-updated",
  "space.order-updated",
  "space.deleted",
  "project.created",
  "project.meta-updated",
  "project.deleted",
]);

export const THREAD_MESSAGE_PROJECTION_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.message-sent",
  "thread.async-user-input-answered",
  "thread.reverted",
  "thread.conversation-rolled-back",
]);

export const THREAD_ACTIVITY_PROJECTION_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.activity-appended",
  "thread.reverted",
  "thread.conversation-rolled-back",
]);

export const THREAD_SESSION_PROJECTION_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.turn-start-requested",
  "thread.session-set",
]);

export const THREAD_TURN_PROJECTION_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.deleted",
  "thread.claude-cache-set",
  "thread.archived",
  "thread.session-stop-requested",
  "thread.claude-cache-response-requested",
  "thread.turn-start-requested",
  "thread.session-set",
  "thread.turn-diff-completed",
  "thread.reverted",
  "thread.conversation-rolled-back",
]);

export const PENDING_INTERACTION_ACTIVITY_KINDS = new Set([
  "approval.requested",
  "approval.resolved",
  "provider.approval.respond.failed",
  "user-input.requested",
  "user-input.resolved",
  "provider.user-input.respond.failed",
]);

export const PENDING_INTERACTION_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.activity-appended",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
]);

export function shouldApplyThreadTurnsProjection(event: OrchestrationEvent): boolean {
  return (
    THREAD_TURN_PROJECTION_EVENT_TYPES.has(event.type) ||
    (event.type === "thread.message-sent" &&
      event.payload.role === "assistant" &&
      event.payload.turnId !== null)
  );
}

export function shouldApplyPendingInteractionsProjection(event: OrchestrationEvent): boolean {
  return (
    event.type === "thread.approval-response-requested" ||
    event.type === "thread.user-input-response-requested" ||
    (event.type === "thread.activity-appended" &&
      PENDING_INTERACTION_ACTIVITY_KINDS.has(event.payload.activity.kind))
  );
}
