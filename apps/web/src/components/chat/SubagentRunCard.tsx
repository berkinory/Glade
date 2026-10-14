import { ThreadId, type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { formatEffortLabel } from "@glade/shared/provider/effortLabel";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertCircleIcon, ArrowRight02Icon, BotIcon, SquareFilledIcon } from "~/lib/icons";
import { useLiveClockNow } from "~/lib/liveActivityPresentation";
import { providerComposerCapabilitiesQueryOptions } from "~/lib/providerDiscoveryReactQuery";
import {
  formatSubagentModelLabel,
  resolveSubagentPresentation,
  subagentStatusTextToneClassName,
  type SubagentStatusKind,
} from "~/lib/subagentPresentation";
import { cn } from "~/lib/utils";
import { formatClockDuration } from "~/session-logic";
import { useStore } from "~/store";
import { createThreadSelector } from "~/storeSelectors";
import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";
import { retainThreadDetailSubscription } from "~/threadDetailSubscriptionRetention";
import { deriveWorkLogEntries } from "~/workLog.entries";
import type { WorkLogSubagentRun, WorkLogSubagentRunMember } from "~/workLog.types";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Spinner } from "../ui/spinner";
import { interruptThreadTurn } from "./chatTaskActions";
import { SubagentAvatar } from "./SubagentAvatar";
import {
  WORK_ROW_BLOCK_CLASS_NAME,
  WORK_ROW_GAP_CLASS_NAME,
  WORK_ROW_ICON_CLASS_NAME,
  WORK_ROW_ICON_SLOT_CLASS_NAME,
  WORK_ROW_LINE_CLASS_NAME,
} from "./workRowStyles";
import {
  describeLatestStep,
  describeRunHeader,
  previewLine,
  formatUsage,
  memberEndMs,
  subagentStatusKind,
} from "./SubagentRunCard.logic";
import { WorkTextShimmer } from "./WorkTextShimmer";

function isLiveKind(kind: SubagentStatusKind | null): boolean {
  return kind === "running" || kind === "queued";
}

function memberThreadId(member: WorkLogSubagentRunMember): ThreadId {
  return ThreadId.makeUnsafe(member.subagent.resolvedThreadId ?? member.subagent.threadId);
}

function statusText(
  kind: SubagentStatusKind | null,
  fallback: string | undefined,
  elapsed: string | null,
): string | null {
  switch (kind) {
    case "running":
      return elapsed ? `Running · ${elapsed}` : "Running";
    case "queued":
      return "Starting";
    case "completed":
      return elapsed ? `Done in ${elapsed}` : "Done";
    case "failed":
      return elapsed ? `Failed after ${elapsed}` : "Failed";
    case "stopped":
      return "Stopped";
    default:
      return fallback ?? null;
  }
}

export function SubagentRunCard({
  run,
  launching,
  fontSizePx,
}: {
  run: WorkLogSubagentRun;
  // The launch call is still running; a subagent that has not reported a status yet is starting.
  launching: boolean;
  fontSizePx: number;
}) {
  const { members } = run;
  const kinds = members.map((member) => subagentStatusKind(member.subagent));
  const live = kinds.some(isLiveKind) || (launching && kinds.includes(null));
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? live;
  const nowMs = useLiveClockNow(live);
  const startMs = Math.min(...members.map((member) => Date.parse(member.launchedAt)));
  const endMs = live
    ? nowMs
    : Math.max(...members.map((member) => memberEndMs(member) ?? Number.NaN));
  const elapsed =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? formatClockDuration(endMs - startMs)
      : null;
  const failed = kinds.includes("failed");
  const runningThreadIds = members
    .filter((member) => isLiveKind(subagentStatusKind(member.subagent)))
    .map(memberThreadId);

  return (
    <div data-subagent-run="true">
      <div className="flex max-w-full items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          className={cn(
            "inline-flex min-w-0 items-center text-left transition-colors duration-100 hover:text-foreground",
            WORK_ROW_BLOCK_CLASS_NAME,
            WORK_ROW_LINE_CLASS_NAME,
            WORK_ROW_GAP_CLASS_NAME,
            MUTED_LABEL_TEXT_CLASS_NAME,
          )}
          style={{ fontSize: `${fontSizePx}px` }}
          onClick={() => setUserOpen(!open)}
        >
          <span className={WORK_ROW_ICON_SLOT_CLASS_NAME} aria-hidden>
            {live ? (
              <Spinner variant="subagent" className={WORK_ROW_ICON_CLASS_NAME} />
            ) : failed ? (
              <AlertCircleIcon className={cn(WORK_ROW_ICON_CLASS_NAME, "text-destructive/85")} />
            ) : (
              <BotIcon className={WORK_ROW_ICON_CLASS_NAME} />
            )}
          </span>
          <span className="min-w-0 truncate">
            <WorkTextShimmer active={live}>{describeRunHeader(members)}</WorkTextShimmer>
            {elapsed ? <span> · {elapsed}</span> : null}
          </span>
          <DisclosureChevron open={open} className="text-muted-foreground/70" />
        </button>
        {runningThreadIds.length > 1 ? (
          <SubagentStopAllButton threadIds={runningThreadIds} />
        ) : null}
      </div>
      <DisclosureRegion open={open} lazy>
        <div className="tool-group-tree">
          <div className="space-y-px pt-0.5">
            {members.map((member) => (
              <SubagentRunRow
                key={`${member.subagent.threadId}:${member.launchedAt}`}
                member={member}
                nowMs={nowMs}
                fontSizePx={fontSizePx}
              />
            ))}
          </div>
        </div>
      </DisclosureRegion>
    </div>
  );
}

function SubagentRunRow({
  member,
  nowMs,
  fontSizePx,
}: {
  member: WorkLogSubagentRunMember;
  nowMs: number;
  fontSizePx: number;
}) {
  const { subagent } = member;
  const threadId = memberThreadId(member);
  const navigate = useNavigate();
  const child = useStore(useMemo(() => createThreadSelector(threadId), [threadId]));
  const childExists = child !== undefined;
  // Rows only mount while the card is open; that is when the child's messages and steps are needed.
  useEffect(
    () => (childExists ? retainThreadDetailSubscription(threadId) : undefined),
    [childExists, threadId],
  );

  const kind = subagentStatusKind(subagent);
  const live = isLiveKind(kind);
  const presentation = resolveSubagentPresentation({
    nickname: subagent.nickname,
    role: subagent.role,
    title: subagent.title,
    fallbackId: subagent.threadId,
  });
  const meta = [
    presentation.role,
    formatSubagentModelLabel(subagent.model),
    subagent.effort ? formatEffortLabel(subagent.effort) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const launchedMs = Date.parse(member.launchedAt);
  const endMs = live ? nowMs : memberEndMs(member);
  // The shared clock can trail a just-launched row by a tick; a live row still reads 0s.
  const elapsed =
    endMs !== null && (live || endMs >= launchedMs)
      ? formatClockDuration(Math.max(0, endMs - launchedMs))
      : null;
  const status = statusText(kind, subagent.statusLabel, kind === "stopped" ? null : elapsed);

  const detail = live
    ? ((child
        ? describeLatestStep(
            deriveWorkLogEntries(child.activities, child.latestTurn?.turnId ?? undefined),
          )
        : null) ?? previewLine(subagent.latestUpdate))
    : (previewLine(
        child?.messages.findLast(
          (message) =>
            message.role === "assistant" &&
            (member.settledAt === undefined || message.createdAt <= member.settledAt),
        )?.text,
      ) ?? previewLine(subagent.latestUpdate));
  const usage = formatUsage(member.usage);

  return (
    <div
      className="group/subagent-row relative rounded-md hover:bg-[var(--color-background-button-secondary-hover)]"
      style={{ fontSize: `${fontSizePx}px` }}
    >
      <button
        type="button"
        disabled={!childExists}
        title={childExists ? `Open ${presentation.primaryLabel}` : undefined}
        className="flex w-full min-w-0 items-start gap-2 px-1.5 py-1 text-left disabled:cursor-default"
        onClick={() => {
          void navigate({ to: "/$threadId", params: { threadId } });
        }}
      >
        <SubagentAvatar threadId={threadId} className="mt-px" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate font-medium text-foreground/85">
              {presentation.primaryLabel}
            </span>
            {meta ? <span className="truncate text-muted-foreground/60">{meta}</span> : null}
            {subagent.background ? (
              <span className="shrink-0 text-muted-foreground/60">background</span>
            ) : null}
          </span>
          {detail ? (
            <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
              {live ? null : <ArrowRight02Icon className="size-3 shrink-0 opacity-60" />}
              <WorkTextShimmer active={live} className="truncate">
                {detail}
              </WorkTextShimmer>
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-col items-end">
          {status ? (
            <span className={cn("tabular-nums", subagentStatusTextToneClassName(kind))}>
              {status}
            </span>
          ) : null}
          {usage ? <span className="text-muted-foreground/55 tabular-nums">{usage}</span> : null}
        </span>
      </button>
      {live && child ? (
        <SubagentStopButton threadId={threadId} provider={child.modelSelection.provider} />
      ) : null}
    </div>
  );
}

function SubagentStopButton({
  threadId,
  provider,
}: {
  threadId: ThreadId;
  provider: ProviderKind;
}) {
  const setError = useStore((store) => store.setError);
  const canInterrupt = useQuery(providerComposerCapabilitiesQueryOptions(provider)).data
    ?.nativeSubagentControls?.interrupt;
  if (!canInterrupt) return null;
  return (
    <button
      type="button"
      aria-label="Stop subagent"
      title="Stop subagent"
      className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-md bg-background opacity-0 transition-opacity hover:bg-[var(--color-background-button-secondary-hover)] group-hover/subagent-row:opacity-100 focus-visible:opacity-100"
      onClick={() => {
        void interruptThreadTurn(threadId).catch((error: unknown) => {
          setError(threadId, error instanceof Error ? error.message : "Could not stop subagent.");
        });
      }}
    >
      <SquareFilledIcon className="size-3" />
    </button>
  );
}

function SubagentStopAllButton({ threadIds }: { threadIds: ReadonlyArray<ThreadId> }) {
  const provider = useStore(
    (store) => store.threadShellById?.[threadIds[0]!]?.modelSelection.provider,
  );
  return provider ? <SubagentStopAllControl threadIds={threadIds} provider={provider} /> : null;
}

function SubagentStopAllControl({
  threadIds,
  provider,
}: {
  threadIds: ReadonlyArray<ThreadId>;
  provider: ProviderKind;
}) {
  const setError = useStore((store) => store.setError);
  const canInterrupt = useQuery(providerComposerCapabilitiesQueryOptions(provider)).data
    ?.nativeSubagentControls?.interrupt;
  if (!canInterrupt) return null;
  return (
    <button
      type="button"
      aria-label="Stop all subagents"
      title="Stop all running subagents"
      className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
      onClick={() => {
        for (const threadId of threadIds) {
          void interruptThreadTurn(threadId).catch((error: unknown) => {
            setError(threadId, error instanceof Error ? error.message : "Could not stop subagent.");
          });
        }
      }}
    >
      <SquareFilledIcon className="size-3" />
    </button>
  );
}
