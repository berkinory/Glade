import type {
  WorkspaceRestoreConfirmation,
  WorkspaceRestorePreview,
} from "@glade/contracts/orchestration/workspaceRestore";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { CheckpointStoreError } from "../Errors.ts";
import { CheckpointRef } from "@glade/contracts/core/baseSchemas";

interface CaptureCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;

  readonly skipIfExists?: boolean;
}

interface CopyCheckpointRefInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
}

interface DiffCheckpointsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  readonly fallbackFromToHead?: boolean;
  readonly ignoreWhitespace: boolean;
  readonly maxOutputBytes?: number;
}

interface DeleteCheckpointRefsInput {
  readonly cwd: string;
  readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
}

export interface ScopedRestoreInput {
  readonly cwd: string;
  readonly turns: ReadonlyArray<{
    readonly beforeCheckpointRef: CheckpointRef;
    readonly afterCheckpointRef: CheckpointRef;
    readonly fallbackBeforeCheckpointRef?: CheckpointRef;
  }>;
}

export interface CheckpointStoreShape {
  readonly previewScopedRestore: (
    input: ScopedRestoreInput,
  ) => Effect.Effect<WorkspaceRestorePreview, CheckpointStoreError>;
  readonly restoreScopedCheckpoint: (
    input: ScopedRestoreInput & { readonly confirmation: WorkspaceRestoreConfirmation },
  ) => Effect.Effect<void, CheckpointStoreError>;
  readonly isGitRepository: (cwd: string) => Effect.Effect<boolean, CheckpointStoreError>;

  readonly captureCheckpoint: (
    input: CaptureCheckpointInput,
  ) => Effect.Effect<void, CheckpointStoreError>;

  readonly copyCheckpointRef: (
    input: CopyCheckpointRefInput,
  ) => Effect.Effect<boolean, CheckpointStoreError>;

  readonly hasCheckpointRef: (input: {
    readonly cwd: string;
    readonly checkpointRef: CheckpointRef;
  }) => Effect.Effect<boolean, CheckpointStoreError>;

  readonly diffCheckpoints: (
    input: DiffCheckpointsInput,
  ) => Effect.Effect<string, CheckpointStoreError>;

  readonly deleteCheckpointRefs: (
    input: DeleteCheckpointRefsInput,
  ) => Effect.Effect<void, CheckpointStoreError>;
}

export class CheckpointStore extends ServiceMap.Service<CheckpointStore, CheckpointStoreShape>()(
  "glade/checkpointing/Services/CheckpointStore",
) {}
