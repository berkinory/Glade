import { PROVIDER_DEFAULT_MODEL, type ModelSlug } from "@glade/contracts/provider/model";
import { ThreadId, type ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import type { GitWorktreeSetupPhase } from "@glade/contracts/git/git";
import type { ServerProviderAuthStatus } from "@glade/contracts/server/server";
import { normalizeModelSlug } from "@glade/shared/provider/model";
import { isGenericChatThreadTitle } from "@glade/shared/threads/chatThreads";
import type { ChatMessage, Thread, TurnDiffSummary, WorktreeSetupStepId } from "../types";
import type { DraftThreadState } from "../composerDraftDomain";
import { isProviderFileEditWorkLogEntry, type WorkLogEntry } from "../workLog.types";
import { buildModelSelection, type ProviderModelOption } from "../providerModelOptions";

export function resolveCycledModelSlug(input: {
  currentModel: string;
  options: ReadonlyArray<{ slug: string }>;
  favoriteSlugs?: ReadonlyArray<string>;
  direction: "next" | "previous";
}): string | null {
  const optionSlugs = new Set(
    input.options.map((option) => option.slug.trim()).filter((slug) => slug.length > 0),
  );
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (slug: string) => {
    const trimmed = slug.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };
  for (const favorite of input.favoriteSlugs ?? []) {
    if (optionSlugs.has(favorite.trim())) {
      push(favorite);
    }
  }
  for (const option of input.options) {
    push(option.slug);
  }
  if (ordered.length < 2) {
    return null;
  }
  const currentIndex = ordered.indexOf(input.currentModel.trim());
  if (currentIndex < 0) {
    return input.direction === "next" ? (ordered[0] ?? null) : (ordered.at(-1) ?? null);
  }
  const delta = input.direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + delta + ordered.length) % ordered.length;
  return ordered[nextIndex] ?? null;
}

export function resolveEnvironmentPanelOpen(input: {
  defaultOpen: boolean;
  userPreferenceOpen: boolean | null;
}): boolean {
  return input.userPreferenceOpen ?? input.defaultOpen;
}

export function resolveEnvironmentPanelPreferenceUpdate(input: {
  open: boolean;
  persist: boolean;
}): {
  userPreferenceOpen: boolean;
  settingsDefaultOpen: boolean | null;
} {
  return {
    userPreferenceOpen: input.open,
    settingsDefaultOpen: input.persist ? input.open : null,
  };
}

export function resolveEnvironmentPanelPreferenceAfterFirstSend(input: {
  isCenteredEmptyLanding: boolean;
  settingsDefaultOpen: boolean;
  currentPreferenceOpen: boolean | null;
}): boolean | null {
  if (!input.isCenteredEmptyLanding) {
    return input.currentPreferenceOpen;
  }
  return input.settingsDefaultOpen ? null : false;
}

export function resolveEnvironmentPanelVisible(input: {
  environmentEnabled: boolean;
  environmentPanelOpen: boolean;
}): boolean {
  return input.environmentEnabled && input.environmentPanelOpen;
}

export function resolveGitRepoUiState(input: { queriedIsRepo: boolean | undefined }): boolean {
  return input.queriedIsRepo ?? true;
}

export interface SettledThreadBranchMismatch {
  readonly threadBranch: string;
  readonly currentBranch: string;
}

export function resolveSettledThreadBranchMismatch(input: {
  isSettled: boolean;
  isLocalWorkspace: boolean;
  threadBranch: string | null | undefined;
  currentBranch: string | null | undefined;
}): SettledThreadBranchMismatch | null {
  if (!input.isSettled || !input.isLocalWorkspace) {
    return null;
  }

  const threadBranch = input.threadBranch?.trim() ?? "";
  const currentBranch = input.currentBranch?.trim() ?? "";
  if (!threadBranch || !currentBranch || threadBranch === currentBranch) {
    return null;
  }

  return { threadBranch, currentBranch };
}

// The composer live strip prefers the turn's computed diff (the `thread.turn-diff-completed` event)
// so it can show real per-file +/- stats. Before that lands, it falls back to mid-turn file-edit
// work-log activity so the strip can appear while the turn is running, but without a reviewable
// turn id. Once a turn diff exists, its empty file list is authoritative and must not be
// overwritten by tool metadata.
export function resolveActiveTurnLiveDiffState(input: {
  latestTurnId: TurnDiffSummary["turnId"] | null | undefined;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  workLogEntries?: ReadonlyArray<
    Pick<WorkLogEntry, "changedFiles" | "itemType" | "requestKind" | "turnId"> &
      Partial<Pick<WorkLogEntry, "tone">>
  >;
}): {
  turnId: TurnDiffSummary["turnId"] | null;
  fileCount: number | null;
  additions: number;
  deletions: number;
  hasChanges: boolean;
} {
  const summary = input.latestTurnId
    ? (input.turnDiffSummaries.find((entry) => entry.turnId === input.latestTurnId) ?? null)
    : null;
  const files = summary?.files ?? [];
  const hasToolWork = input.workLogEntries?.some(
    (entry) => entry.turnId === input.latestTurnId && entry.tone === "tool",
  );
  if (summary && files.length > 0 && hasToolWork) {
    return {
      turnId: summary.turnId,
      fileCount: files.length,
      additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
      deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
      hasChanges: true,
    };
  }
  if (summary) {
    return {
      turnId: null,
      fileCount: 0,
      additions: 0,
      deletions: 0,
      hasChanges: false,
    };
  }

  const workLogFilePaths = new Set<string>();
  let hasFileEditWork = false;
  if (input.latestTurnId) {
    for (const entry of input.workLogEntries ?? []) {
      if (entry.turnId !== input.latestTurnId || !isProviderFileEditWorkLogEntry(entry)) {
        continue;
      }
      hasFileEditWork = true;
      for (const filePath of entry.changedFiles ?? []) {
        workLogFilePaths.add(filePath);
      }
    }
  }

  if (hasFileEditWork && input.latestTurnId) {
    return {
      turnId: null,
      fileCount: workLogFilePaths.size > 0 ? workLogFilePaths.size : null,
      additions: 0,
      deletions: 0,
      hasChanges: true,
    };
  }

  return {
    turnId: null,
    fileCount: 0,
    additions: 0,
    deletions: 0,
    hasChanges: false,
  };
}

export type ThreadDetailHydration = "ready" | "loading" | "failed";

// A server thread's shell row alone cannot distinguish "no messages" from "history not loaded yet",
// so an empty timeline only counts as a genuine empty landing once the detail snapshot has been
// applied.
export function resolveThreadDetailHydration(input: {
  readonly isServerThread: boolean;
  readonly hasTimelineEntries: boolean;
  readonly detailSyncState: "synced" | "failed" | null;
}): ThreadDetailHydration {
  if (!input.isServerThread || input.hasTimelineEntries || input.detailSyncState === "synced") {
    return "ready";
  }
  return input.detailSyncState === "failed" ? "failed" : "loading";
}

// An explicit project default wins; otherwise the user's default provider is used then codex. The
// model comes from the project default only when it matches the chosen provider, otherwise the
// provider's own default.
export function resolveDraftFallbackModelSelection(input: {
  projectDefault: ModelSelection | null | undefined;
  settingsDefaultProvider: ProviderKind;
}): ModelSelection {
  const provider = input.projectDefault?.provider ?? input.settingsDefaultProvider;
  const model =
    (provider === input.projectDefault?.provider ? input.projectDefault.model : null) ??
    PROVIDER_DEFAULT_MODEL ??
    PROVIDER_DEFAULT_MODEL;
  return buildModelSelection(provider, model);
}

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModelSelection: ModelSelection,
  error: string | null,
): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New thread",
    modelSelection: fallbackModelSelection,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: draftThread.createdAt,
    envMode: draftThread.envMode,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    workingDirectory: draftThread.workingDirectory ?? null,
    lastKnownPr: draftThread.lastKnownPr ?? null,
    handoff: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

export function resolveActiveThreadTitle(input: {
  title: string;
  subagentTitle: string | null;
  isHomeChat: boolean;
  isEmpty: boolean;
}): string {
  if (input.subagentTitle) {
    return input.subagentTitle;
  }
  if (input.isHomeChat && input.isEmpty && isGenericChatThreadTitle(input.title)) {
    return "New Chat";
  }
  return input.title;
}

export function threadHasProviderLockingActivity(
  thread: Pick<Thread, "messages" | "latestTurn" | "session">,
): boolean {
  return thread.latestTurn !== null || thread.session !== null || thread.messages.length > 0;
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export function appendVoiceTranscriptToPrompt(
  currentPrompt: string,
  transcript: string,
): string | null {
  const trimmedTranscript = transcript.trim();
  if (trimmedTranscript.length === 0) {
    return null;
  }
  return currentPrompt.trim().length === 0
    ? trimmedTranscript
    : `${currentPrompt.replace(/\s+$/, "")}\n${trimmedTranscript}`;
}

export function sanitizeVoiceErrorMessage(message: string): string {
  const normalized = message.trim();
  if (normalized.length === 0) {
    return "The voice note could not be transcribed.";
  }

  const firstLine = normalized.split("\n")[0]?.trim() ?? normalized;
  const withoutInlineStack = firstLine.replace(/\s+at file:\/\/.*$/s, "").trim();
  const withoutRemoteMethodPrefix = withoutInlineStack.replace(
    /^Error invoking remote method ['"][^'"]+['"]:\s*/i,
    "",
  );
  const withoutRepeatedErrorPrefix = withoutRemoteMethodPrefix.replace(/^(Error:\s*)+/i, "").trim();

  return withoutRepeatedErrorPrefix.length > 0
    ? withoutRepeatedErrorPrefix
    : "The voice note could not be transcribed.";
}

export function isVoiceAuthExpiredMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("chatgpt login has expired") || normalized.includes("sign in again");
}

export function describeVoiceRecordingStartError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "The microphone could not be opened.";
  }

  const normalizedMessage = error.message.trim();
  const errorName = typeof error.name === "string" ? error.name : "";

  if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
    return "Microphone access was denied. Enable it in macOS Privacy & Security > Microphone for Glade, then try again.";
  }
  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "No microphone was found. Connect one and try again.";
  }
  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "The microphone is busy or unavailable right now. Close other audio apps and try again.";
  }
  if (errorName === "SecurityError") {
    return "Microphone access is blocked in this environment.";
  }
  if (normalizedMessage.length > 0) {
    return sanitizeVoiceErrorMessage(normalizedMessage);
  }

  return "The microphone could not be opened.";
}

export function deriveComposerVoiceState(input: {
  authStatus: ServerProviderAuthStatus | null | undefined;
  voiceTranscriptionAvailable: boolean | undefined;
  isRecording: boolean;
  isTranscribing: boolean;
}): {
  canRenderVoiceNotes: boolean;
  canStartVoiceNotes: boolean;
  showVoiceNotesControl: boolean;
} {
  const canRenderVoiceNotes = input.authStatus !== "unauthenticated";
  const canStartVoiceNotes = canRenderVoiceNotes && input.voiceTranscriptionAvailable !== false;

  return {
    canRenderVoiceNotes,
    canStartVoiceNotes,
    showVoiceNotesControl: canRenderVoiceNotes || input.isRecording || input.isTranscribing,
  };
}

export function shouldShowComposerModelBootstrapSkeleton(input: {
  selectedProvider: ProviderKind;
  selectedModel: string | null | undefined;
  persistedModelSelection: ModelSelection | null | undefined;
  draftModelSelection: ModelSelection | null | undefined;
  providerModelsLoading: boolean;
  requiresDiscoveredModels?: boolean;
}): boolean {
  if (input.requiresDiscoveredModels === true && input.providerModelsLoading) {
    return true;
  }

  const draftSelection = input.draftModelSelection;
  if (draftSelection && draftSelection.provider === input.selectedProvider) {
    return false;
  }

  const persistedSelection = input.persistedModelSelection;
  if (!persistedSelection) {
    return false;
  }

  if (persistedSelection.provider !== input.selectedProvider) {
    return true;
  }

  if (!input.providerModelsLoading) {
    return false;
  }

  const normalizedSelectedModel =
    normalizeModelSlug(input.selectedModel, input.selectedProvider) ?? input.selectedModel;
  const normalizedPersistedModel =
    normalizeModelSlug(persistedSelection.model, persistedSelection.provider) ??
    persistedSelection.model;

  return normalizedSelectedModel !== normalizedPersistedModel;
}

export function resolveCommittedProviderModel(input: {
  selectedModel: ModelSlug;
  availableOptions: ReadonlyArray<ProviderModelOption>;
  fallback: () => string;
}): string {
  const directRuntimeOption = input.availableOptions.find(
    (option) => option.slug === input.selectedModel,
  );
  return directRuntimeOption?.slug ?? input.fallback();
}

export function shouldConsumePendingCustomBinaryConfirmation(input: {
  sessionAlreadyChecked: boolean;
  pendingCustomBinaryPath: string | null | undefined;
}): boolean {
  return !input.sessionAlreadyChecked || Boolean(input.pendingCustomBinaryPath);
}

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

const WORKTREE_SETUP_STEP_LABELS: Record<WorktreeSetupStepId, string> = {
  "create-branch": "Creating branch",
  "create-worktree": "Creating worktree",
  "copy-changes": "Copying local changes",
  "prepare-thread": "Linking thread workspace",
  "run-setup-action": "Running setup action",
  "start-session": "Starting session",
};

export const WORKTREE_SETUP_STEP_ID_BY_PHASE: Record<GitWorktreeSetupPhase, WorktreeSetupStepId> = {
  branch: "create-branch",
  worktree: "create-worktree",
  "copy-changes": "copy-changes",
};

export interface WorktreeSetupSnapshotOptions {
  setupScriptName?: string | null;
  copyLocalChanges?: boolean;
}

export interface WorktreeSetupDispatchOptions extends WorktreeSetupSnapshotOptions {
  worktreeSetupStepId?: WorktreeSetupStepId;
  expectedUserMessageId?: ChatMessage["id"];
}

export function worktreeSetupStepDefinitions(
  activeStepId: WorktreeSetupStepId,
  options?: WorktreeSetupSnapshotOptions,
): ReadonlyArray<{ id: WorktreeSetupStepId; label: string }> {
  const setupScriptName = options?.setupScriptName?.trim();
  const includeSetupStep = activeStepId === "run-setup-action" || Boolean(setupScriptName);
  const includeCopyStep = activeStepId === "copy-changes" || Boolean(options?.copyLocalChanges);
  const stepIds: WorktreeSetupStepId[] = ["create-branch", "create-worktree"];
  if (includeCopyStep) {
    stepIds.push("copy-changes");
  }
  stepIds.push("prepare-thread");
  if (includeSetupStep) {
    stepIds.push("run-setup-action");
  }
  stepIds.push("start-session");
  return stepIds.map((id) => ({
    id,
    label:
      id === "run-setup-action" && setupScriptName
        ? `${WORKTREE_SETUP_STEP_LABELS[id]}: ${setupScriptName}`
        : WORKTREE_SETUP_STEP_LABELS[id],
  }));
}
