import type {
  PreviewWorkspaceRestoreInput,
  WorkspaceRestorePreview,
} from "@glade/contracts/orchestration/workspaceRestore";
import type {
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
} from "@glade/contracts/orchestration/rpc";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { CheckpointServiceError } from "../Errors.ts";

export interface CheckpointDiffQueryShape {
  readonly previewWorkspaceRestore: (
    input: PreviewWorkspaceRestoreInput,
  ) => Effect.Effect<WorkspaceRestorePreview, CheckpointServiceError>;
  readonly getTurnDiff: (
    input: OrchestrationGetTurnDiffInput,
  ) => Effect.Effect<OrchestrationGetTurnDiffResult, CheckpointServiceError>;

  readonly getFullThreadDiff: (
    input: OrchestrationGetFullThreadDiffInput,
  ) => Effect.Effect<OrchestrationGetFullThreadDiffResult, CheckpointServiceError>;
}

export class CheckpointDiffQuery extends ServiceMap.Service<
  CheckpointDiffQuery,
  CheckpointDiffQueryShape
>()("glade/checkpointing/Services/CheckpointDiffQuery") {}
