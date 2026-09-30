import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useMemo, useRef } from "react";

import { useAppSettings } from "~/appSettings";
import { useStableValue } from "~/hooks/useStableValue";
import { toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useKanbanUiStore } from "../../kanbanUiStore";
import { isHomeChatContainerProject } from "../../lib/chatProjects";
import { useStore } from "../../store";
import { createSidebarDisplayThreadsSelector } from "../../storeSelectors";
import { useWorkspacePathsStore } from "../../workspacePathsStore";
import { sortProjectsForSidebar } from "../Sidebar.logic";
import {
  areKanbanComposerDraftSnapshotsEqual,
  buildKanbanBoard,
  buildKanbanComposerDraftSnapshot,
  deriveKanbanColumn,
  resolveOptimisticDispatchOutcome,
  type KanbanBoard,
  type KanbanComposerDraftSnapshot,
  type KanbanDraftThreadSnapshot,
} from "./kanban.logic";

const OPTIMISTIC_DISPATCH_TIMEOUT_MS = 30_000;
const OPTIMISTIC_DISPATCH_EXPIRY_CHECK_MS = 5_000;

export function useKanbanBoard(): KanbanBoard {
  const { settings } = useAppSettings();

  const hideAutomationRunThreads = !settings.showAutomationRunThreads;
  const selectDisplayThreads = useMemo(
    () => createSidebarDisplayThreadsSelector({ hideAutomationRunThreads }),
    [hideAutomationRunThreads],
  );
  const threads = useStore(selectDisplayThreads);
  const allProjects = useStore((state) => state.projects);
  const threadsHydrated = useStore((state) => state.threadsHydrated);
  const homeDir = useWorkspacePathsStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspacePathsStore((state) => state.chatWorkspaceRoot);
  const projectSortOrder = settings.sidebarProjectSortOrder;

  const { projects, projectIdAliases } = useMemo(() => {
    const chatContainers = allProjects.filter((project) =>
      isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot }),
    );
    const otherProjects = allProjects.filter(
      (project) => !isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot }),
    );
    const canonicalContainer =
      chatContainers.find((project) => project.kind === "chat") ?? chatContainers[0] ?? null;
    const aliases: Record<string, ProjectId> = {};
    for (const container of chatContainers) {
      if (canonicalContainer && container.id !== canonicalContainer.id) {
        aliases[container.id] = canonicalContainer.id;
      }
    }
    return {
      projects: [
        ...sortProjectsForSidebar(otherProjects, threads, projectSortOrder),
        ...(canonicalContainer
          ? [{ id: canonicalContainer.id, kind: canonicalContainer.kind, name: "Chats" }]
          : []),
      ],
      projectIdAliases: aliases,
    };
  }, [allProjects, chatWorkspaceRoot, homeDir, projectSortOrder, threads]);
  const draftsByThreadId = useComposerDraftStore((state) => state.draftsByThreadId);
  const draftThreadsByThreadId = useComposerDraftStore((state) => state.draftThreadsByThreadId);
  const draftOrderByProjectId = useKanbanUiStore((state) => state.draftOrderByProjectId);
  const optimisticDispatchByThreadId = useKanbanUiStore(
    (state) => state.optimisticDispatchByThreadId,
  );

  // Drop persisted manual draft orders for projects that no longer exist, so the localStorage payload
  // doesn't grow forever as projects come and go.
  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }
    const knownProjectIds = new Set<string>(allProjects.map((project) => project.id));
    const kanbanUi = useKanbanUiStore.getState();
    for (const projectId of Object.keys(kanbanUi.draftOrderByProjectId)) {
      if (!knownProjectIds.has(projectId)) {
        kanbanUi.clearDraftOrder(projectId);
      }
    }
  }, [allProjects, threadsHydrated]);

  useEffect(() => {
    const entries = Object.entries(optimisticDispatchByThreadId);
    if (entries.length === 0) {
      return;
    }
    const kanbanUi = useKanbanUiStore.getState();
    for (const [threadId, entry] of entries) {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) {
        continue;
      }
      const outcome = resolveOptimisticDispatchOutcome(entry, thread);
      if (outcome === "pending") {
        continue;
      }
      kanbanUi.clearOptimisticDispatch(threadId);
      if (outcome === "failed") {
        toastManager.add({
          type: "error",
          title: "Task didn't start",
          description: thread.session?.lastError ?? `${entry.title} was moved back to Draft.`,
        });
      }
    }
  }, [optimisticDispatchByThreadId, threads]);

  // Safety net: a dispatch whose runtime signal never arrives reverts to Draft instead of leaving a
  // ghost card In Progress forever. Keyed on a boolean so new entries don't reset the interval and
  // stretch older entries' deadlines; the interval reads the live thread list through a ref (assigned
  // post-commit so a discarded concurrent render can never leak into it).
  const threadsRef = useRef(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  const hasOptimisticDispatches = Object.keys(optimisticDispatchByThreadId).length > 0;
  useEffect(() => {
    if (!hasOptimisticDispatches) {
      return;
    }
    const intervalId = window.setInterval(() => {
      const expired = useKanbanUiStore
        .getState()
        .expireOptimisticDispatches(Date.now() - OPTIMISTIC_DISPATCH_TIMEOUT_MS);
      for (const [threadId, entry] of expired) {
        const thread = threadsRef.current.find((candidate) => candidate.id === threadId);
        if (thread && deriveKanbanColumn(thread) === "inProgress") {
          continue;
        }
        toastManager.add({
          type: "error",
          title: "Task didn't start",
          description: `${entry.title} was moved back to Draft.`,
        });
      }
    }, OPTIMISTIC_DISPATCH_EXPIRY_CHECK_MS);
    return () => window.clearInterval(intervalId);
  }, [hasOptimisticDispatches]);

  // Empty drafts are dropped so routine composer churn (focus, selections, modes) rarely changes the
  // content — and useStableValue keeps the same object when it doesn't, sparing the downstream board
  // rebuild entirely.
  const computedComposerDraftByThreadId = useMemo(() => {
    const snapshots: Record<string, KanbanComposerDraftSnapshot> = {};
    for (const [threadId, draft] of Object.entries(draftsByThreadId)) {
      const snapshot = buildKanbanComposerDraftSnapshot(draft);
      if (snapshot && (snapshot.prompt.trim().length > 0 || snapshot.hasAttachments)) {
        snapshots[threadId] = snapshot;
      }
    }
    return snapshots;
  }, [draftsByThreadId]);
  const composerDraftByThreadId = useStableValue(
    computedComposerDraftByThreadId,
    areKanbanComposerDraftSnapshotsEqual,
  );

  const draftThreads = useMemo(() => {
    const snapshots: KanbanDraftThreadSnapshot[] = [];
    for (const [threadId, draftThread] of Object.entries(draftThreadsByThreadId)) {
      if (draftThread.promotedTo) {
        continue;
      }
      snapshots.push({
        threadId: threadId as ThreadId,
        projectId: draftThread.projectId,
        createdAt: draftThread.createdAt,
        branch: draftThread.branch,
        envMode: draftThread.envMode,
        worktreePath: draftThread.worktreePath,
      });
    }
    return snapshots;
  }, [draftThreadsByThreadId]);

  return useMemo(
    () =>
      buildKanbanBoard({
        projects,
        threads,
        draftThreads,
        composerDraftByThreadId,
        draftOrderByProjectId,
        projectIdAliases,
        optimisticDispatchByThreadId,
      }),
    [
      composerDraftByThreadId,
      draftOrderByProjectId,
      draftThreads,
      optimisticDispatchByThreadId,
      projectIdAliases,
      projects,
      threads,
    ],
  );
}
