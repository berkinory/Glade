import { ProviderForkPoint } from "../provider/provider";
import { Schema } from "effect";
import {
  SpaceId,
  NonNegativeInt,
  IsoDateTime,
  ProjectId,
  TrimmedNonEmptyString,
  ThreadId,
  TurnId,
  MessageId,
  ApprovalRequestId,
  CheckpointRef,
  ProviderItemId,
  EventId,
  CommandId,
} from "../core/baseSchemas";
import { ProjectKind } from "../workspace/project";
import { AsyncUserInput, AsyncUserInputResponse } from "./asyncUserInput";
import { ProviderSkillReference, ProviderMentionReference } from "../provider/providerDiscovery";
import {
  SpaceName,
  SpaceIconName,
  SPACES_MAX_COUNT,
  ProjectScript,
  ThreadEnvironmentMode,
  OrchestrationThreadPullRequest,
  ThreadHandoff,
  ThreadPinnedMessages,
  ThreadNotes,
  PinnedMessage,
  PinnedMessageLabel,
  OrchestrationMessageRole,
  ChatAttachment,
  OrchestrationMessageSource,
  PendingClaudeCacheReview,
  ComputerControlMode,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  OrchestrationSession,
  OrchestrationCheckpointStatus,
  OrchestrationCheckpointFile,
  OrchestrationThreadActivity,
} from "./threadEntities";
import {
  ModelSelection,
  RuntimeMode,
  DEFAULT_RUNTIME_MODE,
  ThreadCreationSource,
  TurnDispatchMode,
  MessageDispatchOrigin,
  ProviderStartOptions,
  ProviderReviewTarget,
  AssistantDeliveryMode,
  DEFAULT_TURN_DISPATCH_MODE,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from "../provider/sessionPolicy";

export const OrchestrationEventType = Schema.Literals([
  "space.created",
  "space.meta-updated",
  "space.order-updated",
  "space.deleted",
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",

  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.pinned-message-added",
  "thread.pinned-message-removed",
  "thread.pinned-message-done-set",
  "thread.pinned-message-label-set",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.async-user-input-answered",
  "thread.turn-queued",
  "thread.turn-start-requested",
  "thread.claude-cache-set",
  "thread.claude-cache-response-requested",
  "thread.legacy-cache-abandoned",
  "thread.goal-continuation-requested",
  "thread.compact-requested",
  "thread.turn-interrupt-requested",
  "thread.task-stop-requested",
  "thread.task-background-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.conversation-rollback-requested",
  "thread.conversation-rolled-back",
  "thread.message-edit-resend-requested",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
]);

export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["space", "project", "thread"]);

export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;

export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const SpaceCreatedPayload = Schema.Struct({
  spaceId: SpaceId,
  name: SpaceName,
  icon: SpaceIconName,
  sortOrder: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SpaceMetaUpdatedPayload = Schema.Struct({
  spaceId: SpaceId,
  name: Schema.optional(SpaceName),
  icon: Schema.optional(SpaceIconName),
  updatedAt: IsoDateTime,
});

export const SpaceOrderUpdatedPayload = Schema.Struct({
  spaceId: SpaceId,
  orderedSpaceIds: Schema.Array(SpaceId).check(Schema.isMaxLength(SPACES_MAX_COUNT)),
  updatedAt: IsoDateTime,
});

export const SpaceDeletedPayload = Schema.Struct({
  spaceId: SpaceId,
  deletedAt: IsoDateTime,
});

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  kind: Schema.optional(ProjectKind).pipe(Schema.withDecodingDefault(() => "project")),
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  kind: Schema.optional(ProjectKind),
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  isPinned: Schema.optional(Schema.Boolean),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  forkPoint: Schema.optional(ProviderForkPoint),
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),

  envMode: Schema.optional(ThreadEnvironmentMode).pipe(Schema.withDecodingDefault(() => "local")),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  creationSource: Schema.optional(Schema.NullOr(ThreadCreationSource)),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  sourceTurnId: Schema.optional(Schema.NullOr(TurnId)),
  gatewayOperationId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  gatewayOperationIndex: Schema.optional(Schema.NullOr(NonNegativeInt)),
  subagentAgentId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentNickname: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  forkSourceThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  lastKnownPr: Schema.optional(Schema.NullOr(OrchestrationThreadPullRequest)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  handoff: Schema.NullOr(ThreadHandoff).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,

  archivedAt: Schema.optional(IsoDateTime),
  updatedAt: Schema.optional(IsoDateTime),
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,

  unarchivedAt: Schema.optional(IsoDateTime),

  updatedAt: Schema.optional(IsoDateTime),
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  titleSource: Schema.optional(Schema.Literals(["user", "provider"])),
  modelSelection: Schema.optional(ModelSelection),
  envMode: Schema.optional(ThreadEnvironmentMode),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean),
  isPinned: Schema.optional(Schema.Boolean),
  settledAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  subagentAgentId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  subagentNickname: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  subagentRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  handoff: Schema.optional(Schema.NullOr(ThreadHandoff)),
  lastKnownPr: Schema.optional(Schema.NullOr(OrchestrationThreadPullRequest)),
  pinnedMessages: Schema.optional(ThreadPinnedMessages),
  notes: Schema.optional(ThreadNotes),

  updatedAt: IsoDateTime,
});

export const ThreadPinnedMessageAddedPayload = Schema.Struct({
  threadId: ThreadId,
  pin: PinnedMessage,
  updatedAt: IsoDateTime,
});

export const ThreadPinnedMessageRemovedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  updatedAt: IsoDateTime,
});

export const ThreadPinnedMessageDoneSetPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  done: Schema.Boolean,
  updatedAt: IsoDateTime,
});

export const ThreadPinnedMessageLabelSetPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  label: Schema.NullOr(PinnedMessageLabel),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  providerMessageId: Schema.optional(TrimmedNonEmptyString),
  asyncUserInput: Schema.optional(AsyncUserInput),
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,

  segmentStartedAt: Schema.optional(IsoDateTime),
  segmentSequence: Schema.optional(NonNegativeInt),
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  skills: Schema.optional(Schema.Array(ProviderSkillReference)),
  mentions: Schema.optional(Schema.Array(ProviderMentionReference)),
  dispatchMode: Schema.optional(TurnDispatchMode),
  dispatchOrigin: Schema.optional(MessageDispatchOrigin),
  startsNewTurn: Schema.optional(Schema.Boolean),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  source: OrchestrationMessageSource.pipe(Schema.withDecodingDefault(() => "native")),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadAsyncUserInputAnsweredPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  response: AsyncUserInputResponse,
});

export const ThreadClaudeCacheSetPayload = Schema.Struct({
  threadId: ThreadId,
  review: Schema.NullOr(PendingClaudeCacheReview),
  updatedAt: IsoDateTime,
});

export const ThreadClaudeCacheResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  review: PendingClaudeCacheReview,
  decision: Schema.Literals(["continue", "compact", "cancel"]),
  createdAt: IsoDateTime,
});

export const ThreadLegacyCacheAbandonedPayload = Schema.Struct({
  threadId: ThreadId,
  reviewId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  enableComputerControl: Schema.optional(Schema.Boolean),
  computerControlMode: Schema.optional(ComputerControlMode),
  computerControlGeneration: Schema.optional(NonNegativeInt),
  reviewTarget: Schema.optional(ProviderReviewTarget),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  dispatchMode: TurnDispatchMode.pipe(Schema.withDecodingDefault(() => DEFAULT_TURN_DISPATCH_MODE)),
  dispatchOrigin: Schema.optional(MessageDispatchOrigin),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),

  createdAt: IsoDateTime,
});

export const ThreadTurnQueuedPayload = ThreadTurnStartRequestedPayload;

const LegacyGoalContinuationPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadTaskStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  taskId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const ThreadTaskBackgroundRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  toolUseId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  scope: Schema.optional(Schema.Literals(["thread", "files"])).pipe(
    Schema.withDecodingDefault(() => "thread"),
  ),
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadConversationRollbackRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  numTurns: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadConversationRolledBackPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  numTurns: NonNegativeInt,
  removedTurnIds: Schema.optional(Schema.Array(TurnId)),
  skipAttachmentPrune: Schema.optional(Schema.Boolean),
  replacementText: Schema.optional(Schema.String),
});

export const ThreadMessageEditResendRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  rollbackTurnCount: Schema.optional(NonNegativeInt),
  removedTurnIds: Schema.optional(Schema.Array(TurnId)),
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  enableComputerControl: Schema.optional(Schema.Boolean),
  computerControlMode: Schema.optional(ComputerControlMode),
  computerControlGeneration: Schema.optional(NonNegativeInt),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode,

  createdAt: IsoDateTime,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
  preserveLatestTurn: Schema.optional(Schema.Boolean),
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});

export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([SpaceId, ProjectId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("space.created"),
    payload: SpaceCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("space.meta-updated"),
    payload: SpaceMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("space.order-updated"),
    payload: SpaceOrderUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("space.deleted"),
    payload: SpaceDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pinned-message-added"),
    payload: ThreadPinnedMessageAddedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pinned-message-removed"),
    payload: ThreadPinnedMessageRemovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pinned-message-done-set"),
    payload: ThreadPinnedMessageDoneSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pinned-message-label-set"),
    payload: ThreadPinnedMessageLabelSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: Schema.Struct({ threadId: ThreadId, updatedAt: IsoDateTime }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.async-user-input-answered"),
    payload: ThreadAsyncUserInputAnsweredPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.claude-cache-set"),
    payload: ThreadClaudeCacheSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.claude-cache-response-requested"),
    payload: ThreadClaudeCacheResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.legacy-cache-abandoned"),
    payload: ThreadLegacyCacheAbandonedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-queued"),
    payload: ThreadTurnQueuedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.goal-continuation-requested"),
    payload: LegacyGoalContinuationPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.compact-requested"),
    payload: Schema.Struct({
      threadId: ThreadId,
      instructions: Schema.optional(TrimmedNonEmptyString),
      createdAt: IsoDateTime,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.task-stop-requested"),
    payload: ThreadTaskStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.task-background-requested"),
    payload: ThreadTaskBackgroundRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.conversation-rollback-requested"),
    payload: ThreadConversationRollbackRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.conversation-rolled-back"),
    payload: ThreadConversationRolledBackPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-edit-resend-requested"),
    payload: ThreadMessageEditResendRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),

  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: Schema.Struct({ threadId: ThreadId }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
]);

export type OrchestrationEvent = typeof OrchestrationEvent.Type;
