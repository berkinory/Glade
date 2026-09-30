import * as Schema from "effect/Schema";
import { normalizePendingUserInputDrafts } from "./pendingUserInputRecovery";
import { ModelSelection, RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { OrchestrationThreadPullRequest } from "@glade/contracts/orchestration/threadEntities";
import { ProjectId, ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  ProviderMentionReference,
  ProviderSkillReference,
} from "@glade/contracts/provider/providerDiscovery";
import type { DeepMutable } from "effect/Types";
import { normalizePersistedAttachment } from "./composerDraftAttachments";
import type { DraftThreadEnvMode } from "./composerDraftDomain";
import {
  legacyMergeModelSelectionIntoProviderModelOptions,
  legacySyncModelSelectionOptions,
  legacyToModelSelectionByProvider,
  normalizeModelSelection,
  normalizeProviderKind,
  normalizeProviderModelOptions,
} from "./composerDraftModels";
import { normalizeBrowserAnnotations } from "./lib/browserAnnotations";
import { ensureInlineTerminalContextPlaceholders } from "./lib/terminalContext";
import { DEFAULT_RUNTIME_MODE } from "./types";
import {
  LEGACY_TERMINAL_DRAFT_MAPPING_SUFFIX,
  normalizePersistedModelSelectionMap,
} from "./composerDraftPersistence.types";
import type {
  LegacyPersistedComposerThreadDraftState,
  PersistedComposerDraftStoreState,
  PersistedComposerThreadDraftState,
  PersistedDraftThreadState,
} from "./composerDraftPersistence.types";
import {
  normalizePersistedAssistantSelection,
  normalizePersistedFileCommentDraft,
  normalizePersistedPastedTextDraft,
  normalizePersistedPromptHistorySavedDraft,
  normalizePersistedPullRequestContextDraft,
  normalizePersistedQueuedTurns,
  normalizePersistedTerminalContextDraft,
} from "./composerDraftPersistence.values";

function normalizeDraftThreadEnvMode(
  value: unknown,
  fallbackWorktreePath: string | null,
): DraftThreadEnvMode {
  if (value === "local" || value === "worktree") {
    return value;
  }
  return fallbackWorktreePath ? "worktree" : "local";
}

export function normalizePersistedDraftThreads(
  rawDraftThreadsByThreadId: unknown,
  rawProjectDraftThreadIdByProjectId: unknown,
): Pick<
  PersistedComposerDraftStoreState,
  "draftThreadsByThreadId" | "projectDraftThreadIdByProjectId"
> {
  const draftThreadsByThreadId: Record<ThreadId, PersistedDraftThreadState> = {};
  if (rawDraftThreadsByThreadId && typeof rawDraftThreadsByThreadId === "object") {
    for (const [threadId, rawDraftThread] of Object.entries(
      rawDraftThreadsByThreadId as Record<string, unknown>,
    )) {
      if (typeof threadId !== "string" || threadId.length === 0) {
        continue;
      }
      if (!rawDraftThread || typeof rawDraftThread !== "object") {
        continue;
      }
      const candidateDraftThread = rawDraftThread as Record<string, unknown>;
      const projectId = candidateDraftThread.projectId;
      const createdAt = candidateDraftThread.createdAt;
      const branch = candidateDraftThread.branch;
      const worktreePath = candidateDraftThread.worktreePath;
      const workingDirectory = candidateDraftThread.workingDirectory;
      let lastKnownPr: OrchestrationThreadPullRequest | null = null;
      if (
        candidateDraftThread.lastKnownPr &&
        typeof candidateDraftThread.lastKnownPr === "object"
      ) {
        try {
          lastKnownPr = Schema.decodeUnknownSync(OrchestrationThreadPullRequest)(
            candidateDraftThread.lastKnownPr,
          );
        } catch {
          lastKnownPr = null;
        }
      }
      const normalizedWorktreePath = typeof worktreePath === "string" ? worktreePath : null;

      const promotedTo =
        typeof candidateDraftThread.promotedTo === "string" &&
        candidateDraftThread.promotedTo.length > 0
          ? (candidateDraftThread.promotedTo as ThreadId)
          : undefined;
      if (typeof projectId !== "string" || projectId.length === 0) {
        continue;
      }
      draftThreadsByThreadId[threadId as ThreadId] = {
        projectId: projectId as ProjectId,
        createdAt:
          typeof createdAt === "string" && createdAt.length > 0
            ? createdAt
            : new Date().toISOString(),
        runtimeMode: Schema.is(RuntimeMode)(candidateDraftThread.runtimeMode)
          ? candidateDraftThread.runtimeMode
          : DEFAULT_RUNTIME_MODE,

        branch: typeof branch === "string" ? branch : null,
        worktreePath: normalizedWorktreePath,
        workingDirectory: typeof workingDirectory === "string" ? workingDirectory : null,
        ...(lastKnownPr ? { lastKnownPr } : {}),
        envMode: normalizeDraftThreadEnvMode(candidateDraftThread.envMode, normalizedWorktreePath),

        ...(promotedTo ? { promotedTo } : {}),
      };
    }
  }

  const projectDraftThreadIdByProjectId: Record<string, ThreadId> = {};
  if (
    rawProjectDraftThreadIdByProjectId &&
    typeof rawProjectDraftThreadIdByProjectId === "object"
  ) {
    const mappings = Object.entries(rawProjectDraftThreadIdByProjectId as Record<string, unknown>);

    mappings.sort(
      ([left], [right]) =>
        Number(left.endsWith(LEGACY_TERMINAL_DRAFT_MAPPING_SUFFIX)) -
        Number(right.endsWith(LEGACY_TERMINAL_DRAFT_MAPPING_SUFFIX)),
    );
    for (const [mappingKey, threadId] of mappings) {
      const isLegacyTerminalMapping = mappingKey.endsWith(LEGACY_TERMINAL_DRAFT_MAPPING_SUFFIX);
      const projectId = isLegacyTerminalMapping
        ? mappingKey.slice(0, -LEGACY_TERMINAL_DRAFT_MAPPING_SUFFIX.length)
        : mappingKey;
      if (
        typeof projectId === "string" &&
        projectId.length > 0 &&
        typeof threadId === "string" &&
        threadId.length > 0
      ) {
        if (!projectDraftThreadIdByProjectId[projectId]) {
          projectDraftThreadIdByProjectId[projectId] = threadId as ThreadId;
        }
        if (!draftThreadsByThreadId[threadId as ThreadId]) {
          draftThreadsByThreadId[threadId as ThreadId] = {
            projectId: projectId as ProjectId,
            createdAt: new Date().toISOString(),
            runtimeMode: DEFAULT_RUNTIME_MODE,

            branch: null,
            worktreePath: null,
            workingDirectory: null,
            envMode: "local",
          };
        } else if (draftThreadsByThreadId[threadId as ThreadId]?.projectId !== projectId) {
          draftThreadsByThreadId[threadId as ThreadId] = {
            ...draftThreadsByThreadId[threadId as ThreadId]!,
            projectId: projectId as ProjectId,
          };
        }
      }
    }
  }

  return { draftThreadsByThreadId, projectDraftThreadIdByProjectId };
}

export function normalizePersistedDraftsByThreadId(
  rawDraftMap: unknown,
): PersistedComposerDraftStoreState["draftsByThreadId"] {
  if (!rawDraftMap || typeof rawDraftMap !== "object") {
    return {};
  }

  const nextDraftsByThreadId: DeepMutable<PersistedComposerDraftStoreState["draftsByThreadId"]> =
    {};
  for (const [threadId, draftValue] of Object.entries(rawDraftMap as Record<string, unknown>)) {
    if (typeof threadId !== "string" || threadId.length === 0) {
      continue;
    }
    if (!draftValue || typeof draftValue !== "object") {
      continue;
    }
    const draftCandidate = draftValue as PersistedComposerThreadDraftState;
    const pendingUserInputDrafts = normalizePendingUserInputDrafts(
      draftCandidate.pendingUserInputDrafts,
    );
    const promptCandidate = typeof draftCandidate.prompt === "string" ? draftCandidate.prompt : "";
    const promptHistorySavedDraft = normalizePersistedPromptHistorySavedDraft(
      draftCandidate.promptHistorySavedDraft,
    );
    const attachments = Array.isArray(draftCandidate.attachments)
      ? draftCandidate.attachments.flatMap((entry) => {
          const normalized = normalizePersistedAttachment(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const terminalContexts = Array.isArray(draftCandidate.terminalContexts)
      ? draftCandidate.terminalContexts.flatMap((entry) => {
          const normalized = normalizePersistedTerminalContextDraft(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const assistantSelections = Array.isArray(draftCandidate.assistantSelections)
      ? draftCandidate.assistantSelections.flatMap((entry) => {
          const normalized = normalizePersistedAssistantSelection(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const browserAnnotations = Array.isArray(draftCandidate.browserAnnotations)
      ? normalizeBrowserAnnotations(draftCandidate.browserAnnotations)
      : [];
    const fileComments = Array.isArray(draftCandidate.fileComments)
      ? draftCandidate.fileComments.flatMap((entry) => {
          const normalized = normalizePersistedFileCommentDraft(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const pastedTexts = Array.isArray(draftCandidate.pastedTexts)
      ? draftCandidate.pastedTexts.flatMap((entry) => {
          const normalized = normalizePersistedPastedTextDraft(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const pullRequestContexts = Array.isArray(draftCandidate.pullRequestContexts)
      ? draftCandidate.pullRequestContexts.flatMap((entry) => {
          const normalized = normalizePersistedPullRequestContextDraft(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const skills = Array.isArray(draftCandidate.skills)
      ? draftCandidate.skills.filter(Schema.is(ProviderSkillReference))
      : [];
    const mentions = Array.isArray(draftCandidate.mentions)
      ? draftCandidate.mentions.filter(Schema.is(ProviderMentionReference))
      : [];
    const queuedTurns = normalizePersistedQueuedTurns(draftCandidate.queuedTurns);
    const runtimeMode = Schema.is(RuntimeMode)(draftCandidate.runtimeMode)
      ? draftCandidate.runtimeMode
      : null;

    const enableComputerControl =
      typeof draftCandidate.enableComputerControl === "boolean"
        ? draftCandidate.enableComputerControl
        : undefined;
    const computerControlMode =
      draftCandidate.computerControlMode === "off" ||
      draftCandidate.computerControlMode === "request" ||
      draftCandidate.computerControlMode === "chat"
        ? draftCandidate.computerControlMode
        : undefined;
    const computerControlGeneration =
      typeof draftCandidate.computerControlGeneration === "number" &&
      Number.isSafeInteger(draftCandidate.computerControlGeneration) &&
      draftCandidate.computerControlGeneration >= 0
        ? draftCandidate.computerControlGeneration
        : undefined;
    const prompt = ensureInlineTerminalContextPlaceholders(
      promptCandidate,
      terminalContexts.length,
    );

    const legacyDraftCandidate = draftValue as LegacyPersistedComposerThreadDraftState;
    let modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>> = {};
    let activeProvider: ProviderKind | null = null;

    if (
      draftCandidate.modelSelectionByProvider &&
      typeof draftCandidate.modelSelectionByProvider === "object"
    ) {
      modelSelectionByProvider = normalizePersistedModelSelectionMap(
        draftCandidate.modelSelectionByProvider,
      );
      activeProvider = normalizeProviderKind(draftCandidate.activeProvider);
    } else {
      const normalizedModelOptions =
        normalizeProviderModelOptions(
          legacyDraftCandidate.modelOptions,
          undefined,
          legacyDraftCandidate,
        ) ?? null;
      const normalizedModelSelection = normalizeModelSelection(
        legacyDraftCandidate.modelSelection,
        {
          provider: legacyDraftCandidate.provider,
          model: legacyDraftCandidate.model,
          modelOptions: normalizedModelOptions ?? legacyDraftCandidate.modelOptions,
          legacyCodex: legacyDraftCandidate,
        },
      );
      const mergedModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
        normalizedModelSelection,
        normalizedModelOptions,
      );
      const modelSelection = legacySyncModelSelectionOptions(
        normalizedModelSelection,
        mergedModelOptions,
      );
      modelSelectionByProvider = legacyToModelSelectionByProvider(
        modelSelection,
        mergedModelOptions,
      );
      activeProvider = modelSelection?.provider ?? null;
    }

    const normalizedQueuedTurns = queuedTurns ?? [];

    const hasModelData =
      Object.keys(modelSelectionByProvider).length > 0 || activeProvider !== null;
    const hasQueuedTurns = normalizedQueuedTurns.length > 0;
    const hasReferenceData = skills.length > 0 || mentions.length > 0;
    if (
      Object.keys(pendingUserInputDrafts).length === 0 &&
      promptCandidate.length === 0 &&
      promptHistorySavedDraft === null &&
      attachments.length === 0 &&
      terminalContexts.length === 0 &&
      assistantSelections.length === 0 &&
      browserAnnotations.length === 0 &&
      fileComments.length === 0 &&
      pastedTexts.length === 0 &&
      pullRequestContexts.length === 0 &&
      !hasReferenceData &&
      !hasQueuedTurns &&
      !hasModelData &&
      !runtimeMode &&
      enableComputerControl === undefined &&
      computerControlMode === undefined
    ) {
      continue;
    }
    nextDraftsByThreadId[threadId as ThreadId] = {
      ...(Object.keys(pendingUserInputDrafts).length > 0 ? { pendingUserInputDrafts } : {}),
      prompt,
      ...(promptHistorySavedDraft !== null ? { promptHistorySavedDraft } : {}),
      attachments,
      ...(assistantSelections.length > 0 ? { assistantSelections } : {}),
      ...(browserAnnotations.length > 0 ? { browserAnnotations } : {}),
      ...(terminalContexts.length > 0 ? { terminalContexts } : {}),
      ...(fileComments.length > 0 ? { fileComments } : {}),
      ...(pastedTexts.length > 0 ? { pastedTexts } : {}),
      ...(pullRequestContexts.length > 0 ? { pullRequestContexts } : {}),
      ...(skills.length > 0 ? { skills } : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
      ...(hasQueuedTurns ? { queuedTurns: normalizedQueuedTurns } : {}),

      ...(hasModelData ? { modelSelectionByProvider, activeProvider } : {}),
      ...(runtimeMode ? { runtimeMode } : {}),

      ...(enableComputerControl !== undefined ? { enableComputerControl } : {}),
      ...(computerControlMode !== undefined ? { computerControlMode } : {}),
      ...(computerControlGeneration !== undefined ? { computerControlGeneration } : {}),
    };
  }

  return nextDraftsByThreadId;
}
