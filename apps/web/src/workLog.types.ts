import type {
  ComputerPermission,
  ComputerBuildSignature,
} from "@glade/contracts/computer/computer";
import type { ToolLifecycleItemType } from "@glade/contracts/provider/runtimeMetadata";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import type { ProviderKind, TurnId } from "@glade/contracts/core/baseSchemas";
import type { ApprovalRequestKind } from "@glade/shared/threads/threadSummary";
import type { GladeMcpToolStatus } from "./lib/toolCallLabel.descriptors";
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

interface WorkLogComputerSetupRequired {
  missing: readonly ComputerPermission[];
  // Only an `adhoc` build gets the stale-grant explanation, because only there can System Settings
  // show the switch on while the grant does not apply.
  buildSignature?: ComputerBuildSignature;

  bundleId?: string;
}

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
  toolCallId?: string;
  toolStatus?: GladeMcpToolStatus;
  liveActivity?: WorkLogLiveActivity;
  toolDetails?: WorkLogToolDetails;
  itemType?: ToolLifecycleItemType;
  requestKind?: WorkLogRequestKind;
  subagents?: ReadonlyArray<WorkLogSubagent>;
  subagentAction?: WorkLogSubagentAction;
  automation?: WorkLogAutomation;
  gladeThreadCreation?: WorkLogGladeThreadCreation;

  computerControlDenied?: WorkLogComputerControlDenied;
  computerSetupRequired?: WorkLogComputerSetupRequired;
  providerContextLifecycle?: ProviderContextLifecycleInfo;

  activityKind?: OrchestrationThreadActivity["kind"];

  nativeEventType?: string;
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

export interface WorkLogAutomation {
  id: string;
  name: string;
  cadenceLabel: string;
  proposalState?: "pending" | "accepted" | "dismissed";
}

interface WorkLogComputerControlDenied {
  toolName: string | null;
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
  effort?: string | undefined;
  background?: boolean | undefined;
  prompt?: string | undefined;
  rawStatus?: string | undefined;
  latestUpdate?: string | undefined;
  title?: string | undefined;
  statusLabel?: string | undefined;
  isActive?: boolean | undefined;
}

export interface WorkLogSubagentAction {
  tool: string;
  status: string;
  summaryText: string;
  model?: string | undefined;
  prompt?: string | undefined;
}

export interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
  collapseCommand?: string;
  toolName?: string;
  runtimeWarningRepeatCount?: number;
  runtimeWarningMessage?: string;
  suppressStandaloneCommandStart?: boolean;
  taskListHasTasks?: boolean;
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
