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
import { createThreadSelector } from "~/storeSelectors";
import type { ThreadShell } from "~/types";
import { deriveWorkLogEntries } from "~/workLog.entries";
import {
  type ComposerSubagentStripItem,
  deriveComposerSubagentStripItems,
} from "../ComposerSubagentStrip.logic";
import { SubagentAvatar } from "../SubagentAvatar";
import { SubagentStatusIndicator } from "../SubagentStatusIndicator";
import {
  EnvironmentCollapsibleSection,
  EnvironmentSectionDivider,
  ENVIRONMENT_ROW_CLASS_NAME,
} from "./EnvironmentRow";

const NO_BACKGROUND_IDS: ReadonlySet<string> = new Set();

function NativeSubagentRow({
  thread,
  detail,
  runtimeUnavailable,
  onOpen,
}: {
  thread: ThreadShell;
  detail: ComposerSubagentStripItem | undefined;
  runtimeUnavailable: boolean;
  onOpen: (id: ThreadId) => void;
}) {
  const child = useStore(useMemo(() => createThreadSelector(thread.id), [thread.id]));
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
  const state = child?.latestTurn?.state;
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
  const rootThread = useStore(useMemo(() => createThreadSelector(root?.id), [root?.id]));
  const entries = deriveWorkLogEntries(rootThread?.activities ?? [], undefined);
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
  const details = deriveComposerSubagentStripItems({
    workEntries: enrichSubagentWorkEntries(entries, relevantThreads, root.id),
    parentActivities: rootThread?.activities ?? [],
    backgroundedProviderThreadIds: NO_BACKGROUND_IDS,
  }).filter((item): item is ComposerSubagentStripItem => item.kind === "subagent");
  const detailById = new Map(
    details.map((item) => [`subagent:${root.id}:${item.providerThreadId}`, item]),
  );
  const omission = rootThread?.activities.findLast(
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
  return (
    <>
      <EnvironmentSectionDivider />
      <EnvironmentCollapsibleSection label={`Subagents (${visibleChildren.length})`}>
        {omission ? (
          <p className="px-2 py-1 text-ui-xs text-muted-foreground">{omission.summary}</p>
        ) : null}
        {visibleChildren.map((thread) => (
          <NativeSubagentRow
            key={thread.id}
            thread={thread}
            detail={detailById.get(thread.id)}
            runtimeUnavailable={
              rootThread?.session?.status === "closed" ||
              rootThread?.session?.status === "error" ||
              rootThread?.session?.status === "disconnected"
            }
            onOpen={(id) => {
              void navigate({ to: "/$threadId", params: { threadId: id } });
              onClose();
            }}
          />
        ))}
      </EnvironmentCollapsibleSection>
    </>
  );
}
