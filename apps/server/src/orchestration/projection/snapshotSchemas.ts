import { Schema, Struct } from "effect";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import {
  ProjectScript,
  ThreadHandoff,
  PendingClaudeCacheReview,
  OrchestrationThreadPullRequest,
  ThreadPinnedMessages,
  OrchestrationPendingInteraction,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  ThreadEnvironmentMode,
} from "@glade/contracts/orchestration/threadEntities";
import { ProjectionThreadProposedPlan } from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import {
  NonNegativeInt,
  TurnId,
  IsoDateTime,
  MessageId,
  ThreadId,
  ProjectId,
  SpaceId,
  CheckpointRef,
} from "@glade/contracts/core/baseSchemas";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionCheckpoint } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectKind } from "@glade/contracts/workspace/project";
import { ProjectionSpace } from "../../persistence/Services/ProjectionSpaces.ts";
import { ModelSelection } from "@glade/contracts/provider/sessionPolicy";

const ModelSelectionJsonUnknown = Schema.fromJsonString(Schema.Unknown);

export const MAX_THREAD_MESSAGES = 2_000;

export const MAX_SNAPSHOT_THREAD_ACTIVITIES = 500;

export const MAX_THREAD_DETAIL_ACTIVITIES = 2_000;

export const MAX_TURN_GENERATED_IMAGE_ACTIVITY_RECORDS = 64;

export const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(ModelSelectionJsonUnknown),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    isPinned: Schema.Number,
  }),
);

export const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan;

export const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    createBranchFlowCompleted: Schema.Number,
    isPinned: Schema.Number,
    handoff: Schema.NullOr(Schema.fromJsonString(ThreadHandoff)),
    claudeCacheReview: Schema.optional(
      Schema.NullOr(Schema.fromJsonString(PendingClaudeCacheReview)),
    ),
    lastKnownPr: Schema.NullOr(Schema.fromJsonString(OrchestrationThreadPullRequest)),
    pinnedMessages: Schema.NullOr(Schema.fromJsonString(ThreadPinnedMessages)),

    modelSelection: ModelSelectionJsonUnknown,
  }),
);

const {
  pinnedMessages: _projectionThreadPinnedMessagesField,
  notes: _projectionThreadNotesField,

  ...ProjectionThreadShellFields
} = ProjectionThread.fields;

export const ProjectionThreadShellDbRowSchema = Schema.Struct(
  ProjectionThreadShellFields,
).mapFields(
  Struct.assign({
    createBranchFlowCompleted: Schema.Number,
    isPinned: Schema.Number,
    handoff: Schema.NullOr(Schema.fromJsonString(ThreadHandoff)),
    claudeCacheReview: Schema.optional(
      Schema.NullOr(Schema.fromJsonString(PendingClaudeCacheReview)),
    ),
    lastKnownPr: Schema.NullOr(Schema.fromJsonString(OrchestrationThreadPullRequest)),
    modelSelection: ModelSelectionJsonUnknown,
  }),
);

export const ProjectionManagedWorktreeThreadRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  archivedAt: ProjectionThread.fields.archivedAt,
  deletedAt: ProjectionThread.fields.deletedAt,
  worktreePath: ProjectionThread.fields.worktreePath,
  associatedWorktreePath: ProjectionThread.fields.associatedWorktreePath,
});

export const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);

export type PendingInteractionRow = typeof OrchestrationPendingInteraction.Type;

export const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;

export const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);

export const ProjectionGeneratedImageActivityDbRowSchema = Schema.Struct({
  kind: Schema.String,
  payload: Schema.fromJsonString(Schema.Unknown),
});

export const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  historyUpdatedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
});

export const ProjectionStateDbRowSchema = ProjectionState;

export const ProjectionCountsRowSchema = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});

export const EmptyProjectShellRepairRowSchema = Schema.Struct({
  required: Schema.Number,
});

export const WorkspaceRootLookupInput = Schema.Struct({
  workspaceRoot: Schema.String,
});

export const ProjectIdLookupInput = Schema.Struct({
  projectId: ProjectId,
});

export const SpaceIdLookupInput = Schema.Struct({
  spaceId: SpaceId,
});

export const ThreadIdLookupInput = Schema.Struct({
  threadId: ThreadId,
});

export const StaleInFlightThreadLookupInput = Schema.Struct({
  updatedBefore: IsoDateTime,
  limit: Schema.Number,
});

export const ThreadTurnLookupInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
});

export const ThreadMessagesByThreadLookupInput = Schema.Struct({
  threadId: ThreadId,
  maxMessages: Schema.NullOr(Schema.Number),
});

export const SyntheticSubagentParentLookupInput = Schema.Struct({
  threadId: ThreadId,
});

export const FullThreadDiffContextLookupInput = Schema.Struct({
  threadId: ThreadId,
  checkpointTurnCount: NonNegativeInt,
});

export const ProjectionThreadIdLookupRowSchema = Schema.Struct({
  threadId: ThreadId,
});

export const ProjectionThreadCheckpointContextThreadRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  projectKind: ProjectKind.pipe(Schema.withDecodingDefault(() => "project")),
  workspaceRoot: Schema.String,
  envMode: ThreadEnvironmentMode,
  worktreePath: Schema.NullOr(Schema.String),
  workingDirectory: Schema.NullOr(Schema.String),
});

export const ProjectionFullThreadDiffContextRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  projectKind: ProjectKind.pipe(Schema.withDecodingDefault(() => "project")),
  workspaceRoot: Schema.String,
  envMode: ThreadEnvironmentMode,
  worktreePath: Schema.NullOr(Schema.String),
  workingDirectory: Schema.NullOr(Schema.String),
  latestCheckpointTurnCount: Schema.NullOr(NonNegativeInt),
  baselineCheckpointRef: Schema.NullOr(CheckpointRef),
  toCheckpointRef: Schema.NullOr(CheckpointRef),
});

export type ProjectionThreadDbRowRaw = Schema.Schema.Type<typeof ProjectionThreadDbRowSchema>;

export type ProjectionThreadShellDbRowRaw = Schema.Schema.Type<
  typeof ProjectionThreadShellDbRowSchema
>;

export type ProjectionProjectDbRowRaw = Schema.Schema.Type<typeof ProjectionProjectDbRowSchema>;

export type ProjectionSpaceDbRow = Schema.Schema.Type<typeof ProjectionSpace>;

export type ProjectionThreadDbRow = Omit<ProjectionThreadDbRowRaw, "modelSelection"> & {
  readonly modelSelection: typeof ModelSelection.Type;
};

export type ProjectionThreadShellDbRow = Omit<ProjectionThreadShellDbRowRaw, "modelSelection"> & {
  readonly modelSelection: typeof ModelSelection.Type;
};

export type ProjectionProjectDbRow = Omit<ProjectionProjectDbRowRaw, "defaultModelSelection"> & {
  readonly defaultModelSelection: typeof ModelSelection.Type | null;
};

export type ProjectionThreadProposedPlanDbRow = Schema.Schema.Type<
  typeof ProjectionThreadProposedPlanDbRowSchema
>;

export type ProjectionThreadActivityDbRow = Schema.Schema.Type<
  typeof ProjectionThreadActivityDbRowSchema
>;

export type ProjectionCheckpointDbRow = Schema.Schema.Type<typeof ProjectionCheckpointDbRowSchema>;

export type ProjectionLatestTurnDbRow = Schema.Schema.Type<typeof ProjectionLatestTurnDbRowSchema>;

export type ProjectionThreadSessionDbRow = Schema.Schema.Type<
  typeof ProjectionThreadSessionDbRowSchema
>;

export type ProjectionStateDbRow = Schema.Schema.Type<typeof ProjectionStateDbRowSchema>;
