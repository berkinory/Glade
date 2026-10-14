import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  backgroundWorkTurnIds,
  sessionKeepsBackgroundWork,
} from "@glade/shared/threads/backgroundWork";
import { useStore } from "~/store";
import { selectThreadActivities } from "~/threadDerivation";
import type { Thread } from "~/types";
import { deriveBackgroundTasks } from "~/workLog.backgroundTasks";
import type { WorkLogBackgroundTask } from "~/workLog.types";

const NO_ACTIVITIES: Thread["activities"] = [];

/**
 * The chat's background tasks worth showing: every one still running, and the finished ones of its
 * latest turn, counting the earlier turn whose task woke it.
 */
export function useThreadBackgroundTasks(threadId: ThreadId | null): WorkLogBackgroundTask[] {
  const activities = useStore((state) =>
    threadId ? selectThreadActivities(state, threadId) : NO_ACTIVITIES,
  );
  const session = useStore((state) =>
    threadId ? (state.threadSessionById?.[threadId] ?? null) : null,
  );
  const latestTurnId = useStore((state) =>
    threadId ? state.threadTurnStateById?.[threadId]?.latestTurn?.turnId : undefined,
  );
  const sessionEnded = session !== null && !sessionKeepsBackgroundWork(session.status);
  const latestTurns = backgroundWorkTurnIds(activities, latestTurnId);
  return deriveBackgroundTasks(activities).flatMap((task) => {
    // Work cannot outlive the session that ran it, even when the provider never reported its end.
    const settled =
      task.status === "running" && sessionEnded
        ? {
            ...task,
            status: "stopped" as const,
            settledAt: session.updatedAt > task.startedAt ? session.updatedAt : task.startedAt,
          }
        : task;
    return settled.status === "running" || (settled.turnId && latestTurns.has(settled.turnId))
      ? [settled]
      : [];
  });
}
