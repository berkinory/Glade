import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { GitPullRequestDetail } from "@glade/contracts/git/pullRequests";
import type { GitPullRequestReviewResult } from "@glade/contracts/git/pullRequestReview";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { GitHubIcon } from "~/lib/brandIcons";
import { copyTextToClipboard } from "~/lib/clipboard";
import {
  EllipsisIcon,
  File02Icon,
  Link01Icon,
  PlusMinusSquare01Icon,
  RefreshCwIcon,
  ToolsIcon,
} from "~/lib/icons";
import {
  gitPullRequestDetailQueryOptions,
  gitPullRequestReviewQueryOptions,
} from "~/lib/gitQueryOptions";
import { openExternalLink } from "~/lib/linkChips";
import { ComposerPickerMenuPopup } from "../chat/ComposerPickerMenuPopup";
import { DiffLayoutToggle } from "../chat/DiffLayoutToggle";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import { PanelTabBar } from "../chat/PanelTabBar";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestFiles } from "./PullRequestFiles";
import { PullRequestSummary } from "./PullRequestSummary";
import { resolveMergeBlocker, resolvePullRequestNextStep } from "./pullRequestNextStep";
import { buildReviewCommentsPrompt } from "./pullRequestPrompts";
import {
  MergePullRequestDialog,
  type PullRequestActions,
  usePullRequestActions,
} from "./usePullRequestActions";

type Section = "summary" | "changes";

// Mirrors the loaded summary's title, meta line and rows so the swap does not move anything.
function SummarySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading pull request" className="flex flex-col gap-3 p-4">
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-4 w-2/5" />
      <div className="flex flex-col gap-2 pt-1">
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-2/5" />
      </div>
      <Skeleton className="mt-2 h-24 w-full" />
    </div>
  );
}

function PrimaryAction(props: {
  pr: GitPullRequestDetail;
  review: GitPullRequestReviewResult | null;
  busy: boolean;
  onReady: () => void;
  onMerge: () => void;
}) {
  const { pr, review } = props;
  if (pr.state !== "open" || !review) return null;
  const blocker = pr.isDraft ? null : resolveMergeBlocker(review);
  const button = (
    <Button
      size="xs"
      variant={blocker ? "subtle" : "default"}
      // aria-disabled instead of disabled keeps hover alive for the tooltip that explains why.
      aria-disabled={blocker !== null || props.busy}
      className={blocker ? "cursor-not-allowed" : undefined}
      onClick={() => {
        if (blocker || props.busy) return;
        if (pr.isDraft) props.onReady();
        else props.onMerge();
      }}
    >
      {props.busy ? <Spinner variant="action" /> : null}
      {pr.isDraft ? "Ready for review" : "Merge"}
    </Button>
  );
  if (!blocker) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup side="bottom">{blocker}</TooltipPopup>
    </Tooltip>
  );
}

// Fixing, resolving and rerunning are what a blocked PR needs next, so they stay visible in the bar.
function UnblockActions(props: {
  pr: GitPullRequestDetail;
  review: GitPullRequestReviewResult | null;
  actions: PullRequestActions;
}) {
  const { pr, review, actions } = props;
  if (!review) return null;
  const nextStep = resolvePullRequestNextStep(pr, review);
  const canRerun = actions.canRerun(review.checks);
  const fix = actions.canDraft && nextStep && "hint" in nextStep ? nextStep : null;
  return (
    <>
      {canRerun ? (
        <IconButton
          size="icon-xs"
          label="Rerun failed jobs"
          tooltip="Rerun failed jobs"
          disabled={actions.busy}
          onClick={() => actions.rerunFailed(review.checks)}
        >
          <RefreshCwIcon className="size-3.5" />
        </IconButton>
      ) : null}
      {fix ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="outline"
                disabled={actions.busy}
                onClick={() => {
                  if (fix.kind === "fix_checks") void actions.draftFixChecks(review.checks);
                  else actions.draftPrompt(fix.prompt);
                }}
              />
            }
          >
            <ToolsIcon aria-hidden className="size-3.5" />
            {fix.label}
          </TooltipTrigger>
          <TooltipPopup side="bottom">{fix.hint}</TooltipPopup>
        </Tooltip>
      ) : null}
    </>
  );
}

function OverflowMenu(props: {
  pr: GitPullRequestDetail;
  review: GitPullRequestReviewResult | null;
  actions: PullRequestActions;
}) {
  const { pr, review, actions } = props;
  const nextStep = review ? resolvePullRequestNextStep(pr, review) : null;
  // The bar already offers the next step; the menu only holds what it leaves out.
  const addressComments =
    review && review.comments.length > 0 && actions.canDraft && nextStep?.kind !== "fix";
  const updateBranch = review?.mergeState === "behind" && nextStep?.kind !== "update_branch";
  const copyLink = () =>
    void copyTextToClipboard(pr.url).then(
      () => toastManager.add({ type: "success", title: "Link copied" }),
      (error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Could not copy the link",
          description: error instanceof Error ? error.message : undefined,
        }),
    );
  return (
    <Menu>
      <MenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label="More actions" />}>
        <EllipsisIcon aria-hidden />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="end">
        {review && addressComments ? (
          <MenuItem
            onClick={() =>
              actions.draftPrompt(buildReviewCommentsPrompt(pr.number, review.comments))
            }
          >
            <ToolsIcon aria-hidden className="size-3.5 opacity-70" />
            Address review comments
          </MenuItem>
        ) : null}
        {updateBranch ? (
          <MenuItem onClick={() => actions.run({ kind: "update_branch" })}>
            <RefreshCwIcon aria-hidden className="size-3.5 opacity-70" />
            Update branch
          </MenuItem>
        ) : null}
        {addressComments || updateBranch ? <MenuSeparator /> : null}
        <MenuItem onClick={copyLink}>
          <Link01Icon aria-hidden className="size-3.5 opacity-70" />
          Copy link
        </MenuItem>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

export function PullRequestDetail(props: {
  cwd: string;
  number: number;
  threadId: ThreadId;
  onOpenFile: (path: string) => void;
}) {
  const [section, setSection] = useState<Section>("summary");
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const detail = useQuery(gitPullRequestDetailQueryOptions(props.cwd, props.number));
  const isOpen = detail.data?.state === "open";
  const reviewQuery = useQuery(
    gitPullRequestReviewQueryOptions({ cwd: props.cwd, number: props.number, enabled: isOpen }),
  );
  const actions = usePullRequestActions({
    cwd: props.cwd,
    number: props.number,
    threadId: props.threadId,
  });
  const pr = detail.data;
  const review = isOpen ? (reviewQuery.data ?? null) : null;
  // The summary and its actions appear together, once both reads settle, so nothing pops in later.
  const ready = pr !== undefined && !(isOpen && reviewQuery.isPending);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <PanelTabBar
        label="Pull request sections"
        contentTabs
        activeId={section}
        tabs={[
          { id: "summary", label: "Summary", icon: <File02Icon className="size-3.5" /> },
          {
            id: "changes",
            label: "Changes",
            icon: <PlusMinusSquare01Icon className="size-3.5" />,
          },
        ]}
        onSelect={(id) => setSection(id === "changes" ? "changes" : "summary")}
        actions={
          ready ? (
            <span className="flex items-center gap-1">
              {section === "changes" ? (
                <DiffLayoutToggle value={diffStyle} onChange={setDiffStyle} />
              ) : null}
              <IconButton
                size="icon-xs"
                label="Open on GitHub"
                tooltip="Open on GitHub"
                onClick={() => openExternalLink(pr.url)}
              >
                <GitHubIcon className="size-3.5" />
              </IconButton>
              <OverflowMenu pr={pr} review={review} actions={actions} />
              <UnblockActions pr={pr} review={review} actions={actions} />
              <PrimaryAction
                pr={pr}
                review={review}
                busy={actions.busy}
                onReady={() => actions.run({ kind: "ready" })}
                onMerge={() => setConfirmingMerge(true)}
              />
            </span>
          ) : null
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {detail.isError ? (
          <PanelStateMessage>
            <div className="flex flex-col items-center gap-2">
              <span>Could not load pull request #{props.number}.</span>
              <span className="text-ui-xs text-muted-foreground">{detail.error.message}</span>
              <Button size="sm" variant="outline" onClick={() => void detail.refetch()}>
                Retry
              </Button>
            </div>
          </PanelStateMessage>
        ) : !ready ? (
          <SummarySkeleton />
        ) : section === "changes" ? (
          <PullRequestFiles
            cwd={props.cwd}
            number={pr.number}
            diffStyle={diffStyle}
            onOpenFile={props.onOpenFile}
          />
        ) : (
          <>
            {isOpen && reviewQuery.isError ? (
              <p className="mx-4 mt-3 rounded-md bg-muted px-2.5 py-1.5 text-ui-sm text-muted-foreground">
                Could not load checks and reviews.{" "}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => void reviewQuery.refetch()}
                >
                  Retry
                </button>
              </p>
            ) : null}
            <PullRequestSummary
              cwd={props.cwd}
              pr={pr}
              review={review}
              canDraft={actions.canDraft}
              onFixComment={(comment) =>
                actions.draftPrompt(buildReviewCommentsPrompt(pr.number, [comment]))
              }
              onOpenFile={props.onOpenFile}
            />
          </>
        )}
      </div>
      {pr && review && review.mergeMethods.length > 0 ? (
        <MergePullRequestDialog
          open={confirmingMerge}
          onOpenChange={setConfirmingMerge}
          number={pr.number}
          title={pr.title}
          baseBranch={pr.baseBranch}
          methods={review.mergeMethods}
          busy={actions.busy}
          onMerge={(method) => {
            setConfirmingMerge(false);
            actions.run({ kind: "merge", method });
          }}
        />
      ) : null}
    </section>
  );
}
