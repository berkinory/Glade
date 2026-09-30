import type { ScopedRestoreInput } from "../../checkpointing/Services/CheckpointStore";
import type { WorkspaceRestoreConfirmation } from "@glade/contracts/orchestration/workspaceRestore";
import { TurnId } from "@glade/contracts/core/baseSchemas";
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

export interface EditReplayWorkspaceRestorePlan extends ScopedRestoreInput {
  readonly confirmation: WorkspaceRestoreConfirmation;
}
