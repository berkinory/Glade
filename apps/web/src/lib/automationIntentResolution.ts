import type { AutomationMode } from "@glade/contracts/automation/automation";
import type { ServerGenerateAutomationIntentResult } from "@glade/contracts/server/server";
import { automationRequiresTargetThread } from "@glade/shared/threads/automationMode";
import {
  normalizeInlineText,
  wordCount,
  extractExecutionScope,
  extractIterationLimit,
  stripAutomationScaffold,
  extractStopClause,
  deriveAutomationIntentName,
  formatAutomationIntentCadence,
  type ChatAutomationIntent,
  type ChatAutomationExecutionScope,
  type ResolvedChatAutomationIntent,
} from "./automationIntent";

const GENERATED_INTENT_CONFIDENCE_THRESHOLD = 0.75;
const PROMPT_ENRICHMENT_MAX_WORDS = 10;
const PROMPT_ENRICHMENT_MAX_LENGTH = 80;

export function shouldGenerateAutomationIntent(input: {
  readonly deterministicIntent: ChatAutomationIntent | null;
  readonly automationMessage: string;
}): boolean {
  const message = normalizeInlineText(input.automationMessage);
  if (!message) {
    return false;
  }
  if (!input.deterministicIntent) {
    return true;
  }
  const prompt = normalizeInlineText(input.deterministicIntent.prompt);
  return (
    prompt.length > 0 &&
    (prompt.length <= PROMPT_ENRICHMENT_MAX_LENGTH ||
      wordCount(prompt) <= PROMPT_ENRICHMENT_MAX_WORDS)
  );
}

function stripGeneratedPromptScaffolding(value: string): string {
  const withoutExecutionScope = extractExecutionScope(value)?.textWithoutExecutionScope ?? value;
  const withoutIterationLimit =
    extractIterationLimit(withoutExecutionScope)?.textWithoutIterationLimit ??
    withoutExecutionScope;
  const withoutSchedule = stripAutomationScaffold(withoutIterationLimit);
  const stopClause = extractStopClause(withoutSchedule);
  return normalizeInlineText(
    stopClause?.textWithoutStopClause
      ? stripAutomationScaffold(stopClause.textWithoutStopClause)
      : withoutSchedule,
  );
}

function maxIterationsFromGeneratedIntent(
  generatedIntent: ServerGenerateAutomationIntentResult,
): number | null {
  return (
    generatedIntent.maxIterations ??
    (generatedIntent.taskPrompt
      ? (extractIterationLimit(generatedIntent.taskPrompt)?.maxIterations ?? null)
      : null)
  );
}

function generatedAutomationPromptEnrichment(
  generatedIntent: ServerGenerateAutomationIntentResult | null,
): Pick<ChatAutomationIntent, "name" | "prompt" | "maxIterations"> | null {
  if (
    generatedIntent?.isAutomation !== true ||
    generatedIntent.taskPrompt === null ||
    generatedIntent.confidence < GENERATED_INTENT_CONFIDENCE_THRESHOLD
  ) {
    return null;
  }
  const prompt = stripGeneratedPromptScaffolding(generatedIntent.taskPrompt);
  if (!prompt) {
    return null;
  }
  return {
    name: generatedIntent.name ?? deriveAutomationIntentName(prompt),
    prompt,
    maxIterations: maxIterationsFromGeneratedIntent(generatedIntent),
  };
}

function generatedAutomationIntentToChatIntent(
  generatedIntent: ServerGenerateAutomationIntentResult | null,
  executionScope: ChatAutomationExecutionScope,
): ChatAutomationIntent | null {
  if (generatedIntent?.isAutomation !== true || generatedIntent.taskPrompt === null) {
    return null;
  }

  if (
    generatedIntent.confidence < GENERATED_INTENT_CONFIDENCE_THRESHOLD &&
    !generatedIntent.needsConfirmation
  ) {
    return null;
  }

  const schedule = generatedIntent.schedule ?? { type: "manual" as const };
  const prompt = stripGeneratedPromptScaffolding(generatedIntent.taskPrompt);
  if (!prompt) {
    return null;
  }
  const resolvedExecutionScope = executionScopeForGeneratedMode(
    generatedIntent.mode,
    executionScope,
  );
  return {
    name: generatedIntent.name ?? deriveAutomationIntentName(prompt),
    prompt,
    schedule,
    cadenceLabel: formatAutomationIntentCadence(schedule),
    maxIterations: maxIterationsFromGeneratedIntent(generatedIntent),
    completionPolicy: generatedIntent.completionPolicy ?? { type: "none" },
    executionScope: resolvedExecutionScope,
  };
}

function executionScopeForGeneratedMode(
  mode: AutomationMode | null,
  fallback: ChatAutomationExecutionScope,
): ChatAutomationExecutionScope {
  if (mode === null) {
    return fallback;
  }

  if (automationRequiresTargetThread(mode)) {
    return "thread";
  }
  return fallback === "worktree" ? "worktree" : "standalone";
}

function modeForExecutionScope(input: {
  readonly executionScope: ChatAutomationExecutionScope;
  readonly defaultMode: AutomationMode;
  readonly generatedMode: AutomationMode | null;
}): AutomationMode {
  if (input.executionScope === "thread") {
    return input.defaultMode;
  }
  return input.generatedMode === "dedicated" ? "dedicated" : "standalone";
}

export function resolveChatAutomationIntent(input: {
  readonly deterministicIntent: ChatAutomationIntent | null;
  readonly generatedIntent: ServerGenerateAutomationIntentResult | null;
  readonly defaultMode: AutomationMode;
  readonly executionScope: ChatAutomationExecutionScope;
}): ResolvedChatAutomationIntent | null {
  if (input.deterministicIntent) {
    const resolvedExecutionScope =
      input.deterministicIntent.executionScope === "thread"
        ? executionScopeForGeneratedMode(input.generatedIntent?.mode ?? null, input.executionScope)
        : input.deterministicIntent.executionScope;

    const mode = modeForExecutionScope({
      executionScope: resolvedExecutionScope,
      defaultMode: input.defaultMode,
      generatedMode: input.generatedIntent?.mode ?? null,
    });
    const enrichment = generatedAutomationPromptEnrichment(input.generatedIntent);
    const enrichmentNeedsConfirmation =
      enrichment !== null && (input.generatedIntent?.needsConfirmation ?? false);
    const deterministicIntent =
      resolvedExecutionScope === input.deterministicIntent.executionScope
        ? input.deterministicIntent
        : { ...input.deterministicIntent, executionScope: resolvedExecutionScope };
    const intent = enrichment
      ? {
          ...deterministicIntent,
          name: enrichment.name,
          prompt: enrichment.prompt,
          maxIterations: enrichment.maxIterations ?? deterministicIntent.maxIterations,
        }
      : deterministicIntent;
    return {
      intent,
      mode,
      source: "deterministic",
      requiresReview:
        // Any LLM-influenced draft requires human review before creating: when the prompt is terse the
        // generator rewrites name/prompt/maxIterations even though the schedule parsed deterministically
        // (enrichment !== null), so the confirmation must not be skipped. Purely local parses keep their
        // finer gating, including the deliberate bounded-fast-loop auto-submit (which skips generation, so
        // enrichment stays null).
        enrichment !== null || resolvedExecutionScope !== "thread",
      generatedConfidence: enrichment ? (input.generatedIntent?.confidence ?? null) : null,
      generatedNeedsConfirmation: enrichmentNeedsConfirmation,
      reason: enrichmentNeedsConfirmation ? (input.generatedIntent?.reason ?? null) : null,
    };
  }

  const generatedIntent = generatedAutomationIntentToChatIntent(
    input.generatedIntent,
    input.executionScope,
  );
  if (!generatedIntent) {
    return null;
  }

  const generatedSchedule = input.generatedIntent?.schedule;
  const fastRecurringInterval =
    generatedSchedule?.type === "interval" && generatedSchedule.everySeconds < 60;

  const mode = modeForExecutionScope({
    executionScope: generatedIntent.executionScope,
    defaultMode: input.defaultMode,
    generatedMode: input.generatedIntent?.mode ?? null,
  });
  return {
    intent: generatedIntent,
    mode,
    source: "generated",
    // Generated (LLM-interpreted) intents always require a human confirmation step: a misread message
    // must never silently create a recurring background automation, no matter how confident the model
    // is. Deterministic explicit intents keep their finer-grained gating above, including the
    // intentional bounded-fast-loop auto-submit, which never reaches this branch because generation is
    // skipped for it in resolveComposerAutomationRequest.
    requiresReview: true,
    generatedConfidence: input.generatedIntent?.confidence ?? null,
    generatedNeedsConfirmation:
      (input.generatedIntent?.needsConfirmation ?? false) || fastRecurringInterval,
    reason: input.generatedIntent?.reason ?? null,
  };
}
