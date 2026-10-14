import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useLiveClockNow } from "~/lib/liveActivityPresentation";
import { cn } from "~/lib/utils";
import { formatClockDuration } from "~/session-logic";
import { useQuery } from "@tanstack/react-query";
import { serverLocalServersQueryOptions } from "~/lib/serverReactQuery";
import { useStore } from "~/store";
import type { WorkLogBackgroundTask } from "~/workLog.types";
import { stopWorkflowTask } from "../chatTaskActions";
import { SubagentStatusIndicator } from "../SubagentStatusIndicator";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  EnvironmentCollapsibleSection,
  EnvironmentSectionDivider,
  HIDDEN_SCROLLBAR_CLASS_NAME,
} from "./EnvironmentRow";
import { useThreadBackgroundTasks } from "./useThreadBackgroundTasks";

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
  onOpen,
}: {
  task: WorkLogBackgroundTask;
  nowMs: number;
  onStop: (() => void) | undefined;
  onOpen: (() => void) | undefined;
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
      <button
        type="button"
        className="min-w-0 truncate text-left disabled:cursor-default"
        title={description}
        disabled={!onOpen}
        onClick={onOpen}
      >
        {description}
        {Number.isFinite(elapsedMs) && elapsedMs >= 0 ? (
          <span className="ml-1.5 text-ui-xs tabular-nums text-muted-foreground">
            {formatClockDuration(elapsedMs)}
          </span>
        ) : null}
      </button>
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
// A task serving a local port is listed once, under Local Servers, while it runs.
export function EnvironmentBackgroundTasksSection({
  threadId,
  localServersEnabled,
  onOpenToolCall,
}: {
  threadId: ThreadId | null;
  localServersEnabled: boolean;
  // Shows the tool call that started a task in the transcript, its command and output open.
  onOpenToolCall: (toolCallId: string) => void;
}) {
  const setError = useStore((store) => store.setError);
  const servers = useQuery(serverLocalServersQueryOptions(localServersEnabled)).data?.servers;
  const serverTaskIds = new Set(
    (servers ?? []).flatMap((server) =>
      server.startedByAgent?.taskId ? [server.startedByAgent.taskId] : [],
    ),
  );
  const tasks = useThreadBackgroundTasks(threadId)
    .filter((task) => !(task.status === "running" && serverTaskIds.has(task.taskId)))
    .toSorted(
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
              onOpen={task.toolUseId ? () => onOpenToolCall(task.toolUseId!) : undefined}
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
