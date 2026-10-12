import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";

import { isCheckpointRevertLifecycleActivityKind } from "./commandInvariants.ts";
import { updateThread } from "./eventProjections/projectionState.ts";

type ThreadPatch = Pick<Partial<OrchestrationThread>, "messages" | "activities" | "checkpoints">;

// The engine's read model only serves command decisions. They read message identity and state, user
// text and checkpoint-revert lifecycle activities; commands that need a transcript load it from the
// projection. Keeping assistant text, other activities and checkpoint file lists here would grow the
// heap with every thread touched since boot, so each event leaves only what boot loads.
export function retainCommandReadModelEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): OrchestrationReadModel {
  if (
    event.type !== "thread.message-sent" &&
    event.type !== "thread.activity-appended" &&
    event.type !== "thread.turn-diff-completed"
  ) {
    return model;
  }
  const thread = model.threads.find((entry) => entry.id === event.payload.threadId);
  if (!thread) return model;
  const patch = retainedThreadPatch(thread, event);
  return patch ? { ...model, threads: updateThread(model.threads, thread.id, patch) } : model;
}

function retainedThreadPatch(
  thread: OrchestrationThread,
  event: Extract<
    OrchestrationEvent,
    { type: "thread.message-sent" | "thread.activity-appended" | "thread.turn-diff-completed" }
  >,
): ThreadPatch | undefined {
  switch (event.type) {
    case "thread.message-sent": {
      if (event.payload.role !== "assistant") return undefined;
      const index = thread.messages.findLastIndex(
        (message) => message.id === event.payload.messageId,
      );
      const message = thread.messages[index];
      if (!message || (message.text === "" && message.textSegments === undefined)) return undefined;
      const { textSegments: _textSegments, ...retained } = message;
      const messages = thread.messages.slice();
      messages[index] = { ...retained, text: "" };
      return { messages };
    }
    case "thread.activity-appended": {
      const { activity } = event.payload;
      if (isCheckpointRevertLifecycleActivityKind(activity.kind)) return undefined;
      return thread.activities.some((entry) => entry.id === activity.id)
        ? { activities: thread.activities.filter((entry) => entry.id !== activity.id) }
        : undefined;
    }
    case "thread.turn-diff-completed":
      return thread.checkpoints.some((checkpoint) => checkpoint.files.length > 0)
        ? {
            checkpoints: thread.checkpoints.map((checkpoint) =>
              checkpoint.files.length > 0 ? { ...checkpoint, files: [] } : checkpoint,
            ),
          }
        : undefined;
  }
}
