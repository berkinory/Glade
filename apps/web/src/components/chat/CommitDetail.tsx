import { ChevronDownIcon, Copy01Icon, GitCommitHorizontalIcon, XIcon } from "~/lib/icons";
import type { GitRecentCommit } from "@glade/contracts/git/git";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTheme } from "~/hooks/useTheme";
import { copyTextToClipboard } from "~/lib/clipboard";
import { getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { toastManager } from "../ui/toast";
import { ExplorerLoadingRows } from "./ExplorerLoadingRows";
import { FileDiffCard, FileDiffSurface } from "./FileDiffView";
import { GitMediaPreview, isGitMediaPath } from "./GitMediaPreview";
import { PanelStateMessage } from "./PanelStateMessage";
import { WorkspaceDiffFile } from "./WorkspaceDiffFile";
import { EditSourceFile } from "./EditSourceFile";
export function CommitDetail(props: {
  filePath?: string | undefined;
  onSelectFile?: ((path: string, preview: boolean) => void) | undefined;
  cwd: string;
  commit: Pick<GitRecentCommit, "sha" | "subject">;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const detail = useQuery({
    queryKey: ["git", "history-commit", props.cwd, props.commit.sha],
    queryFn: () =>
      ensureNativeApi().git.readCommit({
        cwd: props.cwd,
        sha: props.commit.sha,
      }),
    staleTime: Infinity,
  });
  const renderable = useMemo(
    () => getRenderablePatch(detail.data?.patch, `history:${props.commit.sha}`),
    [detail.data?.patch, props.commit.sha],
  );
  const selectedFile =
    renderable?.kind === "files"
      ? renderable.files.find((file) => resolveFileDiffPath(file) === props.filePath)
      : null;
  if (selectedFile && props.filePath)
    return isGitMediaPath(props.filePath) ? (
      <GitMediaPreview cwd={props.cwd} path={props.filePath} revision={props.commit.sha} />
    ) : (
      <WorkspaceDiffFile
        cwd={props.cwd}
        file={selectedFile}
        truncated={detail.data?.truncated ?? false}
        theme={resolvedTheme as "light" | "dark"}
        onOpenFile={props.onOpenFile}
      />
    );
  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-border/70">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <GitCommitHorizontalIcon className="size-[1.231em] shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium">
          {props.commit.subject}
        </span>
        <IconButton
          label="Copy commit hash"
          tooltip="Copy commit hash"
          onClick={() => {
            void copyTextToClipboard(props.commit.sha).catch(() =>
              toastManager.add({
                type: "error",
                title: "Could not copy commit hash",
              }),
            );
          }}
        >
          <Copy01Icon className="size-3.5" />
        </IconButton>
        <IconButton
          label="Close commit details"
          tooltip="Close commit details"
          onClick={props.onClose}
        >
          <XIcon className="size-3.5" />
        </IconButton>
      </div>
      {detail.isPending ? (
        <div className="px-2">
          <ExplorerLoadingRows depth={0} label="Loading commit files" />
        </div>
      ) : detail.isError ? (
        <PanelStateMessage>
          <div className="flex flex-col items-center gap-2">
            <span>Could not load commit details.</span>
            <Button size="sm" variant="outline" onClick={() => void detail.refetch()}>
              Retry
            </Button>
          </div>
        </PanelStateMessage>
      ) : (
        <FileDiffSurface className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {detail.data.truncated ? (
            <p className="px-1 pb-2 text-ui-xs text-muted-foreground">
              Large commit. Diff is partial.
            </p>
          ) : null}
          {renderable?.kind === "files" ? (
            renderable.files
              .filter((file) => !props.filePath || resolveFileDiffPath(file) === props.filePath)
              .map((file) => {
                const path = resolveFileDiffPath(file);
                const expanded = Boolean(props.filePath) || expandedPaths.has(path);
                return (
                  <div
                    key={`${props.commit.sha}:${path}`}
                    className="diff-render-file mb-2 rounded-md"
                    onClickCapture={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest("button") || !target.closest("[data-diff-file-header]"))
                        return;
                      if (props.onSelectFile) {
                        props.onSelectFile(path, event.detail !== 2);
                        return;
                      }
                      setExpandedPaths((current) => {
                        const next = new Set(current);
                        if (next.has(path)) next.delete(path);
                        else next.add(path);
                        return next;
                      });
                    }}
                  >
                    <FileDiffCard
                      fileDiff={file}
                      theme={resolvedTheme as "light" | "dark"}
                      collapsed={!expanded}
                      renderHeaderTrailing={() => (
                        <>
                          {!props.onSelectFile ? (
                            <EditSourceFile
                              cwd={props.cwd}
                              file={file}
                              onOpenFile={props.onOpenFile}
                            />
                          ) : null}
                          <ChevronDownIcon
                            className={cn(
                              "size-3.5 text-muted-foreground transition-transform",
                              expanded && "rotate-180",
                            )}
                          />
                        </>
                      )}
                    />
                    {expanded && isGitMediaPath(path) ? (
                      <GitMediaPreview cwd={props.cwd} path={path} revision={props.commit.sha} />
                    ) : null}
                  </div>
                );
              })
          ) : renderable?.kind === "raw" ? (
            <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-ui-xs">
              {renderable.text}
            </pre>
          ) : (
            <PanelStateMessage>No file changes in this commit.</PanelStateMessage>
          )}
        </FileDiffSurface>
      )}
    </section>
  );
}
