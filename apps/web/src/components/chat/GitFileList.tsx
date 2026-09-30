import type {
  GitSourceControlFileStatus,
  GitSourceControlFilesResult,
} from "@glade/contracts/git/git";
import type { MouseEvent } from "react";

import { useTheme } from "~/hooks/useTheme";
import { splitRepoRelativePath } from "~/lib/diffRendering";
import { EyeOpenIcon, MinusIcon, PlusIcon, RefreshCwIcon, RotateCcwIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { IconButton } from "../ui/icon-button";
import { CHAT_HEADER_ICON_CONTROL_CLASS_NAME } from "./chatHeaderControls";
import { DiffStat } from "./DiffStatLabel";
import { FileEntryIcon } from "./FileEntryIcon";

export type SourceFile = GitSourceControlFilesResult["staged"][number];

export function canRevertFile(file: SourceFile): boolean {
  return ["M", "U", "D", "T"].includes(file.status);
}

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
  onSelect: (file: SourceFile, event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (file: SourceFile, event: MouseEvent<HTMLDivElement>) => void;
  onAction: (paths: string[]) => void;
  onOpenFile: (path: string) => void;
  onRevert?: (file: SourceFile) => void;
}) {
  const filePath = props.file.path;
  const { dir, name } = splitRepoRelativePath(filePath);
  const status = statusPresentation[props.file.status];
  return (
    <div
      className={cn(
        "group/git-file-row flex h-7 shrink-0 select-none items-center gap-1.5 rounded-md px-1.5 text-left",
        props.isSelected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
      onContextMenu={(event) => props.onContextMenu(props.file, event)}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5"
        onClick={(event) => props.onSelect(props.file, event)}
        aria-pressed={props.isSelected}
        title={filePath}
      >
        <FileEntryIcon pathValue={filePath} kind="file" theme={props.theme} className="size-4" />
        <span className="min-w-0 truncate text-ui text-foreground">
          {dir ? <span className="text-muted-foreground/70">{dir}</span> : null}
          <span>{name}</span>
        </span>
      </button>
      <div className="relative flex h-7 w-[7.5rem] shrink-0 items-center justify-end">
        <DiffStat
          additions={props.file.insertions}
          deletions={props.file.deletions}
          className="absolute right-7 shrink-0 text-ui-sm group-hover/git-file-row:invisible group-has-[:focus-visible]/git-file-row:invisible"
        />
        <div className="invisible absolute right-7 flex items-center gap-0.5 group-hover/git-file-row:visible group-has-[:focus-visible]/git-file-row:visible">
          <IconButton
            size="icon-xs"
            variant="ghost"
            label="Open file in Explorer"
            tooltip="Open file in Explorer"
            disabled={props.file.status === "D"}
            onClick={() => props.onOpenFile(filePath)}
          >
            <EyeOpenIcon className="size-3.5" />
          </IconButton>
          {props.onRevert && canRevertFile(props.file) ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              label="Revert changes"
              tooltip="Revert changes"
              disabled={props.actionDisabled}
              onClick={() => props.onRevert?.(props.file)}
            >
              <RotateCcwIcon className="size-3.5" />
            </IconButton>
          ) : null}
          <IconButton
            size="icon-xs"
            variant="ghost"
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
        <span
          className={cn("w-5 shrink-0 text-center text-ui-sm font-semibold", status.color)}
          title={status.label}
          aria-label={status.label}
        >
          {props.file.status}
        </span>
      </div>
    </div>
  );
}

export function GitFileSection(props: {
  title: string;
  files: readonly SourceFile[];
  untrackedFileStats?: ReadonlyMap<string, { insertions: number; deletions: number }>;
  totalStats?: { additions: number; deletions: number } | null;
  selectedPaths: ReadonlySet<string>;
  actionLabel: string;
  actionAllLabel: string;
  actionIcon: "stage" | "unstage";
  actionDisabled: boolean;
  onSelect: (file: SourceFile, event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (file: SourceFile, event: MouseEvent<HTMLDivElement>) => void;
  onAction: (paths: string[]) => void;
  onOpenFile: (path: string) => void;
  onRevert?: (file: SourceFile) => void;
  onRefresh?: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme as "light" | "dark";
  const allPaths = props.files.map((file) => file.path);
  return (
    <section className="min-w-0">
      <header className="flex items-center gap-2 px-1.5 py-1">
        <span className="text-ui-sm font-semibold text-muted-foreground">{props.title}</span>
        <span className="rounded-full bg-muted px-1.5 text-ui-xs font-medium text-muted-foreground">
          {props.files.length}
        </span>
        {props.totalStats !== null ? (
          <DiffStat
            additions={
              props.totalStats?.additions ??
              props.files.reduce((sum, file) => sum + file.insertions, 0)
            }
            deletions={
              props.totalStats?.deletions ??
              props.files.reduce((sum, file) => sum + file.deletions, 0)
            }
            className="text-ui-xs"
          />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {props.files.length > 0 ? (
            <IconButton
              variant="ghost"
              size="icon-xs"
              label={props.actionAllLabel}
              tooltip={props.actionAllLabel}
              disabled={props.actionDisabled}
              onClick={() => props.onAction(allPaths)}
            >
              {props.actionIcon === "stage" ? (
                <PlusIcon className="size-3.5" />
              ) : (
                <MinusIcon className="size-3.5" />
              )}
            </IconButton>
          ) : null}
          {props.onRefresh ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              label="Refresh changes"
              tooltip="Refresh changes"
              className={CHAT_HEADER_ICON_CONTROL_CLASS_NAME}
              onClick={props.onRefresh}
            >
              <RefreshCwIcon className="size-3.5" />
            </IconButton>
          ) : null}
        </div>
      </header>
      {props.files.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {props.files.map((file) => {
            const fileStats = file.status === "U" ? props.untrackedFileStats?.get(file.path) : null;
            return (
              <GitFileRow
                key={file.path}
                file={fileStats ? { ...file, ...fileStats } : file}
                theme={theme}
                isSelected={props.selectedPaths.has(file.path)}
                actionLabel={props.actionLabel}
                actionIcon={props.actionIcon}
                actionDisabled={props.actionDisabled}
                onSelect={props.onSelect}
                onContextMenu={props.onContextMenu}
                onAction={props.onAction}
                onOpenFile={props.onOpenFile}
                {...(props.onRevert ? { onRevert: props.onRevert } : {})}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
