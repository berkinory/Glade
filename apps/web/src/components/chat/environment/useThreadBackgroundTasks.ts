import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useStore } from "~/store";
import { selectThreadActivities } from "~/threadDerivation";
import type { Thread } from "~/types";
import { deriveBackgroundTasks } from "~/workLog.backgroundTasks";
import type { WorkLogBackgroundTask } from "~/workLog.types";

const NO_ACTIVITIES: Thread["activities"] = [];

export function useThreadBackgroundTasks(threadId: ThreadId | null): WorkLogBackgroundTask[] {
  const activities = useStore((state) =>
    threadId ? selectThreadActivities(state, threadId) : NO_ACTIVITIES,
  );
  return deriveBackgroundTasks(activities);
}
