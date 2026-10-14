import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DiffStat } from "~/components/ui/diff-stat";
import { SubmitShortcutKbd } from "~/components/ui/kbd";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  type GitCommitDialogAction,
  type GitDialogContext,
  resolveCommitDialogActions,
} from "./GitActionsControl.logic";
import { ShowMoreFilesButton, usePagedFiles } from "./chat/ShowMoreFilesButton";
import { GitActionGlyph } from "./gitActionGlyphs";
import {
  GIT_DIALOG_FIELD_CLASS,
  GitDialogActionList,
  GitDialogActionRow,
  GitDialogBody,
  GitDialogHeading,
  GitDialogShell,
} from "./GitDialogChrome";
import { cn } from "~/lib/utils";
import {
  gitSourceControlFilesQueryOptions,
  gitWorkingTreeDiffStatsQueryOptions,
} from "~/lib/gitQueryOptions";

export interface GitCommitDialogSubmission {
  action: GitCommitDialogAction["action"];
  featureBranch: boolean;
  message: string | null;
  // null commits every changed file; otherwise only the listed paths.
  filePaths: string[] | null;
}

interface ChangedFile {
  path: string;
  insertions: number;
  deletions: number;
}

interface GitCommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: GitDialogContext;
  gitCwd: string | null;
  primaryActionId: "commit" | "commit_push";
  onSubmit: (submission: GitCommitDialogSubmission) => void;
  onOpenFile: (filePath: string) => void;
}

export function GitCommitDialog({
  open,
  onOpenChange,
  context,
  gitCwd,
  primaryActionId,
  onSubmit,
  onOpenFile,
}: GitCommitDialogProps) {
  const [message, setMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const [selectionSeeded, setSelectionSeeded] = useState(false);
  const sourceFiles = useQuery({
    ...gitSourceControlFilesQueryOptions(gitCwd),
    enabled: open && gitCwd !== null,
  });
  const workingTreeStats = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({ cwd: gitCwd, includeFiles: true, enabled: open }),
  );
  const stagedStats = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({
      cwd: gitCwd,
      scope: "staged",
      includeFiles: true,
      enabled: open,
    }),
  );

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
    setSelectionSeeded(false);
  }, [open]);

  const gitStatus = context.gitStatus;
  const stagedPaths = useMemo(
    () => new Set(sourceFiles.data?.staged.map((file) => file.path) ?? []),
    [sourceFiles.data],
  );
  const statusFiles = useMemo(() => gitStatus?.workingTree.files ?? [], [gitStatus]);
  // A selection equal to the index is committed as staged, so its counts come from the index.
  const commitsIndexAsStaged =
    stagedPaths.size > 0 &&
    statusFiles.every((file) => excludedFiles.has(file.path) !== stagedPaths.has(file.path));
  const allFiles = useMemo(() => {
    const source = commitsIndexAsStaged ? stagedStats.data : workingTreeStats.data;
    const stats = new Map(source?.files?.map((file) => [file.path, file]));
    return statusFiles.map((file) => {
      const stat = stats.get(file.path);
      return stat ? { ...file, insertions: stat.insertions, deletions: stat.deletions } : file;
    });
  }, [commitsIndexAsStaged, stagedStats.data, statusFiles, workingTreeStats.data]);
  const pagedFiles = usePagedFiles(allFiles);

  // Staged files are the user's explicit selection from Source Control, so the dialog starts there
  // instead of silently widening the commit to every change.
  useEffect(() => {
    if (!open || selectionSeeded || !sourceFiles.data) return;
    setSelectionSeeded(true);
    if (stagedPaths.size === 0) return;
    setExcludedFiles(
      new Set(allFiles.filter((file) => !stagedPaths.has(file.path)).map((file) => file.path)),
    );
    setIsEditingFiles(true);
  }, [allFiles, open, selectionSeeded, sourceFiles.data, stagedPaths]);
  const selectedFiles = useMemo(
    () => allFiles.filter((file) => !excludedFiles.has(file.path)),
    [allFiles, excludedFiles],
  );
  const incomplete = gitStatus?.workingTree.incomplete === true;
  const allSelected = incomplete || excludedFiles.size === 0;
  const noneSelected = selectedFiles.length === 0;

  const hasFileSelection = allFiles.length === 0 || !noneSelected;

  const actions = useMemo(
    () => resolveCommitDialogActions({ context, hasFileSelection }),
    [context, hasFileSelection],
  );

  const submit = (action: GitCommitDialogAction) => {
    if (action.disabled) return;
    onSubmit({
      action: action.action,
      featureBranch: action.featureBranch,
      message: message.trim() || null,
      filePaths: allSelected ? null : selectedFiles.map((file) => file.path),
    });
  };

  const submitPrimary = () => {
    const primary = actions.find((action) => action.id === primaryActionId);
    if (primary) submit(primary);
  };

  const toggleFile = (path: string) => {
    setExcludedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <GitDialogShell open={open} onOpenChange={onOpenChange} onSubmitShortcut={submitPrimary}>
      <GitDialogHeading
        eyebrow="Commit"
        eyebrowTrailing={
          context.isDefaultBranch ? <span className="text-warning">Default branch</span> : null
        }
        subject={gitStatus?.branch ?? "(detached HEAD)"}
      />
      <GitDialogBody>
        <textarea
          autoFocus
          aria-label="Commit message"
          className={cn(GIT_DIALOG_FIELD_CLASS, "resize-none")}
          maxLength={20_000}
          placeholder="Message (leave empty to generate)"
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <div className="space-y-1">
          <div className="flex items-center gap-2 py-1 text-ui leading-snug">
            {isEditingFiles && allFiles.length > 0 ? (
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && !noneSelected}
                onCheckedChange={() => {
                  setExcludedFiles(
                    allSelected ? new Set(allFiles.map((file) => file.path)) : new Set(),
                  );
                }}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {incomplete
                ? "All changes (partial file list)"
                : summarizeSelection(allFiles.length, selectedFiles.length, allSelected)}
            </span>
            <DiffStat
              className="shrink-0 font-mono text-ui leading-snug"
              insertions={selectedFiles.reduce((sum, file) => sum + file.insertions, 0)}
              deletions={selectedFiles.reduce((sum, file) => sum + file.deletions, 0)}
            />
            {allFiles.length > 0 && !incomplete ? (
              <Button
                variant="ghost"
                size="xs"
                className="shrink-0"
                onClick={() => setIsEditingFiles((prev) => !prev)}
              >
                {isEditingFiles ? "Done" : "Edit"}
              </Button>
            ) : null}
          </div>
          {allFiles.length > 0 ? (
            <ScrollArea className="h-32 rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)]">
              <div className="space-y-1 p-1">
                {pagedFiles.visibleFiles.map((file) => (
                  <ChangedFileRow
                    key={file.path}
                    file={file}
                    excluded={excludedFiles.has(file.path)}
                    staged={stagedPaths.has(file.path)}
                    selectable={isEditingFiles && !incomplete}
                    onToggle={() => toggleFile(file.path)}
                    onOpen={() => onOpenFile(file.path)}
                  />
                ))}
                <ShowMoreFilesButton
                  hiddenCount={pagedFiles.hiddenCount}
                  onClick={pagedFiles.showMore}
                  className="px-1.5 py-1"
                />
              </div>
            </ScrollArea>
          ) : null}
        </div>
      </GitDialogBody>
      <GitDialogActionList>
        {actions.map((action) => (
          <GitDialogActionRow
            key={action.id}
            highlighted={action.id === primaryActionId}
            disabled={action.disabled}
            disabledReason={action.disabledReason}
            icon={<GitActionGlyph name={action.icon} className="size-4" />}
            label={action.label}
            {...(action.id === primaryActionId ? { trailing: <SubmitShortcutKbd /> } : {})}
            onClick={() => submit(action)}
          />
        ))}
      </GitDialogActionList>
    </GitDialogShell>
  );
}

function summarizeSelection(total: number, selected: number, allSelected: boolean): string {
  if (total === 0) return "No local changes";
  if (allSelected) return `${total} ${total === 1 ? "file" : "files"}`;
  return `${selected} of ${total} files`;
}

function ChangedFileRow({
  file,
  excluded,
  staged,
  selectable,
  onToggle,
  onOpen,
}: {
  file: ChangedFile;
  excluded: boolean;
  staged: boolean;
  selectable: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-ui leading-snug hover:bg-[var(--color-background-button-secondary-hover)]">
      {selectable ? <Checkbox checked={!excluded} onCheckedChange={onToggle} /> : null}
      <button
        type="button"
        className="group flex flex-1 items-center justify-between gap-3 truncate text-left"
        onClick={onOpen}
      >
        <span
          className={cn(
            "truncate underline-offset-2 group-hover:underline group-focus-visible:underline",
            excluded && "text-muted-foreground",
          )}
        >
          {file.path}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {staged ? (
            <span className="font-sans text-ui-xs text-muted-foreground">Staged</span>
          ) : null}
          {excluded ? (
            <span className="text-muted-foreground">Excluded</span>
          ) : (
            <DiffStat
              insertions={file.insertions}
              deletions={file.deletions}
              separator={<span className="text-muted-foreground">/</span>}
            />
          )}
        </span>
      </button>
    </div>
  );
}
