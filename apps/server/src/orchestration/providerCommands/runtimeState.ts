import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import { TurnId, type CheckpointRef } from "@glade/contracts/core/baseSchemas";
import { ProviderContextLifecycleEvidence } from "./contextLifecycle";
import { ProviderQueueDrainEvent } from "./deliveryClaims";

export type BlockedGoalContinuation = Pick<
  Extract<ProviderIntentEvent, { type: "thread.goal-continuation-requested" }>["payload"],
  "goalStartedAt" | "trigger" | "sourceTurnId"
>;

export type PendingQueuedDispatch = {
  readonly queuedThreadId: string;
  readonly messageId: string;
  releaseOnTurnId?: TurnId;
  pendingTerminalTurnIds?: Set<TurnId>;
};

export type PendingInterruptEscalation = { evidence: ProviderContextLifecycleEvidence | null };

export type PendingContextBootstrapAttempt = {
  turnId?: TurnId;
  terminalEvent?: ProviderQueueDrainEvent;
  readonly clearFreshSessionTranscript: boolean;
  readonly completeDurablePriorTranscript: boolean;
  lifecycleEvidence: ProviderContextLifecycleEvidence | null;
  readonly lifecycleEvidenceCreatedAt: string;
  readonly interruptEscalation?: PendingInterruptEscalation;
};

export interface EditReplayWorkspaceRestorePlan {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  readonly targetTurnCount: number;
}
