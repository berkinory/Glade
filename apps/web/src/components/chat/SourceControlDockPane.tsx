import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { SourceControlView } from "~/rightDockStore.logic";
import { cn } from "~/lib/utils";
import { ChangesIcon, HistoryIcon } from "~/lib/icons";
import { GitPanel } from "./GitPanel";
import { SourceControlHistory } from "./SourceControlHistory";
import { SourceControlTurnChanges } from "./SourceControlTurnChanges";

export function SourceControlDockPane(props: {
  threadId: ThreadId;
  workspaceRoot: string | null;
  onOpenFile: (filePath: string) => void;
  view: SourceControlView;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
  onViewChange: (view: SourceControlView) => void;
  onCurrentChanges: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div
        role="tablist"
        aria-label="Source control views"
        className="flex shrink-0 gap-1 border-b border-border/70 px-3 py-1.5"
      >
        {(["changes", "history"] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={props.view === view}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-ui-sm font-medium",
              props.view === view
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60",
            )}
            onClick={() => props.onViewChange(view)}
          >
            {view === "changes" ? (
              <ChangesIcon className="size-3.5" />
            ) : (
              <HistoryIcon className="size-3.5" />
            )}
            {view === "changes" ? "Changes" : "History"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {props.view === "history" ? (
          <SourceControlHistory
            key={props.workspaceRoot}
            cwd={props.workspaceRoot}
            onOpenFile={props.onOpenFile}
          />
        ) : props.diffTurnId ? (
          <SourceControlTurnChanges
            key={props.diffTurnId}
            threadId={props.threadId}
            turnId={props.diffTurnId}
            filePath={props.diffFilePath}
            cwd={props.workspaceRoot}
            onOpenFile={props.onOpenFile}
            onCurrentChanges={props.onCurrentChanges}
          />
        ) : (
          <GitPanel
            selectedFilePath={props.diffFilePath}
            threadId={props.threadId}
            workspaceRoot={props.workspaceRoot}
            onOpenFile={props.onOpenFile}
          />
        )}
      </div>
    </div>
  );
}
