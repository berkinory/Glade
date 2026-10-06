import type {
  OrchestrationCheckpointSummary,
  OrchestrationProject,
  OrchestrationProjectShell,
  OrchestrationSpaceShell,
  OrchestrationThread,
  OrchestrationThreadShell,
  ThreadEnvironmentMode,
} from "@glade/contracts/orchestration/threadEntities";
import type {
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationThreadDetailSnapshot,
} from "@glade/contracts/orchestration/snapshots";
import type {
  CheckpointRef,
  ProjectId,
  SpaceId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import type { ProjectKind } from "@glade/contracts/workspace/project";
import { ServiceMap } from "effect";
import type { Effect, Option } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface OrchestrationThreadMentionContext {
  readonly id: ThreadId;
  readonly title: OrchestrationThread["title"];
  readonly modelSelection: OrchestrationThread["modelSelection"];

  readonly messages: OrchestrationThread["messages"];

  readonly totalMessageCount: number;
}

export interface ProjectionSnapshotCounts {
  readonly projectCount: number;
  readonly threadCount: number;
}

export interface ProjectionSnapshotSequence {
  readonly snapshotSequence: number;
}

export interface ProjectionThreadCheckpointContext {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly projectKind: ProjectKind;
  readonly workspaceRoot: string;
  readonly envMode: ThreadEnvironmentMode;
  readonly worktreePath: string | null;
  readonly workingDirectory: string | null;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
}

export interface ProjectionGeneratedImageActivityRecord {
  readonly kind: string;
  readonly payload: unknown;
}

export interface ProjectionFullThreadDiffContext {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly projectKind: ProjectKind;
  readonly workspaceRoot: string;
  readonly envMode: ThreadEnvironmentMode;
  readonly worktreePath: string | null;
  readonly workingDirectory: string | null;
  readonly latestCheckpointTurnCount: number;
  readonly baselineCheckpointRef: CheckpointRef | null;
  readonly toCheckpointRef: CheckpointRef | null;
}

// Soft-deleted threads are intentionally included because purge can be deferred while provider
// delivery is unresolved; their worktrees must remain eligible for snapshot and reclaim until the
// rows are removed.
export interface ProjectionManagedWorktreeThread {
  readonly id: ThreadId;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly worktreePath: string | null;
  readonly associatedWorktreePath: string | null;
}

export interface ProjectionSnapshotQueryShape {
  readonly getCommandReadModel: () => Effect.Effect<
    OrchestrationReadModel,
    ProjectionRepositoryError
  >;

  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;

  readonly getCounts: () => Effect.Effect<ProjectionSnapshotCounts, ProjectionRepositoryError>;

  readonly getSnapshotSequence: () => Effect.Effect<
    ProjectionSnapshotSequence,
    ProjectionRepositoryError
  >;

  readonly listStaleInFlightThreadIds: (input: {
    readonly updatedBefore: string;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<ThreadId>, ProjectionRepositoryError>;

  readonly listManagedWorktreeThreads: () => Effect.Effect<
    ReadonlyArray<ProjectionManagedWorktreeThread>,
    ProjectionRepositoryError
  >;

  readonly getShellSnapshot: () => Effect.Effect<
    OrchestrationShellSnapshot,
    ProjectionRepositoryError
  >;

  readonly getActiveProjectByWorkspaceRoot: (
    workspaceRoot: string,
  ) => Effect.Effect<Option.Option<OrchestrationProject>, ProjectionRepositoryError>;

  readonly getProjectShellById: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectionRepositoryError>;

  readonly getSpaceShellById: (
    spaceId: SpaceId,
  ) => Effect.Effect<Option.Option<OrchestrationSpaceShell>, ProjectionRepositoryError>;

  readonly getFirstActiveThreadIdByProjectId: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<ThreadId>, ProjectionRepositoryError>;

  readonly getThreadCheckpointContext: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProjectionThreadCheckpointContext>, ProjectionRepositoryError>;

  readonly listGeneratedImageActivitiesByTurn: (
    threadId: ThreadId,
    turnId: TurnId,
  ) => Effect.Effect<
    ReadonlyArray<ProjectionGeneratedImageActivityRecord>,
    ProjectionRepositoryError
  >;

  readonly getFullThreadDiffContext: (
    threadId: ThreadId,
    toTurnCount: number,
  ) => Effect.Effect<Option.Option<ProjectionFullThreadDiffContext>, ProjectionRepositoryError>;

  readonly getThreadShellById: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThreadShell>, ProjectionRepositoryError>;

  readonly getThreadShellsByIds: (
    threadIds: ReadonlyArray<ThreadId>,
  ) => Effect.Effect<ReadonlyArray<OrchestrationThreadShell>, ProjectionRepositoryError>;

  // Non-deleted child threads (archived included), matching the shell snapshot's visibility.
  readonly listChildThreadShells: (
    parentThreadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<OrchestrationThreadShell>, ProjectionRepositoryError>;

  readonly threadIdExistsIncludingDeleted: (
    threadId: ThreadId,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;

  readonly findSyntheticSubagentParentThread: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThreadShell>, ProjectionRepositoryError>;

  readonly getThreadDetailById: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThread>, ProjectionRepositoryError>;

  readonly getThreadMentionContextById: (
    threadId: ThreadId,
    options: { readonly messageLimit: number },
  ) => Effect.Effect<Option.Option<OrchestrationThreadMentionContext>, ProjectionRepositoryError>;

  readonly getThreadDetailForExportById: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThread>, ProjectionRepositoryError>;

  readonly getThreadDetailSnapshotById: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThreadDetailSnapshot>, ProjectionRepositoryError>;
}

export class ProjectionSnapshotQuery extends ServiceMap.Service<
  ProjectionSnapshotQuery,
  ProjectionSnapshotQueryShape
>()("glade/orchestration/Services/ProjectionSnapshotQuery") {}
