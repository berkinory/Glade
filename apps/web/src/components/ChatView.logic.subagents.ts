import {
  resolveComputerControlMode,
  type ComposerComputerControlMode,
} from "../computerControlMode";
import { ThreadId, type ThreadId as ThreadIdType } from "@glade/contracts/core/baseSchemas";
import type {
  AssistantDeliveryMode,
  ModelSelection,
  ProviderInteractionMode,
  ProviderStartOptions,
  RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";
import type { Thread } from "../types";
import type {
  DraftThreadEnvMode,
  QueuedComposerChatTurn,
  QueuedComposerTurn,
} from "../composerDraftDomain";
import {
  humanizeSubagentStatus,
  normalizeSubagentStatusKind,
  resolveSubagentPresentationForThread,
} from "../lib/subagentPresentation";
import { hasLiveTurnTailWork } from "../session-logic";
import type { WorkLogEntry } from "../workLog.types";
import { localSubagentThreadId } from "./ChatView.selectors";

export interface TurnDispatchSettings {
  readonly modelSelection: ModelSelection;

  readonly providerOptions: ProviderStartOptions | undefined;
  readonly enableComputerControl: boolean;
  readonly computerControlMode?: ComposerComputerControlMode | undefined;
  readonly computerControlGeneration?: number | undefined;
  readonly assistantDeliveryMode: AssistantDeliveryMode;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly envMode: DraftThreadEnvMode;
}

// A queued turn froze its dispatch settings when it was queued, so dispatching it later must replay
// those, not whatever the composer shows now.
export function resolveQueuedTurnDispatchSettings(
  settings: TurnDispatchSettings,
  queuedTurn: QueuedComposerTurn | null | undefined,
): TurnDispatchSettings {
  if (!queuedTurn) {
    return settings;
  }
  const queuedMode = resolveComputerControlMode(
    queuedTurn.computerControlMode,
    queuedTurn.enableComputerControl,
  );
  const liveMode = resolveComputerControlMode(
    settings.computerControlMode,
    settings.enableComputerControl,
  );
  const sameGeneration =
    settings.computerControlGeneration === undefined ||
    settings.computerControlGeneration === (queuedTurn.computerControlGeneration ?? 0);
  const computerControlMode =
    sameGeneration && (queuedMode === "request" || liveMode === "chat") ? queuedMode : "off";
  const enableComputerControl = computerControlMode !== "off";
  return {
    ...settings,
    modelSelection: queuedTurn.modelSelection ?? settings.modelSelection,
    providerOptions: queuedTurn.providerOptionsForDispatch ?? settings.providerOptions,
    enableComputerControl,
    computerControlGeneration: queuedTurn.computerControlGeneration ?? 0,
    computerControlMode,
    runtimeMode: queuedTurn.runtimeMode ?? settings.runtimeMode,
    interactionMode: queuedTurn.interactionMode ?? settings.interactionMode,

    envMode: (queuedTurn.kind === "chat" ? queuedTurn.envMode : undefined) ?? settings.envMode,
  };
}

function turnDispatchIdentityFields(settings: TurnDispatchSettings) {
  return {
    modelSelection: settings.modelSelection,
    ...(settings.providerOptions ? { providerOptions: settings.providerOptions } : {}),
    enableComputerControl: settings.enableComputerControl,
    computerControlGeneration: settings.computerControlGeneration ?? 0,
    computerControlMode: resolveComputerControlMode(
      settings.computerControlMode,
      settings.enableComputerControl,
    ),
    assistantDeliveryMode: settings.assistantDeliveryMode,
  };
}

function turnDispatchModeFields(settings: TurnDispatchSettings) {
  return {
    runtimeMode: settings.runtimeMode,
    interactionMode: settings.interactionMode,
  };
}

export function turnStartDispatchFields(
  settings: TurnDispatchSettings,
  dispatchMode: "queue" | "steer",
) {
  return {
    ...turnDispatchIdentityFields(settings),
    dispatchMode,
    ...turnDispatchModeFields(settings),
  };
}

export function editAndResendDispatchFields(settings: TurnDispatchSettings) {
  return {
    ...turnDispatchIdentityFields(settings),
    ...turnDispatchModeFields(settings),
  };
}

export function queuedChatTurnDispatchFields(
  settings: TurnDispatchSettings,
  sourceProposedPlan: QueuedComposerChatTurn["sourceProposedPlan"],
) {
  return {
    modelSelection: settings.modelSelection,
    ...(settings.providerOptions ? { providerOptionsForDispatch: settings.providerOptions } : {}),
    enableComputerControl: settings.enableComputerControl,
    computerControlGeneration: settings.computerControlGeneration ?? 0,
    computerControlMode: resolveComputerControlMode(
      settings.computerControlMode,
      settings.enableComputerControl,
    ),
    ...(sourceProposedPlan ? { sourceProposedPlan } : {}),
    ...turnDispatchModeFields(settings),
    envMode: settings.envMode,
  };
}

export function queuedPlanFollowUpDispatchFields(settings: TurnDispatchSettings) {
  return {
    modelSelection: settings.modelSelection,
    ...(settings.providerOptions ? { providerOptionsForDispatch: settings.providerOptions } : {}),
    enableComputerControl: settings.enableComputerControl,
    computerControlGeneration: settings.computerControlGeneration ?? 0,
    computerControlMode: resolveComputerControlMode(
      settings.computerControlMode,
      settings.enableComputerControl,
    ),
    runtimeMode: settings.runtimeMode,
  };
}

export function planImplementationDispatchSettings(
  settings: TurnDispatchSettings,
): TurnDispatchSettings {
  return { ...settings, interactionMode: "default", computerControlGeneration: 0 };
}

export function threadSettingsDispatchFields(settings: TurnDispatchSettings) {
  return {
    modelSelection: settings.modelSelection,
    ...turnDispatchModeFields(settings),
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

export function shouldRenderTerminalWorkspace(options: {
  presentationMode: "drawer" | "workspace";
  terminalOpen: boolean;
}): boolean {
  return options.terminalOpen && options.presentationMode === "workspace";
}

export function resolveProjectScriptTerminalTarget(options: {
  baseTerminalId: string;
  createTerminalId: () => string;
  hasRunningTerminal: boolean;
  preferNewTerminal?: boolean | undefined;
  terminalOpen: boolean;
}): { shouldCreateNewTerminal: boolean; terminalId: string } {
  const shouldCreateNewTerminal =
    Boolean(options.preferNewTerminal) || options.terminalOpen || options.hasRunningTerminal;

  return {
    shouldCreateNewTerminal,
    terminalId: shouldCreateNewTerminal ? options.createTerminalId() : options.baseTerminalId,
  };
}

export interface ThreadBreadcrumb {
  threadId: ThreadIdType;
  title: string;
}

type ThreadBreadcrumbSource = Pick<
  Thread,
  "id" | "title" | "parentThreadId" | "subagentAgentId" | "subagentNickname" | "subagentRole"
> & {
  activities?: Thread["activities"];
};

export function buildThreadBreadcrumbs(
  threads: ReadonlyArray<ThreadBreadcrumbSource>,
  thread: Pick<Thread, "id" | "parentThreadId"> | null | undefined,
): ThreadBreadcrumb[] {
  if (!thread?.parentThreadId) {
    return [];
  }

  const threadById = new Map(threads.map((entry) => [entry.id, entry] as const));
  const breadcrumbs: ThreadBreadcrumb[] = [];
  const visited = new Set<ThreadIdType>();
  let currentParentId: ThreadIdType | null = thread.parentThreadId ?? null;

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parentThread = threadById.get(currentParentId);
    if (!parentThread) {
      break;
    }
    breadcrumbs.unshift({
      threadId: parentThread.id,
      title: parentThread.parentThreadId
        ? resolveSubagentPresentationForThread({ thread: parentThread, threads }).fullLabel
        : parentThread.title,
    });
    currentParentId = parentThread.parentThreadId ?? null;
  }

  return breadcrumbs;
}

function deriveSubagentStatus(thread: Thread | undefined): {
  isActive: boolean;
  label: string | undefined;
} {
  if (!thread) {
    return {
      isActive: false,
      label: undefined,
    };
  }

  if (thread.error || thread.session?.status === "error") {
    return {
      isActive: false,
      label: "Error",
    };
  }
  if (thread.session?.status === "connecting") {
    return {
      isActive: true,
      label: "Connecting",
    };
  }
  if (
    thread.session?.status === "running" ||
    hasLiveTurnTailWork({
      latestTurn: thread.latestTurn,
      messages: thread.messages,
      activities: thread.activities,
      session: thread.session,
    })
  ) {
    return {
      isActive: true,
      label: "Running",
    };
  }
  if (thread.session?.status === "closed") {
    return {
      isActive: false,
      label: "Closed",
    };
  }

  return {
    isActive: false,
    label: thread.session ? "Idle" : undefined,
  };
}

function humanizeSubagentRawStatus(rawStatus: string | undefined): string | undefined {
  return humanizeSubagentStatus(rawStatus);
}

// Terminal work-log statuses are authoritative over child-thread session state: a finished
// subagent's thread merely parks in an "Idle"/"Closed" session status, which must not mask
// Completed/Failed/Stopped.
function terminalSubagentStatusLabel(
  rawStatus: string | undefined,
  entryStatus: string | undefined,
): string | undefined {
  for (const candidate of rawStatus !== undefined ? [rawStatus] : [entryStatus]) {
    const statusKind = normalizeSubagentStatusKind(candidate);
    if (statusKind === "completed" || statusKind === "failed" || statusKind === "stopped") {
      return humanizeSubagentStatus(candidate);
    }
  }
  return undefined;
}

function resolveTimelineSubagentThread(input: {
  subagent: NonNullable<WorkLogEntry["subagents"]>[number];
  parentThreadId: ThreadIdType | null;
  threadById: ReadonlyMap<ThreadIdType, Thread>;
  threads: ReadonlyArray<Thread>;
}): Thread | undefined {
  const directThreadId = input.subagent.resolvedThreadId ?? input.subagent.threadId;
  if (directThreadId) {
    const directMatch = input.threadById.get(ThreadId.makeUnsafe(directThreadId));
    if (directMatch) {
      return directMatch;
    }
  }

  if (input.parentThreadId) {
    const providerThreadId = input.subagent.providerThreadId ?? input.subagent.threadId;
    const derivedLocalThreadId = localSubagentThreadId(input.parentThreadId, providerThreadId);
    const derivedLocalMatch = input.threadById.get(derivedLocalThreadId);
    if (derivedLocalMatch) {
      return derivedLocalMatch;
    }

    if (input.subagent.agentId) {
      const matchedByAgent = input.threads.find(
        (thread) =>
          thread.parentThreadId === input.parentThreadId &&
          thread.subagentAgentId === input.subagent.agentId,
      );
      if (matchedByAgent) {
        return matchedByAgent;
      }
    }
  }

  if (input.subagent.agentId) {
    return input.threads.find((thread) => thread.subagentAgentId === input.subagent.agentId);
  }

  return undefined;
}

export function resolveComposerStripWorkLogEntries(input: {
  hasDistinctParentSource: boolean;
  activeWorkLogEntries: WorkLogEntry[];
  deriveParentWorkLogEntries: () => WorkLogEntry[];
}): WorkLogEntry[] {
  return input.hasDistinctParentSource
    ? input.deriveParentWorkLogEntries()
    : input.activeWorkLogEntries;
}

export function enrichSubagentWorkEntries(
  workEntries: ReadonlyArray<WorkLogEntry>,
  threads: ReadonlyArray<Thread>,
  parentThreadId: ThreadIdType | null,
): WorkLogEntry[] {
  if (workEntries.length === 0) {
    return [];
  }

  const threadById = new Map(threads.map((thread) => [thread.id, thread] as const));

  return workEntries.map((entry) => {
    if ((entry.subagents?.length ?? 0) === 0) {
      return entry;
    }

    const subagents = entry.subagents!.map((subagent) => {
      const matchedThread = resolveTimelineSubagentThread({
        subagent,
        parentThreadId,
        threadById,
        threads,
      });
      const status = deriveSubagentStatus(matchedThread);
      const fallbackStatusLabel = humanizeSubagentRawStatus(subagent.rawStatus);
      const terminalStatusLabel = status.isActive
        ? undefined
        : terminalSubagentStatusLabel(subagent.rawStatus, entry.subagentAction?.status);
      const matchedPresentation =
        matchedThread !== undefined
          ? resolveSubagentPresentationForThread({ thread: matchedThread, threads })
          : null;
      const nextSubagent = Object.assign({}, subagent);
      if (matchedThread) {
        nextSubagent.resolvedThreadId = matchedThread.id;
      }
      if (matchedPresentation) {
        nextSubagent.title = matchedPresentation.fullLabel;
      }
      if (terminalStatusLabel ?? status.label ?? fallbackStatusLabel) {
        nextSubagent.statusLabel = terminalStatusLabel ?? status.label ?? fallbackStatusLabel;
      }
      if (status.isActive || fallbackStatusLabel === "Running") {
        nextSubagent.isActive = true;
      }
      return nextSubagent;
    });

    return {
      ...entry,
      subagents,
    };
  });
}
