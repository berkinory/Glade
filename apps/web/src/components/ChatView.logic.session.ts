import { ProjectId, type ThreadId as ThreadIdType } from "@glade/contracts/core/baseSchemas";
import type {
  ModelSelection,
  ProviderApprovalDecision,
  ProviderRequestKind,
  RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";
import { approvalSessionGrantWidensSessionPolicy } from "@glade/shared/threads/approvalSessionGrant";
import type { ChatMessage, Thread, ThreadPrimarySurface } from "../types";
import { Schema } from "effect";
import { deriveDisplayedUserMessageState } from "../lib/terminalContext";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "glade:last-invoked-script-by-project";

export const DISMISSED_PROVIDER_HEALTH_BANNERS_KEY = "glade:dismissed-provider-health-banners";

const PROMPT_HISTORY_MAX_ENTRIES = 100;

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export const DismissedProviderHealthBannersSchema = Schema.Array(Schema.String);

export function canApplyComposerFocus(input: {
  readonly windowHasFocus: boolean;
  readonly secondaryChromeReady: boolean;
  readonly editorAvailable: boolean;
  readonly editorDisabled: boolean;
}): boolean {
  return (
    input.windowHasFocus &&
    input.secondaryChromeReady &&
    input.editorAvailable &&
    !input.editorDisabled
  );
}

export interface PendingFileUndo {
  readonly threadId: ThreadIdType;

  readonly turnCounts: readonly number[];
  readonly existingFailureActivityIds: readonly string[];
}

export function hasFileUndoSettled(input: {
  readonly pending: PendingFileUndo;
  readonly thread: Pick<Thread, "id" | "turnDiffSummaries" | "activities"> | null;
}): boolean {
  if (!input.thread || input.thread.id !== input.pending.threadId) {
    return false;
  }

  const targetTurnCounts = new Set(input.pending.turnCounts);
  const targetSummaries = input.thread.turnDiffSummaries.filter(
    (summary) =>
      summary.checkpointTurnCount !== undefined &&
      targetTurnCounts.has(summary.checkpointTurnCount),
  );
  if (
    targetSummaries.length > 0 &&
    targetSummaries.every((summary) => summary.files.length === 0)
  ) {
    return true;
  }

  const existingFailureActivityIdSet = new Set(input.pending.existingFailureActivityIds);
  return input.thread.activities.some((activity) => {
    if (
      activity.kind !== "checkpoint.revert.failed" ||
      existingFailureActivityIdSet.has(activity.id) ||
      typeof activity.payload !== "object" ||
      activity.payload === null ||
      !("turnCount" in activity.payload) ||
      typeof activity.payload.turnCount !== "number"
    ) {
      return false;
    }
    return targetTurnCounts.has(activity.payload.turnCount);
  });
}

// Because the client is the source of truth for runtime mode (it sends it with every turn), a
// supervised thread must also flip to full-access so the choice survives idle-stop and runtime
// restarts.
export function resolveRuntimeModeAfterApprovalDecision(
  currentRuntimeMode: RuntimeMode,
  decision: ProviderApprovalDecision,
  requestKind?: ProviderRequestKind,
): RuntimeMode | null {
  if (!approvalSessionGrantWidensSessionPolicy(requestKind)) {
    return null;
  }
  if (decision === "acceptForSession" && currentRuntimeMode === "approval-required") {
    return "full-access";
  }
  return null;
}

export async function commitAfterRuntimeModePersistence(input: {
  currentRuntimeMode: RuntimeMode;
  nextRuntimeMode: RuntimeMode;
  persistRuntimeMode: (mode: RuntimeMode) => Promise<boolean>;
  commit: () => void;
}): Promise<boolean> {
  if (
    input.nextRuntimeMode !== input.currentRuntimeMode &&
    !(await input.persistRuntimeMode(input.nextRuntimeMode))
  ) {
    return false;
  }
  input.commit();
  return true;
}

export interface RuntimeModePersistenceQueue {
  syncAcknowledgedMode: (mode: RuntimeMode) => void;
  persist: (
    mode: RuntimeMode,
    operation: (currentMode: RuntimeMode, nextMode: RuntimeMode) => Promise<boolean>,
  ) => Promise<boolean>;
}

// Equality is checked only when a queued choice starts, after earlier choices have settled, so Auto
// → Full access → Auto cannot drop the final Auto choice against a stale render.
export function createRuntimeModePersistenceQueue(
  initialMode: RuntimeMode,
): RuntimeModePersistenceQueue {
  let acknowledgedMode = initialMode;
  let pendingCount = 0;
  let tail: Promise<void> = Promise.resolve();

  return {
    syncAcknowledgedMode(mode) {
      if (pendingCount === 0) {
        acknowledgedMode = mode;
      }
    },
    persist(mode, operation) {
      pendingCount += 1;
      const result = tail.then(async () => {
        if (mode === acknowledgedMode) {
          return true;
        }
        const persisted = await operation(acknowledgedMode, mode);
        if (persisted) {
          acknowledgedMode = mode;
        }
        return persisted;
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result.finally(() => {
        pendingCount -= 1;
      });
    },
  };
}

function modelSelectionsEqual(left: ModelSelection, right: ModelSelection): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    JSON.stringify(left.options ?? null) === JSON.stringify(right.options ?? null) &&
    (left.provider !== "claudeAgent" ||
      right.provider !== "claudeAgent" ||
      left.supportsAutoMode === right.supportsAutoMode)
  );
}

export async function persistModelSelectionBeforeRuntimeMode(input: {
  currentModelSelection: ModelSelection;
  nextModelSelection?: ModelSelection;
  currentRuntimeMode: RuntimeMode;
  nextRuntimeMode: RuntimeMode;
  persistModelSelection: (selection: ModelSelection) => Promise<unknown>;
  persistRuntimeMode: (mode: RuntimeMode) => Promise<unknown>;
}): Promise<void> {
  const nextModelSelection = input.nextModelSelection;
  const modelChanged =
    nextModelSelection !== undefined &&
    !modelSelectionsEqual(input.currentModelSelection, nextModelSelection);
  const runtimeChanged = input.currentRuntimeMode !== input.nextRuntimeMode;
  const downgradesFromAuto =
    input.currentRuntimeMode === "auto" && input.nextRuntimeMode !== "auto";

  if (runtimeChanged && downgradesFromAuto) {
    await input.persistRuntimeMode(input.nextRuntimeMode);
  }
  if (modelChanged && nextModelSelection !== undefined) {
    await input.persistModelSelection(nextModelSelection);
  }
  if (runtimeChanged && !downgradesFromAuto) {
    await input.persistRuntimeMode(input.nextRuntimeMode);
  }
}

export function shouldRenderProviderHealthBanner(input: {
  threadEntryPoint: ThreadPrimarySurface;
  terminalWorkspaceTerminalTabActive: boolean;
}): boolean {
  return input.threadEntryPoint === "chat" && !input.terminalWorkspaceTerminalTabActive;
}

export function shouldEnableComposerPastedTextCollapse(input: {
  isComposerApprovalState: boolean;
  hasPendingUserInput: boolean;
}): boolean {
  return !input.isComposerApprovalState && !input.hasPendingUserInput;
}

export function buildTranscriptAutoFollowSignal(input: {
  readonly messageCount: number;
  readonly tailKey: string;
}): string {
  return `${input.messageCount}\u001f${input.tailKey}`;
}

export function buildTranscriptTailKey(
  tailMessage: {
    readonly id: string;
    readonly role: string;
    readonly streaming?: boolean;
    readonly text: string;
    readonly completedAt?: string | null | undefined;
  } | null,
): string {
  if (tailMessage === null) {
    return "empty";
  }
  return [
    tailMessage.id,
    tailMessage.role,
    tailMessage.streaming ? "streaming" : "settled",

    tailMessage.streaming
      ? tailMessage.text.length > 0
        ? "content"
        : "empty"
      : String(tailMessage.text.length),
    tailMessage.completedAt ?? "",
  ].join(":");
}

export function resolveThreadArtifactWorkspaceRoot(input: {
  readonly projectCwd: string | null;
  readonly threadWorkspaceCwd: string | null;
}): string | null {
  if (input.threadWorkspaceCwd) {
    return input.threadWorkspaceCwd;
  }
  return input.projectCwd;
}

export interface PromptHistoryNavigationState {
  index: number;
  draft: string;
}

export type PromptHistoryDirection = "older" | "newer";

export interface PromptHistoryNavigationResult {
  handled: boolean;
  prompt: string;
  expandedCursor: number;
  state: PromptHistoryNavigationState | null;
}

export function derivePromptHistoryFromMessages(
  messages: ReadonlyArray<Pick<ChatMessage, "id" | "role" | "source" | "text">>,
  limit: number = PROMPT_HISTORY_MAX_ENTRIES,
): string[] {
  if (limit <= 0) {
    return [];
  }
  const history: string[] = [];
  for (let index = messages.length - 1; index >= 0 && history.length < limit; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user" || (message.source ?? "native") !== "native") {
      continue;
    }
    const prompt = deriveDisplayedUserMessageState(message.text, {
      hideImageOnlyBootstrapPrompt: true,
      messageId: message.id,
    }).copyText.trim();
    if (prompt.length === 0) {
      continue;
    }
    history.push(prompt);
  }
  return history;
}

export function promptStillMatchesActiveHistoryBrowse(input: {
  state: PromptHistoryNavigationState | null;
  history: readonly string[];
  nextPrompt: string;
  appliedPrompt: string | null;
}): boolean {
  if (input.state === null) {
    return false;
  }
  const activeEntry = input.history[input.state.index] ?? null;
  return input.nextPrompt === activeEntry || input.nextPrompt === input.appliedPrompt;
}

export function shouldHandlePromptHistoryNavigationKey(input: {
  key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Slash";
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  menuIsActive: boolean;
  hasActivePendingProgress: boolean;
  isComposerApprovalState: boolean;
  pendingUserInputCount: number;
}): boolean {
  return (
    (input.key === "ArrowUp" || input.key === "ArrowDown") &&
    !input.metaKey &&
    !input.ctrlKey &&
    !input.altKey &&
    !input.shiftKey &&
    !input.menuIsActive &&
    !input.hasActivePendingProgress &&
    !input.isComposerApprovalState &&
    input.pendingUserInputCount === 0
  );
}

function isComposerCursorOnFirstLine(prompt: string, expandedCursor: number): boolean {
  const boundedCursor = Math.max(0, Math.min(prompt.length, expandedCursor));
  const firstLineEnd = prompt.indexOf("\n");
  return firstLineEnd < 0 || boundedCursor <= firstLineEnd;
}

function isComposerCursorOnLastLine(prompt: string, expandedCursor: number): boolean {
  const boundedCursor = Math.max(0, Math.min(prompt.length, expandedCursor));
  const lastLineStart = prompt.lastIndexOf("\n") + 1;
  return boundedCursor >= lastLineStart;
}

function expandedCursorForPromptHistoryItem(
  prompt: string,
  direction: PromptHistoryDirection,
): number {
  if (direction === "older") {
    const firstLineEnd = prompt.indexOf("\n");
    return firstLineEnd < 0 ? prompt.length : firstLineEnd;
  }
  return prompt.length;
}

export function resolvePromptHistoryNavigation(input: {
  direction: PromptHistoryDirection;
  history: readonly string[];
  currentPrompt: string;
  currentExpandedCursor: number;
  selectionCollapsed: boolean;
  state: PromptHistoryNavigationState | null;
}): PromptHistoryNavigationResult {
  const notHandled = (
    state: PromptHistoryNavigationState | null,
  ): PromptHistoryNavigationResult => ({
    handled: false,
    prompt: input.currentPrompt,
    expandedCursor: input.currentExpandedCursor,
    state,
  });
  if (!input.selectionCollapsed || input.history.length === 0) {
    return notHandled(input.state);
  }

  const activeEntry = input.state ? input.history[input.state.index] : undefined;
  const stateIsStale =
    input.state !== null && (activeEntry === undefined || input.currentPrompt !== activeEntry);

  if (input.direction === "older") {
    if (!isComposerCursorOnFirstLine(input.currentPrompt, input.currentExpandedCursor)) {
      return notHandled(input.state);
    }
    const nextState: PromptHistoryNavigationState =
      input.state === null
        ? { index: 0, draft: input.currentPrompt }
        : stateIsStale
          ? { index: 0, draft: input.state.draft }
          : {
              ...input.state,
              index: Math.min(input.state.index + 1, input.history.length - 1),
            };
    const nextPrompt = input.history[nextState.index] ?? input.currentPrompt;
    return {
      handled: true,
      prompt: nextPrompt,
      expandedCursor: expandedCursorForPromptHistoryItem(nextPrompt, "older"),
      state: nextState,
    };
  }

  if (!input.state) {
    return notHandled(null);
  }
  const cursorCanNavigateNewer =
    isComposerCursorOnLastLine(input.currentPrompt, input.currentExpandedCursor) ||
    isComposerCursorOnFirstLine(input.currentPrompt, input.currentExpandedCursor);
  if (!cursorCanNavigateNewer) {
    return notHandled(input.state);
  }
  if (stateIsStale) {
    return {
      handled: true,
      prompt: input.state.draft,
      expandedCursor: input.state.draft.length,
      state: null,
    };
  }
  if (input.state.index > 0) {
    const nextState = {
      ...input.state,
      index: input.state.index - 1,
    };
    const nextPrompt = input.history[nextState.index] ?? input.currentPrompt;
    return {
      handled: true,
      prompt: nextPrompt,
      expandedCursor: expandedCursorForPromptHistoryItem(nextPrompt, "newer"),
      state: nextState,
    };
  }

  return {
    handled: true,
    prompt: input.state.draft,
    expandedCursor: input.state.draft.length,
    state: null,
  };
}

export function resolveDefaultEnvironmentPanelOpen(input: {
  environmentEnabled: boolean;
  isCenteredEmptyLanding: boolean;
  isTerminalPrimarySurface: boolean;
  isConstrainedChatLayout: boolean;
  settingsDefaultOpen?: boolean;
}): boolean {
  const settingsDefaultOpen = input.settingsDefaultOpen ?? false;
  return (
    input.environmentEnabled &&
    settingsDefaultOpen &&
    !input.isCenteredEmptyLanding &&
    !input.isTerminalPrimarySurface &&
    !input.isConstrainedChatLayout
  );
}
