import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { providerComposerCapabilitiesQueryOptions } from "~/lib/providerDiscoveryReactQuery";
import { interruptThreadTurn } from "../chatTaskActions";
import { enrichSubagentWorkEntries } from "~/components/ChatView.logic.subagents";
import { createRelevantWorkLogThreadsSelector } from "~/components/ChatView.selectors";
import {
  normalizeSubagentStatusKind,
  resolveSubagentPresentation,
} from "~/lib/subagentPresentation";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";
import { selectThreadActivities } from "~/threadDerivation";
import type { Thread, ThreadShell } from "~/types";
import { deriveWorkLogEntries } from "~/workLog.entries";
import { type SubagentRosterItem, deriveSubagentRosterItems } from "../subagentRoster.logic";
import { SubagentAvatar } from "../SubagentAvatar";
import { SubagentStatusIndicator } from "../SubagentStatusIndicator";
import { useEnvironmentListOpen } from "./environmentListOpen";
import { EnvironmentListSummary } from "./EnvironmentListSummary";
import {
  EnvironmentCollapsibleSection,
  EnvironmentSectionDivider,
  ENVIRONMENT_LIST_CLASS_NAME,
  ENVIRONMENT_ROW_CLASS_NAME,
} from "./EnvironmentRow";

const MAX_SUMMARY_AVATARS = 5;

const NO_BACKGROUND_IDS: ReadonlySet<string> = new Set();
const NO_ACTIVITIES: Thread["activities"] = [];

function NativeSubagentRow({
  thread,
  detail,
  runtimeUnavailable,
  onOpen,
}: {
  thread: ThreadShell;
  detail: SubagentRosterItem | undefined;
  runtimeUnavailable: boolean;
  onOpen: (id: ThreadId) => void;
}) {
  const state = useStore(
    (store) => store.threadTurnStateById?.[thread.id]?.latestTurn?.state ?? null,
  );
  const setError = useStore((store) => store.setError);
  const nativeControls = useQuery(
    providerComposerCapabilitiesQueryOptions(thread.modelSelection.provider),
  ).data?.nativeSubagentControls;
  const presentation = resolveSubagentPresentation({
    nickname: thread.subagentNickname,
    role: thread.subagentRole,
    title: thread.title,
    fallbackId: thread.id,
  });
  const status =
    detail?.statusLabel ??
    (state === "running"
      ? runtimeUnavailable
        ? "Runtime unavailable"
        : "Running"
      : state === "completed"
        ? "Completed"
        : state === "interrupted"
          ? "Stopped"
          : state === "error"
            ? "Failed"
            : "Status unavailable");
  return (
    <div
      className={cn(
        ENVIRONMENT_ROW_CLASS_NAME,
        "group/subagent-row grid grid-cols-[minmax(0,1fr)_auto] gap-y-0.5",
      )}
    >
      <button
        type="button"
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-left"
        onClick={() => onOpen(thread.id)}
      >
        <SubagentAvatar threadId={thread.id} />
        <span
          className="min-w-0 truncate"
          title={detail?.primaryLabel ?? presentation.primaryLabel}
        >
          {detail?.primaryLabel ?? presentation.primaryLabel}
          {detail?.modelLabel ? (
            <span className="ml-1.5 text-ui-xs text-muted-foreground" title={detail.modelLabel}>
              {detail.modelLabel}
            </span>
          ) : null}
        </span>
      </button>
      <span className="self-start">
        <SubagentStatusIndicator
          statusKind={detail?.statusKind ?? normalizeSubagentStatusKind(status)}
          statusLabel={status}
          onStop={
            detail?.isActive && nativeControls?.interrupt && !runtimeUnavailable
              ? () => {
                  void interruptThreadTurn(thread.id).catch((error: unknown) => {
                    setError(
                      thread.id,
                      error instanceof Error ? error.message : "Could not stop subagent.",
                    );
                  });
                }
              : undefined
          }
        />
      </span>
    </div>
  );
}

export function EnvironmentSubagentsSection({
  threadId,
  onClose,
}: {
  threadId: ThreadId | null;
  onClose: () => void;
}) {
  const shells = useStore((state) => state.threadShellById);
  const navigate = useNavigate();
  let root = threadId ? shells?.[threadId] : undefined;
  const visited = new Set<ThreadId>();
  while (
    root?.creationSource === "provider_native" &&
    root.parentThreadId &&
    !visited.has(root.id)
  ) {
    visited.add(root.id);
    const parent = shells?.[root.parentThreadId];
    if (!parent) break;
    root = parent;
  }
  const rootId = root?.id ?? null;
  // A subagent's chat shows its root chat's roster, so the root chat holds the choice.
  const [expanded, setExpanded] = useEnvironmentListOpen("subagents", rootId);
  const rootActivities = useStore((state) =>
    rootId ? selectThreadActivities(state, rootId) : NO_ACTIVITIES,
  );
  const rootSessionStatus = useStore((state) =>
    rootId ? (state.threadSessionById?.[rootId]?.status ?? null) : null,
  );
  const entries = deriveWorkLogEntries(rootActivities, undefined);
  const relevantThreads = useStore(
    useMemo(
      () =>
        createRelevantWorkLogThreadsSelector({
          workEntries: entries,
          parentThreadId: root?.id ?? null,
          enabled: entries.length > 0,
        }),
      [entries, root?.id],
    ),
  );
  if (!root || !shells) return null;
  const details = deriveSubagentRosterItems({
    workEntries: enrichSubagentWorkEntries(entries, relevantThreads, root.id),
    backgroundedProviderThreadIds: NO_BACKGROUND_IDS,
  });
  const detailById = new Map(
    details.map((item) => [`subagent:${root.id}:${item.providerThreadId}`, item]),
  );
  const omission = rootActivities.findLast(
    (activity) => activity.kind === "subagent.materialization.capped",
  );
  const descendants = new Set<ThreadId>([root.id]);
  const children: ThreadShell[] = [];
  const nativeThreads = Object.values(shells).filter(
    (thread) => thread.creationSource === "provider_native",
  );
  let added = true;
  while (added) {
    added = false;
    for (const thread of nativeThreads) {
      if (
        !descendants.has(thread.id) &&
        thread.parentThreadId &&
        descendants.has(thread.parentThreadId)
      ) {
        descendants.add(thread.id);
        children.push(thread);
        added = true;
      }
    }
  }
  const visibleChildren = children.filter((thread) => detailById.has(thread.id));
  if (visibleChildren.length === 0) return null;
  const runningCount = visibleChildren.filter(
    (thread) => detailById.get(thread.id)?.isActive,
  ).length;
  return (
    <>
      <EnvironmentSectionDivider />
      <EnvironmentCollapsibleSection
        label={`Subagents (${visibleChildren.length})`}
        open={expanded}
        onOpenChange={setExpanded}
        collapsedContent={
          <EnvironmentListSummary
            leading={
              <>
                {visibleChildren.slice(0, MAX_SUMMARY_AVATARS).map((thread) => (
                  <SubagentAvatar key={thread.id} threadId={thread.id} />
                ))}
                {visibleChildren.length > MAX_SUMMARY_AVATARS ? (
                  <span className="text-ui-sm text-muted-foreground">
                    +{visibleChildren.length - MAX_SUMMARY_AVATARS}
                  </span>
                ) : null}
              </>
            }
            runningCount={runningCount}
            doneCount={visibleChildren.length - runningCount}
            expandLabel="Show subagent list"
            onExpand={() => setExpanded(true)}
          />
        }
      >
        {omission ? (
          <p className="px-2 py-1 text-ui-xs text-muted-foreground">{omission.summary}</p>
        ) : null}
        <div className={ENVIRONMENT_LIST_CLASS_NAME}>
          {visibleChildren.map((thread) => (
            <NativeSubagentRow
              key={thread.id}
              thread={thread}
              detail={detailById.get(thread.id)}
              runtimeUnavailable={
                rootSessionStatus === "closed" ||
                rootSessionStatus === "error" ||
                rootSessionStatus === "disconnected"
              }
              onOpen={(id) => {
                void navigate({ to: "/$threadId", params: { threadId: id } });
                onClose();
              }}
            />
          ))}
        </div>
      </EnvironmentCollapsibleSection>
    </>
  );
}
