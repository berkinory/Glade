import * as Schema from "effect/Schema";
import {
  ModelSelection,
  ProviderInteractionMode,
  ProviderStartOptions,
  RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";
import {
  OrchestrationProposedPlanId,
  OrchestrationThreadPullRequest,
} from "@glade/contracts/orchestration/threadEntities";
import { ProjectId, ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  ProviderMentionReference,
  ProviderSkillReference,
} from "@glade/contracts/provider/providerDiscovery";
import { ProviderModelOptions } from "@glade/contracts/provider/model";
import { PersistedComposerImageAttachment } from "./composerDraftDomain";
import { LegacyCodexFields, normalizeModelSelection } from "./composerDraftModels";
import type { BrowserAnnotationDraft } from "./lib/browserAnnotations";
import { PULL_REQUEST_CONTEXT_SCOPES } from "./lib/pullRequestContext";

const DraftThreadEnvModeSchema = Schema.Literals(["local", "worktree"]);

export const LEGACY_TERMINAL_DRAFT_MAPPING_SUFFIX = "::terminal";

export function normalizePersistedModelSelectionMap(
  value: unknown,
): Partial<Record<ProviderKind, ModelSelection>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Partial<Record<ProviderKind, ModelSelection>> = {};
  for (const [legacyProvider, rawSelection] of Object.entries(value)) {
    const selection = normalizeModelSelection(rawSelection, {
      provider: legacyProvider,
      model:
        rawSelection !== null && typeof rawSelection === "object" && !Array.isArray(rawSelection)
          ? (rawSelection as Record<string, unknown>).model
          : undefined,
    });
    if (selection) {
      result[selection.provider] = selection;
    }
  }
  return result;
}

export function cloneBrowserAnnotation(annotation: BrowserAnnotationDraft): BrowserAnnotationDraft {
  return {
    ...annotation,
    source: { ...annotation.source },
  };
}

const PersistedTerminalContextDraft = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  createdAt: Schema.String,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
});

export type PersistedTerminalContextDraft = typeof PersistedTerminalContextDraft.Type;

const PersistedQueuedTerminalContextDraft = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  createdAt: Schema.String,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
  text: Schema.String,
});

export type PersistedQueuedTerminalContextDraft = typeof PersistedQueuedTerminalContextDraft.Type;

const PersistedFileCommentDraft = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  text: Schema.String,
});

export type PersistedFileCommentDraft = typeof PersistedFileCommentDraft.Type;

const PersistedPastedTextDraft = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  text: Schema.String,
});

export type PersistedPastedTextDraft = typeof PersistedPastedTextDraft.Type;

const PersistedPullRequestContextDraft = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  scope: Schema.Literals(PULL_REQUEST_CONTEXT_SCOPES),
  prNumber: Schema.Number,
  prUrl: Schema.String,
  title: Schema.String,
  subtitle: Schema.String,
  text: Schema.String,
});

export type PersistedPullRequestContextDraft = typeof PersistedPullRequestContextDraft.Type;

export const PersistedSourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const PersistedRestoredSourceProposedPlan = Schema.Struct({
  threadId: ThreadId,
  restoredPrompt: Schema.String,
  sourceProposedPlan: PersistedSourceProposedPlanReference,
});

const PersistedAssistantSelectionDraft = Schema.Struct({
  id: Schema.String,
  assistantMessageId: Schema.String,
  text: Schema.String,
});

type PersistedAssistantSelectionDraft = typeof PersistedAssistantSelectionDraft.Type;

const PersistedBrowserAnnotationDraft = Schema.Struct({
  id: Schema.String,
  ordinal: Schema.Number,
  tabId: Schema.String,
  documentKey: Schema.optionalKey(Schema.String),
  source: Schema.Struct({
    url: Schema.String,
    pageTitle: Schema.String,
  }),
  selector: Schema.String,
  tagName: Schema.String,
  role: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  fingerprint: Schema.String,
  comment: Schema.NullOr(Schema.String),
  capturedAt: Schema.String,
});

const PersistedQueuedComposerChatTurn = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("chat"),
  createdAt: Schema.String,
  previewText: Schema.String,
  prompt: Schema.String,
  images: Schema.Array(PersistedComposerImageAttachment),
  assistantSelections: Schema.optionalKey(Schema.Array(PersistedAssistantSelectionDraft)),
  browserAnnotations: Schema.optionalKey(Schema.Array(PersistedBrowserAnnotationDraft)),
  terminalContexts: Schema.Array(PersistedQueuedTerminalContextDraft),
  fileComments: Schema.optionalKey(Schema.Array(PersistedFileCommentDraft)),
  pastedTexts: Schema.optionalKey(Schema.Array(PersistedPastedTextDraft)),
  pullRequestContexts: Schema.optionalKey(Schema.Array(PersistedPullRequestContextDraft)),
  skills: Schema.Array(ProviderSkillReference),
  mentions: Schema.Array(ProviderMentionReference),
  selectedProvider: ProviderKind,
  selectedModel: Schema.NullOr(Schema.String),
  selectedPromptEffort: Schema.NullOr(Schema.String),
  modelSelection: ModelSelection,
  providerOptionsForDispatch: Schema.optionalKey(ProviderStartOptions),
  enableComputerControl: Schema.optionalKey(Schema.Boolean),
  computerControlMode: Schema.optionalKey(Schema.Literals(["off", "request", "chat"])),
  computerControlGeneration: Schema.optionalKey(Schema.Number),
  sourceProposedPlan: Schema.optionalKey(PersistedSourceProposedPlanReference),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  envMode: DraftThreadEnvModeSchema,
});

type PersistedQueuedComposerChatTurn = typeof PersistedQueuedComposerChatTurn.Type;

const PersistedQueuedComposerPlanFollowUp = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("plan-follow-up"),
  createdAt: Schema.String,
  previewText: Schema.String,
  text: Schema.String,
  interactionMode: Schema.Literals(["default", "plan"]),
  selectedProvider: ProviderKind,
  selectedModel: Schema.NullOr(Schema.String),
  selectedPromptEffort: Schema.NullOr(Schema.String),
  modelSelection: ModelSelection,
  providerOptionsForDispatch: Schema.optionalKey(ProviderStartOptions),
  enableComputerControl: Schema.optionalKey(Schema.Boolean),
  computerControlMode: Schema.optionalKey(Schema.Literals(["off", "request", "chat"])),
  computerControlGeneration: Schema.optionalKey(Schema.Number),
  runtimeMode: RuntimeMode,
});

type PersistedQueuedComposerPlanFollowUp = typeof PersistedQueuedComposerPlanFollowUp.Type;

const PersistedQueuedComposerTurn = Schema.Union([
  PersistedQueuedComposerChatTurn,
  PersistedQueuedComposerPlanFollowUp,
]);

export type PersistedQueuedComposerTurn = typeof PersistedQueuedComposerTurn.Type;

const PersistedComposerPromptHistorySavedDraft = Schema.Union([
  Schema.String,
  Schema.Struct({
    prompt: Schema.String,
    attachments: Schema.optionalKey(Schema.Array(PersistedComposerImageAttachment)),
    assistantSelections: Schema.optionalKey(Schema.Array(PersistedAssistantSelectionDraft)),
    browserAnnotations: Schema.optionalKey(Schema.Array(PersistedBrowserAnnotationDraft)),
    terminalContexts: Schema.optionalKey(Schema.Array(PersistedTerminalContextDraft)),
    fileComments: Schema.optionalKey(Schema.Array(PersistedFileCommentDraft)),
    pastedTexts: Schema.optionalKey(Schema.Array(PersistedPastedTextDraft)),
    pullRequestContexts: Schema.optionalKey(Schema.Array(PersistedPullRequestContextDraft)),
    skills: Schema.optionalKey(Schema.Array(ProviderSkillReference)),
    mentions: Schema.optionalKey(Schema.Array(ProviderMentionReference)),
  }),
]);

export type PersistedComposerPromptHistorySavedDraft =
  typeof PersistedComposerPromptHistorySavedDraft.Type;

const PersistedComposerThreadDraftState = Schema.Struct({
  pendingUserInputDrafts: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  prompt: Schema.String,

  promptHistorySavedDraft: Schema.optionalKey(PersistedComposerPromptHistorySavedDraft),
  attachments: Schema.Array(PersistedComposerImageAttachment),
  assistantSelections: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        assistantMessageId: Schema.String,
        text: Schema.String,
      }),
    ),
  ),
  browserAnnotations: Schema.optionalKey(Schema.Array(PersistedBrowserAnnotationDraft)),
  terminalContexts: Schema.optionalKey(Schema.Array(PersistedTerminalContextDraft)),
  fileComments: Schema.optionalKey(Schema.Array(PersistedFileCommentDraft)),
  pastedTexts: Schema.optionalKey(Schema.Array(PersistedPastedTextDraft)),
  pullRequestContexts: Schema.optionalKey(Schema.Array(PersistedPullRequestContextDraft)),
  skills: Schema.optionalKey(Schema.Array(ProviderSkillReference)),
  mentions: Schema.optionalKey(Schema.Array(ProviderMentionReference)),
  queuedTurns: Schema.optionalKey(Schema.Array(PersistedQueuedComposerTurn)),
  restoredSourceProposedPlan: Schema.optionalKey(PersistedRestoredSourceProposedPlan),
  modelSelectionByProvider: Schema.optionalKey(
    Schema.Record(ProviderKind, Schema.optionalKey(ModelSelection)),
  ),
  activeProvider: Schema.optionalKey(Schema.NullOr(ProviderKind)),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
  enableComputerControl: Schema.optionalKey(Schema.Boolean),
  computerControlMode: Schema.optionalKey(Schema.Literals(["off", "request", "chat"])),
  computerControlGeneration: Schema.optionalKey(Schema.Number),
});

export type PersistedComposerThreadDraftState = typeof PersistedComposerThreadDraftState.Type;

const LegacyThreadModelFields = Schema.Struct({
  provider: Schema.optionalKey(ProviderKind),
  model: Schema.optionalKey(Schema.String),
  modelOptions: Schema.optionalKey(Schema.NullOr(ProviderModelOptions)),
});

type LegacyThreadModelFields = typeof LegacyThreadModelFields.Type;

type LegacyV2ThreadDraftFields = {
  modelSelection?: ModelSelection | null;
  modelOptions?: ProviderModelOptions | null;
};

export type LegacyPersistedComposerThreadDraftState = PersistedComposerThreadDraftState &
  LegacyCodexFields &
  LegacyThreadModelFields &
  LegacyV2ThreadDraftFields;

const LegacyStickyModelFields = Schema.Struct({
  stickyProvider: Schema.optionalKey(ProviderKind),
  stickyModel: Schema.optionalKey(Schema.String),
  stickyModelOptions: Schema.optionalKey(Schema.NullOr(ProviderModelOptions)),
});

type LegacyStickyModelFields = typeof LegacyStickyModelFields.Type;

type LegacyV2StoreFields = {
  stickyModelSelection?: ModelSelection | null;
  stickyModelOptions?: ProviderModelOptions | null;
};

export type LegacyPersistedComposerDraftStoreState = PersistedComposerDraftStoreState &
  LegacyStickyModelFields &
  LegacyV2StoreFields;

const PersistedDraftThreadState = Schema.Struct({
  projectId: ProjectId,
  createdAt: Schema.String,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  workingDirectory: Schema.optionalKey(Schema.NullOr(Schema.String)),
  lastKnownPr: Schema.optionalKey(Schema.NullOr(OrchestrationThreadPullRequest)),
  envMode: DraftThreadEnvModeSchema,
  goal: Schema.optionalKey(Schema.String),
  promotedTo: Schema.optionalKey(ThreadId),
});

export type PersistedDraftThreadState = typeof PersistedDraftThreadState.Type;

const PersistedComposerDraftStoreState = Schema.Struct({
  draftsByThreadId: Schema.Record(ThreadId, PersistedComposerThreadDraftState),
  draftThreadsByThreadId: Schema.Record(ThreadId, PersistedDraftThreadState),
  projectDraftThreadIdByProjectId: Schema.Record(ProjectId, ThreadId),
  stickyModelSelectionByProvider: Schema.optionalKey(
    Schema.Record(ProviderKind, Schema.optionalKey(ModelSelection)),
  ),
  stickyActiveProvider: Schema.optionalKey(Schema.NullOr(ProviderKind)),
});

export type PersistedComposerDraftStoreState = typeof PersistedComposerDraftStoreState.Type;

export const EMPTY_PERSISTED_DRAFT_STORE_STATE = Object.freeze<PersistedComposerDraftStoreState>({
  draftsByThreadId: {},
  draftThreadsByThreadId: {},
  projectDraftThreadIdByProjectId: {},
  stickyModelSelectionByProvider: {},
  stickyActiveProvider: null,
});
