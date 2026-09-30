import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import {
  ModelSelection,
  RuntimeMode,
  ThreadCreationSource,
} from "@glade/contracts/provider/sessionPolicy";
import {
  OrchestrationThreadPullRequest,
  PendingClaudeCacheReview,
  ThreadNotes,
  ThreadPinnedMessages,
  ThreadHandoff,
  ThreadEnvironmentMode,
} from "@glade/contracts/orchestration/threadEntities";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThread = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,

  envMode: ThreadEnvironmentMode,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  workingDirectory: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  associatedWorktreePath: Schema.NullOr(Schema.String),
  associatedWorktreeBranch: Schema.NullOr(Schema.String),
  associatedWorktreeRef: Schema.NullOr(Schema.String),
  createBranchFlowCompleted: Schema.Boolean,
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  creationSource: Schema.optional(Schema.NullOr(ThreadCreationSource)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  sourceTurnId: Schema.optional(Schema.NullOr(TurnId)).pipe(Schema.withDecodingDefault(() => null)),
  gatewayOperationId: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  gatewayOperationIndex: Schema.optional(Schema.NullOr(NonNegativeInt)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentAgentId: Schema.optional(Schema.NullOr(Schema.String)),
  subagentNickname: Schema.optional(Schema.NullOr(Schema.String)),
  subagentRole: Schema.optional(Schema.NullOr(Schema.String)),
  forkSourceThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  lastKnownPr: Schema.NullOr(OrchestrationThreadPullRequest),
  latestTurnId: Schema.NullOr(TurnId),
  handoff: Schema.NullOr(ThreadHandoff),

  claudeCacheReview: Schema.optional(Schema.NullOr(PendingClaudeCacheReview)),
  pinnedMessages: Schema.NullOr(ThreadPinnedMessages),
  notes: Schema.NullOr(ThreadNotes),

  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  latestHumanMessageAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  pendingApprovalCount: NonNegativeInt,
  pendingUserInputCount: NonNegativeInt,

  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.optional(Schema.NullOr(IsoDateTime)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  settledAt: Schema.optional(Schema.NullOr(IsoDateTime)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionThread = typeof ProjectionThread.Type;

export const GetProjectionThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionThreadInput = typeof GetProjectionThreadInput.Type;

export const DeleteProjectionThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadInput = typeof DeleteProjectionThreadInput.Type;

export const ListProjectionThreadsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionThreadsByProjectInput = typeof ListProjectionThreadsByProjectInput.Type;

export interface ProjectionThreadRepositoryShape {
  readonly upsert: (thread: ProjectionThread) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: GetProjectionThreadInput,
  ) => Effect.Effect<Option.Option<ProjectionThread>, ProjectionRepositoryError>;

  readonly listByProjectId: (
    input: ListProjectionThreadsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThread>, ProjectionRepositoryError>;

  readonly deleteById: (
    input: DeleteProjectionThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadRepository extends ServiceMap.Service<
  ProjectionThreadRepository,
  ProjectionThreadRepositoryShape
>()("glade/persistence/Services/ProjectionThreads/ProjectionThreadRepository") {}
