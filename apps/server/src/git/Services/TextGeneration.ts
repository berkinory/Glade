import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { AutomationMode } from "@glade/contracts/automation/automation";
import type { ChatAttachment } from "@glade/contracts/orchestration/threadEntities";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import type { ServerGenerateAutomationIntentResult } from "@glade/contracts/server/server";

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
