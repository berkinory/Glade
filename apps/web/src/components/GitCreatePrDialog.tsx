import { GitPullRequestDraftIcon, GitPullRequestIcon } from "~/lib/icons";
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { DiffStat } from "~/components/ui/diff-stat";
import { SubmitShortcutKbd } from "~/components/ui/kbd";
import {
  type GitDialogContext,
  resolveCreatePrDialogExecution,
  resolveCreatePrDialogView,
} from "./GitActionsControl.logic";
import {
  GIT_DIALOG_FIELD_CLASS,
  GitDialogActionList,
  GitDialogActionRow,
  GitDialogBody,
  GitDialogHeading,
  GitDialogShell,
} from "./GitDialogChrome";
import { cn } from "~/lib/utils";
export interface GitCreatePrDialogSubmission {
  action: "create_pr" | "commit_push_pr";
  draft: boolean;
  includeLocalChanges: boolean;
  title: string | null;
  body: string | null;
}
interface GitCreatePrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: GitDialogContext;
  onSubmit: (submission: GitCreatePrDialogSubmission) => void;
}
export function GitCreatePrDialog({
  open,
  onOpenChange,
  context,
  onSubmit,
}: GitCreatePrDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [includeLocalChanges, setIncludeLocalChanges] = useState(true);
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBody("");
    setIncludeLocalChanges(true);
  }, [open]);
  const view = useMemo(() => resolveCreatePrDialogView(context), [context]);
  const execution = useMemo(
    () => resolveCreatePrDialogExecution(context, includeLocalChanges),
    [context, includeLocalChanges],
  );
  const canCreate = execution.kind === "run_action";
  const unavailableHint = execution.kind === "unavailable" ? execution.hint : null;
  const submit = (draft: boolean) => {
    if (execution.kind !== "run_action") return;
    onSubmit({
      action: execution.action,
      draft,
      includeLocalChanges,
      title: title.trim() || null,
      body: body.trim() || null,
    });
  };
  return (
    <GitDialogShell open={open} onOpenChange={onOpenChange} onSubmitShortcut={() => submit(false)}>
      <GitDialogHeading
        eyebrow={`${view.isNewBranch ? "New branch" : "Branch"} → ${view.baseBranchName}`}
        subject={
          view.willCreateFeatureBranch
            ? "Auto-named feature branch"
            : (view.branchName ?? "(detached HEAD)")
        }
        subjectMuted={view.willCreateFeatureBranch}
      />
      <GitDialogBody>
        <input
          autoFocus
          aria-label="Pull request title"
          className={GIT_DIALOG_FIELD_CLASS}
          maxLength={300}
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          aria-label="Pull request description"
          className={cn(GIT_DIALOG_FIELD_CLASS, "resize-none")}
          maxLength={60_000}
          placeholder="Description"
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-muted-foreground text-ui-sm leading-snug">
          Leave empty to generate the title and description.
        </p>
        {view.showCommitToggle && (
          <label className="flex cursor-pointer items-center gap-2 py-1 text-ui leading-snug">
            <Checkbox
              checked={includeLocalChanges}
              onCheckedChange={(checked) => setIncludeLocalChanges(checked === true)}
            />
            <span className="flex-1">Commit and push local changes</span>
            <DiffStat
              className="shrink-0 font-mono text-ui leading-snug"
              insertions={view.insertions}
              deletions={view.deletions}
            />
          </label>
        )}
        {unavailableHint && (
          <p className="py-1 text-warning text-ui leading-snug">{unavailableHint}</p>
        )}
      </GitDialogBody>
      <GitDialogActionList>
        <GitDialogActionRow
          disabled={!canCreate}
          icon={<GitPullRequestDraftIcon />}
          label="Create draft PR"
          onClick={() => submit(true)}
        />
        <GitDialogActionRow
          highlighted
          disabled={!canCreate}
          icon={<GitPullRequestIcon />}
          label="Create PR"
          trailing={<SubmitShortcutKbd />}
          onClick={() => submit(false)}
        />
      </GitDialogActionList>
    </GitDialogShell>
  );
}
