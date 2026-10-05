import { CheckIcon, LayoutAlignRightIcon } from "~/lib/icons";
import { Spinner } from "~/components/ui/spinner";
import { type TimestampFormat } from "../appSettings";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "~/lib/utils";
import type { ActiveTaskListState } from "../session-logic";
import { formatTimestamp } from "../timestampFormat";
function stepStatusIcon(status: string): React.ReactNode {
  if (status === "completed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]">
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent-blue)_15%,transparent)] text-[var(--color-accent-blue)]">
        <Spinner variant="working" className="size-3" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30">
      <span className="size-1.5 rounded-full bg-muted-foreground/30" />
    </span>
  );
}
export default function TaskListSidebar({
  activeTaskList,
  timestampFormat,
  onClose,
}: {
  activeTaskList: ActiveTaskListState | null;
  timestampFormat: TimestampFormat;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-border/70 bg-card/50">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2">
          <span className="text-ui-sm font-semibold">Tasks</span>
          {activeTaskList ? (
            <span className="text-ui-sm text-muted-foreground/60">
              {formatTimestamp(activeTaskList.createdAt, timestampFormat)}
            </span>
          ) : null}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          aria-label="Close task list sidebar"
        >
          <LayoutAlignRightIcon className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3 space-y-4">
          {activeTaskList?.explanation ? (
            <p className="text-ui-lg leading-relaxed text-muted-foreground/80">
              {activeTaskList.explanation}
            </p>
          ) : null}

          {activeTaskList && activeTaskList.tasks.length > 0 ? (
            <div className="space-y-1">
              <p className="mb-2 text-ui-xs font-semibold text-muted-foreground/40">Steps</p>
              {activeTaskList.tasks.map((task) => (
                <div
                  key={`${task.status}:${task.task}`}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-100",
                    task.status === "inProgress" &&
                      "bg-[color-mix(in_srgb,var(--color-accent-blue)_5%,transparent)]",
                    task.status === "completed" &&
                      "bg-[color-mix(in_srgb,var(--success)_5%,transparent)]",
                  )}
                >
                  <div className="mt-0.5">{stepStatusIcon(task.status)}</div>
                  <p
                    className={cn(
                      "text-ui-lg leading-snug",
                      task.status === "completed"
                        ? "text-muted-foreground/50 line-through decoration-muted-foreground/20"
                        : task.status === "inProgress"
                          ? "text-foreground/90"
                          : "text-muted-foreground/70",
                    )}
                  >
                    {task.task}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {!activeTaskList ? (
            <p className="text-ui-sm text-muted-foreground">No active tasks.</p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
