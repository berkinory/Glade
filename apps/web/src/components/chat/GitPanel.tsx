import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { SourceControlToolbar } from "./SourceControlToolbar";

import { type FileDiffMetadata } from "@pierre/diffs/react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type MouseEvent } from "react";

import { showGitFileContextMenu } from "./gitFileContextMenu";
import { useTheme } from "~/hooks/useTheme";
import { buildFileDiffRenderKey, getRenderablePatch } from "~/lib/diffRendering";
import {
  gitQueryKeys,
  gitWorkingTreeDiffQueryOptions,
  gitWorkingTreeDiffStatsQueryOptions,
  gitSourceControlFilesQueryOptions,
} from "../../lib/gitQueryOptions";
import {
  gitSourceControlActionMutationOptions,
  gitRevertUnstagedFileMutationOptions,
  gitStageFilesMutationOptions,
  gitUnstageFilesMutationOptions,
} from "~/lib/gitReactQuery";
import { CircleCheckIcon, RefreshCwIcon } from "~/lib/icons";
import { projectQueryKeys } from "~/lib/projectReactQuery";
import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";
import { cn } from "~/lib/utils";
import { Alert } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { FileDiffCard, FileDiffSurface } from "./FileDiffView";
import { GitFileSection, type SourceFile } from "./GitFileList";
import { PanelStateMessage } from "./PanelStateMessage";
import { selectGitFiles, type GitFileSelection, type GitFileSectionId } from "./gitFileSelection";

type GitPanelSection = GitFileSectionId;

interface SelectedFile {
  section: GitPanelSection;
  path: string;
}

function SelectedFileDiff(props: { fileDiff: FileDiffMetadata; theme: "light" | "dark" }) {
  return (
    <FileDiffSurface className="h-full min-h-0 overflow-auto px-2 py-2">
      <div className="diff-render-file rounded-md">
        <FileDiffCard fileDiff={props.fileDiff} theme={props.theme} />
      </div>
    </FileDiffSurface>
  );
}

export function GitPanel(props: {
  threadId: ThreadId;
  workspaceRoot: string | null;
  onOpenFile: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme as "light" | "dark";
  const cwd = props.workspaceRoot;

  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [fileSelection, setFileSelection] = useState<GitFileSelection | null>(null);
  const [reverting, setReverting] = useState<readonly SourceFile[] | null>(null);

  const filesQuery = useQuery(gitSourceControlFilesQueryOptions(cwd));
  const stagedFiles = filesQuery.data?.staged ?? [];
  const unstagedFiles = filesQuery.data?.unstaged ?? [];
  const hasUntrackedFiles = unstagedFiles.some((file) => file.status === "U");
  const unstagedStatsQuery = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({
      cwd,
      scope: "unstaged",
      enabled: hasUntrackedFiles,
      includeUntrackedFiles: true,
    }),
  );
  const unstagedTotalStats = hasUntrackedFiles ? (unstagedStatsQuery.data ?? null) : undefined;
  const untrackedFileStats = useMemo(
    () => new Map(unstagedStatsQuery.data?.untrackedFiles?.map((file) => [file.path, file]) ?? []),
    [unstagedStatsQuery.data?.untrackedFiles],
  );
  const selectedSection =
    selected &&
    !(selected.section === "staged" ? stagedFiles : unstagedFiles).some(
      (file) => file.path === selected.path,
    )
      ? selected.section === "staged"
        ? "unstaged"
        : "staged"
      : (selected?.section ?? "unstaged");
  const selectedPatchQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd,
      scope: selectedSection,
      filePath: selected?.path ?? null,
      enabled: selected !== null,
    }),
  );
  const selectedPatch = selectedPatchQuery.data?.patch;
  const selectedDiff = useMemo(() => {
    const renderable = getRenderablePatch(selectedPatch, `git-pane:selected:${theme}`);
    return renderable?.kind === "files" ? (renderable.files[0] ?? null) : null;
  }, [selectedPatch, theme]);

  const stageMutation = useMutation(gitStageFilesMutationOptions({ cwd, queryClient }));
  const unstageMutation = useMutation(gitUnstageFilesMutationOptions({ cwd, queryClient }));
  const revertMutation = useMutation(gitRevertUnstagedFileMutationOptions({ cwd, queryClient }));
  const ignoreMutation = useMutation(gitSourceControlActionMutationOptions({ cwd, queryClient }));
  const mutating =
    useIsMutating({
      predicate: (mutation) =>
        mutation.options.mutationKey?.[0] === "git" && mutation.options.mutationKey.includes(cwd),
    }) > 0;

  const stage = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    setFileSelection(null);
    stageMutation.mutate(paths);
  };
  const unstage = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    setFileSelection(null);
    unstageMutation.mutate(paths);
  };

  const selectFile = (
    section: GitPanelSection,
    file: SourceFile,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const additive = event.metaKey || event.ctrlKey;
    const range = event.shiftKey;
    const files = section === "staged" ? stagedFiles : unstagedFiles;
    setFileSelection((current) =>
      selectGitFiles({ current, section, files, path: file.path, additive, range }),
    );
    if (!additive && !range) {
      setSelected((current) =>
        current?.section === section && current.path === file.path
          ? null
          : { section, path: file.path },
      );
    }
  };
  const showFileMenu = async (
    section: GitPanelSection,
    file: SourceFile,
    event: MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    if (mutating) return;
    const files = section === "staged" ? stagedFiles : unstagedFiles;
    const selectedPaths =
      fileSelection?.section === section && fileSelection.paths.includes(file.path)
        ? fileSelection.paths
        : [file.path];
    const targets = files.filter((candidate) => selectedPaths.includes(candidate.path));
    if (selectedPaths.length === 1 || !fileSelection?.paths.includes(file.path)) {
      setFileSelection({ section, paths: [file.path], anchor: file.path });
    }
    const clicked = await showGitFileContextMenu(section, file, targets, {
      x: event.clientX,
      y: event.clientY,
    });
    if (clicked === "open") props.onOpenFile(file.path);
    if (clicked === "action") {
      if (section === "staged") unstage(targets.map((target) => target.path));
      else stage(targets.map((target) => target.path));
    }
    if (clicked === "revert") setReverting(targets);
    if (clicked === "ignore") {
      if (!targets.every((target) => target.status === "U")) {
        toastManager.add({
          type: "info",
          title: "Git already tracks these files",
          description:
            ".gitignore applies to untracked files. Existing tracked files are kept in the repository.",
        });
        return;
      }
      if (hasUnsavedWorkspaceEditors(queryClient, cwd)) {
        toastManager.add({
          type: "error",
          title: "Save your open files before updating .gitignore.",
        });
        return;
      }
      ignoreMutation.mutate(
        { action: "ignore", paths: targets.map((target) => target.path) },
        {
          onError: (error) =>
            toastManager.add({
              type: "error",
              title: "Could not update .gitignore",
              description: error.message,
            }),
          onSuccess: () => {
            setFileSelection(null);
            toastManager.add({ type: "success", title: "Added to .gitignore" });
          },
        },
      );
    }
  };

  const refresh = () => {
    if (!cwd) return;
    void queryClient.invalidateQueries({ queryKey: gitQueryKeys.sourceControlFiles(cwd) });
    void queryClient.invalidateQueries({ queryKey: gitQueryKeys.workingTreeDiffs(cwd) });
  };

  let selectedResolved: { section: GitPanelSection; file: SourceFile } | null = null;
  if (selected) {
    const findInSection = (section: GitPanelSection) =>
      (section === "staged" ? stagedFiles : unstagedFiles).find(
        (file) => file.path === selected.path,
      ) ?? null;
    const preferred = findInSection(selected.section);
    if (preferred) {
      selectedResolved = { section: selected.section, file: preferred };
    } else {
      const otherSection: GitPanelSection = selected.section === "staged" ? "unstaged" : "staged";
      const fallback = findInSection(otherSection);
      selectedResolved = fallback ? { section: otherSection, file: fallback } : null;
    }
  }
  const selectedFileDiff = selectedResolved ? selectedDiff : null;
  const highlightedPaths = (section: GitPanelSection) =>
    new Set(
      fileSelection?.section === section
        ? fileSelection.paths
        : selectedResolved?.section === section
          ? [selectedResolved.file.path]
          : [],
    );

  const isLoading = filesQuery.isLoading;
  const error = filesQuery.error instanceof Error ? filesQuery.error.message : null;
  const hasChanges = stagedFiles.length > 0 || unstagedFiles.length > 0;

  if (!cwd) {
    return <PanelStateMessage>Source control is unavailable for this thread.</PanelStateMessage>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <SourceControlToolbar
        key={cwd}
        cwd={cwd}
        threadId={props.threadId}
        stagedCount={stagedFiles.length}
        busy={mutating}
      />
      <div
        className={cn(
          "flex min-h-0 flex-col gap-2 overflow-auto px-1.5 py-2",
          selectedResolved ? "max-h-[40%] shrink-0" : "flex-1",
        )}
      >
        {stagedFiles.length > 0 ? (
          <GitFileSection
            title="Staged"
            files={stagedFiles}
            selectedPaths={highlightedPaths("staged")}
            actionLabel="Unstage file"
            actionAllLabel="Unstage all"
            actionIcon="unstage"
            actionDisabled={mutating}
            onSelect={(file, event) => selectFile("staged", file, event)}
            onContextMenu={(file, event) => void showFileMenu("staged", file, event)}
            onAction={unstage}
            onOpenFile={props.onOpenFile}
            onRefresh={refresh}
          />
        ) : null}
        {error ? (
          <Alert variant="error" size="sm" className="text-destructive">
            {error}
          </Alert>
        ) : null}
        {!error && isLoading && !hasChanges ? (
          <div className="flex flex-1 items-center justify-center" aria-label="Loading changes">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : null}
        {!error && !isLoading && !hasChanges ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/50 text-muted-foreground">
              <CircleCheckIcon className="size-6" aria-hidden="true" />
            </span>
            <span className="text-ui-lg font-medium text-foreground">No changes</span>
            <span className="text-ui-sm text-muted-foreground">
              No staged or unstaged files here.
            </span>
            <span className="max-w-full break-all text-ui-xs text-muted-foreground/70" title={cwd}>
              {cwd}
            </span>
            <IconButton
              size="icon-xs"
              variant="ghost"
              label="Refresh changes"
              tooltip="Refresh changes"
              onClick={refresh}
            >
              <RefreshCwIcon className="size-3.5" />
            </IconButton>
          </div>
        ) : null}
        {hasChanges ? (
          <GitFileSection
            title="Changes"
            files={unstagedFiles}
            untrackedFileStats={untrackedFileStats}
            {...(unstagedTotalStats === undefined ? {} : { totalStats: unstagedTotalStats })}
            selectedPaths={highlightedPaths("unstaged")}
            actionLabel="Stage file"
            actionAllLabel="Stage all"
            actionIcon="stage"
            actionDisabled={mutating}
            onSelect={(file, event) => selectFile("unstaged", file, event)}
            onContextMenu={(file, event) => void showFileMenu("unstaged", file, event)}
            onAction={stage}
            onOpenFile={props.onOpenFile}
            onRevert={(file) => setReverting([file])}
            {...(stagedFiles.length === 0 ? { onRefresh: refresh } : {})}
          />
        ) : null}
      </div>

      {selectedResolved ? (
        <div className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden border-t border-border/70">
          {selectedPatchQuery.data?.truncated ? (
            <Alert variant="error" size="sm">
              This file's diff exceeds the preview limit.
            </Alert>
          ) : selectedPatchQuery.error instanceof Error ? (
            <Alert variant="error" size="sm">
              {selectedPatchQuery.error.message}
            </Alert>
          ) : selectedFileDiff ? (
            <SelectedFileDiff
              key={`${buildFileDiffRenderKey(selectedFileDiff)}:${theme}`}
              fileDiff={selectedFileDiff}
              theme={theme}
            />
          ) : (
            <PanelStateMessage density="compact">
              {selectedPatchQuery.isLoading ? (
                <Spinner className="size-5" aria-label="Loading diff" />
              ) : (
                "No diff to show."
              )}
            </PanelStateMessage>
          )}
        </div>
      ) : null}
      <AlertDialog
        open={reverting !== null}
        onOpenChange={(open) => {
          if (!open) setReverting(null);
        }}
      >
        <AlertDialogPopup className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="truncate" title={reverting?.[0]?.path}>
              {reverting?.length === 1
                ? "Revert changes?"
                : `Revert ${reverting?.length ?? 0} files?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reverting?.length === 1
                ? reverting[0]?.status === "U"
                  ? `Delete untracked file ${reverting[0].path}? This cannot be undone.`
                  : `Discard unstaged changes in ${reverting?.[0]?.path}? Staged changes will remain.`
                : "Discard unstaged changes in the selected files? Untracked files will be deleted. Staged changes will remain."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={mutating}
              onClick={() => {
                void (async () => {
                  if (!cwd || !reverting) return;
                  if (hasUnsavedWorkspaceEditors(queryClient, cwd)) {
                    toastManager.add({
                      type: "warning",
                      title: "Save open files before reverting changes.",
                    });
                    return;
                  }
                  let completed = 0;
                  try {
                    for (const file of reverting) {
                      await revertMutation.mutateAsync(file.path);
                      completed += 1;
                    }
                    if (reverting.some((file) => file.status === "U")) {
                      await queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
                    }
                    setFileSelection(null);
                    setReverting(null);
                  } catch (error) {
                    if (completed > 0) {
                      await queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
                      setFileSelection(null);
                      setReverting(null);
                    }
                    toastManager.add({
                      type: "error",
                      title:
                        error &&
                        typeof error === "object" &&
                        "message" in error &&
                        typeof error.message === "string"
                          ? error.message
                          : "Could not revert file.",
                      ...(completed > 0
                        ? { description: `${completed} of ${reverting.length} files reverted.` }
                        : {}),
                    });
                  }
                })();
              }}
            >
              Revert
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
