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
import { ComputerTerminal01Icon } from "~/lib/icons";
import { useEnvironmentListOpen } from "./environmentListOpen";
import { EnvironmentListSummary } from "./EnvironmentListSummary";
import {
  ENVIRONMENT_LIST_CLASS_NAME,
  ENVIRONMENT_ROW_CLASS_NAME,
  EnvironmentCollapsibleSection,
  EnvironmentSectionDivider,
} from "./EnvironmentRow";
import { useThreadBackgroundTasks } from "./useThreadBackgroundTasks";

const STATUS_LABELS: Record<WorkLogBackgroundTask["status"], string> = {
  running: "Running",
  completed: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

// Sized like a subagent's avatar, so both lists start their text at the same place.
function BackgroundTaskTile() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-[1.429em] shrink-0 items-center justify-center rounded-[30%] bg-[var(--color-background-button-secondary)] text-muted-foreground"
    >
      <ComputerTerminal01Icon className="size-[68%]" />
    </span>
  );
}

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
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 text-left disabled:cursor-default"
        disabled={!onOpen}
        onClick={onOpen}
      >
        <BackgroundTaskTile />
        <span className="min-w-0 truncate" title={description}>
          {description}
          {Number.isFinite(elapsedMs) && elapsedMs >= 0 ? (
            <span className="ml-1.5 text-ui-xs tabular-nums text-muted-foreground">
              {formatClockDuration(elapsedMs)}
            </span>
          ) : null}
        </span>
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
  const [expanded, setExpanded] = useEnvironmentListOpen("background-tasks", threadId);
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
        open={expanded}
        onOpenChange={setExpanded}
        collapsedContent={
          <EnvironmentListSummary
            leading={<BackgroundTaskTile />}
            runningCount={runningCount}
            doneCount={doneCount}
            expandLabel="Show background tasks"
            onExpand={() => setExpanded(true)}
          />
        }
      >
        <div className={ENVIRONMENT_LIST_CLASS_NAME}>
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
