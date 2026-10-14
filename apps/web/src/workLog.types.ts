import type { VisualReply } from "@glade/contracts/orchestration/visualReply";
import type { ToolLifecycleItemType } from "@glade/contracts/provider/runtimeMetadata";
import type { ProviderFailureKind } from "@glade/contracts/provider/providerFailure";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import type {
  HandoffStrategy,
  HandoffTransitionStage,
} from "@glade/contracts/orchestration/threadEntities";
import type { CommandId, ProviderKind, TurnId } from "@glade/contracts/core/baseSchemas";
import type { ApprovalRequestKind } from "@glade/shared/threads/threadSummary";
import type { GladeMcpToolStatus } from "./lib/gatewayToolCall";
import type { WorkLogToolDetails } from "./lib/toolCallDetails";
import type { ChatMessage } from "./types";

type WorkLogRequestKind = ApprovalRequestKind;

export // Mirrors CHECKPOINT_REVERT_FAILED_ACTIVITY_KIND in
// apps/server/src/orchestration/commandInvariants.ts, which the web app cannot import.
const CHECKPOINT_REVERT_FAILED_ACTIVITY_KIND = "checkpoint.revert.failed";

export const PROVIDER_CONTEXT_LIFECYCLE_ACTIVITY_KIND = "provider.context.changed";

export const SESSION_CONTEXT_RECAP_PREVIEW_MAX_CHARS = 600;

export type ProviderContextLifecycleReason =
  | "conversation-rebuilt"
  | "fresh-session"
  | "interrupt-escalation"
  | "native-history-unavailable"
  | "native-resume-failed";

export interface ProviderContextLifecycleInfo {
  provider: ProviderKind;
  nativeHistory: "available" | "unavailable";
  restartReason: ProviderContextLifecycleReason;
  sessionRestarted: boolean;
  recapInjected: boolean;
  recapCharacters: number;
  recapPreview: string | null;
  recapPreviewTruncated: boolean;
}

export type WorkLogToolKind =
  | "command"
  | "read"
  | "list"
  | "search"
  | "edit"
  | "fetch"
  | "web_search"
  | "browser"
  | "computer"
  | "agent"
  | "image_view"
  | "image_generation"
  | "mcp"
  | "tool";

export interface WorkLogEntry {
  id: string;
  createdAt: string;

  sequence?: number;
  turnId?: TurnId | null;
  label: string;
  detail?: string;
  command?: string;
  rawCommand?: string;
  preview?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  toolName?: string;
  mcpService?: string;
  toolCallId?: string;
  toolStatus?: GladeMcpToolStatus;
  liveActivity?: WorkLogLiveActivity;
  toolDetails?: WorkLogToolDetails;
  itemType?: ToolLifecycleItemType;
  requestKind?: WorkLogRequestKind;
  toolKind?: WorkLogToolKind;
  subagents?: ReadonlyArray<WorkLogSubagent>;
  subagentAction?: WorkLogSubagentAction;
  // Set on the one transcript entry that stands in for a batch of subagent launches.
  subagentRun?: WorkLogSubagentRun;
  gladeThreadCreation?: WorkLogGladeThreadCreation;
  visualReply?: VisualReply;
  // Durable provider failure of this entry's turn; session readiness never clears it.
  turnFailure?: { message: string };
  // Marks where a stopped turn ended; the transcript folds it into that turn's header.
  turnStopped?: true;
  // An answered agent question with the user's answers; it stays visible outside a settled turn's fold.
  userInputExchange?: ReadonlyArray<WorkLogUserInputExchangeItem>;
  // How many times in a row the same command ran; the entry shows the latest run.
  repeatCount?: number;
  // Set on the tool call that started background work, such as a test run left running.
  backgroundTask?: WorkLogBackgroundTask;
  // Consecutive retries of one provider request, oldest first.
  requestRetries?: ReadonlyArray<WorkLogRequestRetry>;
  // A provider thinking block: still streaming while live, and how long it took once known.
  reasoning?: { live: boolean; durationMs?: number };
  // A Claude Monitor update that woke the agent; it marks where the reply it prompted starts.
  monitorNotification?: WorkLogMonitorNotification;

  providerContextLifecycle?: ProviderContextLifecycleInfo;
  providerTransition?: {
    operationId: CommandId;
    source: { provider: ProviderKind };
    destination: { provider: ProviderKind };
    stage: HandoffTransitionStage;
    strategy?: HandoffStrategy | undefined;
  };

  replySource?: { threadId: string; nickname: string };

  activityKind?: OrchestrationThreadActivity["kind"];

  nativeEventType?: string;
}

export interface WorkLogBackgroundTask {
  taskId: string;
  // The tool call that started it, when the provider reports one.
  toolUseId: string | null;
  description: string;
  status: "running" | "completed" | "failed" | "stopped";
  // The turn that started it, when the provider reports one.
  turnId: TurnId | null;
  startedAt: string;
  settledAt: string | null;
}

export interface WorkLogRequestRetry {
  reason: ProviderFailureKind;
  // Null when the request failed without a response, such as a dropped connection.
  httpStatus: number | null;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
}

export interface WorkLogMonitorNotification {
  name: string;
  output: string;
  outcome: "updated" | "completed" | "failed" | "stopped";
  // Arrived while its turn was already working: an update inside that reply, not the wake-up that
  // started one.
  midTurn?: true;
}

export interface WorkLogUserInputExchangeItem {
  id: string;
  question: string;
  answer: string | null;
}

export type WorkLogLiveActivityState =
  | "starting"
  | "thinking"
  | "running_tool"
  | "waiting"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkLogLiveActivity {
  state: WorkLogLiveActivityState;
  label: string;
  startedAt?: string;
  lastActivityAt: string;
  detail?: string;
  progress?: number;
  elapsedSeconds?: number;
}

export interface WorkLogGladeCreatedThread {
  threadId: string;
  title: string;
  provider: ProviderKind;
  model: string;
  environment: "local" | "worktree";
  status: string;
}

export interface WorkLogGladeThreadCreation {
  operationId: string;
  requestedCount: number;
  createdCount: number;
  threads: ReadonlyArray<WorkLogGladeCreatedThread>;
}

export interface WorkLogSubagent {
  threadId: string;
  providerThreadId?: string | undefined;
  resolvedThreadId?: string | undefined;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  modelIsRequestedHint?: boolean | undefined;
  effort?: string | undefined;
  background?: boolean | undefined;
  prompt?: string | undefined;
  rawStatus?: string | undefined;
  latestUpdate?: string | undefined;
  title?: string | undefined;
  statusLabel?: string | undefined;
  isActive?: boolean | undefined;
  lastCompletedAt?: string | undefined;
  hasPendingInteraction?: boolean | undefined;
}

export interface WorkLogSubagentAction {
  tool: string;
  status: string;
  summaryText: string;
  model?: string | undefined;
  prompt?: string | undefined;
}

export interface WorkLogSubagentUsage {
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
}

export interface WorkLogSubagentRunMember {
  subagent: WorkLogSubagent;
  launchedAt: string;
  settledAt?: string;
  usage?: WorkLogSubagentUsage;
}

export interface WorkLogSubagentRun {
  members: ReadonlyArray<WorkLogSubagentRunMember>;
}

export interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
  collapseCommand?: string;
  toolName?: string;
  runtimeWarningRepeatCount?: number;
  runtimeWarningMessage?: string;
  suppressStandaloneCommandStart?: boolean;
}

export function isFileChangeWorkLogEntry(
  workEntry: Pick<WorkLogEntry, "itemType" | "requestKind">,
): boolean {
  return workEntry.requestKind === "file-change" || workEntry.itemType === "file_change";
}

export function isProviderFileEditWorkLogEntry(
  workEntry: Pick<WorkLogEntry, "changedFiles" | "itemType" | "requestKind">,
): boolean {
  if (workEntry.itemType === "file_change") {
    return true;
  }
  return workEntry.requestKind === "file-change" && (workEntry.changedFiles?.length ?? 0) > 0;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "message-segment";
      createdAt: string;
      sequence: number;
      message: ChatMessage;
      segmentIndex: number;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      sequence?: number;
      entry: WorkLogEntry;
    };
