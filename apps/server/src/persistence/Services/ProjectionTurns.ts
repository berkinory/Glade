import {
  CheckpointRef,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import {
  OrchestrationProposedPlanId,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
} from "@glade/contracts/orchestration/orchestration";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTurnState = Schema.Literals([
  "pending",
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type ProjectionTurnState = typeof ProjectionTurnState.Type;

export const ProjectionTurn = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  pendingMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  assistantMessageId: Schema.NullOr(MessageId),
  state: ProjectionTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  checkpointTurnCount: Schema.NullOr(NonNegativeInt),
  checkpointRef: Schema.NullOr(CheckpointRef),
  checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
  checkpointFiles: Schema.Array(OrchestrationCheckpointFile),
});
export type ProjectionTurn = typeof ProjectionTurn.Type;

export const ProjectionTurnById = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  pendingMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  assistantMessageId: Schema.NullOr(MessageId),
  state: ProjectionTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  checkpointTurnCount: Schema.NullOr(NonNegativeInt),
  checkpointRef: Schema.NullOr(CheckpointRef),
  checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
  checkpointFiles: Schema.Array(OrchestrationCheckpointFile),
});
export type ProjectionTurnById = typeof ProjectionTurnById.Type;

export const ProjectionPendingTurnStart = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  requestedAt: IsoDateTime,
});
export type ProjectionPendingTurnStart = typeof ProjectionPendingTurnStart.Type;

export const ListProjectionTurnsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionTurnsByThreadInput = typeof ListProjectionTurnsByThreadInput.Type;

export const GetProjectionTurnByTurnIdInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
});
export type GetProjectionTurnByTurnIdInput = typeof GetProjectionTurnByTurnIdInput.Type;

interface ProjectionTurnWaitSnapshot {
  readonly existingThreadIds: ReadonlyArray<GetProjectionTurnByTurnIdInput["threadId"]>;
  readonly turns: ReadonlyArray<{
    readonly threadId: GetProjectionTurnByTurnIdInput["threadId"];
    readonly turnId: GetProjectionTurnByTurnIdInput["turnId"];
    readonly state: ProjectionTurnState;
  }>;
}

export const GetProjectionPendingTurnStartInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionPendingTurnStartInput = typeof GetProjectionPendingTurnStartInput.Type;

export const DeleteProjectionTurnsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionTurnsByThreadInput = typeof DeleteProjectionTurnsByThreadInput.Type;

export const ClearCheckpointTurnConflictInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
});
export type ClearCheckpointTurnConflictInput = typeof ClearCheckpointTurnConflictInput.Type;

export interface ProjectionTurnRepositoryShape {
  readonly upsertByTurnId: (
    row: ProjectionTurnById,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly replacePendingTurnStart: (
    row: ProjectionPendingTurnStart,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getPendingTurnStartByThreadId: (
    input: GetProjectionPendingTurnStartInput,
  ) => Effect.Effect<Option.Option<ProjectionPendingTurnStart>, ProjectionRepositoryError>;

  readonly deletePendingTurnStartByThreadId: (
    input: GetProjectionPendingTurnStartInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listByThreadId: (
    input: ListProjectionTurnsByThreadInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTurn>, ProjectionRepositoryError>;

  readonly getByTurnId: (
    input: GetProjectionTurnByTurnIdInput,
  ) => Effect.Effect<Option.Option<ProjectionTurnById>, ProjectionRepositoryError>;

  readonly getManyByTurnId: (
    input: ReadonlyArray<GetProjectionTurnByTurnIdInput>,
  ) => Effect.Effect<ReadonlyArray<ProjectionTurnById>, ProjectionRepositoryError>;

  readonly getManyWaitSnapshot: (input: {
    readonly threadIds: ReadonlyArray<GetProjectionTurnByTurnIdInput["threadId"]>;
    readonly turns: ReadonlyArray<GetProjectionTurnByTurnIdInput>;
  }) => Effect.Effect<ProjectionTurnWaitSnapshot, ProjectionRepositoryError>;

  readonly clearCheckpointTurnConflict: (
    input: ClearCheckpointTurnConflictInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly deleteByThreadId: (
    input: DeleteProjectionTurnsByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionTurnRepository extends ServiceMap.Service<
  ProjectionTurnRepository,
  ProjectionTurnRepositoryShape
>()("glade/persistence/Services/ProjectionTurns/ProjectionTurnRepository") {}
