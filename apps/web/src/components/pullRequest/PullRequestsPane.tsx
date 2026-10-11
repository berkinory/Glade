import type {
  GitPullRequestListItem,
  GitPullRequestListState,
} from "@glade/contracts/git/pullRequests";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Archive04Icon, GitPullRequestIcon, RefreshCwIcon } from "~/lib/icons";
import { gitPullRequestListQueryOptions } from "~/lib/gitQueryOptions";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { AuthorAvatar } from "../AuthorAvatar";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import { PanelTabBar } from "../chat/PanelTabBar";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CheckStateIcon } from "./PullRequestCheckList";
import {
  PR_STATE_PRESENTATION_ICONS,
  resolvePrStatePresentation,
} from "./pullRequestStatePresentation";

const STATES: ReadonlyArray<{
  id: GitPullRequestListState;
  label: string;
  icon: typeof GitPullRequestIcon;
}> = [
  { id: "open", label: "Open", icon: GitPullRequestIcon },
  { id: "closed", label: "Closed", icon: Archive04Icon },
];

const REVIEW_LABELS = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
} as const;

function matches(item: GitPullRequestListItem, search: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return [item.title, item.author, item.headBranch, `#${item.number}`].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

function PullRequestRow(props: {
  item: GitPullRequestListItem;
  onSelect: (item: GitPullRequestListItem, preview: boolean) => void;
}) {
  const { item } = props;
  const presentation = resolvePrStatePresentation({ state: item.state, isDraft: item.isDraft });
  const Icon = PR_STATE_PRESENTATION_ICONS[presentation.iconKind] ?? GitPullRequestIcon;
  const relativeTime = formatRelativeTime(item.updatedAt);
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-sidebar-accent/60"
      onClick={(event) => props.onSelect(item, event.detail !== 2)}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-ui-sm text-foreground">
          <Icon className={cn("size-3.5 shrink-0", presentation.colorClass)} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {item.checks !== "none" ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                <CheckStateIcon state={item.checks} />
              </TooltipTrigger>
              <TooltipPopup side="left">Checks {item.checks}</TooltipPopup>
            </Tooltip>
          ) : null}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-ui-xs text-muted-foreground">
          <AuthorAvatar actor={{ login: item.author, avatarUrl: item.authorAvatarUrl }} size="md" />
          <span className="min-w-0 truncate">{item.author}</span>
          <span className="shrink-0">#{item.number}</span>
          {item.reviewDecision ? (
            <span className="min-w-0 truncate">{REVIEW_LABELS[item.reviewDecision]}</span>
          ) : null}
          <span className="ml-auto shrink-0" title={item.updatedAt}>
            {relativeTime === "now" ? "now" : `${relativeTime} ago`}
          </span>
        </span>
      </span>
    </button>
  );
}

export function PullRequestsPane(props: {
  cwd: string | null;
  visible: boolean;
  onSelect: (item: GitPullRequestListItem, preview: boolean) => void;
}) {
  const [state, setState] = useState<GitPullRequestListState>("open");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const list = useQuery(
    gitPullRequestListQueryOptions({ cwd: props.cwd, state, enabled: props.visible }),
  );
  if (!props.cwd)
    return <PanelStateMessage>Open a project to see its pull requests.</PanelStateMessage>;
  const items = list.data?.items.filter((item) => matches(item, deferredSearch)) ?? [];
  const viewer = list.data?.viewerLogin ?? null;
  // Without a known viewer there is nothing to split by, so the list stays one unlabeled group.
  const sections = viewer
    ? [
        { label: "Yours", items: items.filter((item) => item.author === viewer) },
        { label: "Others", items: items.filter((item) => item.author !== viewer) },
      ]
    : [{ label: null, items }];
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <PanelTabBar
        label="Pull request state"
        contentTabs
        activeId={state}
        tabs={STATES.map((entry) => ({
          id: entry.id,
          label: entry.label,
          icon: <entry.icon className="size-3.5" />,
        }))}
        onSelect={(id) => setState(id === "closed" ? "closed" : "open")}
        actions={
          <IconButton
            size="icon-xs"
            label="Refresh pull requests"
            tooltip="Refresh"
            disabled={list.isFetching}
            onClick={() => void list.refetch()}
          >
            {list.isFetching ? (
              <Spinner variant="action" className="size-3.5" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
          </IconButton>
        }
      />
      <div className="shrink-0 border-b border-border/70 px-3 py-2">
        <Input
          nativeInput
          size="sm"
          type="search"
          maxLength={200}
          aria-label="Filter pull requests"
          placeholder="Filter pull requests"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending ? (
          <PanelStateMessage>
            <Spinner className="size-4" aria-label="Loading pull requests" />
          </PanelStateMessage>
        ) : list.isError ? (
          <PanelStateMessage>
            <div className="flex flex-col items-center gap-2">
              <span>Could not load pull requests.</span>
              <span className="text-ui-xs text-muted-foreground">{list.error.message}</span>
              <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
                Retry
              </Button>
            </div>
          </PanelStateMessage>
        ) : items.length === 0 ? (
          <PanelStateMessage>
            {deferredSearch ? "No matching pull requests." : "No pull requests here."}
          </PanelStateMessage>
        ) : (
          <div className="flex flex-col py-1">
            {sections.map((section) =>
              section.items.length > 0 ? (
                <section key={section.label} className="flex flex-col">
                  {section.label ? (
                    <h3 className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-ui-xs font-medium text-muted-foreground">
                      {section.label}
                      <span className="font-normal tabular-nums">{section.items.length}</span>
                    </h3>
                  ) : null}
                  {section.items.map((item) => (
                    <PullRequestRow key={item.number} item={item} onSelect={props.onSelect} />
                  ))}
                </section>
              ) : null,
            )}
          </div>
        )}
      </div>
    </div>
  );
}
