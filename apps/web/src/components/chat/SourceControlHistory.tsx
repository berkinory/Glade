import { useCommitDrafts } from "./commitDraftStore";
import { gitRebaseStateQueryOptions } from "~/lib/gitReactQuery";
import { invalidateGitQueriesForCwds } from "~/lib/gitQueryOptions";
import { GitMediaPreview, isGitMediaPath } from "./GitMediaPreview";
import { ShowSourceFile } from "./ShowSourceFile";
import type { GitRecentCommit } from "@glade/contracts/git/git";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { IconTag } from "@tabler/icons-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { AuthorAvatar } from "../AuthorAvatar";
import { IconButton } from "../ui/icon-button";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { useTheme } from "~/hooks/useTheme";
import { copyTextToClipboard } from "../../lib/clipboard";
import { showContextMenuFallback } from "~/contextMenuFallback";
import { GIT_COMMIT_CONTEXT_MENU_ICONS } from "~/lib/contextMenuIcons";
import { getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import { gitQueryKeys, gitStatusQueryOptions } from "../../lib/gitQueryOptions";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  XIcon,
} from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { FileDiffCard, FileDiffSurface } from "./FileDiffView";
import { ExplorerLoadingRows } from "./ExplorerLoadingRows";
import { PanelStateMessage } from "./PanelStateMessage";

const PAGE_SIZE = 20;
const ROW_HEIGHT = 60;

async function showCommitContextMenu(
  commit: GitRecentCommit,
  event: MouseEvent<HTMLButtonElement>,
  undo: (() => void) | undefined,
  cwd: string,
) {
  event.preventDefault();
  let eligible = false;
  if (undo) {
    try {
      eligible = (await ensureNativeApi().git.checkUndoCommit({ cwd })) === commit.sha;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not establish undo eligibility",
        description:
          error instanceof Error ? error.message : "Remote publication state is unavailable.",
      });
    }
  }
  const action = await showContextMenuFallback(
    [
      ...(eligible ? [{ id: "undo", label: "Undo commit" }] : []),
      { id: "hash", label: "Copy commit hash", icon: GIT_COMMIT_CONTEXT_MENU_ICONS.hash },
      { id: "short-hash", label: "Copy short hash", icon: GIT_COMMIT_CONTEXT_MENU_ICONS.shortHash },
      { id: "subject", label: "Copy commit subject", icon: GIT_COMMIT_CONTEXT_MENU_ICONS.subject },
    ],
    { x: event.clientX, y: event.clientY },
  );
  if (!action) return;
  if (action === "undo") {
    undo?.();
    return;
  }
  const value =
    action === "hash" ? commit.sha : action === "short-hash" ? commit.shortSha : commit.subject;
  try {
    await copyTextToClipboard(value);
  } catch {
    toastManager.add({ type: "error", title: "Could not copy commit details" });
  }
}

function CommitDetail(props: {
  cwd: string;
  commit: GitRecentCommit;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const detail = useQuery({
    queryKey: ["git", "history-commit", props.cwd, props.commit.sha],
    queryFn: () => ensureNativeApi().git.readCommit({ cwd: props.cwd, sha: props.commit.sha }),
    staleTime: Infinity,
  });
  const renderable = useMemo(
    () => getRenderablePatch(detail.data?.patch, `history:${props.commit.sha}`),
    [detail.data?.patch, props.commit.sha],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-border/70">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <GitCommitIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium">
          {props.commit.subject}
        </span>
        <IconButton
          label="Copy commit hash"
          tooltip="Copy commit hash"
          onClick={() => {
            void copyTextToClipboard(props.commit.sha).catch(() =>
              toastManager.add({ type: "error", title: "Could not copy commit hash" }),
            );
          }}
        >
          <CopyIcon className="size-3.5" />
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
            renderable.files.map((file) => {
              const path = resolveFileDiffPath(file);
              const expanded = expandedPaths.has(path);
              return (
                <div
                  key={`${props.commit.sha}:${path}`}
                  className="diff-render-file mb-2 rounded-md"
                  onClickCapture={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.closest("button") || !target.closest("[data-diff-file-header]"))
                      return;
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
                        <ShowSourceFile cwd={props.cwd} file={file} onOpenFile={props.onOpenFile} />
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

function CommitRow(props: {
  cwd: string;
  commit: GitRecentCommit;
  selected: boolean;
  onSelect: () => void;
  undo?: (() => void) | undefined;
}) {
  const { commit } = props;
  const relativeTime = formatRelativeTime(commit.committedAt);
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
      onContextMenu={(event) => void showCommitContextMenu(commit, event, props.undo, props.cwd)}
      className={cn(
        "flex h-full w-full items-center gap-2 px-3 text-left hover:bg-sidebar-accent/60",
        props.selected && "bg-sidebar-accent",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-ui-sm text-foreground">
          <span className="min-w-0 flex-1 truncate">{commit.subject || "(no subject)"}</span>
          {commit.isMerge ? (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 text-ui-xs text-muted-foreground"
              title="Merge commit"
            >
              <GitMergeIcon className="size-3.5" aria-hidden />
              Merge
            </span>
          ) : null}
          {commit.branches.length > 0 ? (
            <span
              className="inline-flex min-w-0 max-w-24 items-center gap-0.5 rounded border border-border/70 px-1 text-ui-xs text-muted-foreground"
              title={`Branches at this commit: ${commit.branches.join(", ")}`}
            >
              <GitBranchIcon className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{commit.branches[0]}</span>
              {commit.branches.length > 1 ? (
                <span className="shrink-0">+{commit.branches.length - 1}</span>
              ) : null}
            </span>
          ) : null}
          {commit.tags.slice(0, 1).map((tag) => (
            <span
              key={tag}
              className="inline-flex max-w-20 shrink-0 items-center gap-0.5 truncate rounded border border-border/70 px-1 text-ui-xs text-muted-foreground"
              title={tag}
            >
              <IconTag className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{tag}</span>
            </span>
          ))}
          {commit.tags.length > 1 ? (
            <span
              className="shrink-0 text-ui-xs text-muted-foreground"
              title={commit.tags.slice(1).join(", ")}
            >
              +{commit.tags.length - 1}
            </span>
          ) : null}
          {commit.pushStatus === "unpushed" ? (
            <GitCommitIcon
              className="size-3.5 shrink-0 text-warning"
              aria-label="Not pushed to the upstream branch"
            />
          ) : commit.pushStatus === "pushed" ? (
            <ArrowUpIcon
              className="size-3.5 shrink-0 text-success"
              aria-label="Present on the upstream branch"
            />
          ) : null}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-ui-xs text-muted-foreground">
          <AuthorAvatar actor={{ name: commit.authorName }} size="md" />
          <span className="min-w-0 truncate">{commit.authorName || "Unknown author"}</span>
          <span className="shrink-0 font-mono">{commit.shortSha}</span>
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-0.5"
            title={commit.committedAt}
          >
            {relativeTime === "now" ? "now" : `${relativeTime} ago`}
          </span>
        </span>
      </span>
    </button>
  );
}

export function SourceControlHistory(props: {
  cwd: string | null;
  onOpenFile: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const eligibility = useQuery(gitRebaseStateQueryOptions(props.cwd));
  const undo = useMutation({
    mutationKey: ["git", "mutation", "undo", props.cwd],
    mutationFn: (expectedHead: string) => {
      if (!props.cwd) throw new Error("Repository unavailable.");
      return ensureNativeApi().git.undoCommit({ cwd: props.cwd, expectedHead });
    },
    onSuccess: ({ message }) => {
      if (props.cwd && !(useCommitDrafts.getState().messages[props.cwd] ?? "").trim())
        useCommitDrafts.getState().set(props.cwd, message);
      setSelectedSha(null);
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not undo commit",
        description: error.message,
      }),
    onSettled: () =>
      props.cwd ? invalidateGitQueriesForCwds(queryClient, [props.cwd]) : undefined,
  });
  const [filter, setFilter] = useState("");
  const search = useDeferredValue(filter.trim());
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const status = useQuery({ ...gitStatusQueryOptions(props.cwd), enabled: props.cwd !== null });
  const history = useInfiniteQuery({
    queryKey: [...gitQueryKeys.history(props.cwd), search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      if (!props.cwd) throw new Error("Git commits are unavailable.");
      return ensureNativeApi().git.listRecentCommits({
        cwd: props.cwd,
        limit: PAGE_SIZE,
        offset: pageParam,
        ...(search ? { query: search } : {}),
      });
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.length * PAGE_SIZE : undefined,
    enabled: props.cwd !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [search]);
  const commits = useMemo(
    () => history.data?.pages.flatMap((page) => page.commits) ?? [],
    [history.data],
  );
  const selected = commits.find((commit) => commit.sha === selectedSha) ?? null;
  const virtualizer = useVirtualizer({
    count: commits.length + (history.hasNextPage ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (index === commits.length ? 36 : ROW_HEIGHT),
    overscan: 6,
  });
  const rows = virtualizer.getVirtualItems();
  const lastIndex = rows.at(-1)?.index ?? -1;
  const { hasNextPage, isFetchingNextPage, isFetching, isFetchNextPageError, fetchNextPage } =
    history;
  useEffect(() => {
    if (
      lastIndex >= commits.length &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetching &&
      !isFetchNextPageError
    ) {
      void fetchNextPage();
    }
  }, [
    lastIndex,
    commits.length,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  if (!props.cwd)
    return <PanelStateMessage>Open a Git workspace to see its history.</PanelStateMessage>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-ui-sm font-medium">
            {status.data?.branch ?? "Current branch"}
          </span>
        </div>
        <Input
          nativeInput
          size="sm"
          type="search"
          maxLength={200}
          aria-label="Filter commits"
          placeholder="Filter commits"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div
        ref={scrollRef}
        className={cn("min-h-0 overflow-y-auto", selected ? "max-h-[40%] shrink-0" : "flex-1")}
      >
        {history.isPending ? (
          <PanelStateMessage>
            <Spinner className="size-4" aria-label="Loading history" />
          </PanelStateMessage>
        ) : history.isError && commits.length === 0 ? (
          <PanelStateMessage>
            <div className="flex flex-col items-center gap-2">
              <span>Could not load commit history.</span>
              <Button size="sm" variant="outline" onClick={() => void history.refetch()}>
                Retry
              </Button>
            </div>
          </PanelStateMessage>
        ) : commits.length === 0 ? (
          <PanelStateMessage>
            {search ? "No matching commits." : "No commits on this branch yet."}
          </PanelStateMessage>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {rows.map((row) => (
              <div
                key={row.key}
                className="absolute left-0 top-0 w-full"
                style={{ height: row.size, transform: `translateY(${row.start}px)` }}
              >
                {row.index < commits.length ? (
                  <CommitRow
                    cwd={props.cwd!}
                    undo={
                      !undo.isPending && eligibility.data?.undoableHead === commits[row.index]!.sha
                        ? () => undo.mutate(commits[row.index]!.sha)
                        : undefined
                    }
                    commit={commits[row.index]!}
                    selected={selectedSha === commits[row.index]!.sha}
                    onSelect={() =>
                      setSelectedSha((current) =>
                        current === commits[row.index]!.sha ? null : commits[row.index]!.sha,
                      )
                    }
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    {history.isFetchNextPageError ? (
                      <button
                        type="button"
                        className="text-ui-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void history.fetchNextPage()}
                      >
                        Could not load commits. Retry
                      </button>
                    ) : (
                      <Spinner className="size-3.5" aria-label="Loading more commits" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {selected ? (
        <CommitDetail
          key={selected.sha}
          cwd={props.cwd}
          onOpenFile={props.onOpenFile}
          commit={selected}
          onClose={() => setSelectedSha(null)}
        />
      ) : null}
    </div>
  );
}
