import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { type OrchestrationShellStreamEvent } from "@glade/contracts/orchestration/snapshots";
export interface ThreadCatchupBackoff {
  turnId: string | null;
  replayNoopStreak: number;
  nextReplayAt: number;
  reconcileNoopStreak: number;

  appliedEventSerial: number;

  emptyReplayAtEventSerial: number | null;

  lastProjectionReconciledAt: number | null;
}
export function createStreamState() {
  return {
    disposed: false,
    pendingCheckpointDiffThreadIds: new Set<ThreadId>(),
    needsBroadGitInvalidation: false,
    pendingGitInvalidationThreadIds: new Set<ThreadId>(),
    pendingToolGitInvalidationThreadIds: new Set<ThreadId>(),
    pendingProjectFileInvalidationThreadIds: new Set<ThreadId>(),
    pendingDomainEvents: [] as OrchestrationEvent[],
    immediatelyFlushedAssistantMessageIds: new Set<string>(),
    providerDiscoveryInvalidationFingerprint: null as string | null,
    shellSnapshotSequence: -1,
    shellSubscriptionGeneration: 0,
    shellSnapshotReceivedGeneration: -1,
    pendingShellEvents: [] as OrchestrationShellStreamEvent[],
    subscribedThreadIds: new Set<ThreadId>(),
    threadSnapshotSequenceById: new Map<ThreadId, number>(),
    pendingThreadEventsById: new Map<ThreadId, OrchestrationEvent[]>(),
    threadSnapshotRequestInFlight: new Set<ThreadId>(),
    threadSnapshotRefreshPending: new Set<ThreadId>(),
    threadSnapshotNotFoundRetryAttempted: new Set<ThreadId>(),
    threadsAwaitingCreation: new Set<ThreadId>(),
    threadReplayRequestInFlight: new Set<ThreadId>(),
    threadProjectionReconcileInFlight: new Map<ThreadId, number>(),
    threadProjectionReconcilePendingById: new Map<ThreadId, number>(),
    threadProjectionTerminalFencePending: new Set<ThreadId>(),
    threadProjectionTerminalFenceSequenceById: new Map<ThreadId, number>(),
    threadProjectionTerminalFenceArmedAtById: new Map<ThreadId, number>(),
    threadSubscriptionGenerationById: new Map<ThreadId, number>(),
    nextThreadProjectionReconcileAtById: new Map<ThreadId, number>(),
    nextThreadSubscriptionGeneration: 0,
    reconcileThreadSubscriptionsChain: Promise.resolve(),
    threadCatchupBackoffById: new Map<ThreadId, ThreadCatchupBackoff>(),
    shellSnapshotFallbackTimer: null as number | null,
    scopedSubscriptionRefresh: null as Promise<void> | null,
    subscribed: false,
  };
}
export type StreamState = ReturnType<typeof createStreamState>;
