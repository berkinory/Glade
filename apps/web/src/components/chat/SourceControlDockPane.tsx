import type { GitRecentCommit } from "@glade/contracts/git/git";
import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gitBranchesQueryOptions } from "~/lib/gitQueryOptions";
import { gitInitMutationOptions } from "~/lib/gitReactQuery";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { PanelStateMessage } from "./PanelStateMessage";
import { PanelEmptyState } from "./PanelEmptyState";
import type { SourceControlView } from "~/rightDockStore.logic";
import { PanelTabBar } from "./PanelTabBar";
import { ChangesIcon, GitBranchIcon, HistoryIcon } from "~/lib/icons";
import { GitPanel } from "./GitPanel";
import { SourceControlHistory } from "./SourceControlHistory";
import { SourceControlTurnChanges } from "./SourceControlTurnChanges";

export function SourceControlDockPane(props: {
  onSelectCommitFile?:
    | ((commit: GitRecentCommit, path: string, preview: boolean) => void)
    | undefined;
  onSelectDiff?:
    | ((section: "staged" | "unstaged", path: string, preview: boolean) => void)
    | undefined;
  threadId: ThreadId;
  workspaceRoot: string | null;
  onOpenFile: (filePath: string) => void;
  view: SourceControlView;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
  onViewChange: (view: SourceControlView) => void;
  onCurrentChanges: () => void;
}) {
  const queryClient = useQueryClient();
  const initMutation = useMutation(
    gitInitMutationOptions({ cwd: props.workspaceRoot, queryClient }),
  );
  const needsRepository = props.view === "history" || props.diffTurnId === null;
  const repository = useQuery({
    ...gitBranchesQueryOptions(props.workspaceRoot),
    enabled: needsRepository && props.workspaceRoot !== null,
    retry: false,
  });
  const repositoryState = !props.workspaceRoot ? (
    <PanelStateMessage>Choose a project to use source control.</PanelStateMessage>
  ) : !repository.data && repository.isPending ? (
    <PanelStateMessage loadingLabel="Checking Git repository" />
  ) : !repository.data && repository.isError ? (
    <PanelStateMessage>
      <div className="flex flex-col items-center gap-2">
        <span>Could not check this folder’s Git repository.</span>
        <Button size="sm" variant="outline" onClick={() => void repository.refetch()}>
          Retry
        </Button>
      </div>
    </PanelStateMessage>
  ) : repository.data?.isRepo === false ? (
    <PanelEmptyState
      icon={<GitBranchIcon className="size-12" aria-hidden="true" />}
      title="Not a Git repository"
      description="Initialize a Git repository in this folder to track changes and history."
    >
      <Button
        size="sm"
        disabled={initMutation.isPending}
        onClick={() =>
          initMutation.mutate(undefined, {
            onError: (error) =>
              toastManager.add({
                type: "error",
                title: "Could not initialize repository",
                description: error.message,
              }),
          })
        }
      >
        {initMutation.isPending ? <Spinner variant="action" /> : null}
        {initMutation.isPending ? "Initializing…" : "Initialize Repository"}
      </Button>
    </PanelEmptyState>
  ) : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <PanelTabBar
        label="Source control views"
        activeId={props.view}
        tabs={[
          { id: "changes", label: "Changes", icon: <ChangesIcon className="size-3.5" /> },
          { id: "history", label: "History", icon: <HistoryIcon className="size-3.5" /> },
        ]}
        onSelect={(view) => props.onViewChange(view === "history" ? "history" : "changes")}
      />
      <div className="min-h-0 flex-1">
        {needsRepository && repositoryState ? (
          repositoryState
        ) : props.view === "history" ? (
          <SourceControlHistory
            key={props.workspaceRoot}
            cwd={props.workspaceRoot}
            onSelectCommitFile={props.onSelectCommitFile}
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
            onSelectDiff={props.onSelectDiff}
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
