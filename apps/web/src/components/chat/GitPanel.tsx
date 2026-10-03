import { GitRevertDialog } from "./GitRevertDialog";
import { GitMediaPreview, isGitMediaPath } from "./GitMediaPreview";
import { EditSourceFile } from "./EditSourceFile";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { SourceControlToolbar } from "./SourceControlToolbar";

import { type FileDiffMetadata } from "@pierre/diffs/react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type MouseEvent } from "react";

import { showGitFileContextMenu } from "./gitFileContextMenu";
import { useTheme } from "~/hooks/useTheme";
import { buildFileDiffRenderKey, getRenderablePatch } from "~/lib/diffRendering";
import {
  gitQueryKeys,
  gitWorkingTreeDiffQueryOptions,
  gitSourceControlFilesQueryOptions,
} from "../../lib/gitQueryOptions";
import {
  gitSourceControlActionMutationOptions,
  gitStageFilesMutationOptions,
  gitUnstageFilesMutationOptions,
} from "~/lib/gitReactQuery";
import { CircleCheckIcon, RefreshCwIcon } from "~/lib/icons";
import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";
import { cn } from "~/lib/utils";
import { Alert } from "../ui/alert";

import { Input } from "../ui/input";
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

function SelectedFileDiff(props: {
  fileDiff: FileDiffMetadata;
  theme: "light" | "dark";
  cwd: string;
  onOpenFile: (path: string) => void;
}) {
  return (
    <FileDiffSurface className="h-full min-h-0 overflow-auto px-2 py-2">
      <div className="diff-render-file rounded-md">
        <FileDiffCard
          fileDiff={props.fileDiff}
          theme={props.theme}
          renderHeaderTrailing={() => (
            <EditSourceFile cwd={props.cwd} file={props.fileDiff} onOpenFile={props.onOpenFile} />
          )}
        />
      </div>
    </FileDiffSurface>
  );
}

export function GitPanel(props: {
  threadId: ThreadId;
  workspaceRoot: string | null;
  onOpenFile: (path: string) => void;
  selectedFilePath?: string | null;
  onSelectDiff?: ((section: GitFileSectionId, path: string, preview: boolean) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme as "light" | "dark";
  const cwd = props.workspaceRoot;

  const [selected, setSelected] = useState<SelectedFile | null>(null);
  useEffect(() => {
    if (props.selectedFilePath) setSelected({ section: "unstaged", path: props.selectedFilePath });
  }, [props.selectedFilePath]);
  const [fileSelection, setFileSelection] = useState<GitFileSelection | null>(null);
  const [reverting, setReverting] = useState<readonly SourceFile[] | null>(null);

  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(filter.trim()), 250);
    return () => clearTimeout(timer);
  }, [filter]);
  const filesQuery = useQuery(gitSourceControlFilesQueryOptions(cwd, search));
  const coverage = filesQuery.data?.coverage;
  const large = coverage?.mode === "large";

  const stagedFiles = filesQuery.data?.staged ?? [];
  const unstagedFiles = filesQuery.data?.unstaged ?? [];
  useEffect(() => {
    if (!filesQuery.data) return;
    setFileSelection((current) => {
      if (!current) return current;
      const available = new Set(filesQuery.data[current.section].map((file) => file.path));
      const paths = current.paths.filter((path) => available.has(path));
      if (paths.length === current.paths.length) return current;
      return paths.length
        ? { ...current, paths, anchor: available.has(current.anchor) ? current.anchor : paths[0]! }
        : null;
    });
    setSelected((current) =>
      current && !filesQuery.data[current.section].some((file) => file.path === current.path)
        ? null
        : current,
    );
  }, [filesQuery.data]);
  const selectedSection = selected?.section ?? "unstaged";
  const selectedPatchQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd,
      scope: selectedSection,
      filePath: selected?.path ?? null,
      enabled: !props.onSelectDiff && selected !== null && !isGitMediaPath(selected.path),
    }),
  );
  const selectedPatch = selectedPatchQuery.data?.patch;
  const selectedDiff = useMemo(() => {
    const renderable = getRenderablePatch(selectedPatch, `git-pane:selected:${theme}`);
    return renderable?.kind === "files" ? (renderable.files[0] ?? null) : null;
  }, [selectedPatch, theme]);

  const stageMutation = useMutation(gitStageFilesMutationOptions({ cwd, queryClient }));
  const unstageMutation = useMutation(gitUnstageFilesMutationOptions({ cwd, queryClient }));
  const ignoreMutation = useMutation(gitSourceControlActionMutationOptions({ cwd, queryClient }));
  const mutating =
    useIsMutating({
      predicate: (mutation) =>
        mutation.options.mutationKey?.[0] === "git" && mutation.options.mutationKey.includes(cwd),
    }) > 0;

  const rowTargets = (section: GitPanelSection, paths: string[]) => {
    const files = section === "staged" ? stagedFiles : unstagedFiles;
    const requested =
      fileSelection?.section === section &&
      paths.length === 1 &&
      fileSelection.paths.includes(paths[0]!)
        ? fileSelection.paths
        : paths;
    const currentPaths = new Set(files.map((file) => file.path));
    return requested.filter((path) => currentPaths.has(path));
  };

  const stageAll = (section: GitPanelSection) => {
    const options = {
      onError: (error: Error) =>
        toastManager.add({
          type: "error",
          title: "Could not update all changes",
          description: error.message,
        }),
    };
    if (section === "staged") unstageMutation.mutate({ allChanges: true }, options);
    else stageMutation.mutate({ allChanges: true }, options);
  };
  const stage = (paths: string[]) => {
    paths = rowTargets("unstaged", paths);
    if (!cwd || paths.length === 0) return;
    stageMutation.mutate(paths, {
      onError: (error) =>
        toastManager.add({
          type: "error",
          title: "Could not stage files",
          description: error.message,
        }),
    });
  };
  const unstage = (paths: string[]) => {
    paths = rowTargets("staged", paths);
    if (!cwd || paths.length === 0) return;
    unstageMutation.mutate(paths, {
      onError: (error) =>
        toastManager.add({
          type: "error",
          title: "Could not unstage files",
          description: error.message,
        }),
    });
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
      props.onSelectDiff?.(section, file.path, event.detail !== 2);
      setSelected((current) =>
        !props.onSelectDiff && current?.section === section && current.path === file.path
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
  const error = filesQuery.isError ? "Could not load changes. Refresh to try again." : null;
  const hasChanges = (coverage?.count ?? stagedFiles.length + unstagedFiles.length) > 0;

  if (!cwd) {
    return <PanelStateMessage>Source control is unavailable for this thread.</PanelStateMessage>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <SourceControlToolbar
        key={cwd}
        cwd={cwd}
        threadId={props.threadId}
        busy={mutating}
        onOpenFile={props.onOpenFile}
      />
      <div
        data-git-files-scroll=""
        className={cn(
          "flex min-h-0 flex-col gap-2 overflow-auto px-1.5 py-2",
          selectedResolved && !props.onSelectDiff ? "max-h-[40%] shrink-0" : "flex-1",
        )}
      >
        {large ? (
          <div className="space-y-2 border-b border-border/70 px-1.5 pb-2">
            <p className="text-ui-sm font-medium">
              Large changes: {coverage.count.toLocaleString()}
              {coverage.incomplete ? "+" : ""} unique files
            </p>
            <p className="text-ui-xs text-muted-foreground">
              {coverage.incomplete
                ? "Collection budget reached. Counts and search coverage are incomplete. "
                : ""}
              {coverage.resultsLimited
                ? "Showing bounded results. Search to narrow the list. "
                : ""}
              Stage all and Unstage all apply to the entire checkout.
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-ui-xs text-muted-foreground">
              {coverage.folders.map((folder) => (
                <span key={folder.path}>
                  {folder.path}: {folder.count.toLocaleString()}
                </span>
              ))}
              {coverage.otherFolders ? (
                <span>Other folders: {coverage.otherFolders.toLocaleString()}</span>
              ) : null}
            </div>
          </div>
        ) : null}
        {large || filter ? (
          <Input
            nativeInput
            type="search"
            size="sm"
            aria-label="Search changed files"
            placeholder="Search changed files"
            maxLength={200}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        ) : null}
        {(coverage?.stagedCount ?? stagedFiles.length) > 0 ? (
          <GitFileSection
            title="Staged"
            files={stagedFiles}
            count={coverage?.stagedCount}
            onAllAction={() => stageAll("staged")}
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
            <IconButton label="Retry loading changes" tooltip="Retry" onClick={refresh}>
              <RefreshCwIcon className="size-3.5" />
            </IconButton>
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
            count={coverage?.unstagedCount}
            onAllAction={() => stageAll("unstaged")}
            selectedPaths={highlightedPaths("unstaged")}
            actionLabel="Stage file"
            actionAllLabel="Stage all"
            actionIcon="stage"
            actionDisabled={mutating}
            onSelect={(file, event) => selectFile("unstaged", file, event)}
            onContextMenu={(file, event) => void showFileMenu("unstaged", file, event)}
            onAction={stage}
            onOpenFile={props.onOpenFile}
            onRevert={(file) => {
              const targets = new Set(rowTargets("unstaged", [file.path]));
              setReverting(unstagedFiles.filter((entry) => targets.has(entry.path)));
            }}
            {...(stagedFiles.length === 0 ? { onRefresh: refresh } : {})}
          />
        ) : null}
        {large && stagedFiles.length + unstagedFiles.length === 0 && !isLoading ? (
          <PanelStateMessage density="compact">
            No matching files in the collected results.
          </PanelStateMessage>
        ) : null}
      </div>

      {selectedResolved && !props.onSelectDiff ? (
        <div className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden border-t border-border/70">
          {isGitMediaPath(selectedResolved.file.path) ? (
            <GitMediaPreview
              key={`${cwd}:${selectedResolved.section}:${selectedResolved.file.path}`}
              cwd={cwd}
              path={selectedResolved.file.path}
              revision={selectedResolved.section === "staged" ? "index" : "workingTree"}
            />
          ) : selectedPatchQuery.data?.truncated ? (
            <Alert variant="error" size="sm">
              This file's diff exceeds the preview limit.
            </Alert>
          ) : selectedPatchQuery.isError ? (
            <Alert variant="error" size="sm">
              Could not load this file’s diff. Refresh to try again.
              <IconButton label="Retry loading diff" tooltip="Retry" onClick={refresh}>
                <RefreshCwIcon className="size-3.5" />
              </IconButton>
            </Alert>
          ) : selectedFileDiff ? (
            <SelectedFileDiff
              key={`${buildFileDiffRenderKey(selectedFileDiff)}:${theme}`}
              cwd={cwd}
              onOpenFile={props.onOpenFile}
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
      <GitRevertDialog
        cwd={cwd}
        files={reverting}
        onClose={() => setReverting(null)}
        onCompleted={() => setFileSelection(null)}
      />
    </div>
  );
}
