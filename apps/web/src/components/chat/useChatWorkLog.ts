import { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useMemo } from "react";
import { deriveWorkLogEntries } from "../../workLog.entries";
import { isLatestTurnSettled } from "../../session-logic";
import { useStore } from "../../store";
import { createThreadSelector } from "../../storeSelectors";
import { retainThreadDetailSubscription } from "../../threadDetailSubscriptionRetention";
import type { Thread } from "../../types";
import { useWorkflowRunUiThreadState } from "../../workflowRunUiStore";
import {
  enrichSubagentWorkEntries,
  resolveComposerStripWorkLogEntries,
} from "../ChatView.logic.subagents";
import { createRelevantWorkLogThreadsSelector } from "../ChatView.selectors";
import { deriveSubagentRosterItems } from "./subagentRoster.logic";
import { deriveSubagentTaskReports, foldSubagentRunEntries } from "./SubagentRunCard.logic";
import { deriveWorkflowRunState, type WorkflowSubagentThreadRef } from "./WorkflowRunCard.logic";
const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const TURN_ID_KEY_SEPARATOR = "\n";

function visibleTurnIdsKey(
  messages: Thread["messages"] | undefined,
  latestTurnId: TurnId | null,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): string {
  const turnIds = new Set<TurnId>();
  for (const message of messages ?? []) {
    if (message.turnId) turnIds.add(message.turnId);
  }
  for (const activity of activities) {
    if (activity.turnId) turnIds.add(activity.turnId);
  }
  if (latestTurnId) turnIds.add(latestTurnId);
  return [...turnIds].join(TURN_ID_KEY_SEPARATOR);
}
interface ChatWorkLogInput {
  activeThread: Thread | undefined;
  latestTurnSettled: boolean;
  latestTurnLive: boolean;
}

export function useChatWorkLog({
  activeThread,
  latestTurnSettled,
  latestTurnLive,
}: ChatWorkLogInput) {
  const activeThreadId = activeThread?.id ?? null;
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const activeLatestTurnId = activeLatestTurn?.turnId ?? null;
  const activeLatestTurnStartedAt = activeLatestTurn?.startedAt ?? null;
  const activeLatestTurnState = activeLatestTurn?.state ?? null;
  const activeLatestTurnCompletedAt = activeLatestTurn?.completedAt ?? null;
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;

  // `messages` changes identity on every streaming flush; keying the Set on its turn ids keeps the
  // work log derivation and the store selector below stable until a turn actually appears.
  const workLogVisibleTurnIdsKey = visibleTurnIdsKey(
    activeThread?.messages,
    activeLatestTurnId,
    activeThread?.creationSource === "provider_native" ? threadActivities : EMPTY_ACTIVITIES,
  );
  const workLogVisibleTurnIds = useMemo(
    () =>
      new Set(
        workLogVisibleTurnIdsKey === ""
          ? []
          : (workLogVisibleTurnIdsKey.split(TURN_ID_KEY_SEPARATOR) as TurnId[]),
      ),
    [workLogVisibleTurnIdsKey],
  );
  const rawWorkLogEntries = useMemo(
    () =>
      deriveWorkLogEntries(threadActivities, activeLatestTurnId ?? undefined, {
        visibleTurnIds: workLogVisibleTurnIds,
        activeTurnId: latestTurnLive ? activeLatestTurnId : null,
        activeTurnStartedAt: activeLatestTurnStartedAt,
        latestTurnState: activeLatestTurnState,
        latestTurnCompletedAt: activeLatestTurnCompletedAt,
      }),
    [
      activeLatestTurnCompletedAt,
      activeLatestTurnId,
      activeLatestTurnStartedAt,
      activeLatestTurnState,
      latestTurnLive,
      threadActivities,
      workLogVisibleTurnIds,
    ],
  );
  const hasWorkLogSubagents = useMemo(
    () => rawWorkLogEntries.some((entry) => (entry.subagents?.length ?? 0) > 0),
    [rawWorkLogEntries],
  );
  const relevantWorkLogThreads = useStore(
    useMemo(
      () =>
        createRelevantWorkLogThreadsSelector({
          workEntries: rawWorkLogEntries,
          parentThreadId: activeThread?.id ?? null,
          enabled: hasWorkLogSubagents,
        }),
      [activeThread?.id, hasWorkLogSubagents, rawWorkLogEntries],
    ),
  );
  const enrichedWorkLogEntries = useMemo(
    () =>
      hasWorkLogSubagents
        ? enrichSubagentWorkEntries(
            rawWorkLogEntries,
            relevantWorkLogThreads,
            activeThread?.id ?? null,
          )
        : rawWorkLogEntries,
    [activeThread?.id, hasWorkLogSubagents, rawWorkLogEntries, relevantWorkLogThreads],
  );

  // Native activity and snapshot metadata update the child surfaces, not the tool transcript.
  const workLogEntries = foldSubagentRunEntries(
    enrichedWorkLogEntries.filter((entry) => entry.subagentAction?.tool !== "agentActivity"),
    deriveSubagentTaskReports(threadActivities),
  );

  const liveSubagentThreadIdsKey = useMemo(() => {
    if (!hasWorkLogSubagents) {
      return "";
    }
    const threadIds = new Set<string>();
    for (const entry of enrichedWorkLogEntries) {
      for (const subagent of entry.subagents ?? []) {
        if (subagent.isActive && subagent.resolvedThreadId) {
          threadIds.add(subagent.resolvedThreadId);
        }
      }
    }
    return [...threadIds].toSorted().join("\n");
  }, [enrichedWorkLogEntries, hasWorkLogSubagents]);
  useEffect(() => {
    if (!liveSubagentThreadIdsKey) {
      return;
    }
    const releases = liveSubagentThreadIdsKey
      .split("\n")
      .map((threadId) => retainThreadDetailSubscription(ThreadId.makeUnsafe(threadId)));
    return () => {
      for (const release of releases) {
        release();
      }
    };
  }, [liveSubagentThreadIdsKey]);

  const rosterParentThreadId = activeThread?.parentThreadId ?? null;
  const rosterParentThread = useStore(
    useMemo(() => createThreadSelector(rosterParentThreadId), [rosterParentThreadId]),
  );

  useEffect(() => {
    if (!rosterParentThreadId) {
      return;
    }
    return retainThreadDetailSubscription(rosterParentThreadId);
  }, [rosterParentThreadId]);
  const rosterSourceThreadId = rosterParentThread?.id ?? activeThread?.id ?? null;
  const rosterSourceActivities = rosterParentThread?.activities ?? threadActivities;
  const rosterSourceLatestTurnId = rosterParentThread
    ? (rosterParentThread.latestTurn?.turnId ?? null)
    : (activeLatestTurn?.turnId ?? null);
  const rosterSourceLatestTurnState = rosterParentThread
    ? (rosterParentThread.latestTurn?.state ?? null)
    : activeLatestTurnState;
  const rosterSourceLatestTurnStartedAt = rosterParentThread
    ? (rosterParentThread.latestTurn?.startedAt ?? null)
    : activeLatestTurnStartedAt;
  const rosterSourceLatestTurnCompletedAt = rosterParentThread
    ? (rosterParentThread.latestTurn?.completedAt ?? null)
    : activeLatestTurnCompletedAt;
  const rosterVisibleTurnIds = useMemo(() => {
    if (!rosterParentThread) {
      return workLogVisibleTurnIds;
    }
    const turnIds = new Set<TurnId>();
    for (const message of rosterParentThread.messages) {
      if (message.turnId) {
        turnIds.add(message.turnId);
      }
    }
    if (rosterParentThread.latestTurn?.turnId) {
      turnIds.add(rosterParentThread.latestTurn.turnId);
    }
    return turnIds;
  }, [rosterParentThread, workLogVisibleTurnIds]);
  const rosterLiveTurnId = rosterParentThread
    ? isLatestTurnSettled(rosterParentThread.latestTurn, rosterParentThread.session ?? null)
      ? null
      : (rosterParentThread.latestTurn?.turnId ?? null)
    : latestTurnSettled
      ? null
      : (activeLatestTurn?.turnId ?? null);

  const rosterRawWorkLogEntries = useMemo(
    () =>
      resolveComposerStripWorkLogEntries({
        hasDistinctParentSource: rosterParentThread !== undefined,
        activeWorkLogEntries: rawWorkLogEntries,
        deriveParentWorkLogEntries: () =>
          deriveWorkLogEntries(rosterSourceActivities, rosterSourceLatestTurnId ?? undefined, {
            visibleTurnIds: rosterVisibleTurnIds,
            activeTurnId: rosterLiveTurnId,
            activeTurnStartedAt: rosterSourceLatestTurnStartedAt,
            latestTurnState: rosterSourceLatestTurnState,
            latestTurnCompletedAt: rosterSourceLatestTurnCompletedAt,
          }),
      }),
    [
      rawWorkLogEntries,
      rosterLiveTurnId,
      rosterParentThread,
      rosterSourceActivities,
      rosterSourceLatestTurnCompletedAt,
      rosterSourceLatestTurnId,
      rosterSourceLatestTurnStartedAt,
      rosterSourceLatestTurnState,
      rosterVisibleTurnIds,
    ],
  );
  const hasRosterWorkLogSubagents = useMemo(
    () => rosterRawWorkLogEntries.some((entry) => (entry.subagents?.length ?? 0) > 0),
    [rosterRawWorkLogEntries],
  );
  const rosterRelevantWorkLogThreads = useStore(
    useMemo(
      () =>
        createRelevantWorkLogThreadsSelector({
          workEntries: rosterRawWorkLogEntries,
          parentThreadId: rosterSourceThreadId,
          enabled: hasRosterWorkLogSubagents,
        }),
      [rosterSourceThreadId, hasRosterWorkLogSubagents, rosterRawWorkLogEntries],
    ),
  );
  const rosterWorkLogEntries = useMemo(
    () =>
      hasRosterWorkLogSubagents
        ? enrichSubagentWorkEntries(
            rosterRawWorkLogEntries,
            rosterRelevantWorkLogThreads,
            rosterSourceThreadId,
          )
        : rosterRawWorkLogEntries,
    [
      rosterSourceThreadId,
      hasRosterWorkLogSubagents,
      rosterRawWorkLogEntries,
      rosterRelevantWorkLogThreads,
    ],
  );

  const backgroundedSubagentToolUseIds = useMemo(() => {
    const toolUseIds = new Set<string>();
    for (const activity of rosterSourceActivities) {
      if (activity.kind !== "task.updated") {
        continue;
      }
      const payload =
        activity.payload && typeof activity.payload === "object"
          ? (activity.payload as Record<string, unknown>)
          : null;
      const toolUseId = typeof payload?.toolUseId === "string" ? payload.toolUseId : null;
      if (!toolUseId || typeof payload?.isBackgrounded !== "boolean") {
        continue;
      }
      if (payload.isBackgrounded) {
        toolUseIds.add(toolUseId);
      } else {
        toolUseIds.delete(toolUseId);
      }
    }
    return toolUseIds;
  }, [rosterSourceActivities]);
  const subagentRosterItems = useMemo(
    () =>
      deriveSubagentRosterItems({
        workEntries: rosterWorkLogEntries,
        backgroundedProviderThreadIds: backgroundedSubagentToolUseIds,
      }),
    [backgroundedSubagentToolUseIds, rosterWorkLogEntries],
  );

  const workflowSubagentThreadsByToolUseId = useMemo(() => {
    const refs = new Map<string, WorkflowSubagentThreadRef>();
    for (const entry of enrichedWorkLogEntries) {
      for (const subagent of entry.subagents ?? []) {
        if (!subagent.providerThreadId) {
          continue;
        }
        refs.set(subagent.providerThreadId, {
          threadId: subagent.resolvedThreadId ?? subagent.threadId,
          model: subagent.model,
          effort: subagent.effort,
        });
      }
    }
    return refs;
  }, [enrichedWorkLogEntries]);
  // Persisted (per-thread) workflow run flags: pausedByUser tells the settled card apart from a plain
  // stop; dismissed retires a settled card the run's activities would otherwise keep visible.
  const workflowRunUiThreadState = useWorkflowRunUiThreadState(activeThreadId);
  const pausedWorkflowTaskIds = useMemo(
    () => new Set(workflowRunUiThreadState.pausedByUser),
    [workflowRunUiThreadState.pausedByUser],
  );
  const dismissedWorkflowTaskIds = useMemo(
    () => new Set(workflowRunUiThreadState.dismissed),
    [workflowRunUiThreadState.dismissed],
  );
  const workflowRunState = useMemo(
    () =>
      deriveWorkflowRunState({
        activities: threadActivities,
        subagentThreadsByToolUseId: workflowSubagentThreadsByToolUseId,
        pausedByUserTaskIds: pausedWorkflowTaskIds,
        dismissedTaskIds: dismissedWorkflowTaskIds,
      }),
    [
      threadActivities,
      workflowSubagentThreadsByToolUseId,
      pausedWorkflowTaskIds,
      dismissedWorkflowTaskIds,
    ],
  );
  return {
    workLogEntries,
    subagentRosterItems,
    rosterSourceThreadId,
    workflowRunState,
  };
}
