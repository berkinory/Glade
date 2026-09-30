import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadCreationSource,
} from "@glade/contracts/provider/sessionPolicy";
import type {
  ChatImageAttachment as ContractChatImageAttachment,
  ChatFileAttachment as ContractChatFileAttachment,
  ChatAssistantSelectionAttachment as ContractChatAssistantSelectionAttachment,
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationPendingInteraction,
  OrchestrationLatestTurn,
  OrchestrationThreadPullRequest,
  PinnedMessage,
  PendingClaudeCacheReview,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  OrchestrationSpaceShell,
  ThreadHandoff,
  ProjectScript as ContractProjectScript,
  ThreadEnvironmentMode,
} from "@glade/contracts/orchestration/threadEntities";
import type {
  ThreadId,
  ProjectId,
  SpaceId,
  TurnId,
  MessageId,
  ProviderKind,
  CheckpointRef,
} from "@glade/contracts/core/baseSchemas";
import type { ProjectKind } from "@glade/contracts/workspace/project";
import type { ProjectAppearance } from "./lib/projectAppearance";

type MutableContractFields<T> = {
  -readonly [Key in keyof T]: NonNullable<T[Key]> extends readonly (infer Item)[]
    ? Item[] | Extract<T[Key], null | undefined>
    : T[Key];
};

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "default";
export const MAX_TERMINALS_PER_GROUP = 6;
export type ThreadTerminalPresentationMode = "drawer" | "workspace";
export type ThreadTerminalWorkspaceTab = "terminal" | "chat";
export type ThreadTerminalWorkspaceLayout = "both" | "terminal-only";
export type ThreadPrimarySurface = "chat" | "terminal";
export type ProjectScript = ContractProjectScript;

export type ThreadTerminalSplitDirection = "horizontal" | "vertical";
export type ThreadTerminalSplitPosition = "top" | "right" | "bottom" | "left";

interface ThreadTerminalLeafNode {
  type: "terminal";
  paneId: string;
  terminalIds: string[];
  activeTerminalId: string;
}

export interface ThreadTerminalSplitNode {
  type: "split";
  id: string;
  direction: ThreadTerminalSplitDirection;
  children: ThreadTerminalLayoutNode[];
  weights: number[];
}

export type ThreadTerminalLayoutNode = ThreadTerminalLeafNode | ThreadTerminalSplitNode;

export interface ThreadTerminalGroup {
  id: string;
  activeTerminalId: string;
  layout: ThreadTerminalLayoutNode;
}

export type ChatImageAttachment = MutableContractFields<ContractChatImageAttachment> & {
  previewUrl?: string;
};
export type ChatFileAttachment = MutableContractFields<ContractChatFileAttachment>;
export type ChatAssistantSelectionAttachment = MutableContractFields<
  Omit<ContractChatAssistantSelectionAttachment, "assistantMessageId">
> & { assistantMessageId: string };

export type ChatAttachment =
  | ChatImageAttachment
  | ChatFileAttachment
  | ChatAssistantSelectionAttachment;

export type ChatMessage = MutableContractFields<
  Omit<OrchestrationMessage, "attachments" | "turnId" | "source" | "updatedAt">
> &
  Partial<MutableContractFields<Pick<OrchestrationMessage, "turnId" | "source" | "updatedAt">>> & {
    attachments?: ChatAttachment[];
    completedAt?: string | undefined;
  };

interface TurnDiffFileChange {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TurnDiffSummary {
  turnId: TurnId;
  completedAt: string;
  status?: string | undefined;
  files: TurnDiffFileChange[];
  checkpointRef?: CheckpointRef | undefined;
  assistantMessageId?: MessageId | undefined;
  checkpointTurnCount?: number | undefined;
  checkpointTurnCounts?: number[] | undefined;
}

export type WorktreeSetupStepId =
  | "create-branch"
  | "create-worktree"
  | "copy-changes"
  | "prepare-thread"
  | "run-setup-action"
  | "start-session";
type WorktreeSetupStepStatus = "pending" | "active" | "done" | "error";

export interface WorktreeSetupStep {
  id: WorktreeSetupStepId;
  label: string;
  status: WorktreeSetupStepStatus;
}

export interface WorktreeSetupSnapshot {
  steps: WorktreeSetupStep[];
}

export type WorktreeSetupResolutionAction = "cancel" | "work-locally";

export interface Project {
  id: ProjectId;
  kind: ProjectKind;
  name: string;
  remoteName: string;
  folderName: string;
  localName: string | null;

  appearance?: ProjectAppearance | null;
  cwd: string;
  defaultModelSelection: ModelSelection | null;
  expanded: boolean;
  isPinned?: boolean;

  spaceId?: SpaceId | null;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  scripts: ProjectScript[];
}

export type Space = OrchestrationSpaceShell;

interface ThreadWorkspaceState {
  envMode?: ThreadEnvironmentMode | undefined;
  branch: string | null;
  worktreePath: string | null;
  workingDirectory?: string | null;
  associatedWorktreePath?: string | null;
  associatedWorktreeBranch?: string | null;
  associatedWorktreeRef?: string | null;
  createBranchFlowCompleted?: boolean;
}

export type ThreadWorkspacePatch = Partial<ThreadWorkspaceState>;

export interface Thread
  extends
    ThreadWorkspaceState,
    MutableContractFields<
      Pick<
        OrchestrationThread,
        | "id"
        | "projectId"
        | "title"
        | "modelSelection"
        | "runtimeMode"
        | "interactionMode"
        | "createdAt"
        | "latestTurn"
      >
    > {
  codexThreadId: string | null;
  session: ThreadSession | null;
  messages: ChatMessage[];

  error: string | null;
  archivedAt?: string | null;
  settledAt?: string | null;
  updatedAt?: string | undefined;
  isPinned?: boolean;
  pinnedMessages?: PinnedMessage[];
  notes?: string;

  lastVisitedAt?: string | undefined;
  parentThreadId?: ThreadId | null;
  creationSource?: ThreadCreationSource | null;
  sourceThreadId?: ThreadId | null;
  subagentAgentId?: string | null;
  subagentNickname?: string | null;
  subagentRole?: string | null;
  forkSourceThreadId?: ThreadId | null;
  handoff?: ThreadHandoff | null;
  claudeCacheReview?: PendingClaudeCacheReview | null;

  claudeCacheReviewSequence?: number;
  lastKnownPr?: OrchestrationThreadPullRequest | null;
  latestUserMessageAt?: string | null;
  latestHumanMessageAt?: string | null;
  hasPendingApprovals?: boolean;
  hasPendingUserInput?: boolean;

  pendingInteractions?: OrchestrationPendingInteraction[];
  turnDiffSummaries: TurnDiffSummary[];
  activities: OrchestrationThreadActivity[];
}

export type ThreadShell = Omit<
  Thread,
  "session" | "messages" | "latestTurn" | "turnDiffSummaries" | "activities"
>;

export interface ThreadTurnState {
  latestTurn: OrchestrationLatestTurn | null;
}

export interface SidebarThreadSummary {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  modelSelection: ModelSelection;
  interactionMode: ProviderInteractionMode;
  envMode?: ThreadEnvironmentMode | undefined;
  branch: string | null;
  worktreePath: string | null;
  workingDirectory?: string | null;
  associatedWorktreePath?: string | null;
  associatedWorktreeBranch?: string | null;
  associatedWorktreeRef?: string | null;
  session: ThreadSession | null;
  createdAt: string;
  archivedAt?: string | null;
  settledAt?: string | null;
  updatedAt?: string | undefined;
  isPinned?: boolean;
  latestTurn: OrchestrationLatestTurn | null;
  lastVisitedAt?: string | undefined;
  parentThreadId?: ThreadId | null;
  creationSource?: ThreadCreationSource | null;
  subagentAgentId?: string | null;
  subagentNickname?: string | null;
  subagentRole?: string | null;
  latestUserMessageAt: string | null;
  latestHumanMessageAt?: string | null;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;

  hasLiveTailWork: boolean;
  forkSourceThreadId?: ThreadId | null;
  handoff?: ThreadHandoff | null;
  lastKnownPr?: OrchestrationThreadPullRequest | null;
}

export interface ComposerThreadMentionSource {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  provider: ProviderKind;
  createdAt: string;
  archivedAt?: string | null;
  lastVisitedAt?: string | undefined;
  latestUserMessageAt: string | null;
}

export interface ThreadSession {
  provider: ProviderKind;
  status: SessionPhase | "error" | "closed";
  activeTurnId?: TurnId | undefined;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  orchestrationStatus: OrchestrationSessionStatus;
}
