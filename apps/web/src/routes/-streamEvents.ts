import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ServerConfig } from "@glade/contracts/server/server";
import { type ServerSettingsView } from "@glade/contracts/settings/settings";
import { defaultTerminalTitleForCliKind } from "@glade/shared/threads/terminalThreads";
import {
  didProviderCommandDiscoverySettingsChange,
  didProviderEnablementChange,
} from "../appSettings";
import { toastManager } from "../components/ui/toast";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { providerModelDiscoveryInvalidationFingerprint } from "../lib/providerDiscoveryInvalidation";
import { providerDiscoveryQueryKeys } from "../lib/providerDiscoveryReactQuery";
import {
  invalidateProviderUsageQueries,
  reconcileServerProviderStatuses,
  refreshServerConfigAfterTransportOpen,
  serverConfigQueryOptions,
  serverQueryKeys,
  serverSettingsQueryOptions,
} from "../lib/serverReactQuery";
import { hasPendingTurnDispatch } from "../pendingTurnDispatch";
import {
  projectQueryKeys,
  upsertProjectDevServer,
  removeProjectDevServer,
} from "../lib/projectReactQuery";
import { useStore } from "../store";
import { terminalActivityFromEvent } from "../terminalActivity";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { getThreadFromState } from "../threadDerivation";
import { isThreadDetailVerifiedInSync } from "../threadDetailCatchupPolicy";
import {
  clearThreadDetailResumeCursor,
  setThreadDetailResumeCursor,
} from "../threadDetailResumeCursors";
import { subscribeThreadDetailEvictions } from "../threadDetailSubscriptionRetention";
import {
  onServerConfigUpdated,
  onServerProviderStatusesUpdated,
  onServerSettingsUpdated,
  onServerWelcome,
  onThreadStreamFailure,
} from "../wsNativeApi";
import { addWsTransportStateListener } from "../wsTransportEvents";
import {
  PENDING_SHELL_EVENT_BUFFER_LIMIT,
  PENDING_THREAD_EVENT_BUFFER_LIMIT,
  THREAD_DETAIL_CATCHUP_INTERVAL_MS,
  THREAD_DETAIL_PROJECTION_RECONCILE_INTERVAL_MS,
  THREAD_DETAIL_PROJECTION_RECONCILE_MAX_CONCURRENCY,
  THREAD_DETAIL_PROJECTION_RECONCILE_MAX_INTERVAL_MS,
  THREAD_DETAIL_PROJECTION_RECONCILE_MAX_NOOP_STREAK,
  appendBounded,
  isPendingInteractionDetailMissing,
  reconcilePromotedDraftFromThreadDetail,
  reconcilePromotedDraftsFromShellThreads,
  releaseOrphanedThreadDetail,
  shouldPollThreadDetailCatchup,
  shouldReconcileThreadProjection,
} from "./-rootStreamPolicy";
import type { createStreamBatching } from "./-streamBatching";
import type { StreamContext, StreamOperations } from "./-streamContracts";
import type { createStreamPolicy } from "./-streamPolicy";
import type { createStreamProjection } from "./-streamProjection";
import type { StreamState } from "./-streamState";
import type { createStreamSubscriptions } from "./-streamSubscriptions";
import { canApplyThreadSnapshot } from "./-threadDetailOwnership";
import { isTerminalThreadSessionStatus } from "./-threadTerminalFence";
export function subscribeStreamEvents(
  context: StreamContext,
  state: StreamState,
  operations: StreamOperations,
  subscriptions: ReturnType<typeof createStreamSubscriptions>,
  policy: ReturnType<typeof createStreamPolicy>,
  projection: ReturnType<typeof createStreamProjection>,
  batching: ReturnType<typeof createStreamBatching>,
) {
  context.reconcileThreadSubscriptionsRef.current = (threadIds) =>
    subscriptions.enqueueThreadSubscriptionReconcile(threadIds);

  const unsubShellEvent = context.api.orchestration.onShellEvent((item) => {
    if (item.kind === "snapshot") {
      state.shellSnapshotReceivedGeneration = state.shellSubscriptionGeneration;
      const promotedDraftThreadIds = subscriptions.collectSubscribedDraftsInShell(
        item.snapshot.threads,
      );
      state.shellSnapshotSequence = item.snapshot.snapshotSequence;
      context.syncServerShellSnapshot(item.snapshot);
      reconcilePromotedDraftsFromShellThreads(item.snapshot.threads);
      subscriptions.flushShellBuffer(item.snapshot.snapshotSequence);
      operations.removeOrphanedTerminalsForCurrentState();
      subscriptions.reconcileMissingSubscribedThreadProjections(promotedDraftThreadIds);
      return;
    }

    if (state.shellSnapshotSequence < 0) {
      appendBounded(state.pendingShellEvents, item, PENDING_SHELL_EVENT_BUFFER_LIMIT);
      return;
    }
    if (item.sequence <= state.shellSnapshotSequence) {
      return;
    }
    state.shellSnapshotSequence = item.sequence;
    context.applyShellEvent(item);
    if (item.kind === "thread-upserted") {
      reconcilePromotedDraftsFromShellThreads([item.thread]);
    }
    if (
      item.kind === "thread-removed" ||
      item.kind === "project-removed" ||
      (item.kind === "thread-upserted" && item.thread.archivedAt != null)
    ) {
      operations.removeOrphanedTerminalsForCurrentState();
    }
    if (
      item.kind === "thread-upserted" &&
      state.subscribedThreadIds.has(item.thread.id) &&
      item.thread.session !== null &&
      isTerminalThreadSessionStatus(item.thread.session.status)
    ) {
      policy.armThreadProjectionTerminalFence(item.thread.id, item.sequence);
    } else if (
      item.kind === "thread-upserted" &&
      state.subscribedThreadIds.has(item.thread.id) &&
      item.thread.session !== null
    ) {
      policy.clearThreadProjectionTerminalFence(item.thread.id);
    }
    if (
      item.kind === "thread-upserted" &&
      state.subscribedThreadIds.has(item.thread.id) &&
      !state.threadSnapshotSequenceById.has(item.thread.id)
    ) {
      // Read the now-real projection directly instead of restarting that stream on every shell update;
      // repeated ready/running/meta updates can otherwise keep cancelling hydration before a snapshot
      // reaches the renderer.
      void operations.reconcileThreadProjection(item.thread.id).catch(() => undefined);
    }
    if (
      item.kind === "thread-upserted" &&
      state.subscribedThreadIds.has(item.thread.id) &&
      isPendingInteractionDetailMissing(item.thread.id)
    ) {
      void operations
        .reconcileThreadProjection(item.thread.id, { queueIfInFlight: true })
        .catch(() => undefined);
    }
    if (item.kind === "thread-upserted" && state.subscribedThreadIds.has(item.thread.id)) {
      void projection.replayThreadEvents(item.thread.id, item.sequence).catch(() => undefined);
    }
  });

  const unsubThreadEvent = context.api.orchestration.onThreadEvent((item) => {
    if (item.kind === "snapshot") {
      const threadId = item.snapshot.thread.id;
      state.threadSnapshotRequestInFlight.delete(threadId);

      if (!canApplyThreadSnapshot({ threadId, leasedThreadIds: state.subscribedThreadIds })) {
        state.threadSnapshotSequenceById.delete(threadId);
        state.pendingThreadEventsById.delete(threadId);
        clearThreadDetailResumeCursor(threadId);
        return;
      }
      context.syncServerThreadDetailHotPath(item.snapshot.thread, item.snapshot.snapshotSequence);
      // The projection can discard a tombstoned snapshot (deleted thread or project) instead of applying
      // it; committing the cursor or the stream fence first would leave resume bookkeeping vouching for
      // detail that was never stored. `threadDetailSyncById` flips to "synced" only when the detail was
      // actually applied.
      if (useStore.getState().threadDetailSyncById?.[threadId] !== "synced") {
        state.threadSnapshotSequenceById.delete(threadId);
        state.pendingThreadEventsById.delete(threadId);
        clearThreadDetailResumeCursor(threadId);
        return;
      }
      state.threadSnapshotSequenceById.set(threadId, item.snapshot.snapshotSequence);
      state.threadSnapshotNotFoundRetryAttempted.delete(threadId);

      setThreadDetailResumeCursor(threadId, item.snapshot.snapshotSequence);
      state.nextThreadProjectionReconcileAtById.set(
        threadId,
        Date.now() + THREAD_DETAIL_PROJECTION_RECONCILE_INTERVAL_MS,
      );
      reconcilePromotedDraftFromThreadDetail(item.snapshot.thread);
      policy.flushThreadBuffer(threadId, item.snapshot.snapshotSequence);
      return;
    }

    const threadId = ThreadId.makeUnsafe(String(item.event.aggregateId));
    const latestThreadSequence = state.threadSnapshotSequenceById.get(threadId);
    if (latestThreadSequence === undefined) {
      const pendingThreadEvents = state.pendingThreadEventsById.get(threadId) ?? [];
      appendBounded(pendingThreadEvents, item.event, PENDING_THREAD_EVENT_BUFFER_LIMIT);
      state.pendingThreadEventsById.set(threadId, pendingThreadEvents);
      if (
        item.event.type === "thread.session-set" &&
        isTerminalThreadSessionStatus(item.event.payload.session.status)
      ) {
        policy.armThreadProjectionTerminalFence(threadId, item.event.sequence);
      } else if (item.event.type === "thread.session-set") {
        policy.clearThreadProjectionTerminalFence(threadId);
      }
      if (state.subscribedThreadIds.has(threadId)) {
        void operations.reconcileThreadProjection(threadId).catch(() => undefined);
      }
      return;
    }
    if (item.event.sequence <= latestThreadSequence) {
      return;
    }
    if (!policy.applyFencedThreadEvent(threadId, item.event)) {
      return;
    }
    if (
      item.event.type === "thread.session-set" &&
      isTerminalThreadSessionStatus(item.event.payload.session.status)
    ) {
      policy.armThreadProjectionTerminalFence(threadId, item.event.sequence);
    } else {
      if (item.event.type === "thread.session-set") {
        policy.clearThreadProjectionTerminalFence(threadId);
      }
      state.nextThreadProjectionReconcileAtById.set(
        threadId,
        Date.now() + THREAD_DETAIL_PROJECTION_RECONCILE_INTERVAL_MS,
      );
    }
  });

  const unsubThreadStreamFailure = onThreadStreamFailure((failure) => {
    const threadId = ThreadId.makeUnsafe(failure.threadId);
    if (state.disposed || !state.subscribedThreadIds.has(threadId)) {
      return;
    }

    clearThreadDetailResumeCursor(threadId);
    state.threadSnapshotSequenceById.delete(threadId);
    state.threadSnapshotRequestInFlight.delete(threadId);
    state.threadSnapshotRefreshPending.delete(threadId);
    useStore.getState().markThreadDetailSyncFailed(threadId);
    if (
      failure.code === "THREAD_SNAPSHOT_NOT_FOUND" &&
      !state.threadSnapshotNotFoundRetryAttempted.has(threadId) &&
      getThreadFromState(useStore.getState(), threadId)
    ) {
      state.threadSnapshotNotFoundRetryAttempted.add(threadId);
      useStore.getState().clearThreadDetailSyncFailure(threadId);
      void subscriptions.refreshThreadSnapshot(threadId);
    }
  });

  const unsubThreadDetailEviction = subscribeThreadDetailEvictions((threadId) => {
    if (state.disposed || !state.subscribedThreadIds.has(threadId)) {
      return;
    }
    state.threadSnapshotSequenceById.delete(threadId);
    state.pendingThreadEventsById.set(threadId, []);
    void subscriptions.refreshThreadSnapshot(threadId);
  });

  const unsubTerminalEvent = context.api.terminal.onEvent((event) => {
    const terminalThreadId = ThreadId.makeUnsafe(event.threadId);
    if (event.type === "activity") {
      const terminalStore = useTerminalStateStore.getState();
      const currentCliKind =
        selectThreadTerminalState(terminalStore.terminalStateByThreadId, terminalThreadId)
          .terminalCliKindsById[event.terminalId] ?? null;
      if (event.cliKind || currentCliKind !== null) {
        terminalStore.setTerminalMetadata(terminalThreadId, event.terminalId, {
          cliKind: event.cliKind,
          label: event.cliKind ? defaultTerminalTitleForCliKind(event.cliKind) : "Terminal",
        });
      }
    }
    const activity = terminalActivityFromEvent(event);
    if (activity === null) {
      return;
    }
    useTerminalStateStore.getState().setTerminalActivity(terminalThreadId, event.terminalId, {
      hasRunningSubprocess: activity.hasRunningSubprocess,
      agentState: activity.agentState,
    });
  });

  const invalidateLocalServers = () => {
    void context.queryClient.invalidateQueries({ queryKey: serverQueryKeys.localServers() });
  };

  context.queryClient.setQueryDefaults(projectQueryKeys.devServers(), { gcTime: Infinity });
  const unsubDevServerEvent = context.api.projects.onDevServerEvent((event) => {
    if (event.type === "snapshot") {
      context.queryClient.setQueryData(projectQueryKeys.devServers(), { servers: event.servers });
    } else if (event.type === "upserted") {
      upsertProjectDevServer(context.queryClient, event.server);
    } else {
      removeProjectDevServer(context.queryClient, event.projectId);
    }
    invalidateLocalServers();
  });

  void context.api.projects
    .listDevServers()
    .then(({ servers }) => {
      if (state.disposed) {
        return;
      }
      context.queryClient.setQueryData(projectQueryKeys.devServers(), { servers });
      invalidateLocalServers();
    })
    .catch(() => undefined);

  const unsubWelcome = onServerWelcome((payload) => {
    void (async () => {
      context.setServerWorkspacePaths({
        homeDir: payload.homeDir,
        chatWorkspaceRoot: payload.chatWorkspaceRoot,
      });
      await subscriptions.ensureScopedSubscriptions();
      if (state.disposed) {
        return;
      }

      if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
        return;
      }
      context.setProjectExpanded(payload.bootstrapProjectId, true);

      if (context.pathnameRef.current !== "/") {
        return;
      }
      if (context.handledBootstrapThreadIdRef.current === payload.bootstrapThreadId) {
        return;
      }
      await context.navigate({
        to: "/$threadId",
        params: { threadId: payload.bootstrapThreadId },
        replace: true,
      });
      context.handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
    })().catch(() => undefined);
  });

  const unsubServerConfigUpdated = onServerConfigUpdated((payload) => {
    void context.queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() });
    if (!state.subscribed) return;
    const issue = payload.issues.find((entry) => entry.kind.startsWith("keybindings."));
    if (!issue) {
      return;
    }

    toastManager.add({
      type: "warning",
      title: "Invalid keybindings configuration",
      description: issue.message,
      actionProps: {
        children: "Open keybindings.json",
        onClick: () => {
          void context.queryClient
            .ensureQueryData(serverConfigQueryOptions())
            .then((config) => {
              const editor = resolveAndPersistPreferredEditor(config.availableEditors);
              if (!editor) {
                throw new Error("No available editors found.");
              }
              return context.api.shell.openInEditor(config.keybindingsConfigPath, editor);
            })
            .catch((error) => {
              toastManager.add({
                type: "error",
                title: "Unable to open keybindings file",
                description: error instanceof Error ? error.message : "Unknown error opening file.",
              });
            });
        },
      },
    });
  });

  const unsubProviderStatusesUpdated = onServerProviderStatusesUpdated((payload) => {
    const nextProviderDiscoveryFingerprint = providerModelDiscoveryInvalidationFingerprint(
      payload.providers,
    );
    const currentConfig = context.queryClient.getQueryData<ServerConfig>(serverQueryKeys.config());
    const previousProviderDiscoveryFingerprint =
      state.providerDiscoveryInvalidationFingerprint ??
      (currentConfig
        ? providerModelDiscoveryInvalidationFingerprint(currentConfig.providers)
        : null);
    const shouldInvalidateProviderDiscovery =
      previousProviderDiscoveryFingerprint !== null &&
      previousProviderDiscoveryFingerprint !== nextProviderDiscoveryFingerprint;
    state.providerDiscoveryInvalidationFingerprint = nextProviderDiscoveryFingerprint;

    void reconcileServerProviderStatuses(context.queryClient, payload.providers).catch(
      () => undefined,
    );
    if (shouldInvalidateProviderDiscovery) {
      void context.queryClient.invalidateQueries({
        queryKey: providerDiscoveryQueryKeys.modelsAll,
      });
    }
  });

  const unsubWsTransportState = addWsTransportStateListener(
    (state) => {
      if (state !== "open") return;
      // Reopening the socket is a projection boundary. React Query otherwise keeps the previous
      // infinite-stale config and can strand "Checking".
      void refreshServerConfigAfterTransportOpen(context.queryClient).catch(() => undefined);
    },
    { replayCurrent: true },
  );

  const unsubServerSettingsUpdated = onServerSettingsUpdated((payload) => {
    const previousSettings = context.queryClient.getQueryData<ServerSettingsView>(
      serverQueryKeys.settings(),
    );
    context.queryClient.setQueryData(serverQueryKeys.settings(), payload.settings);
    if (didProviderEnablementChange(previousSettings, payload.settings)) {
      void context.queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
      void invalidateProviderUsageQueries(context.queryClient);
    } else if (didProviderCommandDiscoverySettingsChange(previousSettings, payload.settings)) {
      void context.queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
    }
    void context.queryClient.invalidateQueries({
      queryKey: serverSettingsQueryOptions().queryKey,
    });
  });

  state.subscribed = true;

  void subscriptions.ensureScopedSubscriptions();

  const threadDetailCatchupInterval = window.setInterval(() => {
    const now = Date.now();
    let availableProjectionReconcileSlots = Math.max(
      0,
      THREAD_DETAIL_PROJECTION_RECONCILE_MAX_CONCURRENCY -
        state.threadProjectionReconcileInFlight.size,
    );
    for (const threadId of state.subscribedThreadIds) {
      const draftThreadAwaitingProjection = policy.isDraftThreadAwaitingProjection(threadId);
      if (shouldPollThreadDetailCatchup(threadId)) {
        if (!state.threadSnapshotSequenceById.has(threadId)) {
          void operations.reconcileThreadProjection(threadId).catch(() => undefined);
        } else if (
          // A pending dispatch is the exact lost-event failure this poll repairs, so it always polls at base
          // cadence; otherwise honor the empty-replay backoff (reset on any applied event or a new turn).
          hasPendingTurnDispatch(threadId) ||
          now >= policy.resolveThreadCatchupBackoff(threadId).nextReplayAt
        ) {
          // A late replay result must not recreate backoff state for a thread whose lease was dropped
          // (cleanup deleted it) or re-leased (a new generation starts fresh) while the request was in
          // flight.
          const replaySubscriptionGeneration = state.threadSubscriptionGenerationById.get(threadId);
          void projection
            .replayThreadEvents(threadId)
            .then((appliedEventCount) => {
              if (
                appliedEventCount !== null &&
                state.threadSubscriptionGenerationById.get(threadId) ===
                  replaySubscriptionGeneration
              ) {
                policy.noteThreadReplayResult(threadId, appliedEventCount);
              }
            })
            .catch(() => undefined);
        }
      }
      if (
        !state.threadProjectionTerminalFencePending.has(threadId) &&
        !shouldReconcileThreadProjection(threadId) &&
        !draftThreadAwaitingProjection
      ) {
        state.nextThreadProjectionReconcileAtById.delete(threadId);
        continue;
      }
      const nextProjectionReconcileAt =
        state.nextThreadProjectionReconcileAtById.get(threadId) ?? now;
      const catchupBackoff = policy.resolveThreadCatchupBackoff(threadId);
      if (
        now >= nextProjectionReconcileAt &&
        !state.threadProjectionReconcileInFlight.has(threadId) &&
        !policy.hasThreadProjectionRepairPending(threadId) &&
        catchupBackoff.lastProjectionReconciledAt !== null &&
        now <
          catchupBackoff.lastProjectionReconciledAt +
            THREAD_DETAIL_PROJECTION_RECONCILE_MAX_INTERVAL_MS &&
        catchupBackoff.reconcileNoopStreak < THREAD_DETAIL_PROJECTION_RECONCILE_MAX_NOOP_STREAK &&
        isThreadDetailVerifiedInSync(catchupBackoff)
      ) {
        // This turn already had one authoritative projection resync and the replay poll has since proved
        // the thread current, so re-shipping the full projection would only repeat what the live stream
        // delivered. Count it as a no-op reconcile and let the cadence back off within the deadline from
        // the last actual resync. A skip must not restart that deadline; a new turn or repair bypasses it.
        policy.noteThreadReconcileResult(threadId, true);
        state.nextThreadProjectionReconcileAtById.set(
          threadId,
          Math.min(
            now + policy.nextThreadProjectionReconcileDelayMs(threadId),
            catchupBackoff.lastProjectionReconciledAt +
              THREAD_DETAIL_PROJECTION_RECONCILE_MAX_INTERVAL_MS,
          ),
        );
        continue;
      }
      if (
        availableProjectionReconcileSlots > 0 &&
        !state.threadProjectionReconcileInFlight.has(threadId) &&
        now >= nextProjectionReconcileAt
      ) {
        availableProjectionReconcileSlots -= 1;
        void operations.reconcileThreadProjection(threadId).catch(() => undefined);
      }
    }
  }, THREAD_DETAIL_CATCHUP_INTERVAL_MS);

  return () => {
    batching.flushPendingDomainEvents();
    state.disposed = true;
    if (state.shellSnapshotFallbackTimer !== null) {
      window.clearTimeout(state.shellSnapshotFallbackTimer);
      state.shellSnapshotFallbackTimer = null;
    }
    window.clearInterval(threadDetailCatchupInterval);
    state.needsProviderInvalidation = false;
    state.needsBroadGitInvalidation = false;
    state.pendingGitInvalidationThreadIds = new Set();
    state.threadProjectionReconcileInFlight.clear();
    state.threadProjectionTerminalFencePending.clear();
    state.threadProjectionTerminalFenceSequenceById.clear();
    state.threadProjectionTerminalFenceArmedAtById.clear();
    state.threadSubscriptionGenerationById.clear();
    state.nextThreadProjectionReconcileAtById.clear();
    state.threadCatchupBackoffById.clear();
    batching.domainEventFlushThrottler.cancel();
    context.reconcileThreadSubscriptionsRef.current = null;
    subscriptions.unregisterEmptyRouteRestoreRefresh();
    void context.api.orchestration.unsubscribeShell().catch(() => undefined);

    releaseOrphanedThreadDetail({
      releasedThreadIds: [...state.subscribedThreadIds],
      keptThreadIds: new Set(context.visibleThreadIdsRef.current),
    });
    void Promise.all(
      [...state.subscribedThreadIds].map((threadId) =>
        context.api.orchestration.unsubscribeThread({ threadId }).catch(() => undefined),
      ),
    );
    unsubShellEvent();
    unsubThreadEvent();
    unsubThreadStreamFailure();
    unsubThreadDetailEviction();
    unsubTerminalEvent();
    unsubDevServerEvent();
    unsubWelcome();
    unsubServerConfigUpdated();
    unsubProviderStatusesUpdated();
    unsubWsTransportState();
    unsubServerSettingsUpdated();
  };
}
