import { TurnId, type CheckpointRef } from "@glade/contracts/core/baseSchemas";
import { ProviderContextLifecycleEvidence } from "./contextLifecycle";
import { ProviderQueueDrainEvent } from "./deliveryClaims";

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
