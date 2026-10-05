import type { GitWorktreeSetupProgressEvent } from "@glade/contracts/git/git";
import type {
  ChatMessage,
  SessionPhase,
  Thread,
  WorktreeSetupResolutionAction,
  WorktreeSetupSnapshot,
  WorktreeSetupStepId,
} from "../types";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";
import { filterPastedTextsWithText, type PastedTextDraft } from "../lib/composerPastedText";
import {
  normalizePullRequestContexts,
  type PullRequestContextDraft,
} from "../lib/pullRequestContext";
import {
  WORKTREE_SETUP_STEP_ID_BY_PHASE,
  worktreeSetupStepDefinitions,
} from "./ChatView.logic.worktree";
import type {
  WorktreeSetupDispatchOptions,
  WorktreeSetupSnapshotOptions,
} from "./ChatView.logic.worktree";

export const WORKTREE_SETUP_ERROR_HOLD_MS = 1200;

function createWorktreeSetupSnapshot(
  activeStepId: WorktreeSetupStepId,
  options?: WorktreeSetupSnapshotOptions,
): WorktreeSetupSnapshot {
  const stepDefinitions = worktreeSetupStepDefinitions(activeStepId, options);
  const activeIndex = stepDefinitions.findIndex((step) => step.id === activeStepId);
  return {
    steps: stepDefinitions.map((step, index) => ({
      ...step,
      status: index < activeIndex ? "done" : index === activeIndex ? "active" : "pending",
    })),
  };
}

export function failWorktreeSetupSnapshot(snapshot: WorktreeSetupSnapshot): WorktreeSetupSnapshot {
  if (!snapshot.steps.some((step) => step.status === "active")) {
    return snapshot;
  }
  return {
    steps: snapshot.steps.map((step) =>
      step.status === "active" ? { ...step, status: "error" } : step,
    ),
  };
}

export function worktreeSetupHasError(snapshot: WorktreeSetupSnapshot | null): boolean {
  return snapshot?.steps.some((step) => step.status === "error") ?? false;
}

export class WorktreeSetupCancelledError extends Error {
  constructor() {
    super("Worktree preparation cancelled.");
    this.name = "WorktreeSetupCancelledError";
  }
}

// The setup card's "Cancel" / "Work locally" buttons resolve it; the send pipeline races `promise`
// against worktree creation and checks `action` at step boundaries,
// honoring the choice at the next checkpoint before the turn is dispatched.
export interface WorktreeSetupResolution {
  readonly promise: Promise<WorktreeSetupResolutionAction>;
  readonly action: WorktreeSetupResolutionAction | null;
  resolve(action: WorktreeSetupResolutionAction): void;
}

export function createWorktreeSetupResolution(): WorktreeSetupResolution {
  let action: WorktreeSetupResolutionAction | null = null;
  let settle: (resolved: WorktreeSetupResolutionAction) => void = () => {};
  const promise = new Promise<WorktreeSetupResolutionAction>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    get action() {
      return action;
    },
    resolve(next) {
      if (action !== null) {
        return;
      }
      action = next;
      settle(next);
    },
  };
}

export interface WorktreeCreationFlowDeps<Result extends { worktree: { path: string } }> {
  progressId: string;
  subscribeToProgress: (listener: (event: GitWorktreeSetupProgressEvent) => void) => () => void;
  startCreation: () => Promise<Result>;
  resolution: WorktreeSetupResolution;

  onCreationStep: (stepId: WorktreeSetupStepId) => void;
  removeWorktree: (worktreePath: string) => Promise<unknown>;
}

export type WorktreeCreationFlowOutcome<Result> =
  | { outcome: "resolved" }
  | { outcome: "created"; result: Result };

// Runs one worktree creation while the setup card is showing: subscribes to the server's streamed
// setup phases, races the creation against the card's "Cancel" / "Work locally" resolution, and —
// when the user resolves first — tears the (possibly still materializing) worktree down once the
// creation lands so a resolved send leaves no stray checkout.
export async function runWorktreeCreationFlow<Result extends { worktree: { path: string } }>(
  deps: WorktreeCreationFlowDeps<Result>,
): Promise<WorktreeCreationFlowOutcome<Result>> {
  const unsubscribe = deps.subscribeToProgress((event) => {
    if (
      event.progressId !== deps.progressId ||
      event.kind !== "phase_started" ||
      deps.resolution.action !== null
    ) {
      return;
    }
    deps.onCreationStep(WORKTREE_SETUP_STEP_ID_BY_PHASE[event.phase]);
  });
  try {
    const creation = deps.startCreation();

    await Promise.race([creation, deps.resolution.promise]);
    if (deps.resolution.action !== null) {
      void creation
        .then((result) => deps.removeWorktree(result.worktree.path))
        .catch(() => undefined);
      return { outcome: "resolved" };
    }
    return { outcome: "created", result: await creation };
  } finally {
    unsubscribe();
  }
}

// Once the turn RPC has resolved the server provably owns the turn; the dispatch marker then only
// waits for the thread stream to echo the change (session running / message echo / turn change). A
// dead or stalled stream would otherwise leave the composer spinner stuck forever, so the marker is
// force-cleared after this bound and the catch-up watchdog re-syncs the real thread state.
export const LOCAL_DISPATCH_ACK_TIMEOUT_MS = 10_000;

export interface LocalDispatchSnapshot {
  startedAt: string;
  worktreeSetup: WorktreeSetupSnapshot | null;
  expectedUserMessageId: ChatMessage["id"] | null;
  latestTurnTurnId: Thread["latestTurn"] extends infer T
    ? T extends { turnId: infer U }
      ? U | null
      : null
    : null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionOrchestrationStatus: Thread["session"] extends infer T
    ? T extends { orchestrationStatus: infer U }
      ? U | null
      : null
    : null;
  sessionUpdatedAt: string | null;
}

export function createLocalDispatchSnapshot(
  activeThread: Thread | undefined,
  options?: WorktreeSetupDispatchOptions,
): LocalDispatchSnapshot {
  const latestTurn = activeThread?.latestTurn ?? null;
  const session = activeThread?.session ?? null;
  return {
    startedAt: new Date().toISOString(),
    worktreeSetup: options?.worktreeSetupStepId
      ? createWorktreeSetupSnapshot(options.worktreeSetupStepId, options)
      : null,
    expectedUserMessageId: options?.expectedUserMessageId ?? null,
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionOrchestrationStatus: session?.orchestrationStatus ?? null,
    sessionUpdatedAt: session?.updatedAt ?? null,
  };
}

export function resolveNextLocalDispatchSnapshot(input: {
  current: LocalDispatchSnapshot | null;
  activeThread: Thread | undefined;
  options?: WorktreeSetupDispatchOptions;
}): LocalDispatchSnapshot {
  const worktreeSetupStepId = input.options?.worktreeSetupStepId;
  if (!input.current || worktreeSetupHasError(input.current.worktreeSetup)) {
    return createLocalDispatchSnapshot(input.activeThread, input.options);
  }

  if (!worktreeSetupStepId) {
    if (
      input.options?.expectedUserMessageId != null &&
      input.options.expectedUserMessageId !== input.current.expectedUserMessageId
    ) {
      return createLocalDispatchSnapshot(input.activeThread, input.options);
    }
    return input.current;
  }

  const alreadyActive = input.current.worktreeSetup?.steps.some(
    (step) => step.id === worktreeSetupStepId && step.status === "active",
  );
  return alreadyActive
    ? input.current
    : {
        ...input.current,
        worktreeSetup: createWorktreeSetupSnapshot(worktreeSetupStepId, input.options),
      };
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  messages: readonly ChatMessage[];
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }
  if (
    input.phase === "running" ||
    input.hasPendingApproval ||
    input.hasPendingUserInput ||
    Boolean(input.threadError)
  ) {
    return true;
  }
  if (
    input.localDispatch.expectedUserMessageId !== null &&
    input.messages.some(
      (message) =>
        message.role === "user" && message.id === input.localDispatch?.expectedUserMessageId,
    )
  ) {
    return true;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const nextSessionOrchestrationStatus = session?.orchestrationStatus ?? null;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);

  if (latestTurnChanged) {
    return true;
  }

  if (input.localDispatch.sessionOrchestrationStatus !== nextSessionOrchestrationStatus) {
    if (
      input.localDispatch.sessionOrchestrationStatus === null &&
      nextSessionOrchestrationStatus === "ready"
    ) {
      return false;
    }
    return true;
  }

  return false;
}

export const LOCAL_DISPATCH_TURN_TAKEOVER_TIMEOUT_MS = 60_000;

export type WorkingLabel =
  | "Checking delivery"
  | "Delivery uncertain"
  | "Loading"
  | "Thinking"
  | `Starting ${string}…`;

export function resolveWorkingLabel(input: {
  isSendBusy: boolean;
  dispatchDeliveryState?: "recovering" | "uncertain" | undefined;
  turnTakenOver: boolean;
  isConnecting?: boolean;
  providerName?: string;
}): WorkingLabel {
  if (input.dispatchDeliveryState === "recovering") return "Checking delivery";
  if (input.dispatchDeliveryState === "uncertain") return "Delivery uncertain";
  if (input.isSendBusy && !input.turnTakenOver) {
    return "Loading";
  }
  if (input.isConnecting && input.providerName) {
    return `Starting ${input.providerName}…`;
  }
  return "Thinking";
}

export function hasLiveTurnTakenOver(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  threadError: string | null | undefined;
  now?: number;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }

  if (input.phase === "running") {
    return true;
  }
  if (input.session?.activeTurnId != null) {
    return true;
  }
  if (input.hasPendingApproval || input.hasPendingUserInput || Boolean(input.threadError)) {
    return true;
  }
  const latestTurn = input.latestTurn ?? null;
  const startedAtChanged =
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null);
  const completedAtChanged =
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);
  if (startedAtChanged || completedAtChanged) {
    return true;
  }

  // Fail-open so Thinking cannot stick forever when a turn is requested but never becomes live and
  // never surfaces an error. Worktree setup has its own lifecycle and must not be cut short by this
  // bound.
  if (!input.localDispatch.worktreeSetup && input.now !== undefined) {
    const startedAtMs = Date.parse(input.localDispatch.startedAt);
    if (
      Number.isFinite(startedAtMs) &&
      input.now - startedAtMs >= LOCAL_DISPATCH_TURN_TAKEOVER_TIMEOUT_MS
    ) {
      return true;
    }
  }

  return false;
}

// Between the abort and the steered turn's start the thread briefly looks idle, which would
// otherwise let the queued-composer auto-dispatch race the steered turn (and fire every queued
// message at once).
export interface QueuedSteerGate {
  sawInterruptGap: boolean;

  gapStartedAt: number | null;

  armedActiveTurnId: string | null;
}

const QUEUED_STEER_GATE_TIMEOUT_MS = 15_000;

export type QueuedSteerGateTransition =
  | { kind: "clear" }
  | { kind: "hold"; gate: QueuedSteerGate; expiresInMs: number | null };

export function resolveQueuedSteerGateTransition(input: {
  gate: QueuedSteerGate;
  phase: SessionPhase;
  sessionErrored: boolean;
  activeTurnId: string | null;
  now: number;
}): QueuedSteerGateTransition {
  if (input.phase === "disconnected" || input.sessionErrored) {
    return { kind: "clear" };
  }
  if (input.phase === "running") {
    if (input.gate.sawInterruptGap) {
      return { kind: "clear" };
    }

    if (
      input.gate.armedActiveTurnId !== null &&
      input.activeTurnId !== null &&
      input.activeTurnId !== input.gate.armedActiveTurnId
    ) {
      return { kind: "clear" };
    }

    return {
      kind: "hold",
      gate: {
        sawInterruptGap: false,
        gapStartedAt: null,
        armedActiveTurnId: input.gate.armedActiveTurnId ?? input.activeTurnId,
      },
      expiresInMs: null,
    };
  }
  const gapStartedAt = input.gate.gapStartedAt ?? input.now;
  const expiresInMs = QUEUED_STEER_GATE_TIMEOUT_MS - (input.now - gapStartedAt);
  if (expiresInMs <= 0) {
    return { kind: "clear" };
  }
  return {
    kind: "hold",
    gate: {
      sawInterruptGap: true,
      gapStartedAt,
      armedActiveTurnId: input.gate.armedActiveTurnId,
    },
    expiresInMs,
  };
}

export function shouldHoldQueuedComposerAutoDispatch(input: {
  hasQueueableLiveTurn: boolean;
  phase: SessionPhase;
  isSendBusy: boolean;
  isConnecting: boolean;
  isAwaitingTurnStart: boolean;
  queuedSteerGate: QueuedSteerGate | null;
  hasPendingApproval: boolean;
  hasPendingProgress: boolean;
  hasPendingUserInput: boolean;
  queuedTurnCount: number;
}): boolean {
  return (
    input.hasQueueableLiveTurn ||
    input.phase === "disconnected" ||
    input.isSendBusy ||
    input.isConnecting ||
    input.isAwaitingTurnStart ||
    input.queuedSteerGate !== null ||
    input.hasPendingApproval ||
    input.hasPendingProgress ||
    input.hasPendingUserInput ||
    input.queuedTurnCount === 0
  );
}

export function resolveQueuedComposerAutoDispatchHold(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  messages: readonly ChatMessage[];
  isConnecting: boolean;
  queuedSteerGate: QueuedSteerGate | null;
  hasPendingApproval: boolean;
  hasPendingProgress: boolean;
  hasPendingUserInput: boolean;
  queuedTurnCount: number;
  threadError: string | null | undefined;
  now?: number;
}): boolean {
  const isSendBusy =
    input.localDispatch !== null &&
    !hasServerAcknowledgedLocalDispatch({
      localDispatch: input.localDispatch,
      phase: input.phase,
      latestTurn: input.latestTurn,
      session: input.session,
      messages: input.messages,
      hasPendingApproval: input.hasPendingApproval,
      hasPendingUserInput: input.hasPendingUserInput,
      threadError: input.threadError,
    });
  const turnTakenOver = hasLiveTurnTakenOver({
    localDispatch: input.localDispatch,
    phase: input.phase,
    latestTurn: input.latestTurn,
    session: input.session,
    hasPendingApproval: input.hasPendingApproval,
    hasPendingUserInput: input.hasPendingUserInput,
    threadError: input.threadError,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return shouldHoldQueuedComposerAutoDispatch({
    hasQueueableLiveTurn: input.phase === "running" && input.session?.activeTurnId != null,
    phase: input.phase,
    isSendBusy,
    isConnecting: input.isConnecting,
    isAwaitingTurnStart: input.localDispatch !== null && !turnTakenOver,
    queuedSteerGate: input.queuedSteerGate,
    hasPendingApproval: input.hasPendingApproval,
    hasPendingProgress: input.hasPendingProgress,
    hasPendingUserInput: input.hasPendingUserInput,
    queuedTurnCount: input.queuedTurnCount,
  });
}

export const ACTIVE_TURN_LAYOUT_SETTLE_DELAY_MS = 180;

export function shouldStartActiveTurnLayoutGrace(options: {
  previousTurnLayoutLive: boolean;
  currentTurnLayoutLive: boolean;
  latestTurnStartedAt: string | null;
}): boolean {
  return (
    options.previousTurnLayoutLive &&
    !options.currentTurnLayoutLive &&
    options.latestTurnStartedAt !== null
  );
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  fileCount: number;
  assistantSelectionCount: number;
  browserAnnotationCount: number;
  fileCommentCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  pastedTexts: ReadonlyArray<PastedTextDraft>;
  pullRequestContexts: ReadonlyArray<PullRequestContextDraft>;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  sendablePastedTexts: PastedTextDraft[];
  sendablePullRequestContexts: PullRequestContextDraft[];
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  const sendablePastedTexts = filterPastedTextsWithText(options.pastedTexts);
  const sendablePullRequestContexts = normalizePullRequestContexts(options.pullRequestContexts);
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    sendablePastedTexts,
    sendablePullRequestContexts,
    hasSendableContent:
      trimmedPrompt.length > 0 ||
      options.imageCount > 0 ||
      options.fileCount > 0 ||
      options.assistantSelectionCount > 0 ||
      options.browserAnnotationCount > 0 ||
      options.fileCommentCount > 0 ||
      sendableTerminalContexts.length > 0 ||
      sendablePastedTexts.length > 0 ||
      sendablePullRequestContexts.length > 0,
  };
}
