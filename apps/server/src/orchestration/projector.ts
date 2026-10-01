import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { Effect } from "effect";
import { type OrchestrationProjectorDecodeError } from "./Errors.ts";
import { projectWorkspaceEvent } from "./eventProjections/workspaceProjection";
import { projectThreadEvent } from "./eventProjections/threadProjection";
import { projectTurnEvent } from "./eventProjections/turnProjection";
import { projectMessageEvent } from "./eventProjections/messageProjection";
import { projectHistoryEvent } from "./eventProjections/historyProjection";
import { projectActivityEvent } from "./eventProjections/projectionState";

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    spaces: [],
    projects: [],
    threads: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
  historyLimit?: number,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "space.created":
    case "space.meta-updated":
    case "space.order-updated":
    case "space.deleted":
    case "project.created":
    case "project.meta-updated":
    case "project.deleted":
      return projectWorkspaceEvent(nextBase, event);
    case "thread.created":
    case "thread.deleted":
    case "thread.archived":
    case "thread.unarchived":
    case "thread.meta-updated":
    case "thread.pinned-message-added":
    case "thread.pinned-message-removed":
    case "thread.pinned-message-done-set":
    case "thread.pinned-message-label-set":
    case "thread.runtime-mode-set":
      return projectThreadEvent(nextBase, event);
    case "thread.claude-cache-set":
    case "thread.turn-start-requested":
    case "thread.session-set":
      return projectTurnEvent(nextBase, event);
    case "thread.async-user-input-answered":
    case "thread.message-sent":
      return projectMessageEvent(nextBase, event, historyLimit);
    case "thread.interaction-mode-set":
    case "thread.proposed-plan-upserted":
      return Effect.succeed(nextBase);
    case "thread.turn-diff-completed":
    case "thread.reverted":
    case "thread.conversation-rolled-back":
      return projectHistoryEvent(nextBase, event, historyLimit);
    case "thread.activity-appended":
      return projectActivityEvent(nextBase, event, historyLimit);
    default:
      return Effect.succeed(nextBase);
  }
}
