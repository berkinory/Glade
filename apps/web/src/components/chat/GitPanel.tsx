// FILE: GitPanel.tsx
// Purpose: Source-control staging pane for the right dock (staged/unstaged lists + per-file diff).
// Layer: Chat right-dock UI
// Depends on: gitReactQuery (diff queries + stage/unstage mutations), diffRendering (patch parsing),
//             @pierre/diffs FileDiff for the per-file viewer.
//
// The pane receives the thread's resolved workspace root and lists files from Git status.
// It loads a patch only for the selected file. Stage/unstage are index mutations routed through
// GitCore; on settle we invalidate the per-cwd git caches so both lists stay in sync.

import { type FileDiffMetadata } from "@pierre/diffs/react";
import {
  type GitSourceControlFilesResult,
  type GitSourceControlFileStatus,
} from "@glade/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveFileDiffPath,
  splitRepoRelativePath,
} from "~/lib/diffRendering";
import {
  gitQueryKeys,
  gitStageFilesMutationOptions,
  gitUnstageFilesMutationOptions,
  gitWorkingTreeDiffQueryOptions,
  gitSourceControlFilesQueryOptions,
} from "~/lib/gitReactQuery";
import { CircleCheckIcon, MinusIcon, PlusIcon, RefreshCwIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Spinner } from "../ui/spinner";
import { DOCK_HEADER_ICON_BUTTON_CLASS } from "./chatHeaderControls";
import { DiffStat } from "./DiffStatLabel";
import { FileDiffCard, FileDiffSurface } from "./FileDiffView";
import { FileEntryIcon } from "./FileEntryIcon";
import { PanelStateMessage } from "./PanelStateMessage";

type GitPanelSection = "staged" | "unstaged";

// Selection is keyed by section + working-tree path (not the content-hashed
// render key) so it survives a file moving between the staged and unstaged
// lists after a stage/unstage action.
interface SelectedFile {
  section: GitPanelSection;
  path: string;
}

type SourceFile = GitSourceControlFilesResult["staged"][number];

const statusPresentation: Record<GitSourceControlFileStatus, { label: string; color: string }> = {
  M: { label: "Modified", color: "text-warning" },
  U: { label: "Untracked", color: "text-[var(--color-decoration-added)]" },
  A: { label: "Added", color: "text-[var(--color-decoration-added)]" },
  D: { label: "Deleted", color: "text-destructive" },
  R: { label: "Renamed", color: "text-info" },
  C: { label: "Copied", color: "text-info" },
  T: { label: "Type changed", color: "text-warning" },
  "!": { label: "Conflict", color: "text-destructive" },
};

function GitFileRow(props: {
  file: SourceFile;
  theme: "light" | "dark";
  isSelected: boolean;
  actionLabel: string;
  actionIcon: "stage" | "unstage";
  actionDisabled: boolean;
  onSelect: (file: SourceFile) => void;
  onAction: (paths: string[]) => void;
}) {
  const filePath = props.file.path;
  const { dir, name } = splitRepoRelativePath(filePath);
  const status = statusPresentation[props.file.status];
  return (
    <div
      className={cn(
        "group/git-file-row flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left",
        props.isSelected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5"
        onClick={() => props.onSelect(props.file)}
        title={filePath}
      >
        <FileEntryIcon pathValue={filePath} kind="file" theme={props.theme} className="size-4" />
        <span className="min-w-0 truncate text-ui text-foreground">
          {dir ? <span className="text-muted-foreground/70">{dir}</span> : null}
          <span>{name}</span>
        </span>
      </button>
      <div className="relative flex shrink-0 items-center gap-1.5">
        <DiffStat
          additions={props.file.insertions}
          deletions={props.file.deletions}
          className="shrink-0 text-ui-sm group-hover/git-file-row:opacity-0 group-has-[:focus-visible]/git-file-row:opacity-0"
        />
        <span
          className={cn(
            "w-5 shrink-0 text-center text-ui-sm font-semibold group-hover/git-file-row:opacity-0 group-has-[:focus-visible]/git-file-row:opacity-0",
            status.color,
          )}
          title={status.label}
          aria-label={status.label}
        >
          {props.file.status}
        </span>
        <IconButton
          size="icon-xs"
          variant="ghost"
          className="pointer-events-none absolute right-0 opacity-0 group-hover/git-file-row:pointer-events-auto group-hover/git-file-row:opacity-100 group-has-[:focus-visible]/git-file-row:pointer-events-auto group-has-[:focus-visible]/git-file-row:opacity-100"
          label={props.actionLabel}
          tooltip={props.actionLabel}
          disabled={props.actionDisabled}
          onClick={() => props.onAction([filePath])}
        >
          {props.actionIcon === "stage" ? (
            <PlusIcon className="size-3.5" />
          ) : (
            <MinusIcon className="size-3.5" />
          )}
        </IconButton>
      </div>
    </div>
  );
}

function GitFileSection(props: {
  title: string;
  emptyLabel: string;
  files: readonly SourceFile[];
  theme: "light" | "dark";
  selectedPath: string | null;
  actionLabel: string;
  actionAllLabel: string;
  actionIcon: "stage" | "unstage";
  actionDisabled: boolean;
  onSelect: (file: SourceFile) => void;
  onAction: (paths: string[]) => void;
  onRefresh?: () => void;
  hideEmptyLabel?: boolean;
}) {
  const allPaths = props.files.map((file) => file.path);
  return (
    <section className="min-w-0">
      <header className="flex items-center gap-2 px-1.5 py-1">
        <span className="text-ui-sm font-semibold text-muted-foreground">{props.title}</span>
        <span className="rounded-full bg-muted px-1.5 text-ui-xs font-medium text-muted-foreground">
          {props.files.length}
        </span>
        <DiffStat
          additions={props.files.reduce((sum, file) => sum + file.insertions, 0)}
          deletions={props.files.reduce((sum, file) => sum + file.deletions, 0)}
          className="text-ui-xs"
        />
        <div className="ml-auto flex items-center gap-1">
          {props.files.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0"
              disabled={props.actionDisabled}
              onClick={() => props.onAction(allPaths)}
            >
              {props.actionAllLabel}
            </Button>
          ) : null}
          {props.onRefresh ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              label="Refresh changes"
              tooltip="Refresh changes"
              className={DOCK_HEADER_ICON_BUTTON_CLASS}
              onClick={props.onRefresh}
            >
              <RefreshCwIcon className="size-3.5" />
            </IconButton>
          ) : null}
        </div>
      </header>
      {props.files.length === 0 && !props.hideEmptyLabel ? (
        <p className="px-1.5 py-1 text-ui-sm text-muted-foreground/70">{props.emptyLabel}</p>
      ) : props.files.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {props.files.map((file) => {
            const key = file.path;
            const filePath = file.path;
            return (
              <GitFileRow
                key={key}
                file={file}
                theme={props.theme}
                isSelected={props.selectedPath === filePath}
                actionLabel={props.actionLabel}
                actionIcon={props.actionIcon}
                actionDisabled={props.actionDisabled}
                onSelect={props.onSelect}
                onAction={props.onAction}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
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

export function GitPanel(props: { workspaceRoot: string | null }) {
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme as "light" | "dark";
  const cwd = props.workspaceRoot;

  const [selected, setSelected] = useState<SelectedFile | null>(null);

  // No fixed polling: turn-driven file changes already push-invalidate the
  // working-tree-diff cache (see __root.tsx), and focus + the Refresh button +
  // post-mutation invalidation cover the rest. This keeps the pane cheap.
  const filesQuery = useQuery(gitSourceControlFilesQueryOptions(cwd));
  const stagedFiles = filesQuery.data?.staged ?? [];
  const unstagedFiles = filesQuery.data?.unstaged ?? [];
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
  const mutating = stageMutation.isPending || unstageMutation.isPending;

  const stage = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    stageMutation.mutate(paths);
  };
  const unstage = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    unstageMutation.mutate(paths);
  };

  const selectStaged = (file: SourceFile) => {
    setSelected((current) =>
      current?.section === "staged" && current.path === file.path
        ? null
        : { section: "staged", path: file.path },
    );
  };
  const selectUnstaged = (file: SourceFile) => {
    setSelected((current) =>
      current?.section === "unstaged" && current.path === file.path
        ? null
        : { section: "unstaged", path: file.path },
    );
  };

  const refresh = () => {
    if (!cwd) return;
    void queryClient.invalidateQueries({ queryKey: gitQueryKeys.sourceControlFiles(cwd) });
    void queryClient.invalidateQueries({ queryKey: gitQueryKeys.workingTreeDiffs(cwd) });
  };

  // Resolve the selected file by path, preferring its stored section but falling
  // back to the other list so the diff (and row highlight) follow a file across a
  // stage/unstage move instead of silently clearing.
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
  const selectedPath = selected?.path ?? null;

  const isLoading = filesQuery.isLoading;
  const error = filesQuery.error instanceof Error ? filesQuery.error.message : null;
  const hasChanges = stagedFiles.length > 0 || unstagedFiles.length > 0;

  if (!cwd) {
    return <PanelStateMessage>Source control is unavailable for this thread.</PanelStateMessage>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div
        className={cn(
          "flex min-h-0 flex-col gap-2 overflow-auto px-1.5 py-2",
          selectedResolved ? "max-h-[40%] shrink-0" : "flex-1",
        )}
      >
        <GitFileSection
          title="Staged"
          emptyLabel="No staged changes."
          files={stagedFiles}
          theme={theme}
          selectedPath={selectedResolved?.section === "staged" ? selectedPath : null}
          actionLabel="Unstage file"
          actionAllLabel="Unstage all"
          actionIcon="unstage"
          actionDisabled={mutating}
          onSelect={selectStaged}
          onAction={unstage}
          onRefresh={refresh}
          hideEmptyLabel={!hasChanges}
        />
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
          </div>
        ) : null}
        {hasChanges ? (
          <GitFileSection
            title="Changes"
            emptyLabel="No unstaged changes."
            files={unstagedFiles}
            theme={theme}
            selectedPath={selectedResolved?.section === "unstaged" ? selectedPath : null}
            actionLabel="Stage file"
            actionAllLabel="Stage all"
            actionIcon="stage"
            actionDisabled={mutating}
            onSelect={selectUnstaged}
            onAction={stage}
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
    </div>
  );
}

export default GitPanel;
