import { VISUAL_REPLY_ACTIVITY_KIND } from "@glade/contracts/orchestration/visualReply";
import { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Schema, Effect } from "effect";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { type OrchestrationProjectorDecodeError, toProjectorDecodeError } from "../Errors.ts";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import { ThreadActivityAppendedPayload } from "../Schemas.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;

export const MAX_THREAD_MESSAGES = 2_000;

const MAX_THREAD_ACTIVITIES = 500;

export function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  const nextThreads = threads.slice();
  const index = nextThreads.findIndex((thread) => thread.id === threadId);
  if (index === -1) {
    return nextThreads;
  }
  nextThreads[index] = { ...nextThreads[index]!, ...patch };
  return nextThreads;
}

export function decodeForEvent<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value),
    catch: (error) => toProjectorDecodeError(`${eventType}:${field}`)(error as Schema.SchemaError),
  });
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function upsertThreadActivity(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
  activity: OrchestrationThread["activities"][number],
  historyLimit: number,
): ReadonlyArray<OrchestrationThread["activities"][number]> {
  const cap = (next: ReadonlyArray<OrchestrationThread["activities"][number]>) => {
    const cutoff = next.length - historyLimit;
    return next.filter(
      (entry, index) => index >= cutoff || entry.kind === VISUAL_REPLY_ACTIVITY_KIND,
    );
  };
  const existingIndex = activities.findIndex((entry) => entry.id === activity.id);
  if (activity.kind === "provider.transition" && existingIndex >= 0)
    activity = { ...activity, sequence: activities[existingIndex]!.sequence };
  if (existingIndex >= 0 && compareThreadActivities(activities[existingIndex]!, activity) === 0) {
    const next = [...activities];
    next[existingIndex] = activity;
    return cap(next);
  }

  const withoutExisting =
    existingIndex < 0
      ? activities
      : [...activities.slice(0, existingIndex), ...activities.slice(existingIndex + 1)];
  const last = withoutExisting.at(-1);
  if (!last || compareThreadActivities(last, activity) <= 0) {
    return cap([...withoutExisting, activity]);
  }

  let low = 0;
  let high = withoutExisting.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareThreadActivities(withoutExisting[middle]!, activity) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return cap([...withoutExisting.slice(0, low), activity, ...withoutExisting.slice(low)]);
}

export type ProjectionEffect = Effect.Effect<
  OrchestrationReadModel,
  OrchestrationProjectorDecodeError
>;

export function projectActivityEvent(
  nextBase: OrchestrationReadModel,
  event: Extract<OrchestrationEvent, { type: "thread.activity-appended" }>,
  historyLimit = MAX_THREAD_ACTIVITIES,
): ProjectionEffect {
  switch (event.type) {
    case "thread.activity-appended":
      return decodeForEvent(
        ThreadActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const activities = upsertThreadActivity(
            thread.activities,
            {
              ...payload.activity,
              sequence: payload.activity.sequence ?? event.sequence,
            },
            historyLimit,
          );

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              activities,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );
  }
}
