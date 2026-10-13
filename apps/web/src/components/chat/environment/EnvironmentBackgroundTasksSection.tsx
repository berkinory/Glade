import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useLiveClockNow } from "~/lib/liveActivityPresentation";
import { cn } from "~/lib/utils";
import { formatClockDuration } from "~/session-logic";
import { useStore } from "~/store";
import { selectThreadActivities } from "~/threadDerivation";
import type { Thread } from "~/types";
import { deriveBackgroundTasks } from "~/workLog.backgroundTasks";
import type { WorkLogBackgroundTask } from "~/workLog.types";
import { stopWorkflowTask } from "../chatTaskActions";
import { SubagentStatusIndicator } from "../SubagentStatusIndicator";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  EnvironmentCollapsibleSection,
  EnvironmentSectionDivider,
  HIDDEN_SCROLLBAR_CLASS_NAME,
} from "./EnvironmentRow";

const NO_ACTIVITIES: Thread["activities"] = [];

const STATUS_LABELS: Record<WorkLogBackgroundTask["status"], string> = {
  running: "Running",
  completed: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

function BackgroundTaskRow({
  task,
  nowMs,
  onStop,
}: {
  task: WorkLogBackgroundTask;
  nowMs: number;
  onStop: (() => void) | undefined;
}) {
  const endMs = task.settledAt === null ? nowMs : Date.parse(task.settledAt);
  const elapsedMs = endMs - Date.parse(task.startedAt);
  const description = task.description || "Background task";
  return (
    <div
      className={cn(
        ENVIRONMENT_ROW_CLASS_NAME,
        "group/subagent-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2",
      )}
    >
      <span className="min-w-0 truncate" title={description}>
        {description}
        {Number.isFinite(elapsedMs) && elapsedMs >= 0 ? (
          <span className="ml-1.5 text-ui-xs tabular-nums text-muted-foreground">
            {formatClockDuration(elapsedMs)}
          </span>
        ) : null}
      </span>
      <SubagentStatusIndicator
        statusKind={task.status}
        statusLabel={STATUS_LABELS[task.status]}
        onStop={onStop}
        stopLabel="Stop task"
      />
    </div>
  );
}

// Work the agent left running in the background (test runs, builds, dev servers) for the open chat.
export function EnvironmentBackgroundTasksSection({ threadId }: { threadId: ThreadId | null }) {
  const activities = useStore((state) =>
    threadId ? selectThreadActivities(state, threadId) : NO_ACTIVITIES,
  );
  const setError = useStore((store) => store.setError);
  const tasks = deriveBackgroundTasks(activities).toSorted(
    (a, b) =>
      Number(b.status === "running") - Number(a.status === "running") ||
      b.startedAt.localeCompare(a.startedAt),
  );
  const runningCount = tasks.filter((task) => task.status === "running").length;
  const nowMs = useLiveClockNow(runningCount > 0);
  if (!threadId || tasks.length === 0) return null;
  const doneCount = tasks.length - runningCount;
  return (
    <>
      <EnvironmentSectionDivider />
      <EnvironmentCollapsibleSection
        label={`Background tasks (${tasks.length})`}
        collapsedContent={
          <p className="px-2 py-1 text-ui-xs text-muted-foreground">
            {[
              runningCount > 0 ? `${runningCount} running` : null,
              doneCount > 0 ? `${doneCount} done` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        }
      >
        <div
          className={cn(
            "scroll-fade-y max-h-[min(15rem,40vh)] overflow-y-auto overscroll-contain",
            HIDDEN_SCROLLBAR_CLASS_NAME,
          )}
        >
          {tasks.map((task) => (
            <BackgroundTaskRow
              key={task.taskId}
              task={task}
              nowMs={nowMs}
              onStop={
                task.status === "running"
                  ? () => {
                      void stopWorkflowTask(threadId, task.taskId).catch((error: unknown) => {
                        setError(
                          threadId,
                          error instanceof Error ? error.message : "Could not stop the task.",
                        );
                      });
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </EnvironmentCollapsibleSection>
    </>
  );
}
