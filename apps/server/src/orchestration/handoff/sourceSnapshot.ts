import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Stream } from "effect";
import type { OrchestrationEventStoreShape } from "../../persistence/Services/OrchestrationEventStore";
import { ProviderValidationError } from "../../provider/core/Errors";
import { createEmptyReadModel, projectEvent } from "../projector";

export const readHandoffSourceSnapshot = Effect.fnUntraced(function* (
  eventStore: OrchestrationEventStoreShape,
  threadId: ThreadId,
  throughSequence: number,
) {
  if (!Number.isSafeInteger(throughSequence) || throughSequence < 1) {
    return yield* new ProviderValidationError({
      operation: "handoff.prepare",
      issue:
        "The handoff has no valid frozen source boundary. Create a new handoff from the source chat.",
    });
  }
  if (throughSequence > (yield* eventStore.getHighWaterSequence()))
    return yield* new ProviderValidationError({
      operation: "handoff.prepare",
      issue: "The requested frozen source boundary is unavailable.",
    });
  let model = createEmptyReadModel(new Date().toISOString());
  yield* eventStore
    .readThreadEventsFromSequence(threadId, 0, Number.MAX_SAFE_INTEGER, throughSequence)
    .pipe(
      Stream.runForEach((event) =>
        projectEvent(model, event, Number.MAX_SAFE_INTEGER).pipe(
          Effect.map((next) => {
            model = next;
          }),
        ),
      ),
    );
  const thread = model.threads.find((entry) => entry.id === threadId && entry.deletedAt === null);
  if (!thread) {
    return yield* new ProviderValidationError({
      operation: "handoff.prepare",
      issue: "The source conversation is unavailable at the frozen handoff boundary.",
    });
  }
  return thread;
});

export const readHandoffEvidenceSnapshot = Effect.fnUntraced(function* (
  eventStore: OrchestrationEventStoreShape,
  threadId: ThreadId,
  throughSequence: number,
) {
  const source = yield* readHandoffSourceSnapshot(eventStore, threadId, throughSequence);
  const activities = source.activities.filter(
    (activity) => !activity.kind.startsWith("handoff.preparation."),
  );
  const visited = new Set<string>([`${threadId}:${throughSequence}`]);
  let parent = source.handoff;
  while (parent?.sourceBoundarySequence !== undefined) {
    const key = `${parent.sourceThreadId}:${parent.sourceBoundarySequence}`;
    if (visited.has(key))
      return yield* new ProviderValidationError({
        operation: "handoff.prepare",
        issue:
          "The source handoff ancestry contains a cycle. Original evidence is required before continuing.",
      });
    visited.add(key);
    const ancestor = yield* readHandoffSourceSnapshot(
      eventStore,
      parent.sourceThreadId,
      parent.sourceBoundarySequence,
    );
    for (const activity of ancestor.activities) {
      if (
        activity.kind.startsWith("handoff.preparation.") ||
        activities.some((entry) => entry.id === activity.id)
      )
        continue;
      activities.push({
        ...activity,
        payload: {
          sourceThreadId: ancestor.id,
          throughSequence: parent.sourceBoundarySequence,
          originalPayload: activity.payload,
        },
      });
    }
    parent = ancestor.handoff;
  }
  return { ...source, activities };
});
