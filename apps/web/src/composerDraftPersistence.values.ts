import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { ProviderStartOptions, RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  ProviderMentionReference,
  ProviderSkillReference,
} from "@glade/contracts/provider/providerDiscovery";
import type { DeepMutable } from "effect/Types";
import { normalizePersistedAttachment } from "./composerDraftAttachments";
import { normalizeModelSelection, normalizeProviderKind } from "./composerDraftModels";
import { normalizeAssistantSelectionAttachment } from "./lib/assistantSelections";
import { normalizePastedTextContent } from "./lib/composerPastedText";
import { isPullRequestContextScope } from "./lib/pullRequestContext";
import { normalizeFileCommentSelection } from "./lib/fileComments";
import { normalizeTerminalContextText } from "./lib/terminalContext";
import {
  PersistedAssistantSelectionDraft,
  PersistedFileCommentDraft,
} from "./composerDraftPersistence.types";
import type {
  PersistedComposerPromptHistorySavedDraft,
  PersistedComposerThreadDraftState,
  PersistedPastedTextDraft,
  PersistedPullRequestContextDraft,
  PersistedQueuedTerminalContextDraft,
  PersistedTerminalContextDraft,
} from "./composerDraftPersistence.types";

export function normalizePersistedPromptHistorySavedDraft(
  value: unknown,
): DeepMutable<PersistedComposerPromptHistorySavedDraft> | null {
  if (typeof value === "string") {
    return { prompt: value, attachments: [] };
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt : null;
  if (prompt === null) {
    return null;
  }
  const attachments = Array.isArray(candidate.attachments)
    ? candidate.attachments.flatMap((entry) => {
        const normalized = normalizePersistedAttachment(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const assistantSelections = Array.isArray(candidate.assistantSelections)
    ? candidate.assistantSelections.flatMap((entry) => {
        const normalized = normalizePersistedAssistantSelection(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const terminalContexts = Array.isArray(candidate.terminalContexts)
    ? candidate.terminalContexts.flatMap((entry) => {
        const normalized = normalizePersistedTerminalContextDraft(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const fileComments = Array.isArray(candidate.fileComments)
    ? candidate.fileComments.flatMap((entry) => {
        const normalized = normalizePersistedFileCommentDraft(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const pastedTexts = Array.isArray(candidate.pastedTexts)
    ? candidate.pastedTexts.flatMap((entry) => {
        const normalized = normalizePersistedPastedTextDraft(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const pullRequestContexts = Array.isArray(candidate.pullRequestContexts)
    ? candidate.pullRequestContexts.flatMap((entry) => {
        const normalized = normalizePersistedPullRequestContextDraft(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const skills = Array.isArray(candidate.skills)
    ? candidate.skills.filter(Schema.is(ProviderSkillReference))
    : [];
  const mentions = Array.isArray(candidate.mentions)
    ? candidate.mentions.filter(Schema.is(ProviderMentionReference))
    : [];
  return {
    prompt,
    attachments,
    ...(assistantSelections.length > 0 ? { assistantSelections } : {}),
    ...(terminalContexts.length > 0 ? { terminalContexts } : {}),
    ...(fileComments.length > 0 ? { fileComments } : {}),
    ...(pastedTexts.length > 0 ? { pastedTexts } : {}),
    ...(pullRequestContexts.length > 0 ? { pullRequestContexts } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(mentions.length > 0 ? { mentions } : {}),
  };
}

export function normalizePersistedTerminalContextDraft(
  value: unknown,
): PersistedTerminalContextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const threadId = candidate.threadId;
  const createdAt = candidate.createdAt;
  const lineStart = candidate.lineStart;
  const lineEnd = candidate.lineEnd;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    typeof createdAt !== "string" ||
    createdAt.length === 0 ||
    typeof lineStart !== "number" ||
    !Number.isFinite(lineStart) ||
    typeof lineEnd !== "number" ||
    !Number.isFinite(lineEnd)
  ) {
    return null;
  }
  const terminalId = typeof candidate.terminalId === "string" ? candidate.terminalId.trim() : "";
  const terminalLabel =
    typeof candidate.terminalLabel === "string" ? candidate.terminalLabel.trim() : "";
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const normalizedLineStart = Math.max(1, Math.floor(lineStart));
  const normalizedLineEnd = Math.max(normalizedLineStart, Math.floor(lineEnd));
  return {
    id,
    threadId: threadId as ThreadId,
    createdAt,
    terminalId,
    terminalLabel,
    lineStart: normalizedLineStart,
    lineEnd: normalizedLineEnd,
  };
}

function normalizePersistedQueuedTerminalContextDraft(
  value: unknown,
): PersistedQueuedTerminalContextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const base = normalizePersistedTerminalContextDraft(candidate);
  if (!base) {
    return null;
  }
  const text =
    typeof candidate.text === "string" ? normalizeTerminalContextText(candidate.text) : "";
  return {
    ...base,
    text,
  };
}

export function normalizePersistedAssistantSelection(
  value: unknown,
): { id: string; assistantMessageId: string; text: string } | null {
  const decoded = Schema.decodeUnknownOption(PersistedAssistantSelectionDraft)(value);
  if (Option.isNone(decoded) || decoded.value.id.length === 0) return null;
  const normalized = normalizeAssistantSelectionAttachment(decoded.value);
  if (!normalized) {
    return null;
  }
  return { id: decoded.value.id, ...normalized };
}

export function normalizePersistedFileCommentDraft(
  value: unknown,
): PersistedFileCommentDraft | null {
  const decoded = Schema.decodeUnknownOption(PersistedFileCommentDraft)(value);
  if (
    Option.isNone(decoded) ||
    decoded.value.id.length === 0 ||
    !Number.isFinite(decoded.value.startLine) ||
    !Number.isFinite(decoded.value.endLine)
  )
    return null;
  const normalized = normalizeFileCommentSelection(decoded.value);
  if (!normalized) {
    return null;
  }
  return { id: decoded.value.id, ...normalized };
}

export function normalizePersistedPastedTextDraft(value: unknown): PersistedPastedTextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : "";
  const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : "";
  const text = typeof candidate.text === "string" ? normalizePastedTextContent(candidate.text) : "";
  if (id.length === 0 || text.length === 0) {
    return null;
  }
  return { id, createdAt, text };
}

export function normalizePersistedPullRequestContextDraft(
  value: unknown,
): PersistedPullRequestContextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : "";
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  const prNumber = typeof candidate.prNumber === "number" ? candidate.prNumber : 0;
  if (
    id.length === 0 ||
    text.length === 0 ||
    title.length === 0 ||
    !isPullRequestContextScope(candidate.scope) ||
    !Number.isInteger(prNumber) ||
    prNumber <= 0
  ) {
    return null;
  }
  return {
    id,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    scope: candidate.scope,
    prNumber,
    prUrl: typeof candidate.prUrl === "string" ? candidate.prUrl : "",
    title,
    subtitle: typeof candidate.subtitle === "string" ? candidate.subtitle : "",
    text,
  };
}

export function normalizePersistedQueuedTurns(
  rawQueuedTurns: unknown,
): DeepMutable<NonNullable<PersistedComposerThreadDraftState["queuedTurns"]>> | undefined {
  if (!Array.isArray(rawQueuedTurns)) {
    return undefined;
  }
  const normalizedTurns: DeepMutable<
    NonNullable<PersistedComposerThreadDraftState["queuedTurns"]>
  > = [];
  const seenIds = new Set<string>();
  for (const entry of rawQueuedTurns) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const kind = candidate.kind;
    const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : "";
    const previewText = typeof candidate.previewText === "string" ? candidate.previewText : "";
    const selectedProvider = normalizeProviderKind(candidate.selectedProvider);
    const selectedModel =
      candidate.selectedModel === null
        ? null
        : typeof candidate.selectedModel === "string"
          ? candidate.selectedModel
          : null;
    const selectedPromptEffort =
      candidate.selectedPromptEffort === null
        ? null
        : typeof candidate.selectedPromptEffort === "string"
          ? candidate.selectedPromptEffort
          : null;
    const modelSelection = normalizeModelSelection(candidate.modelSelection);
    const providerOptionsForDispatch = Schema.is(ProviderStartOptions)(
      candidate.providerOptionsForDispatch,
    )
      ? candidate.providerOptionsForDispatch
      : undefined;

    const runtimeMode = Schema.is(RuntimeMode)(candidate.runtimeMode)
      ? candidate.runtimeMode
      : null;
    if (
      id.length === 0 ||
      createdAt.length === 0 ||
      previewText.length === 0 ||
      selectedProvider === null ||
      modelSelection === null ||
      runtimeMode === null ||
      seenIds.has(id)
    ) {
      continue;
    }
    if (kind === "chat") {
      const prompt = typeof candidate.prompt === "string" ? candidate.prompt : "";
      const images = Array.isArray(candidate.images)
        ? candidate.images.flatMap((image) => {
            const normalized = normalizePersistedAttachment(image);
            return normalized ? [normalized] : [];
          })
        : [];
      const terminalContexts = Array.isArray(candidate.terminalContexts)
        ? candidate.terminalContexts.flatMap((context) => {
            const normalized = normalizePersistedQueuedTerminalContextDraft(context);
            return normalized ? [normalized] : [];
          })
        : [];
      const assistantSelections = Array.isArray(candidate.assistantSelections)
        ? candidate.assistantSelections.flatMap((selection) => {
            const normalized = normalizePersistedAssistantSelection(selection);
            return normalized ? [normalized] : [];
          })
        : [];
      const fileComments = Array.isArray(candidate.fileComments)
        ? candidate.fileComments.flatMap((comment) => {
            const normalized = normalizePersistedFileCommentDraft(comment);
            return normalized ? [normalized] : [];
          })
        : [];
      const pastedTexts = Array.isArray(candidate.pastedTexts)
        ? candidate.pastedTexts.flatMap((pasted) => {
            const normalized = normalizePersistedPastedTextDraft(pasted);
            return normalized ? [normalized] : [];
          })
        : [];
      const pullRequestContexts = Array.isArray(candidate.pullRequestContexts)
        ? candidate.pullRequestContexts.flatMap((entry) => {
            const normalized = normalizePersistedPullRequestContextDraft(entry);
            return normalized ? [normalized] : [];
          })
        : [];
      const skills = Array.isArray(candidate.skills)
        ? candidate.skills.filter(Schema.is(ProviderSkillReference))
        : [];
      const mentions = Array.isArray(candidate.mentions)
        ? candidate.mentions.filter(Schema.is(ProviderMentionReference))
        : [];

      const envMode =
        candidate.envMode === "local" || candidate.envMode === "worktree"
          ? candidate.envMode
          : null;
      if (envMode === null) {
        continue;
      }
      normalizedTurns.push({
        id,
        kind: "chat",
        createdAt,
        previewText,
        prompt,
        images,
        ...(assistantSelections.length > 0 ? { assistantSelections } : {}),
        terminalContexts,
        ...(fileComments.length > 0 ? { fileComments } : {}),
        ...(pastedTexts.length > 0 ? { pastedTexts } : {}),
        ...(pullRequestContexts.length > 0 ? { pullRequestContexts } : {}),
        skills: [...skills],
        mentions: [...mentions],
        selectedProvider,
        selectedModel,
        selectedPromptEffort,
        modelSelection,
        ...(providerOptionsForDispatch ? { providerOptionsForDispatch } : {}),

        runtimeMode,

        envMode,
      });
      seenIds.add(id);
      continue;
    }
  }
  return normalizedTurns.length > 0 ? normalizedTurns : undefined;
}
