import { WorkspaceRestoreConfirmation } from "./workspaceRestore";
import { Schema, Struct } from "effect";
import {
  CommandId,
  SpaceId,
  IsoDateTime,
  ProjectId,
  TrimmedNonEmptyString,
  ThreadId,
  TurnId,
  NonNegativeInt,
  MessageId,
  ApprovalRequestId,
  CheckpointRef,
} from "../core/baseSchemas";
import { ProjectKind } from "../workspace/project";
import { AsyncUserInputResponse, AsyncUserInputQuestions } from "./asyncUserInput";
import { ProviderSkillReference, ProviderMentionReference } from "../provider/providerDiscovery";
import {
  SpaceName,
  SpaceIconName,
  SPACES_MAX_COUNT,
  SPACE_PROJECTS_ASSIGN_MAX_COUNT,
  ThreadEnvironmentMode,
  OrchestrationThreadPullRequest,
  ThreadHandoff,
  ThreadPinnedMessages,
  ThreadNotes,
  PinnedMessageLabel,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ChatAttachmentList,
  TurnMessageContentCheck,
  ComputerControlMode,
  UploadChatAttachmentList,
  OrchestrationSession,
  OrchestrationThreadActivity,
  OrchestrationSessionStatus,
  OrchestrationCheckpointStatus,
  OrchestrationCheckpointFile,
} from "./threadEntities";
import {
  ModelSelection,
  RuntimeMode,
  ThreadCreationSource,
  ProviderStartOptions,
  ProviderReviewTarget,
  AssistantDeliveryMode,
  TurnDispatchMode,
  DEFAULT_TURN_DISPATCH_MODE,
  MessageDispatchOrigin,
  DEFAULT_RUNTIME_MODE,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from "../provider/sessionPolicy";

export const SpaceCreateCommand = Schema.Struct({
  type: Schema.Literal("space.create"),
  commandId: CommandId,
  spaceId: SpaceId,
  name: SpaceName,
  icon: SpaceIconName,
  createdAt: IsoDateTime,
});

export const SpaceMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("space.meta.update"),
  commandId: CommandId,
  spaceId: SpaceId,
  name: Schema.optional(SpaceName),
  icon: Schema.optional(SpaceIconName),
});

export const SpaceReorderCommand = Schema.Struct({
  type: Schema.Literal("space.reorder"),
  commandId: CommandId,
  spaceId: SpaceId,
  orderedSpaceIds: Schema.Array(SpaceId).check(Schema.isMaxLength(SPACES_MAX_COUNT)),
});

export const SpaceDeleteCommand = Schema.Struct({
  type: Schema.Literal("space.delete"),
  commandId: CommandId,
  spaceId: SpaceId,
});

export const SpaceProjectsAssignCommand = Schema.Struct({
  type: Schema.Literal("space.projects.assign"),
  commandId: CommandId,
  spaceId: SpaceId,
  projectIds: Schema.Array(ProjectId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SPACE_PROJECTS_ASSIGN_MAX_COUNT),
  ),
});

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  kind: Schema.optional(ProjectKind).pipe(Schema.withDecodingDefault(() => "project")),
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,

  preserveExistingProject: Schema.optional(Schema.Boolean),
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),

  spaceId: Schema.optional(Schema.NullOr(SpaceId)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  kind: Schema.optional(ProjectKind),
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  isPinned: Schema.optional(Schema.Boolean),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,

  envMode: Schema.optional(ThreadEnvironmentMode).pipe(Schema.withDecodingDefault(() => "local")),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  creationSource: Schema.optional(ThreadCreationSource),
  sourceThreadId: Schema.optional(ThreadId),
  sourceTurnId: Schema.optional(TurnId),
  gatewayOperationId: Schema.optional(TrimmedNonEmptyString),
  gatewayOperationIndex: Schema.optional(NonNegativeInt),
  subagentAgentId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentNickname: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  lastKnownPr: Schema.optional(Schema.NullOr(OrchestrationThreadPullRequest)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdAt: IsoDateTime,
});

const ThreadHandoffStartCommand = Schema.Struct({
  type: Schema.Literal("thread.handoff.start"),
  commandId: CommandId,
  threadId: ThreadId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  continuationGoal: Schema.optional(Schema.String),
  sourceGeneration: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createdAt: IsoDateTime,
});

const ThreadForkCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.fork.create"),
  commandId: CommandId,
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,

  envMode: Schema.optional(ThreadEnvironmentMode).pipe(Schema.withDecodingDefault(() => "local")),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  forkMessageId: MessageId,
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  titleSource: Schema.optional(Schema.Literals(["user", "provider", "auto"])),

  expectedTitleSequence: Schema.optional(NonNegativeInt),
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

  isSettled: Schema.optional(Schema.Boolean),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  subagentAgentId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  subagentNickname: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  subagentRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  handoff: Schema.optional(Schema.NullOr(ThreadHandoff)),
  lastKnownPr: Schema.optional(Schema.NullOr(OrchestrationThreadPullRequest)),
  pinnedMessages: Schema.optional(ThreadPinnedMessages),
  notes: Schema.optional(ThreadNotes),
  expectedHandoffOperationId: Schema.optional(CommandId),
});

const ThreadPinnedMessageAddCommand = Schema.Struct({
  type: Schema.Literal("thread.pinned-message.add"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
});

const ThreadPinnedMessageRemoveCommand = Schema.Struct({
  type: Schema.Literal("thread.pinned-message.remove"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
});

const ThreadPinnedMessageLabelSetCommand = Schema.Struct({
  type: Schema.Literal("thread.pinned-message.label.set"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  label: Schema.NullOr(PinnedMessageLabel),
});

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  asyncUserInputResponse: Schema.optional(AsyncUserInputResponse),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
    attachments: ChatAttachmentList,
    skills: Schema.optional(Schema.Array(ProviderSkillReference)),
    mentions: Schema.optional(Schema.Array(ProviderMentionReference)),
  }).check(TurnMessageContentCheck),
  handoffOperationId: Schema.optional(CommandId),
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  enableComputerControl: Schema.optional(Schema.Boolean),
  computerControlMode: Schema.optional(ComputerControlMode),
  computerControlGeneration: Schema.optional(NonNegativeInt),
  reviewTarget: Schema.optional(ProviderReviewTarget),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  dispatchMode: Schema.optional(TurnDispatchMode).pipe(
    Schema.withDecodingDefault(() => DEFAULT_TURN_DISPATCH_MODE),
  ),
  // Set by the server when it dispatches a turn. Clients cannot set it:
  // ClientThreadTurnStartCommand omits the field, so decoding strips any spoofed value.
  dispatchOrigin: Schema.optional(MessageDispatchOrigin),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),

  // Clients cannot set it: ClientThreadTurnStartCommand omits the field, so decoding strips a spoofed
  // value.
  resumePrecondition: Schema.optional(
    Schema.Struct({
      recordedTurnId: Schema.NullOr(TurnId),
      recordedAt: IsoDateTime,
    }),
  ),
  createdAt: IsoDateTime,
});

export const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  asyncUserInputResponse: Schema.optional(AsyncUserInputResponse),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
    attachments: UploadChatAttachmentList,
    skills: Schema.optional(Schema.Array(ProviderSkillReference)),
    mentions: Schema.optional(Schema.Array(ProviderMentionReference)),
  }).check(TurnMessageContentCheck),
  handoffOperationId: Schema.optional(CommandId),
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  enableComputerControl: Schema.optional(Schema.Boolean),
  computerControlMode: Schema.optional(ComputerControlMode),
  computerControlGeneration: Schema.optional(NonNegativeInt),
  reviewTarget: Schema.optional(ProviderReviewTarget),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  dispatchMode: Schema.optional(TurnDispatchMode).pipe(
    Schema.withDecodingDefault(() => DEFAULT_TURN_DISPATCH_MODE),
  ),
  runtimeMode: RuntimeMode,

  createdAt: IsoDateTime,
});

const ThreadLegacyCacheAbandonCommand = Schema.Struct({
  type: Schema.Literal("thread.legacy-cache.abandon"),
  commandId: CommandId,
  threadId: ThreadId,
  reviewId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const ThreadCompactCommand = Schema.Struct({
  type: Schema.Literal("thread.compact"),
  commandId: CommandId,
  threadId: ThreadId,
  instructions: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadTaskStopCommand = Schema.Struct({
  type: Schema.Literal("thread.task.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  taskId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const ThreadTaskBackgroundCommand = Schema.Struct({
  type: Schema.Literal("thread.task.background"),
  commandId: CommandId,
  threadId: ThreadId,
  toolUseId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const ThreadDispatchQueuedTurnCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.dispatch-queued"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  enableComputerControl: Schema.optional(Schema.Boolean),
  computerControlMode: Schema.optional(ComputerControlMode),
  computerControlGeneration: Schema.optional(NonNegativeInt),
  reviewTarget: Schema.optional(ProviderReviewTarget),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  dispatchMode: Schema.optional(TurnDispatchMode).pipe(
    Schema.withDecodingDefault(() => DEFAULT_TURN_DISPATCH_MODE),
  ),
  dispatchOrigin: Schema.optional(MessageDispatchOrigin),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),

  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  workspaceRestore: Schema.optional(WorkspaceRestoreConfirmation),
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  scope: Schema.optional(Schema.Literals(["thread", "files"])),
  createdAt: IsoDateTime,
});

const ThreadConversationRollbackCommand = Schema.Struct({
  type: Schema.Literal("thread.conversation.rollback"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  numTurns: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadMessageEditAndResendCommand = Schema.Struct({
  workspaceRestore: Schema.optional(WorkspaceRestoreConfirmation),
  type: Schema.Literal("thread.message.edit-and-resend"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  enableComputerControl: Schema.optional(Schema.Boolean),
  computerControlMode: Schema.optional(ComputerControlMode),
  computerControlGeneration: Schema.optional(NonNegativeInt),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode,

  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  requireUnarchived: Schema.optional(Schema.Boolean),
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  SpaceCreateCommand,
  SpaceMetaUpdateCommand,
  SpaceReorderCommand,
  SpaceDeleteCommand,
  SpaceProjectsAssignCommand,
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadHandoffStartCommand,
  ThreadForkCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadPinnedMessageAddCommand,
  ThreadPinnedMessageRemoveCommand,
  ThreadPinnedMessageLabelSetCommand,
  ThreadRuntimeModeSetCommand,

  ThreadTurnStartCommand,
  ThreadLegacyCacheAbandonCommand,
  ThreadCompactCommand,
  ThreadTurnInterruptCommand,
  ThreadTaskStopCommand,
  ThreadTaskBackgroundCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadMessageEditAndResendCommand,
  ThreadActivityAppendCommand,
  ThreadSessionStopCommand,
]);

export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  SpaceCreateCommand,
  SpaceMetaUpdateCommand,
  SpaceReorderCommand,
  SpaceDeleteCommand,
  SpaceProjectsAssignCommand,
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadHandoffStartCommand.mapFields(Struct.omit(["sourceGeneration"])),
  ThreadForkCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand.mapFields(Struct.omit(["handoff", "expectedHandoffOperationId"])),
  ThreadPinnedMessageAddCommand,
  ThreadPinnedMessageRemoveCommand,
  ThreadPinnedMessageLabelSetCommand,
  ThreadRuntimeModeSetCommand,

  ClientThreadTurnStartCommand,
  ThreadLegacyCacheAbandonCommand,
  ThreadCompactCommand,
  ThreadTurnInterruptCommand,
  ThreadTaskStopCommand,
  ThreadTaskBackgroundCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadMessageEditAndResendCommand,
  ThreadActivityAppendCommand,
  ThreadSessionStopCommand,
]);

export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  expectedSessionStatus: Schema.optional(OrchestrationSessionStatus),
  expectedSessionUpdatedAt: Schema.optional(IsoDateTime),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),

  segmentStartedAt: Schema.optional(IsoDateTime),
  segmentSequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  providerMessageId: Schema.optional(TrimmedNonEmptyString),
  asyncQuestions: Schema.optional(AsyncUserInputQuestions),
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageUserBindTurnCommand = Schema.Struct({
  type: Schema.Literal("thread.message.user.bind-turn"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: TurnId,
  createdAt: IsoDateTime,
});

const ThreadMessageUserSetTurnBoundaryCommand = Schema.Struct({
  type: Schema.Literal("thread.message.user.set-turn-boundary"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  startsNewTurn: Schema.Boolean,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  preserveLatestTurn: Schema.optional(Schema.Boolean),
  checkpointRevertTurnCount: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadConversationRollbackCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.conversation.rollback.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  numTurns: NonNegativeInt,
  removedTurnIds: Schema.optional(Schema.Array(TurnId)),
  skipAttachmentPrune: Schema.optional(Schema.Boolean),
  replacementText: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,

  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadMessageUserBindTurnCommand,
  ThreadMessageUserSetTurnBoundaryCommand,

  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
  ThreadConversationRollbackCommand,
  ThreadConversationRollbackCompleteCommand,
  ThreadDispatchQueuedTurnCommand,
]);

export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);

export type OrchestrationCommand = typeof OrchestrationCommand.Type;
