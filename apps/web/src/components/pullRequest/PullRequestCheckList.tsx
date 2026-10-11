import type {
  GitPullRequestCheck,
  GitPullRequestCheckState,
} from "@glade/contracts/git/pullRequestReview";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CircleCheckIcon,
  LayoutAlignLeftIcon,
  MinusIcon,
  XIcon,
} from "~/lib/icons";
import { openExternalLink } from "~/lib/linkChips";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { ELEVATED_HOVER_SURFACE_CLASS_NAME, SOFT_SURFACE_FILL_CLASS_NAME } from "~/surfaceStyles";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Badge } from "../ui/badge";
import { IconButton } from "../ui/icon-button";
import { Spinner } from "../ui/spinner";

export const CHECK_TONE_CLASS = {
  success: "text-status-success",
  failure: "text-status-failure",
  pending: "text-muted-foreground",
  neutral: "text-muted-foreground",
} as const;

export function CheckStateIcon({ state }: { state: GitPullRequestCheckState }) {
  if (state === "pending")
    return <Spinner variant="action" className={cn("size-3.5", CHECK_TONE_CLASS.pending)} />;
  const Icon = state === "success" ? CircleCheckIcon : state === "failure" ? XIcon : MinusIcon;
  const tone = state === "success" || state === "failure" ? state : "neutral";
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", CHECK_TONE_CLASS[tone])} />;
}

function CheckLog({ cwd, jobId }: { cwd: string; jobId: number }) {
  const log = useQuery({
    queryKey: ["git", "check-log", cwd, jobId],
    queryFn: () => ensureNativeApi().git.pullRequestCheckLog({ cwd, jobId }),
    staleTime: Infinity,
    retry: false,
  });
  const scroller = useRef<HTMLPreElement>(null);
  // The failure sits at the end of a job log, so the excerpt opens scrolled to its tail.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [log.data]);
  if (log.isPending)
    return (
      <div className="flex justify-center py-2">
        <Spinner className="size-4" aria-label="Loading log" />
      </div>
    );
  if (log.isError)
    return <p className="px-1.5 py-1 text-ui-xs text-destructive">Could not load the log.</p>;
  return (
    <pre
      ref={scroller}
      className={cn(
        "mx-1.5 mb-1 max-h-72 overflow-auto rounded-md p-2 font-mono text-ui-xs whitespace-pre-wrap break-all",
        SOFT_SURFACE_FILL_CLASS_NAME,
      )}
    >
      {log.data.truncated ? "…\n" : ""}
      {log.data.excerpt || "The log is empty."}
    </pre>
  );
}

export function PullRequestCheckList(props: {
  checks: ReadonlyArray<GitPullRequestCheck>;
  /** Enables inline log excerpts for failing GitHub Actions jobs. */
  cwd?: string;
}) {
  const [openLog, setOpenLog] = useState<number | null>(null);
  return (
    <ul className="flex flex-col">
      {props.checks.map((check) => {
        const logAvailable =
          Boolean(props.cwd) && check.jobId !== null && check.state === "failure";
        const logOpen = logAvailable && openLog === check.jobId;
        return (
          <li key={`${check.name}-${check.jobId ?? check.url}`}>
            <div
              className={cn(
                "flex h-7 items-center gap-2 rounded-md px-1.5 text-ui-sm",
                ELEVATED_HOVER_SURFACE_CLASS_NAME,
              )}
            >
              <CheckStateIcon state={check.state} />
              <span className="min-w-0 flex-1 truncate">{check.name}</span>
              {check.required ? (
                <Badge variant="outline" size="sm">
                  Required
                </Badge>
              ) : null}
              {logAvailable ? (
                <IconButton
                  size="icon-xs"
                  label={logOpen ? "Hide log" : "Show log"}
                  tooltip={logOpen ? "Hide log" : "Show log"}
                  aria-pressed={logOpen}
                  onClick={() => setOpenLog(logOpen ? null : check.jobId)}
                >
                  <LayoutAlignLeftIcon className="size-3.5" />
                </IconButton>
              ) : null}
              {check.url ? (
                <IconButton
                  size="icon-xs"
                  label="Open on GitHub"
                  tooltip="Open on GitHub"
                  onClick={() => check.url && openExternalLink(check.url)}
                >
                  <ArrowUpRightIcon className="size-3.5" />
                </IconButton>
              ) : null}
            </div>
            {props.cwd && check.jobId !== null ? (
              <DisclosureRegion open={logOpen}>
                {logOpen ? <CheckLog cwd={props.cwd} jobId={check.jobId} /> : null}
              </DisclosureRegion>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
