import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { isStalePendingRequestFailureDetail } from "./lib/pendingInteraction";
import type { Thread } from "./types";
import {
  MAX_THREAD_ACTIVITIES,
  PENDING_INTERACTION_REQUEST_KINDS,
  arraysShallowEqual,
  deepEqualJson,
} from "./storeNormalization.shared";
import type { ReadModelThread } from "./storeNormalization.shared";

export function normalizeTurnDiffFiles(
  incoming: ReadonlyArray<Thread["turnDiffSummaries"][number]["files"][number]>,
  previous: Thread["turnDiffSummaries"][number]["files"] | undefined,
): Thread["turnDiffSummaries"][number]["files"] {
  const mergedIncoming = mergeTurnDiffFilesByPath(incoming);
  const nextFiles = mergedIncoming.map((file, index) => {
    const existing = previous?.[index];
    if (
      existing &&
      existing.path === file.path &&
      existing.kind === file.kind &&
      existing.additions === file.additions &&
      existing.deletions === file.deletions
    ) {
      return existing;
    }
    return file;
  });
  return arraysShallowEqual(previous, nextFiles) ? previous : nextFiles;
}

function mergeTurnDiffFilesByPath(
  files: ReadonlyArray<Thread["turnDiffSummaries"][number]["files"][number]>,
): Thread["turnDiffSummaries"][number]["files"] {
  const filesByPath = new Map<string, Thread["turnDiffSummaries"][number]["files"][number]>();
  for (const file of files) {
    const existing = filesByPath.get(file.path);
    if (!existing) {
      filesByPath.set(file.path, file);
      continue;
    }
    filesByPath.set(file.path, {
      path: file.path,
      kind: existing.kind,
      additions: (existing.additions ?? 0) + (file.additions ?? 0),
      deletions: (existing.deletions ?? 0) + (file.deletions ?? 0),
    });
  }
  return Array.from(filesByPath.values());
}

export function normalizeTurnDiffSummaries(
  incoming: ReadModelThread["checkpoints"],
  previous: Thread["turnDiffSummaries"] | undefined,
): Thread["turnDiffSummaries"] {
  const previousByTurnId = new Map(previous?.map((summary) => [summary.turnId, summary] as const));
  const nextSummaries = incoming.map((checkpoint) => {
    const existing = previousByTurnId.get(checkpoint.turnId);
    const files = normalizeTurnDiffFiles(checkpoint.files, existing?.files);
    if (
      existing &&
      existing.completedAt === checkpoint.completedAt &&
      existing.status === checkpoint.status &&
      existing.assistantMessageId === (checkpoint.assistantMessageId ?? undefined) &&
      existing.checkpointTurnCount === checkpoint.checkpointTurnCount &&
      existing.checkpointRef === checkpoint.checkpointRef &&
      existing.files === files
    ) {
      return existing;
    }
    return {
      turnId: checkpoint.turnId,
      completedAt: checkpoint.completedAt,
      status: checkpoint.status,
      assistantMessageId: checkpoint.assistantMessageId ?? undefined,
      checkpointTurnCount: checkpoint.checkpointTurnCount,
      checkpointRef: checkpoint.checkpointRef,
      files,
    };
  });
  return arraysShallowEqual(previous, nextSummaries) ? previous : nextSummaries;
}

export function normalizeActivities(
  incoming: ReadModelThread["activities"],
  previous: Thread["activities"] | undefined,
): Thread["activities"] {
  const previousActivities = previous ? dedupeActivitiesById(previous) : undefined;
  const incomingActivities = dedupeActivitiesById(incoming);
  const previousById = new Map(
    previousActivities?.map((activity) => [activity.id, activity] as const),
  );
  const nextActivities = incomingActivities.map((activity) => {
    const existing = previousById.get(activity.id);
    if (existing) {
      const preferred = preferRicherActivity(existing, activity);
      if (preferred === existing || activitiesEqual(existing, preferred)) {
        return existing;
      }
      return preferred;
    }
    return activity;
  });
  const cappedActivities = capThreadActivities(nextActivities);
  return arraysShallowEqual(previous, cappedActivities) ? previous : cappedActivities;
}

type ThreadActivity = Thread["activities"][number];

export interface ThreadActivityAccumulator {
  readonly append: (activity: ThreadActivity) => boolean;

  readonly result: () => Thread["activities"];
}

export function createThreadActivityAccumulator(
  previous: Thread["activities"],
): ThreadActivityAccumulator {
  const deduped = dedupeActivitiesById(previous);
  // `dedupeActivitiesById` only returns a new array when it actually removed a duplicate, so a
  // different reference here means the first `append()` must report a change even if that append is
  // itself a no-op (matching `normalizeActivities`, which dedupes `previous` on every call).
  let pendingDedupeChange = deduped !== previous;
  let working: ThreadActivity[] = deduped;
  let owned = pendingDedupeChange;
  let indexById: Map<string, number> | undefined;

  const ensureIndexById = (): Map<string, number> => {
    if (!indexById) {
      const nextIndexById = new Map<string, number>();
      for (let index = 0; index < working.length; index += 1) {
        nextIndexById.set(working[index]!.id, index);
      }
      indexById = nextIndexById;
    }
    return indexById;
  };

  const ensureOwned = (): void => {
    if (!owned) {
      working = [...working];
      owned = true;
    }
  };

  return {
    append: (activity) => {
      const activityIndexById = ensureIndexById();
      const existingIndex = activityIndexById.get(activity.id);
      let changed = false;
      if (existingIndex === undefined) {
        ensureOwned();
        working.push(activity);
        activityIndexById.set(activity.id, working.length - 1);
        changed = true;
      } else {
        const existing = working[existingIndex]!;
        const preferred = preferRicherActivity(existing, activity);
        if (preferred !== existing) {
          ensureOwned();
          working[existingIndex] = preferred;
          changed = true;
        }
      }
      if (working.length > MAX_THREAD_ACTIVITIES) {
        const capped = capThreadActivities(working);

        if (capped.length !== working.length) {
          working = capped;
          owned = true;
          indexById = undefined;
          changed = true;
        }
      }
      if (pendingDedupeChange) {
        pendingDedupeChange = false;
        return true;
      }
      return changed;
    },
    result: () => (arraysShallowEqual(previous, working) ? previous : working),
  };
}

export function withOrchestrationEventSequence(
  activity: OrchestrationThreadActivity,
  sequence: number,
): OrchestrationThreadActivity {
  return { ...activity, sequence: activity.sequence ?? sequence };
}

function resolveTurnAlignedDropCount(
  activities: readonly Thread["activities"][number][],
  minimumDropCount: number,
): number {
  const boundaryTurnId = activities[minimumDropCount - 1]?.turnId ?? null;
  let dropCount = minimumDropCount;
  while (
    dropCount < activities.length &&
    (activities[dropCount]?.turnId ?? null) === boundaryTurnId
  ) {
    dropCount += 1;
  }
  return dropCount >= activities.length ? minimumDropCount : dropCount;
}

export function capThreadActivities<TActivity extends Thread["activities"][number]>(
  activities: readonly TActivity[],
): TActivity[] {
  if (activities.length <= MAX_THREAD_ACTIVITIES) {
    return activities as TActivity[];
  }
  const dropCount = resolveTurnAlignedDropCount(
    activities,
    activities.length - MAX_THREAD_ACTIVITIES,
  );
  const retainedIds = new Set(activities.slice(dropCount).map((activity) => activity.id));
  const pendingRequestIds = pendingInteractionRequestIds(activities);
  for (const activity of activities) {
    const requestId = activityRequestId(activity);
    if (
      requestId !== null &&
      pendingRequestIds.has(requestId) &&
      PENDING_INTERACTION_REQUEST_KINDS.has(activity.kind)
    ) {
      retainedIds.add(activity.id);
    }
  }
  return activities.filter((activity) => retainedIds.has(activity.id));
}

function activityRequestId(activity: Thread["activities"][number]): string | null {
  const payload = asObjectRecord(activity.payload);
  const requestId = payload?.requestId;
  return typeof requestId === "string" && requestId.trim().length > 0 ? requestId : null;
}

function pendingInteractionRequestIds(
  activities: readonly Thread["activities"][number][],
): Set<string> {
  const pendingRequestIds = new Set<string>();
  for (const activity of activities) {
    const requestId = activityRequestId(activity);
    if (requestId === null) {
      continue;
    }
    if (activity.kind === "approval.requested" || activity.kind === "user-input.requested") {
      pendingRequestIds.add(requestId);
      continue;
    }
    if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
      pendingRequestIds.delete(requestId);
      continue;
    }
    if (
      (activity.kind === "provider.approval.respond.failed" ||
        activity.kind === "provider.user-input.respond.failed") &&
      isStalePendingRequestFailureDetail(asObjectRecord(activity.payload)?.detail)
    ) {
      pendingRequestIds.delete(requestId);
    }
  }
  return pendingRequestIds;
}

export function dedupeActivitiesByIdAfterAppend<TActivity extends Thread["activities"][number]>(
  activities: ReadonlyArray<TActivity>,
  previousActivities: ReadonlyArray<TActivity> | undefined,
  previousActivityById: Record<string, Thread["activities"][number]> | undefined,
): TActivity[] {
  if (
    previousActivities === undefined ||
    previousActivityById === undefined ||
    previousActivities.length === 0 ||
    previousActivities.length > activities.length
  ) {
    return dedupeActivitiesById(activities);
  }
  for (let index = 0; index < previousActivities.length; index += 1) {
    if (activities[index] !== previousActivities[index]) {
      return dedupeActivitiesById(activities);
    }
  }
  const appendedIds = new Set<string>();
  for (let index = previousActivities.length; index < activities.length; index += 1) {
    const id = activities[index]!.id;
    if (previousActivityById[id] !== undefined || appendedIds.has(id)) {
      return dedupeActivitiesById(activities);
    }
    appendedIds.add(id);
  }
  return activities as TActivity[];
}

function dedupeActivitiesById<TActivity extends Thread["activities"][number]>(
  activities: ReadonlyArray<TActivity>,
): TActivity[] {
  const indexById = new Map<string, number>();
  const result: TActivity[] = [];
  for (const activity of activities) {
    const existingIndex = indexById.get(activity.id);
    if (existingIndex === undefined) {
      indexById.set(activity.id, result.length);
      result.push(activity);
      continue;
    }
    result[existingIndex] = preferRicherActivity(result[existingIndex]!, activity);
  }
  return arraysShallowEqual(activities, result) ? (activities as TActivity[]) : result;
}

function preferRicherActivity<TActivity extends Thread["activities"][number]>(
  previous: TActivity,
  incoming: TActivity,
): TActivity {
  if (activitiesEqual(previous, incoming)) {
    return previous;
  }
  const previousScore = activityPayloadDetailScore(previous);
  const incomingScore = activityPayloadDetailScore(incoming);
  return incomingScore < previousScore ? previous : incoming;
}

function activitiesEqual(
  left: Thread["activities"][number],
  right: Thread["activities"][number],
): boolean {
  return (
    left.kind === right.kind &&
    left.tone === right.tone &&
    left.summary === right.summary &&
    deepEqualJson(left.payload, right.payload) &&
    left.turnId === right.turnId &&
    left.sequence === right.sequence &&
    left.createdAt === right.createdAt
  );
}

function activityPayloadDetailScore(activity: Thread["activities"][number]): number {
  const payload = asObjectRecord(activity.payload);
  const data = asObjectRecord(payload?.data);
  const item = asObjectRecord(data?.item);
  const commandActions = item?.commandActions ?? data?.commandActions ?? payload?.commandActions;
  let score = 0;
  if (payload?.itemType) score += 4;
  if (payload?.title) score += 1;
  if (payload?.detail) score += 2;
  if (data) score += 2;
  if (item) score += 4;
  if (normalizeActivityCommandValue(item?.command ?? data?.command ?? payload?.command)) score += 8;
  if (Array.isArray(commandActions) && commandActions.length > 0) score += 8;
  return score;
}

function normalizeActivityCommandValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function isNonFatalThreadErrorMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.trim().toLowerCase();
  return normalized.includes("write_stdin failed: stdin is closed for this session");
}

export function normalizeThreadErrorMessage(message: string | null | undefined): string | null {
  return message && !isNonFatalThreadErrorMessage(message) ? message : null;
}
