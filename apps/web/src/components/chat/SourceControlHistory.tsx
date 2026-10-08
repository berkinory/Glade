import { ArrowTurnBackwardIcon, Copy01Icon, HashIcon, TextIcon, UndoIcon } from "~/lib/icons";
import {
  TagIcon,
  ArrowUp02Icon,
  WorkflowCircle04Icon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
} from "~/lib/icons";
import { CommitDetail } from "./CommitDetail";
import { undoCommit } from "./sourceControlUndo";
import { gitRebaseStateQueryOptions } from "~/lib/gitReactQuery";
import { invalidateGitQueriesForCwds } from "~/lib/gitQueryOptions";
import type { GitRecentCommit } from "@glade/contracts/git/git";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { AuthorAvatar } from "../AuthorAvatar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { copyTextToClipboard } from "../../lib/clipboard";
import { showContextMenu } from "~/components/contextMenu/contextMenuStore";
import { gitQueryKeys, gitStatusQueryOptions } from "../../lib/gitQueryOptions";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { PanelStateMessage } from "./PanelStateMessage";
const PAGE_SIZE = 20;
const ROW_HEIGHT = 60;
interface CommitActions {
  undo: (() => void) | undefined;
  revert: () => void;
  // Shown on the disabled revert item.
  revertBlockedReason: string | null;
}
async function showCommitContextMenu(
  commit: GitRecentCommit,
  event: MouseEvent<HTMLButtonElement>,
  actions: CommitActions,
) {
  event.preventDefault();
  const action = await showContextMenu(
    [
      ...(actions.undo
        ? [
            {
              id: "undo",
              label: "Undo commit",
              icon: UndoIcon,
            },
          ]
        : []),
      {
        id: "revert",
        label: "Revert changes in commit",
        icon: ArrowTurnBackwardIcon,
        disabled: actions.revertBlockedReason !== null,
        ...(actions.revertBlockedReason ? { title: actions.revertBlockedReason } : {}),
      },
      {
        id: "hash",
        label: "Copy commit hash",
        icon: Copy01Icon,
        separatorBefore: true,
      },
      {
        id: "short-hash",
        label: "Copy short hash",
        icon: HashIcon,
      },
      {
        id: "subject",
        label: "Copy commit subject",
        icon: TextIcon,
      },
    ],
    {
      x: event.clientX,
      y: event.clientY,
    },
  );
  if (!action) return;
  if (action === "undo") {
    actions.undo?.();
    return;
  }
  if (action === "revert") {
    actions.revert();
    return;
  }
  const value =
    action === "hash" ? commit.sha : action === "short-hash" ? commit.shortSha : commit.subject;
  try {
    await copyTextToClipboard(value);
  } catch {
    toastManager.add({
      type: "error",
      title: "Could not copy commit details",
    });
  }
}
function CommitRow(props: {
  commit: GitRecentCommit;
  selected: boolean;
  onSelect: () => void;
  actions: CommitActions;
}) {
  const { commit } = props;
  const relativeTime = formatRelativeTime(commit.committedAt);
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
      onContextMenu={(event) => void showCommitContextMenu(commit, event, props.actions)}
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
              <WorkflowCircle04Icon className="size-3 shrink-0" aria-hidden />
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
              <TagIcon className="size-3 shrink-0" aria-hidden />
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
            <GitCommitHorizontalIcon
              className="size-3.5 shrink-0 text-warning"
              aria-label="Not pushed to the upstream branch"
            />
          ) : commit.pushStatus === "pushed" ? (
            <ArrowUp02Icon
              className="size-3.5 shrink-0 text-success"
              aria-label="Present on the upstream branch"
            />
          ) : null}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-ui-xs text-muted-foreground">
          <AuthorAvatar
            actor={{
              name: commit.authorName,
            }}
            size="md"
          />
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
  onSelectCommitFile?:
    | ((commit: GitRecentCommit, path: string, preview: boolean) => void)
    | undefined;
  cwd: string | null;
  onOpenFile: (path: string) => void;
  visible: boolean;
}) {
  const queryClient = useQueryClient();
  const eligibility = useQuery({
    ...gitRebaseStateQueryOptions(props.cwd),
    subscribed: props.visible,
  });
  const undo = useMutation({
    mutationKey: ["git", "mutation", "undo", props.cwd],
    mutationFn: (expectedHead: string) => {
      if (!props.cwd) throw new Error("Repository unavailable.");
      return undoCommit(queryClient, props.cwd, expectedHead);
    },
    onSuccess: (undone) => {
      if (undone) setSelectedSha(null);
    },
  });
  const revert = useMutation({
    mutationKey: ["git", "mutation", "revert", props.cwd],
    mutationFn: (sha: string) => {
      if (!props.cwd) throw new Error("Repository unavailable.");
      return ensureNativeApi().git.revertCommit({ cwd: props.cwd, sha });
    },
    onSuccess: (result) =>
      toastManager.add(
        result.status === "reverted"
          ? { type: "success", title: "Commit reverted" }
          : {
              type: "warning",
              title: "Revert stopped. Resolve it in Changes, then continue or abort.",
              description: result.reason,
            },
      ),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not revert commit",
        description: error.message,
      }),
    onSettled: () =>
      props.cwd ? invalidateGitQueriesForCwds(queryClient, [props.cwd]) : undefined,
  });
  const operationBlocked =
    eligibility.data?.inProgress ||
    eligibility.data?.pendingPush ||
    eligibility.data?.conflicts.length
      ? "Finish or abort the current Git operation first."
      : null;
  const commitActions = (commit: GitRecentCommit): CommitActions => ({
    undo:
      !undo.isPending && eligibility.data?.undoableHead === commit.sha
        ? () => undo.mutate(commit.sha)
        : undefined,
    revert: () => revert.mutate(commit.sha),
    revertBlockedReason: commit.isMerge
      ? "Merge commits can't be reverted here because Git needs to know which parent to keep."
      : revert.isPending
        ? "A revert is already running."
        : operationBlocked,
  });
  const [filter, setFilter] = useState("");
  const search = useDeferredValue(filter.trim());
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const status = useQuery({
    ...gitStatusQueryOptions(props.cwd),
    enabled: props.cwd !== null,
    subscribed: props.visible,
  });
  const history = useInfiniteQuery({
    queryKey: [...gitQueryKeys.history(props.cwd), search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      if (!props.cwd) throw new Error("Git commits are unavailable.");
      return ensureNativeApi().git.listRecentCommits({
        cwd: props.cwd,
        limit: PAGE_SIZE,
        offset: pageParam,
        ...(search
          ? {
              query: search,
            }
          : {}),
      });
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.length * PAGE_SIZE : undefined,
    enabled: props.cwd !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    subscribed: props.visible,
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
          <div
            className="relative w-full"
            style={{
              height: virtualizer.getTotalSize(),
            }}
          >
            {rows.map((row) => (
              <div
                key={row.key}
                className="absolute left-0 top-0 w-full"
                style={{
                  height: row.size,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                {row.index < commits.length ? (
                  <CommitRow
                    actions={commitActions(commits[row.index]!)}
                    commit={commits[row.index]!}
                    selected={selectedSha === commits[row.index]!.sha}
                    onSelect={() => {
                      const commit = commits[row.index]!;
                      setSelectedSha((current) => (current === commit.sha ? null : commit.sha));
                    }}
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
          onSelectFile={
            props.onSelectCommitFile
              ? (path, preview) => props.onSelectCommitFile?.(selected, path, preview)
              : undefined
          }
          commit={selected}
          onClose={() => setSelectedSha(null)}
        />
      ) : null}
    </div>
  );
}
