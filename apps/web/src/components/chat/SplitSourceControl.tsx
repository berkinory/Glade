import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useMemo, useState } from "react";
import { useStore } from "~/store";
import { createThreadSelector, createProjectSelector } from "~/storeSelectors";
import { requestExplorerFileReveal } from "~/explorerRevealRequestStore";
import { SourceControlDockPane } from "./SourceControlDockPane";
import { DockExplorerPane } from "./DockExplorerPane";
import { Button } from "../ui/button";

export function SplitSourceControl(props: {
  threadId: ThreadId;
  turnId: TurnId | null;
  filePath: string | null;
  onCurrentChanges: () => void;
}) {
  const thread = useStore(useMemo(() => createThreadSelector(props.threadId), [props.threadId]));
  const project = useStore(
    useMemo(() => createProjectSelector(thread?.projectId), [thread?.projectId]),
  );
  const cwd = thread?.worktreePath ?? project?.cwd ?? null;
  const [view, setView] = useState<"changes" | "history">("changes");
  const [explorer, setExplorer] = useState(false);
  return explorer ? (
    <div className="flex h-full min-h-0 flex-col">
      <Button size="sm" variant="ghost" onClick={() => setExplorer(false)}>
        Source Control
      </Button>
      <DockExplorerPane threadId={props.threadId} workspaceRoot={cwd} isVisible />
    </div>
  ) : (
    <SourceControlDockPane
      threadId={props.threadId}
      workspaceRoot={cwd}
      view={view}
      onViewChange={setView}
      diffTurnId={props.turnId}
      diffFilePath={props.filePath}
      onCurrentChanges={props.onCurrentChanges}
      onOpenFile={(path) => {
        requestExplorerFileReveal(props.threadId, path);
        setExplorer(true);
      }}
    />
  );
}
