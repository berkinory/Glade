import { type ProjectId, ThreadId } from "@glade/contracts";
import { getDefaultModel } from "@glade/shared/model";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startTransition } from "react";
import { useAppSettings } from "../appSettings";
import { prefetchModelsForNewThread } from "../lib/providerModelPrefetch";
import { useProviderStatusesForLocalConfig } from "../hooks/useProviderStatusesForLocalConfig";
import {
  hasReconciledServerProviderStatuses,
  serverConfigQueryOptions,
} from "../lib/serverReactQuery";
import {
  type ComposerThreadDraftState,
  type DraftThreadState,
  resolvePreferredComposerModelSelection,
  useComposerDraftStore,
} from "../composerDraftStore";
import {
  findProviderStatus,
  isProviderUsable,
  resolveAvailableProviderPreference,
} from "../lib/providerAvailability";
import {
  buildDraftThreadContextPatch,
  createFreshDraftThreadSeed,
  resolveThreadBootstrapPlan,
  type NewThreadOptions,
} from "../lib/threadBootstrap";
import {
  draftNavigationSlotKey,
  runDraftNavigationOnce,
  stageDraftNavigation,
} from "../lib/stagedDraftNavigation";
import { newThreadId } from "../lib/utils";
import { useFocusedChatContext } from "../focusedChatContext";
import { useStore } from "../store";
import { useSpacesUiStore } from "../spacesUiStore";
import { useProjectEnvironmentStore } from "../projectEnvironmentStore";
import { useTerminalStateStore } from "../terminalStateStore";

export function useHandleNewThread() {
  const projects = useStore((store) => store.projects);
  const { settings, serverSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const serverCwd = serverConfigQuery.data?.cwd ?? null;
  const providerStatuses = useProviderStatusesForLocalConfig();
  const providerStatusesReconciled = hasReconciledServerProviderStatuses(queryClient);
  const navigate = useNavigate();
  const router = useRouter();
  const { activeDraftThread, activeProjectId, activeThread, focusedThreadId, routeThreadId } =
    useFocusedChatContext();
  const openChatThreadPage = useTerminalStateStore((store) => store.openChatThreadPage);
  const clearTerminalState = useTerminalStateStore((store) => store.clearTerminalState);

  const handleNewThread = (
    projectId: ProjectId,
    options?: NewThreadOptions,
  ): Promise<ThreadId | null> => {
    // Project/thread targets are not authoritative until hydration completes. Read the
    // store at call time so a stale UI callback cannot mint a draft during hydration.
    if (!useStore.getState().threadsHydrated) {
      return Promise.resolve(null);
    }

    const defaultEnvMode =
      useProjectEnvironmentStore.getState().envModeByProjectId[projectId] ??
      settings.defaultThreadEnvMode;
    const draftStore = useComposerDraftStore.getState();
    const draftThread = draftStore.getDraftThreadByProjectId(projectId);
    const draftComposer = draftThread
      ? (draftStore.draftsByThreadId[draftThread.threadId] ?? null)
      : null;
    const project = useStore.getState().projects.find((candidate) => candidate.id === projectId);

    prefetchModelsForNewThread(queryClient, {
      settings,
      serverSettings: serverSettings ?? null,
      hiddenProviders: settings.hiddenProviders,
      providerOverride: options?.provider ?? null,
      draftActiveProvider: draftComposer?.activeProvider ?? null,
      stickyActiveProvider: draftStore.stickyActiveProvider,
      projectDefaultProvider: project?.defaultModelSelection?.provider ?? null,
      projectCwd: project?.cwd ?? null,
      draftWorktreePath: draftThread?.worktreePath ?? null,
      worktreePath: options?.worktreePath ?? null,
      hasExplicitWorktreePath: options?.worktreePath !== undefined,
      fresh: options?.fresh === true,
      envMode: options?.envMode ?? draftThread?.envMode ?? defaultEnvMode,
      serverCwd,
      providerStatuses,
      statusesReconciled: providerStatusesReconciled,
      providerOrder: settings.providerOrder,
    });
    const applyProviderOverride = (threadId: ThreadId) => {
      if (!options?.provider) {
        return;
      }
      const defaultModel = getDefaultModel(options.provider);
      if (!defaultModel) {
        return;
      }
      setModelSelection(threadId, {
        provider: options.provider,
        model: defaultModel,
      });
    };
    const restoreComposerDraft = (
      threadId: ThreadId,
      draftState: ComposerThreadDraftState | null,
    ) => {
      if (!draftState) {
        return;
      }
      useComposerDraftStore.setState((state) => {
        if (state.draftsByThreadId[threadId] === draftState) {
          return state;
        }
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: draftState,
          },
        };
      });
    };
    const {
      getDraftThread,
      getDraftThreadByProjectId,
      applyStickyState,
      clearDraftThread,
      registerDraftThread,
      setDraftThreadContext,
      setProjectDraftThreadId,
      setModelSelection,
    } = useComposerDraftStore.getState();
    const shouldForceFreshThread = options?.fresh === true;

    const storedDraftThreadCandidate = getDraftThreadByProjectId(projectId);
    const latestActiveDraftThreadCandidate: DraftThreadState | null = focusedThreadId
      ? getDraftThread(focusedThreadId)
      : null;
    const storedDraftThread = !shouldForceFreshThread ? storedDraftThreadCandidate : null;
    const latestActiveDraftThread: DraftThreadState | null = !shouldForceFreshThread
      ? latestActiveDraftThreadCandidate
      : null;
    const bootstrapPlan = resolveThreadBootstrapPlan({
      storedDraftThread,
      latestActiveDraftThread,
      projectId,
      routeThreadId: focusedThreadId,
    });
    // Read from the store at call time so post-sync sidebar flows can use the latest project defaults.
    const projectDefaultModelSelection =
      useStore.getState().projects.find((project) => project.id === projectId)
        ?.defaultModelSelection ?? null;
    const applyUsableStickyState = (threadId: ThreadId) => {
      applyStickyState(threadId);
      if (options?.provider || !hasReconciledServerProviderStatuses(queryClient)) {
        return;
      }

      const draft = useComposerDraftStore.getState().draftsByThreadId[threadId] ?? null;
      const stickyProvider = draft?.activeProvider ?? null;
      if (
        !stickyProvider ||
        isProviderUsable(findProviderStatus(providerStatuses, stickyProvider))
      ) {
        return;
      }

      const fallbackProvider = resolveAvailableProviderPreference({
        preferredProvider: projectDefaultModelSelection?.provider ?? settings.defaultProvider,
        statuses: providerStatuses,
        providerOrder: settings.providerOrder,
        hiddenProviders: settings.hiddenProviders,
      });
      if (!isProviderUsable(findProviderStatus(providerStatuses, fallbackProvider))) {
        return;
      }

      setModelSelection(
        threadId,
        resolvePreferredComposerModelSelection({
          draft: draft
            ? {
                modelSelectionByProvider: draft.modelSelectionByProvider,
                activeProvider: fallbackProvider,
              }
            : null,
          threadModelSelection: null,
          projectModelSelection: projectDefaultModelSelection,
          defaultProvider: fallbackProvider,
        }),
      );
    };
    if (bootstrapPlan.kind === "stored") {
      return (async (): Promise<ThreadId> => {
        const preservedComposerDraft =
          useComposerDraftStore.getState().draftsByThreadId[bootstrapPlan.threadId] ?? null;
        const draftContextPatch = buildDraftThreadContextPatch(options);
        if (draftContextPatch) {
          setDraftThreadContext(bootstrapPlan.threadId, draftContextPatch);
        }
        applyProviderOverride(bootstrapPlan.threadId);
        setProjectDraftThreadId(projectId, bootstrapPlan.threadId);
        restoreComposerDraft(bootstrapPlan.threadId, preservedComposerDraft);
        openChatThreadPage(bootstrapPlan.threadId);
        if (focusedThreadId === bootstrapPlan.threadId) {
          return bootstrapPlan.threadId;
        }
        await navigate({
          to: "/$threadId",
          params: { threadId: bootstrapPlan.threadId },
        });
        restoreComposerDraft(bootstrapPlan.threadId, preservedComposerDraft);
        return bootstrapPlan.threadId;
      })();
    }

    if (bootstrapPlan.kind === "route") {
      return (async (): Promise<ThreadId> => {
        const preservedComposerDraft =
          useComposerDraftStore.getState().draftsByThreadId[bootstrapPlan.threadId] ?? null;
        const draftContextPatch = buildDraftThreadContextPatch(options);
        if (draftContextPatch) {
          setDraftThreadContext(bootstrapPlan.threadId, draftContextPatch);
        }
        applyProviderOverride(bootstrapPlan.threadId);
        setProjectDraftThreadId(projectId, bootstrapPlan.threadId);
        restoreComposerDraft(bootstrapPlan.threadId, preservedComposerDraft);
        openChatThreadPage(bootstrapPlan.threadId);
        return bootstrapPlan.threadId;
      })();
    }

    return runDraftNavigationOnce(draftNavigationSlotKey(projectId), async () => {
      const threadId = newThreadId();
      if (
        useStore
          .getState()
          .projects.some((project) => project.id === projectId && project.kind === "chat")
      ) {
        useSpacesUiStore
          .getState()
          .assignChatThread(threadId, useSpacesUiStore.getState().activeSpaceId);
      }
      const createdAt = new Date().toISOString();
      const draftSeed = createFreshDraftThreadSeed({
        createdAt,
        options,
        defaultEnvMode,
      });
      const committed = await stageDraftNavigation({
        // Keep the previous routed draft alive while the destination loads. Replacing the
        // project's primary slot earlier makes the route guard redirect the old URL to Home.
        stage: () => {
          registerDraftThread(threadId, { projectId, ...draftSeed });
          openChatThreadPage(threadId);
          // Seed the draft from the sticky (last-used) selection so a new chat
          // reopens with the model and options used most recently.
          applyUsableStickyState(threadId);
          applyProviderOverride(threadId);
        },
        // Mark the draft-landing navigation as a transition so the new route
        // subtree renders interruptibly and the browser can paint the chat
        // mount loader immediately instead of freezing on the synchronous commit.
        navigate: () =>
          new Promise<void>((resolve, reject) => {
            startTransition(() => {
              navigate({
                to: "/$threadId",
                params: { threadId },
              }).then(resolve, reject);
            });
          }),
        // TanStack resolves an older navigate() promise when a newer navigation supersedes it.
        // Verify the committed route before deleting the previous project draft.
        isDestinationActive: () => router.state.location.pathname === `/${threadId}`,
        finalize: () => {
          if (!options?.standalone) setProjectDraftThreadId(projectId, threadId, draftSeed);
        },
        rollback: () => {
          clearDraftThread(threadId);
          clearTerminalState(threadId);
        },
      });
      if (!committed) {
        return null;
      }
      return threadId;
    });
  };

  return {
    activeDraftThread,
    activeProjectId,
    activeThread,
    activeContextThreadId: focusedThreadId,
    handleNewThread,
    projects,
    routeThreadId,
  };
}
