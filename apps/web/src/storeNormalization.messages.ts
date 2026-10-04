import { MessageId, ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationSpaceShell } from "@glade/contracts/orchestration/threadEntities";
import { mergeAsyncUserInput } from "@glade/shared/threads/asyncUserInput";
import { toAttachmentPreviewUrl } from "./lib/wsHttpUrl";
import { getRememberedProjectUiState, projectCwdKey } from "./storePersistence";
import type { ChatAttachment, ChatMessage, Project, Space, Thread, ThreadSession } from "./types";
import {
  LOCAL_USER_MESSAGE_RETENTION_MS,
  MAX_THREAD_MESSAGES,
  arraysShallowEqual,
  attachmentPreviewRoutePath,
  basenameOfPath,
  normalizeModelSelection,
  providerReferenceArraysEqual,
  textSegmentArraysEqual,
} from "./storeNormalization.shared";
import type {
  ProjectNormalizationInput,
  ReadModelMessage,
  ReadModelSpace,
  ReadModelThread,
} from "./storeNormalization.shared";

export function normalizeProject(
  incoming: ProjectNormalizationInput,
  previous: Project | undefined,
): Project {
  const rememberedUiState = getRememberedProjectUiState();
  const workspaceRootKey = projectCwdKey(incoming.workspaceRoot);
  const folderName = basenameOfPath(incoming.workspaceRoot) ?? incoming.title;
  const localName =
    previous?.localName ?? rememberedUiState.projectNameForCwd(workspaceRootKey) ?? null;
  const appearance =
    previous?.appearance ?? rememberedUiState.projectAppearanceForCwd(workspaceRootKey) ?? null;
  const defaultModelSelection =
    incoming.defaultModelSelection === null
      ? null
      : normalizeModelSelection(incoming.defaultModelSelection, previous?.defaultModelSelection);
  const persistedProjectOrderIndex = rememberedUiState.projectOrderIndexForCwd(workspaceRootKey);
  const hasKnownLegacyExpansion =
    rememberedUiState.projectOrderCount === 0 &&
    (rememberedUiState.expandedProjectCount > 0 || rememberedUiState.isLegacyExpansionPayload);
  // Live expansion wins over persisted preferences during sync. An empty expansion-only payload means
  // all collapsed; an unknown project defaults to expanded.
  const expanded =
    (previous && projectCwdKey(previous.cwd) === workspaceRootKey
      ? previous.expanded
      : undefined) ??
    (persistedProjectOrderIndex !== undefined || hasKnownLegacyExpansion
      ? rememberedUiState.isProjectExpanded(workspaceRootKey)
      : true);

  if (
    previous &&
    previous.id === incoming.id &&
    previous.kind === incoming.kind &&
    previous.name === (localName ?? incoming.title) &&
    previous.remoteName === incoming.title &&
    previous.folderName === folderName &&
    previous.localName === localName &&
    (previous.appearance ?? null) === appearance &&
    previous.cwd === incoming.workspaceRoot &&
    previous.defaultModelSelection === defaultModelSelection &&
    previous.expanded === expanded &&
    (previous.isPinned ?? false) === (incoming.isPinned ?? false) &&
    (previous.spaceId ?? null) === (incoming.spaceId ?? null) &&
    previous.createdAt === incoming.createdAt &&
    previous.updatedAt === incoming.updatedAt
  ) {
    return previous;
  }

  return {
    id: incoming.id,
    kind: incoming.kind ?? "project",
    name: localName ?? incoming.title,
    remoteName: incoming.title,
    folderName,
    localName,
    appearance,
    cwd: incoming.workspaceRoot,
    defaultModelSelection,
    expanded,
    isPinned: incoming.isPinned ?? false,
    spaceId: incoming.spaceId ?? null,
    createdAt: incoming.createdAt,
    updatedAt: incoming.updatedAt,
  };
}

export function normalizeSpace(
  incoming: ReadModelSpace | OrchestrationSpaceShell,
  previous: Space | undefined,
): Space {
  if (
    previous &&
    previous.id === incoming.id &&
    previous.name === incoming.name &&
    previous.icon === incoming.icon &&
    previous.sortOrder === incoming.sortOrder &&
    previous.createdAt === incoming.createdAt &&
    previous.updatedAt === incoming.updatedAt
  ) {
    return previous;
  }
  return {
    id: incoming.id,
    name: incoming.name,
    icon: incoming.icon,
    sortOrder: incoming.sortOrder,
    createdAt: incoming.createdAt,
    updatedAt: incoming.updatedAt,
  };
}

export function mapSpaces(
  incoming: ReadonlyArray<ReadModelSpace | OrchestrationSpaceShell>,
  previous: Space[],
): Space[] {
  const previousById = new Map(previous.map((space) => [space.id, space] as const));
  const next = incoming
    .map((space) => normalizeSpace(space, previousById.get(space.id)))
    .toSorted((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  return arraysShallowEqual(previous, next) ? previous : next;
}

function normalizeChatAttachments(
  incoming: ReadModelMessage["attachments"],
  previous: ChatAttachment[] | undefined,
): ChatAttachment[] | undefined {
  if (!incoming || incoming.length === 0) {
    return undefined;
  }

  const previousById = new Map(previous?.map((attachment) => [attachment.id, attachment] as const));
  const nextAttachments = incoming.map((attachment) => {
    const nextAttachment: ChatAttachment =
      attachment.type === "assistant-selection"
        ? {
            type: "assistant-selection",
            id: attachment.id,
            assistantMessageId: attachment.assistantMessageId,
            text: attachment.text,
          }
        : attachment.type === "file"
          ? {
              type: "file",
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            }
          : {
              type: "image",
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
            };
    const existing = previousById.get(attachment.id);
    if (
      existing &&
      ((existing.type === "assistant-selection" &&
        nextAttachment.type === "assistant-selection" &&
        existing.assistantMessageId === nextAttachment.assistantMessageId &&
        existing.text === nextAttachment.text) ||
        (existing.type === "image" &&
          nextAttachment.type === "image" &&
          existing.name === nextAttachment.name &&
          existing.mimeType === nextAttachment.mimeType &&
          existing.sizeBytes === nextAttachment.sizeBytes &&
          existing.previewUrl === nextAttachment.previewUrl) ||
        (existing.type === "file" &&
          nextAttachment.type === "file" &&
          existing.name === nextAttachment.name &&
          existing.mimeType === nextAttachment.mimeType &&
          existing.sizeBytes === nextAttachment.sizeBytes))
    ) {
      return existing;
    }
    return nextAttachment;
  });

  return arraysShallowEqual(previous, nextAttachments) ? previous : nextAttachments;
}

export function normalizeChatMessage(
  incoming: ReadModelMessage,
  previous: ChatMessage | undefined,
): ChatMessage {
  const attachments = normalizeChatAttachments(incoming.attachments, previous?.attachments);

  const skills =
    incoming.skills && incoming.skills.length > 0 ? incoming.skills : (previous?.skills ?? []);
  const mentions =
    incoming.mentions && incoming.mentions.length > 0
      ? incoming.mentions
      : (previous?.mentions ?? []);
  const previousSkills = previous?.skills ?? [];
  const previousMentions = previous?.mentions ?? [];
  const completedAt = incoming.streaming ? undefined : incoming.updatedAt;
  const asyncUserInput = mergeAsyncUserInput(previous?.asyncUserInput, incoming.asyncUserInput);
  if (
    previous &&
    previous.role === incoming.role &&
    previous.text === incoming.text &&
    previous.asyncUserInput === asyncUserInput &&
    previous.dispatchMode === incoming.dispatchMode &&
    previous.dispatchOrigin === incoming.dispatchOrigin &&
    previous.startsNewTurn === incoming.startsNewTurn &&
    previous.turnId === incoming.turnId &&
    previous.providerMessageId === incoming.providerMessageId &&
    previous.createdAt === incoming.createdAt &&
    previous.updatedAt === incoming.updatedAt &&
    previous.streaming === incoming.streaming &&
    previous.source === incoming.source &&
    previous.completedAt === completedAt &&
    previous.attachments === attachments &&
    textSegmentArraysEqual(previous.textSegments, incoming.textSegments) &&
    providerReferenceArraysEqual(previousSkills, skills) &&
    providerReferenceArraysEqual(previousMentions, mentions)
  ) {
    return previous;
  }

  return {
    id: incoming.id,
    role: incoming.role,
    text: incoming.text,
    ...(asyncUserInput ? { asyncUserInput } : {}),
    ...(incoming.textSegments !== undefined && incoming.textSegments.length > 0
      ? { textSegments: [...incoming.textSegments] }
      : {}),
    ...(incoming.dispatchMode ? { dispatchMode: incoming.dispatchMode } : {}),
    ...(incoming.dispatchOrigin ? { dispatchOrigin: incoming.dispatchOrigin } : {}),
    ...(incoming.startsNewTurn !== undefined ? { startsNewTurn: incoming.startsNewTurn } : {}),
    ...(incoming.providerMessageId ? { providerMessageId: incoming.providerMessageId } : {}),
    turnId: incoming.turnId,
    createdAt: incoming.createdAt,
    updatedAt: incoming.updatedAt,
    streaming: incoming.streaming,
    source: incoming.source,
    ...(completedAt ? { completedAt } : {}),
    ...(attachments ? { attachments } : {}),
    ...(skills.length > 0 ? { skills: [...skills] } : {}),
    ...(mentions.length > 0 ? { mentions: [...mentions] } : {}),
  };
}

export function retainChatMessageWindow(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_THREAD_MESSAGES);
}

export function normalizeChatMessages(
  incoming: ReadModelThread["messages"],
  previous: ChatMessage[] | undefined,
): ChatMessage[] {
  const previousById = new Map(previous?.map((message) => [message.id, message] as const));
  const nextMessages = incoming
    .slice(-MAX_THREAD_MESSAGES)
    .map((message) => normalizeChatMessage(message, previousById.get(message.id)));
  return arraysShallowEqual(previous, nextMessages) ? previous : nextMessages;
}

function readModelAttachmentsFromChatMessage(
  attachments: ChatMessage["attachments"],
): ReadModelThread["messages"][number]["attachments"] {
  return (
    attachments?.map((attachment) =>
      attachment.type === "assistant-selection"
        ? {
            id: attachment.id,
            type: "assistant-selection" as const,
            assistantMessageId: MessageId.makeUnsafe(attachment.assistantMessageId),
            text: attachment.text,
          }
        : attachment.type === "file"
          ? {
              id: attachment.id,
              name: attachment.name,
              type: "file" as const,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            }
          : {
              id: attachment.id,
              name: attachment.name,
              type: "image" as const,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            },
    ) ?? []
  );
}

function readModelMessageFromChatMessage(
  message: ChatMessage,
): ReadModelThread["messages"][number] {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    ...(message.asyncUserInput ? { asyncUserInput: message.asyncUserInput } : {}),
    ...(message.dispatchMode ? { dispatchMode: message.dispatchMode } : {}),
    ...(message.dispatchOrigin ? { dispatchOrigin: message.dispatchOrigin } : {}),
    ...(message.startsNewTurn !== undefined ? { startsNewTurn: message.startsNewTurn } : {}),
    ...(message.providerMessageId ? { providerMessageId: message.providerMessageId } : {}),
    turnId: message.turnId ?? null,
    streaming: message.streaming,
    source: message.source ?? "native",
    createdAt: message.createdAt,
    updatedAt: message.updatedAt ?? message.completedAt ?? message.createdAt,
    attachments: readModelAttachmentsFromChatMessage(message.attachments),
    ...(message.skills && message.skills.length > 0 ? { skills: message.skills } : {}),
    ...(message.mentions && message.mentions.length > 0 ? { mentions: message.mentions } : {}),
  };
}

function shouldRetainLiveAssistantMessageForHotPath(
  previousThread: Thread,
  message: ChatMessage,
): boolean {
  if (message.streaming) {
    return true;
  }
  const latestTurn = previousThread.latestTurn;
  if (!latestTurn) {
    return false;
  }
  if (latestTurn.assistantMessageId === message.id) {
    return true;
  }
  return (
    previousThread.session?.orchestrationStatus === "running" &&
    message.turnId !== undefined &&
    latestTurn.turnId === message.turnId
  );
}

function shouldRetainLiveUserMessageForHotPath(
  previousThread: Thread,
  message: ChatMessage,
): boolean {
  const latestTurn = previousThread.latestTurn;
  if (latestTurn && message.turnId != null && message.turnId === latestTurn.turnId) {
    return (
      latestTurn.state === "running" || previousThread.session?.orchestrationStatus === "running"
    );
  }
  const createdAtMs = Date.parse(message.createdAt);
  return (
    Number.isFinite(createdAtMs) && Date.now() - createdAtMs <= LOCAL_USER_MESSAGE_RETENTION_MS
  );
}

function shouldRetainLiveMessageForHotPath(previousThread: Thread, message: ChatMessage): boolean {
  switch (message.role) {
    case "assistant":
      return shouldRetainLiveAssistantMessageForHotPath(previousThread, message);
    case "user":
      return shouldRetainLiveUserMessageForHotPath(previousThread, message);
    default:
      return false;
  }
}

function mergeReadModelMessagesWithLiveHotPath(
  incomingMessages: ReadModelThread["messages"],
  previousThread: Thread | undefined,
  options?: {
    // Turn the snapshot has just settled: its message contents are final, so the "local row looks
    // richer" heuristics must not resurrect mid-stream text.
    readonly authoritativeTurnId?: TurnId | null;
  },
): ReadModelThread["messages"] {
  if (!previousThread || previousThread.messages.length === 0) {
    return incomingMessages;
  }
  const authoritativeTurnId = options?.authoritativeTurnId ?? null;

  const previousMessageById = new Map(
    previousThread.messages.map((message) => [message.id, message] as const),
  );
  const mergedById = new Map<MessageId, ReadModelThread["messages"][number]>();
  let changed = false;

  for (const incomingMessage of incomingMessages) {
    const previousMessage = previousMessageById.get(incomingMessage.id);
    if (!previousMessage || previousMessage.role !== incomingMessage.role) {
      mergedById.set(incomingMessage.id, incomingMessage);
      continue;
    }

    const incomingCompletedAt = incomingMessage.streaming ? undefined : incomingMessage.updatedAt;
    const localStreamingTextIsAhead =
      previousMessage.streaming && previousMessage.text.length > incomingMessage.text.length;
    const shouldPreferLiveMessage =
      (authoritativeTurnId === null || incomingMessage.turnId !== authoritativeTurnId) &&
      (localStreamingTextIsAhead ||
        (!previousMessage.streaming && incomingMessage.streaming) ||
        (previousMessage.completedAt !== undefined &&
          (incomingCompletedAt === undefined ||
            previousMessage.completedAt > incomingCompletedAt)));

    if (!shouldPreferLiveMessage) {
      if (
        import.meta.env.DEV &&
        !previousMessage.streaming &&
        previousMessage.text.length > incomingMessage.text.length
      ) {
        console.warn("[transcript] replacing longer completed local message with snapshot text", {
          messageId: incomingMessage.id,
          localLength: previousMessage.text.length,
          snapshotLength: incomingMessage.text.length,
        });
      }
      mergedById.set(incomingMessage.id, {
        ...incomingMessage,
        ...(!incomingMessage.mentions || incomingMessage.mentions.length === 0
          ? previousMessage.mentions && previousMessage.mentions.length > 0
            ? { mentions: previousMessage.mentions }
            : {}
          : {}),
        ...(!incomingMessage.skills || incomingMessage.skills.length === 0
          ? previousMessage.skills && previousMessage.skills.length > 0
            ? { skills: previousMessage.skills }
            : {}
          : {}),
      });
      continue;
    }

    changed = true;
    mergedById.set(incomingMessage.id, {
      ...incomingMessage,
      text: previousMessage.text,
      dispatchMode: previousMessage.dispatchMode ?? incomingMessage.dispatchMode,
      dispatchOrigin: incomingMessage.dispatchOrigin ?? previousMessage.dispatchOrigin,
      startsNewTurn: incomingMessage.startsNewTurn ?? previousMessage.startsNewTurn,
      asyncUserInput: mergeAsyncUserInput(
        previousMessage.asyncUserInput,
        incomingMessage.asyncUserInput,
      ),
      turnId: previousMessage.turnId ?? incomingMessage.turnId ?? null,
      source: previousMessage.source ?? incomingMessage.source ?? "native",
      streaming: previousMessage.streaming,
      updatedAt:
        previousMessage.updatedAt ?? previousMessage.completedAt ?? incomingMessage.updatedAt,
      attachments: readModelAttachmentsFromChatMessage(previousMessage.attachments),
      ...(previousMessage.skills && previousMessage.skills.length > 0
        ? { skills: previousMessage.skills }
        : {}),
      ...(previousMessage.mentions && previousMessage.mentions.length > 0
        ? { mentions: previousMessage.mentions }
        : {}),
    });
  }

  for (const previousMessage of previousThread.messages) {
    if (mergedById.has(previousMessage.id)) {
      continue;
    }
    if (!shouldRetainLiveMessageForHotPath(previousThread, previousMessage)) {
      continue;
    }
    changed = true;
    mergedById.set(previousMessage.id, readModelMessageFromChatMessage(previousMessage));
  }

  if (!changed) {
    return incomingMessages;
  }

  return [...mergedById.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function hasLiveAssistantIntro(previousThread: Thread | undefined): boolean {
  if (!previousThread) {
    return false;
  }
  const latestTurn = previousThread.latestTurn;
  if (!latestTurn || latestTurn.state !== "running") {
    return false;
  }
  if (previousThread.session?.orchestrationStatus !== "running") {
    return false;
  }
  return previousThread.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.turnId === latestTurn.turnId &&
      (message.streaming || message.id === latestTurn.assistantMessageId),
  );
}

function shouldPreserveRunningTurn(
  previousThread: Thread | undefined,
  incoming: ReadModelThread,
): boolean {
  if (!hasLiveAssistantIntro(previousThread)) {
    return false;
  }
  const previousTurnId = previousThread?.latestTurn?.turnId;
  if (!previousTurnId) {
    return false;
  }
  if (incoming.latestTurn?.turnId !== previousTurnId) {
    return true;
  }
  if (incoming.latestTurn.completedAt) {
    return false;
  }
  return true;
}

function readModelSessionFromThreadSession(
  previousSession: ThreadSession,
  previousThread: Thread | undefined,
  incomingSession: ReadModelThread["session"],
): NonNullable<ReadModelThread["session"]> {
  return {
    threadId: previousThread?.id ?? incomingSession?.threadId ?? ThreadId.makeUnsafe("unknown"),
    status: previousSession.orchestrationStatus,
    providerName: previousSession.provider,
    runtimeMode: previousThread?.runtimeMode ?? incomingSession?.runtimeMode ?? "full-access",
    activeTurnId: previousSession.activeTurnId ?? null,
    lastError: previousSession.lastError ?? null,
    updatedAt: previousSession.updatedAt,
  };
}

function mergeReadModelSessionWithLiveHotPath(
  incomingSession: ReadModelThread["session"],
  previousThread: Thread | undefined,
  options: {
    preserveRunningTurn: boolean;
    incomingLatestTurn: ReadModelThread["latestTurn"];
  },
): ReadModelThread["session"] {
  const previousSession = previousThread?.session;
  if (!previousSession || !options.preserveRunningTurn) {
    return incomingSession;
  }
  if (!incomingSession) {
    return previousSession.orchestrationStatus === "running"
      ? readModelSessionFromThreadSession(previousSession, previousThread, incomingSession)
      : incomingSession;
  }
  if (previousSession.updatedAt > incomingSession.updatedAt) {
    const nextSession = readModelSessionFromThreadSession(
      previousSession,
      previousThread,
      incomingSession,
    );
    return {
      ...nextSession,
      providerName: incomingSession.providerName,
      runtimeMode: incomingSession.runtimeMode,
      activeTurnId: previousSession.activeTurnId ?? incomingSession.activeTurnId,
      lastError: previousSession.lastError ?? incomingSession.lastError,
    };
  }
  // Equal timestamps are ambiguous (a queued follow-up can start in the same millisecond the prior
  // turn settles), so they preserve the local running session and let the next live event or snapshot
  // resolve the race.
  const supersededByTerminalTurn =
    incomingSession.updatedAt > previousSession.updatedAt &&
    options.incomingLatestTurn != null &&
    options.incomingLatestTurn.completedAt != null &&
    options.incomingLatestTurn.turnId !== previousThread?.latestTurn?.turnId;
  if (
    previousSession.orchestrationStatus === "running" &&
    incomingSession.status !== "running" &&
    incomingSession.status !== "error" &&
    previousSession.activeTurnId !== undefined &&
    !supersededByTerminalTurn
  ) {
    return {
      ...incomingSession,
      status: "running",
      activeTurnId: previousSession.activeTurnId,
      lastError: previousSession.lastError ?? incomingSession.lastError,
      updatedAt:
        previousSession.updatedAt >= incomingSession.updatedAt
          ? previousSession.updatedAt
          : incomingSession.updatedAt,
    };
  }
  return incomingSession;
}

function mergeReadModelLatestTurnWithLiveHotPath(
  incomingLatestTurn: ReadModelThread["latestTurn"],
  previousThread: Thread | undefined,
  options: {
    preserveRunningTurn: boolean;
  },
): ReadModelThread["latestTurn"] {
  const previousLatestTurn = previousThread?.latestTurn;
  if (!previousLatestTurn) {
    return incomingLatestTurn;
  }
  if (options.preserveRunningTurn) {
    if (incomingLatestTurn === null || incomingLatestTurn.turnId === previousLatestTurn.turnId) {
      return {
        ...(incomingLatestTurn ?? previousLatestTurn),
        turnId: previousLatestTurn.turnId,
        state: "running",
        requestedAt: incomingLatestTurn?.requestedAt ?? previousLatestTurn.requestedAt,
        startedAt: incomingLatestTurn?.startedAt ?? previousLatestTurn.startedAt,
        completedAt: null,
        assistantMessageId:
          previousLatestTurn.assistantMessageId ?? incomingLatestTurn?.assistantMessageId ?? null,
      };
    }
    return incomingLatestTurn;
  }
  if (incomingLatestTurn === null || incomingLatestTurn.turnId !== previousLatestTurn.turnId) {
    return incomingLatestTurn;
  }
  if (
    previousLatestTurn.assistantMessageId === undefined ||
    incomingLatestTurn.assistantMessageId === previousLatestTurn.assistantMessageId
  ) {
    return incomingLatestTurn;
  }
  return {
    ...incomingLatestTurn,
    assistantMessageId: previousLatestTurn.assistantMessageId,
  };
}

function clearSettledTurnStreamingFlags(
  messages: ReadModelThread["messages"],
  settledTurnId: TurnId,
): ReadModelThread["messages"] {
  let changed = false;
  const nextMessages = messages.map((message) => {
    if (!message.streaming || message.turnId !== settledTurnId) {
      return message;
    }
    changed = true;
    return { ...message, streaming: false };
  });
  return changed ? nextMessages : messages;
}

export function mergeReadModelThreadDetailWithLiveHotPath(
  incoming: ReadModelThread,
  previousThread: Thread | undefined,
  snapshotSequence?: number,
): ReadModelThread {
  if (!previousThread) {
    return incoming;
  }

  // A scoped projection refresh is authoritative for a *terminal transition*: the turn it settles
  // must not keep local streaming flags or a resurrected running session alive. It is not
  // authoritative for message contents, so the normal merge still runs — skipping it drops locally
  // streamed assistant text and locally preserved mentions/skills/attachments the snapshot has not
  // caught up with yet.
  const settledLocalTurnId =
    previousThread.latestTurn?.state === "running" &&
    incoming.latestTurn !== null &&
    incoming.latestTurn.turnId === previousThread.latestTurn.turnId &&
    incoming.latestTurn.state !== "running" &&
    incoming.latestTurn.completedAt !== null
      ? incoming.latestTurn.turnId
      : null;

  const preserveRunningTurn =
    settledLocalTurnId === null && shouldPreserveRunningTurn(previousThread, incoming);
  const mergedMessages = mergeReadModelMessagesWithLiveHotPath(incoming.messages, previousThread, {
    authoritativeTurnId: settledLocalTurnId,
  });
  const messages =
    settledLocalTurnId === null
      ? mergedMessages
      : clearSettledTurnStreamingFlags(mergedMessages, settledLocalTurnId);
  const session = mergeReadModelSessionWithLiveHotPath(incoming.session, previousThread, {
    preserveRunningTurn,
    incomingLatestTurn: incoming.latestTurn,
  });
  const latestTurn = mergeReadModelLatestTurnWithLiveHotPath(incoming.latestTurn, previousThread, {
    preserveRunningTurn,
  });
  const claudeCacheReview =
    previousThread.claudeCacheReview !== undefined &&
    (snapshotSequence === undefined
      ? incoming.updatedAt < (previousThread.updatedAt ?? previousThread.createdAt)
      : snapshotSequence < (previousThread.claudeCacheReviewSequence ?? 0))
      ? previousThread.claudeCacheReview
      : incoming.claudeCacheReview;
  if (
    messages === incoming.messages &&
    session === incoming.session &&
    latestTurn === incoming.latestTurn &&
    claudeCacheReview === incoming.claudeCacheReview
  ) {
    return incoming;
  }
  return {
    ...incoming,
    messages,
    session,
    latestTurn,
    ...(claudeCacheReview !== undefined ? { claudeCacheReview } : {}),
  };
}
