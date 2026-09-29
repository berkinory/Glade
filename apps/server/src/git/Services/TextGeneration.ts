import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type {
  AutomationMode,
  ChatAttachment,
  ModelSelection,
  ProviderStartOptions,
  ServerGenerateAutomationIntentResult,
} from "@glade/contracts";

import type { TextGenerationError } from "../Errors.ts";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  codexHomePath?: string;

  includeBranch?: boolean;

  model?: string;

  modelSelection?: ModelSelection;

  providerOptions?: ProviderStartOptions;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;

  branch?: string | undefined;
}

export interface PrContentGenerationInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;

  prTemplate?: string | undefined;
  codexHomePath?: string;

  model?: string;

  modelSelection?: ModelSelection;

  providerOptions?: ProviderStartOptions;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface DiffSummaryGenerationInput {
  cwd: string;
  patch: string;
  codexHomePath?: string;

  model?: string;

  modelSelection?: ModelSelection;

  providerOptions?: ProviderStartOptions;
}

export interface DiffSummaryGenerationResult {
  summary: string;
}

export interface BranchNameGenerationInput {
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;

  model?: string;

  modelSelection?: ModelSelection;

  providerOptions?: ProviderStartOptions;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  cwd: string;
  message: string;

  context?: "conversation";
  attachments?: ReadonlyArray<ChatAttachment> | undefined;

  model?: string;

  modelSelection?: ModelSelection;

  providerOptions?: ProviderStartOptions;
}

export interface ThreadTitleGenerationResult {
  title: string;
}

export interface AutomationIntentGenerationInput {
  cwd: string;
  message: string;
  defaultMode?: AutomationMode;
  nowIso: string;
  codexHomePath?: string;

  model?: string;

  modelSelection?: ModelSelection;

  providerOptions?: ProviderStartOptions;
}

export type AutomationIntentGenerationResult = ServerGenerateAutomationIntentResult;

export interface AutomationCompletionEvaluationInput {
  cwd: string;
  automationName: string;
  automationPrompt: string;
  stopWhen: string;
  runUserMessage: string;
  runAssistantText: string;
  threadContext?: string | undefined;
  codexHomePath?: string;

  model?: string;

  modelSelection?: ModelSelection;

  providerOptions?: ProviderStartOptions;
}

export interface AutomationCompletionEvaluationResult {
  stopMatched: boolean;
  confidence: number;
  reason: string;
}

export type TextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateDiffSummary"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateAutomationIntent"
  | "evaluateAutomationCompletion";

export interface TextGenerationShape {
  readonly generateCommitMessage: (
    input: CommitMessageGenerationInput,
  ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

  readonly generatePrContent: (
    input: PrContentGenerationInput,
  ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

  readonly generateDiffSummary: (
    input: DiffSummaryGenerationInput,
  ) => Effect.Effect<DiffSummaryGenerationResult, TextGenerationError>;

  readonly generateBranchName: (
    input: BranchNameGenerationInput,
  ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

  readonly generateThreadTitle: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

  readonly generateAutomationIntent: (
    input: AutomationIntentGenerationInput,
  ) => Effect.Effect<AutomationIntentGenerationResult, TextGenerationError>;

  readonly evaluateAutomationCompletion: (
    input: AutomationCompletionEvaluationInput,
  ) => Effect.Effect<AutomationCompletionEvaluationResult, TextGenerationError>;
}

export class CodexTextGeneration extends ServiceMap.Service<
  CodexTextGeneration,
  TextGenerationShape
>()("glade/git/Services/TextGeneration/CodexTextGeneration") {}

export class TextGeneration extends ServiceMap.Service<TextGeneration, TextGenerationShape>()(
  "glade/git/Services/TextGeneration",
) {}
