import { DEFAULT_AUTOMATION_FAST_INTERVAL_MAX_ITERATIONS } from "@glade/contracts/automation/automation";
import type { AutomationMode } from "@glade/contracts/automation/automation";
import type { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  ServerAutomationIntentMissingField,
  ServerGenerateAutomationIntentInput,
  ServerGenerateAutomationIntentResult,
} from "@glade/contracts/server/server";

import {
  applyScheduleToForm,
  formFromDefinition,
  isFormSubmittable,
  type AutomationFormState,
} from "./automationForm";
import { stopWhenFromCompletionPolicy } from "../features/automations/completionPolicy";
import { automationRequiresTargetThread } from "@glade/shared/threads/automationMode";
import {
  acknowledgedWarningIdsForAutomaticChatAutomation,
  buildAutomationDraftWarnings,
  hasBlockingAutomationDraftWarnings,
  type AutomationDraftWarning,
  type AutomationDraftWarningId,
} from "./automationDraft";
import {
  detectChatAutomationExecutionScope,
  ensureAutomationConversationScaffold,
  extractChatAutomationInvocation,
  extractPlainChatAutomationCreationInvocation,
  parseChatAutomationInvocation,
  parsePlainChatAutomationInvocation,
  type ChatAutomationIntent,
  type ResolvedChatAutomationIntent,
} from "./automationIntent";
import {
  resolveChatAutomationIntent,
  shouldGenerateAutomationIntent,
} from "./automationIntentResolution";

type GenerateComposerAutomationIntent = (
  input: ServerGenerateAutomationIntentInput,
) => Promise<ServerGenerateAutomationIntentResult>;

const DEFAULT_GENERATE_INTENT_TIMEOUT_MS = 1_500;

export type ComposerAutomationRequestDecision =
  | { readonly type: "normal-chat" }
  | {
      readonly type: "needs-clarification";
      readonly automationMessage: string;
      readonly missingFields: readonly ServerAutomationIntentMissingField[];
      readonly reason: string | null;
    }
  | {
      readonly type: "automation";
      readonly automationMessage: string;
      readonly resolution: ResolvedChatAutomationIntent;
    };

export interface ComposerAutomationDraftDecision {
  readonly form: AutomationFormState;
  readonly warnings: readonly AutomationDraftWarning[];
  readonly warningContext: {
    readonly hasEphemeralContext: boolean;
    readonly generatedConfidence: number | null;
    readonly generatedNeedsConfirmation: boolean;
  };
  readonly acknowledgedWarningIds: ReadonlySet<AutomationDraftWarningId>;
  readonly needsDraftReview: boolean;
}

function stripTrailingAutomationFiller(message: string): string {
  return message
    .replace(/[.!?。！？]+\s*$/u, "")
    .replace(/\b(automation|task|job|check|monitor|reminder)\s+for\s+(?:me|myself)\s+/iu, "$1 ")
    .replace(/\b(automazione|task|controllo|monitoraggio)\s+per\s+(?:me|noi)\s+/iu, "$1 ")
    .replace(/\s+(?:for\s+(?:me|myself)|per\s+(?:me|noi))\s*$/iu, "")
    .trim();
}

export function automationClarificationPrompt(
  missingFields: readonly ServerAutomationIntentMissingField[],
): string {
  const fields: readonly ServerAutomationIntentMissingField[] =
    missingFields.length > 0 ? missingFields : ["taskPrompt", "schedule"];
  const needsTask = fields.includes("taskPrompt");
  const needsSchedule = fields.includes("schedule");
  if (needsTask && needsSchedule) {
    return 'Sure, what should this automation do, and how often should it run? For example: "every weekday at 9am, summarize my open PRs."';
  }
  if (needsTask) {
    return "What should this automation do? For example: summarize my open PRs, or check the build.";
  }
  if (needsSchedule) {
    return "How often should this automation run? For example: every 6 hours, weekdays at 9am, or daily at 18:00.";
  }
  return "A couple more details: what should this automation do, and how often should it run?";
}

async function generateIntentWithTimeout(input: {
  readonly generateIntent: GenerateComposerAutomationIntent;
  readonly request: ServerGenerateAutomationIntentInput;
  readonly timeoutMs: number;
}): Promise<ServerGenerateAutomationIntentResult | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      input.generateIntent(input.request).catch(() => null),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), Math.max(0, input.timeoutMs));
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function isAutoSubmittableBoundedFastLoop(intent: ChatAutomationIntent | null): boolean {
  if (!intent || intent.executionScope !== "thread") {
    return false;
  }
  return (
    intent.schedule.type === "interval" &&
    intent.schedule.everySeconds < 60 &&
    intent.maxIterations !== null &&
    intent.maxIterations <= DEFAULT_AUTOMATION_FAST_INTERVAL_MAX_ITERATIONS
  );
}

export async function resolveComposerAutomationRequest(input: {
  readonly message: string;
  readonly cwd: string;
  readonly nowIso?: string;
  readonly generateIntent: GenerateComposerAutomationIntent;
  readonly generateIntentTimeoutMs?: number;
}): Promise<ComposerAutomationRequestDecision> {
  const trimmed = input.message.trim();
  if (!trimmed) {
    return { type: "normal-chat" };
  }

  const explicitAutomationInvocation = extractChatAutomationInvocation(trimmed);
  const nowIso = input.nowIso ?? new Date().toISOString();
  const plainCreationInvocation =
    explicitAutomationInvocation === null
      ? extractPlainChatAutomationCreationInvocation(trimmed)
      : null;
  const automaticAutomationIntent =
    explicitAutomationInvocation === null
      ? parsePlainChatAutomationInvocation(trimmed, { nowIso })
      : null;
  const automationInvocation =
    explicitAutomationInvocation ?? (automaticAutomationIntent ? trimmed : plainCreationInvocation);
  if (automationInvocation === null) {
    return { type: "normal-chat" };
  }

  const automationMessage = automationInvocation.trim();
  const deterministicAutomationIntent =
    automaticAutomationIntent ??
    parseChatAutomationInvocation(automationInvocation, {
      nowIso,
    });
  const automationExecutionScope =
    deterministicAutomationIntent?.executionScope ??
    detectChatAutomationExecutionScope(automationMessage);
  const automationDefaultMode: AutomationMode =
    automationExecutionScope === "thread" ? "heartbeat" : "standalone";
  const shouldGenerateIntent =
    !isAutoSubmittableBoundedFastLoop(deterministicAutomationIntent) &&
    shouldGenerateAutomationIntent({
      deterministicIntent: deterministicAutomationIntent,
      automationMessage,
    });
  const generatedAutomationIntent = shouldGenerateIntent
    ? await generateIntentWithTimeout({
        generateIntent: input.generateIntent,
        timeoutMs: input.generateIntentTimeoutMs ?? DEFAULT_GENERATE_INTENT_TIMEOUT_MS,
        request: {
          cwd: input.cwd,
          message: automationMessage,
          defaultMode: automationDefaultMode,
          nowIso,
        },
      })
    : null;
  const automationResolution = resolveChatAutomationIntent({
    deterministicIntent: deterministicAutomationIntent,
    generatedIntent: generatedAutomationIntent,
    defaultMode: automationDefaultMode,
    executionScope: automationExecutionScope,
  });
  // The generator defaults an unspecified schedule to "manual", which would otherwise open a
  // manual-automation review dialog for "create an automation to check the build" instead of asking
  // "how often?".
  const generatedScheduleStillMissing =
    automationResolution !== null &&
    automationResolution.source === "generated" &&
    (generatedAutomationIntent?.missingFields.includes("schedule") ?? false) &&
    automationResolution.intent.schedule.type === "manual";
  if (!automationResolution || generatedScheduleStillMissing) {
    return {
      type: "needs-clarification",

      automationMessage: ensureAutomationConversationScaffold(
        stripTrailingAutomationFiller(automationMessage),
      ),
      missingFields: generatedAutomationIntent?.missingFields ?? [],
      reason: generatedAutomationIntent?.reason ?? null,
    };
  }

  return {
    type: "automation",
    automationMessage,
    resolution: automationResolution,
  };
}

export function buildComposerAutomationDraft(input: {
  readonly resolution: ResolvedChatAutomationIntent;
  readonly projectId: ProjectId;
  readonly projectModelSelection: ModelSelection;
  readonly selectedModelSelection: ModelSelection;
  readonly targetThreadId: ThreadId | null;
  readonly hasEphemeralContext: boolean;
}): ComposerAutomationDraftDecision {
  const { intent: automationIntent, mode: automationMode } = input.resolution;
  const automationStopWhen = stopWhenFromCompletionPolicy(automationIntent.completionPolicy);
  const baseForm = formFromDefinition(null, input.projectId, input.projectModelSelection);

  const nextForm = applyScheduleToForm(
    {
      ...baseForm,
      name: automationIntent.name,
      prompt: automationIntent.prompt,
      projectId: input.projectId,
      modelSelection: input.selectedModelSelection,
      runtimeMode: "approval-required",
      worktreeMode: automationIntent.executionScope === "worktree" ? "worktree" : "auto",
      mode: automationMode,
      targetThreadId:
        automationRequiresTargetThread(automationMode) && input.targetThreadId
          ? input.targetThreadId
          : "",
      maxIterations:
        automationIntent.maxIterations === null ? "" : String(automationIntent.maxIterations),

      stopWhen: automationStopWhen,
    },
    automationIntent.schedule,
  );
  const warnings = buildAutomationDraftWarnings({
    schedule: automationIntent.schedule,
    mode: nextForm.mode,
    runtimeMode: nextForm.runtimeMode,
    worktreeMode: nextForm.worktreeMode,
    hasEphemeralContext: input.hasEphemeralContext,
    generatedConfidence: input.resolution.generatedConfidence,
    generatedNeedsConfirmation: input.resolution.generatedNeedsConfirmation,
    prompt: automationIntent.prompt,
  });
  const warningContext = {
    hasEphemeralContext: input.hasEphemeralContext,
    generatedConfidence: input.resolution.generatedConfidence,
    generatedNeedsConfirmation: input.resolution.generatedNeedsConfirmation,
  };
  const acknowledgedWarningIds = acknowledgedWarningIdsForAutomaticChatAutomation({
    warnings,
    maxIterations: automationIntent.maxIterations,
    executionScope: automationIntent.executionScope,
  });
  const needsDraftReview =
    input.resolution.requiresReview ||
    input.resolution.generatedNeedsConfirmation ||
    !isFormSubmittable(nextForm) ||
    hasBlockingAutomationDraftWarnings(warnings, acknowledgedWarningIds);

  return {
    form: nextForm,
    warnings,
    warningContext,
    acknowledgedWarningIds,
    needsDraftReview,
  };
}
