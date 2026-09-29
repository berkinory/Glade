import type { ThreadId, TurnId } from "@glade/contracts";
import { useEffect, useState } from "react";

import type { DiffFileEditRequest } from "~/lib/diffEditBaseRev";
import type { SourceControlView } from "~/rightDockStore.logic";
import { cn } from "~/lib/utils";
import { GitPanel } from "./GitPanel";
import { LazyDiffPanel } from "./ChatThreadSurfacePrimitives";

export function SourceControlDockPane(props: {
  threadId: ThreadId;
  workspaceRoot: string | null;
  onOpenFile: (filePath: string) => void;
  view: SourceControlView;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
  active: boolean;
  onViewChange: (view: SourceControlView) => void;
  onReviewSelectionChange: (patch: {
    diffTurnId?: TurnId | null;
    diffFilePath?: string | null;
  }) => void;
  onEditFile: (request: DiffFileEditRequest) => void;
  onClose: () => void;
}) {
  const [reviewOpened, setReviewOpened] = useState(props.view === "review");
  useEffect(() => {
    if (props.view === "review") setReviewOpened(true);
  }, [props.view]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div
        role="tablist"
        aria-label="Source control views"
        className="flex shrink-0 gap-1 border-b border-border/70 px-3 py-1.5"
      >
        {(["changes", "review"] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={props.view === view}
            className={cn(
              "rounded-md px-2.5 py-1 text-ui-sm font-medium transition-colors",
              props.view === view
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
            onClick={() => props.onViewChange(view)}
          >
            {view === "changes" ? "Changes" : "Review"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <div className={cn("h-full min-h-0", props.view !== "changes" && "hidden")}>
          <GitPanel workspaceRoot={props.workspaceRoot} onOpenFile={props.onOpenFile} />
        </div>
        {reviewOpened || props.view === "review" ? (
          <div className={cn("h-full min-h-0", props.view !== "review" && "hidden")}>
            <LazyDiffPanel
              mode="sidebar"
              initialViewKind="turn"
              threadId={props.threadId}
              panelState={{
                panel: props.view === "review" ? "diff" : null,
                diffTurnId: props.diffTurnId,
                diffFilePath: props.diffFilePath,
              }}
              onUpdatePanelState={props.onReviewSelectionChange}
              onClosePanel={props.onClose}
              onEditFile={props.onEditFile}
              liveRefreshEnabled={props.active && props.view === "review"}
              queriesEnabled={props.active && props.view === "review"}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
