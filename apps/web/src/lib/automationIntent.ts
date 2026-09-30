import type {
  AutomationCompletionPolicy,
  AutomationMode,
  AutomationSchedule,
} from "@glade/contracts/automation/automation";

import { completionPolicyFromStopWhen } from "../features/automations/completionPolicy";

export interface ChatAutomationIntent {
  readonly name: string;
  readonly prompt: string;
  readonly schedule: AutomationSchedule;
  readonly cadenceLabel: string;
  readonly maxIterations: number | null;
  readonly completionPolicy: AutomationCompletionPolicy;
  readonly executionScope: ChatAutomationExecutionScope;
}

export type ChatAutomationExecutionScope = "thread" | "standalone" | "worktree";

export interface ResolvedChatAutomationIntent {
  readonly intent: ChatAutomationIntent;
  readonly mode: AutomationMode;
  readonly source: "deterministic" | "generated";
  readonly requiresReview: boolean;
  readonly generatedConfidence: number | null;
  readonly generatedNeedsConfirmation: boolean;
  readonly reason: string | null;
}

interface ParsedSchedule {
  readonly schedule: AutomationSchedule;
  readonly cadenceLabel: string;
}

interface ParsedIterationLimit {
  readonly maxIterations: number;
  readonly textWithoutIterationLimit: string;
}

interface ParsedExecutionScope {
  readonly executionScope: ChatAutomationExecutionScope;
  readonly textWithoutExecutionScope: string;
}

const DEFAULT_DAILY_TIME = "09:00";
const MAX_NAME_LENGTH = 120;
const CRON_FIELD_PATTERN = "[*/0-9,-]+";
const PLAIN_INVOCATION_QUESTION_PREFIX_PATTERN =
  /^(?:what|why|how|who|when|where|which|can|could|would|should|do|does|did|is|are|am|will|qual|quale|quali|cosa|come|perche|dove|quando|chi|posso|puoi|potresti|dovrei)\b/;
const PLAIN_INVOCATION_POLITE_REQUEST_PATTERN =
  /^(?:(?:can|could|would|will|should)\s+you(?:\s+please)?|(?:puoi|potresti)(?:\s+per favore)?)\s+/i;
const PLAIN_INVOCATION_ACTION_PREFIX_PATTERN =
  /^(?:check|verify|monitor|watch|remind(?:\s+me)?|notify(?:\s+me)?|alert(?:\s+me)?|tell\s+me|controlla|verifica|monitora|avvisami|ricordami)\b/i;
const PLAIN_INVOCATION_POLITE_ACTION_PREFIX_PATTERN =
  /^(?:check|verify|monitor|watch|say|remind(?:\s+me)?|notify(?:\s+me)?|alert(?:\s+me)?|tell\s+me|controlla|verifica|monitora|avvisami|ricordami)\b/i;
const PLAIN_INVOCATION_AUTOMATION_CREATION_PREFIX_PATTERN = new RegExp(
  [
    "^(?:please\\s+)?(?:",
    "(?:make|create|set up|setup|add|start|build)\\s+(?:an?\\s+)?automation\\b",
    "|schedule\\s+(?:an?\\s+)?(?:automation|task|job|check|monitor)\\b",
    "|(?:crea|creare|aggiungi|imposta|fai)\\s+(?:un[' ]?)?",
    "(?:automazione|task|controllo|monitoraggio)\\b",
    ")",
  ].join(""),
  "i",
);

const WEEKDAY_BY_TOKEN: Record<string, number> = {
  sunday: 0,
  sun: 0,
  domenica: 0,
  monday: 1,
  mon: 1,
  lunedi: 1,
  tuesday: 2,
  tue: 2,
  martedi: 2,
  wednesday: 3,
  wed: 3,
  mercoledi: 3,
  thursday: 4,
  thu: 4,
  giovedi: 4,
  friday: 5,
  fri: 5,
  venerdi: 5,
  saturday: 6,
  sat: 6,
  sabato: 6,
};

const WEEKDAY_STRIP_PATTERN = [
  ...Object.keys(WEEKDAY_BY_TOKEN),
  "lunedi",
  "lunedì",
  "martedi",
  "martedì",
  "mercoledi",
  "mercoledì",
  "giovedi",
  "giovedì",
  "venerdi",
  "venerdì",
].join("|");

const TIME_PATTERN = "((?:[01]?\\d|2[0-3])(?::[0-5]\\d)?\\s*(?:am|pm)?)";
const INTERVAL_UNIT_PATTERN =
  "(?:seconds|second|secs|sec|secondi|secondo|minutes|minute|mins|minuti|minuto|min|hours|hour|hrs|hr|ore|ora|days|day|giorni|giorno|s|m|h|d|g)";
const BARE_INTERVAL_UNIT_PATTERN =
  "(?:seconds|second|secs|sec|secondi|secondo|minutes|minute|mins|minuti|minuto|min|hours|hour|hrs|hr|ore|ora|s|m|h)";
const INTERVAL_PATTERN = `(\\d{1,4})\\s*(${INTERVAL_UNIT_PATTERN})`;
const BARE_INTERVAL_LEADING_REMAINDER_PATTERN =
  "(?=$|\\s*(?:,|and\\b|to\\b|then\\b)|\\s+(?:check|verify|monitor|watch|remind|notify|alert|tell|controlla|verifica|monitora|avvisami|ricordami)\\b)";
const BARE_INTERVAL_LEADING_ACTION_PATTERN = new RegExp(
  `^(?:every|each|ogni)\\s+${BARE_INTERVAL_UNIT_PATTERN}\\b\\s+(?:check|verify|monitor|watch|remind|notify|alert|tell|controlla|verifica|monitora|avvisami|ricordami)\\b`,
  "i",
);

export function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value: string): string {
  return normalizeInlineText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isLikelyPlainAutomationQuestion(value: string): boolean {
  const text = normalizeInlineText(value);
  if (!text) {
    return false;
  }
  if (/[?？]\s*$/.test(text)) {
    return true;
  }
  return PLAIN_INVOCATION_QUESTION_PREFIX_PATTERN.test(normalizeSearchText(text));
}

function isLikelyAutomationQuestionCandidate(value: string): boolean {
  if (isLikelyPlainAutomationQuestion(value)) {
    return true;
  }
  return /^tell me\s+(?:what|why|how|who|when|where|which|qual|quale|quali|cosa|come|perche|dove|quando|chi)\b/.test(
    normalizeSearchText(value),
  );
}

function stripPlainAutomationPoliteRequest(value: string): string | null {
  const normalized = normalizeInlineText(value);
  const match = PLAIN_INVOCATION_POLITE_REQUEST_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }
  return normalizeInlineText(normalized.slice(match[0].length))
    .replace(/[?？]+$/g, "")
    .replace(/^(?:to|di|che)\s+/i, "");
}

export function wordCount(value: string): number {
  return normalizeInlineText(value).split(/\s+/).filter(Boolean).length;
}

function isLikelyPlainAutomationAction(value: string, politeRequest: boolean): boolean {
  const pattern = politeRequest
    ? PLAIN_INVOCATION_POLITE_ACTION_PREFIX_PATTERN
    : PLAIN_INVOCATION_ACTION_PREFIX_PATTERN;
  const normalized = normalizeInlineText(value);
  return (
    pattern.test(normalized) ||
    PLAIN_INVOCATION_AUTOMATION_CREATION_PREFIX_PATTERN.test(normalized) ||
    BARE_INTERVAL_LEADING_ACTION_PATTERN.test(normalized)
  );
}

export function extractPlainChatAutomationCreationInvocation(value: string): string | null {
  const normalizedInvocation = normalizeInlineText(value);
  if (!normalizedInvocation) {
    return null;
  }
  const politeInvocation = stripPlainAutomationPoliteRequest(normalizedInvocation);
  const candidate = politeInvocation ?? normalizedInvocation;
  const candidateIsQuestion =
    politeInvocation === null
      ? isLikelyAutomationQuestionCandidate(normalizedInvocation)
      : isLikelyAutomationQuestionCandidate(candidate);
  if (candidateIsQuestion) {
    return null;
  }
  return PLAIN_INVOCATION_AUTOMATION_CREATION_PREFIX_PATTERN.test(candidate) ? candidate : null;
}

export function ensureAutomationConversationScaffold(message: string): string {
  const normalized = normalizeInlineText(message);
  if (!normalized) {
    return "create an automation";
  }
  if (PLAIN_INVOCATION_AUTOMATION_CREATION_PREFIX_PATTERN.test(normalized)) {
    return normalized;
  }
  return `create an automation ${normalized}`;
}

function removeMatchedText(value: string, match: RegExpExecArray): string {
  return normalizeInlineText(
    `${value.slice(0, match.index)} ${value.slice(match.index + match[0].length)}`,
  )
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/^(?:and|then|to|e|poi|che|di|per)\s+/i, "");
}

export function extractExecutionScope(value: string): ParsedExecutionScope | null {
  const patterns: ReadonlyArray<{
    readonly executionScope: ChatAutomationExecutionScope;
    readonly pattern: RegExp;
  }> = [
    {
      executionScope: "worktree",
      pattern: /\b(?:in|on|with|using|su|con)\s+(?:a\s+|un\s+)?(?:new\s+|nuovo\s+)?worktree\b/i,
    },
    { executionScope: "worktree", pattern: /\b(?:new|nuovo)\s+worktree\b/i },
    {
      executionScope: "standalone",
      pattern:
        /\b(?:run|create|make|start|save|crea|fai|avvia)\s+(?:it\s+)?(?:as\s+)?(?:a\s+|un\s+)?standalone(?:\s+automation)?\b/i,
    },
    { executionScope: "standalone", pattern: /\bstandalone(?:\s+automation)?\b/i },
    { executionScope: "standalone", pattern: /\bseparate\s+(?:run|automation|task)\b/i },
    {
      executionScope: "standalone",
      pattern: /\b(?:as|in|into|inside|within)\s+(?:a\s+)?(?:new|separate)\s+run\b/i,
    },
    {
      executionScope: "standalone",
      pattern: /\bfor\s+(?:every|each|all)\s+(?:new\s+)?chats?\b/i,
    },
    {
      executionScope: "standalone",
      pattern: /\b(?:per|in)\s+ogni\s+(?:nuova\s+)?chat\b/i,
    },
  ];

  for (const { executionScope, pattern } of patterns) {
    const match = pattern.exec(value);
    if (!match) {
      continue;
    }
    return {
      executionScope,
      textWithoutExecutionScope: removeMatchedText(value, match),
    };
  }

  return null;
}

export function detectChatAutomationExecutionScope(value: string): ChatAutomationExecutionScope {
  return extractExecutionScope(value)?.executionScope ?? "thread";
}

interface ParsedStopClause {
  readonly stopWhen: string;
  readonly textWithoutStopClause: string;
}

export function extractStopClause(value: string): ParsedStopClause | null {
  const patterns: readonly RegExp[] = [
    /\bstop\s+when\s+(.+?)(?=(?:[.!?]\s+|$))/i,
    /\buntil\s+(.+?)(?=(?:[.!?]\s+|$))/i,
    /\bkeep\s+monitoring\s+until\s+(.+?)(?=(?:[.!?]\s+|$))/i,
    /\bif\s+(.+?),\s*stop\b/i,
    /\bquando\s+(.+?),\s*fermati\b/i,
    /\bfinch[eé]\s+(.+?)(?=(?:[.!?]\s+|$))/i,
    /\bfino\s+a\s+quando\s+(.+?)(?=(?:[.!?]\s+|$))/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    const stopWhen = match?.[1]
      ?.trim()
      .replace(/[.!?]+$/g, "")
      .trim();
    if (!match || !stopWhen) {
      continue;
    }
    const textWithoutStopClause = normalizeInlineText(
      `${value.slice(0, match.index)} ${value.slice(match.index + match[0].length)}`,
    )
      .replace(/([.!?])\s+[.!?]/g, "$1")
      .replace(/^(?:and|then|e|poi)\s+/i, "");
    return {
      stopWhen,
      textWithoutStopClause,
    };
  }
  return null;
}

export function extractIterationLimit(value: string): ParsedIterationLimit | null {
  const patterns: readonly RegExp[] = [
    /\bfor\s+(\d{1,4})\s+(?:times?|runs?|iterations?|turns?)(?:\s+(?:in\s+)?total)?\b/i,
    /\b(?:a\s+)?total\s+of\s+(\d{1,4})\s+(?:times?|runs?|iterations?|turns?)\b/i,
    /\b(\d{1,4})\s+(?:times?|runs?|iterations?|turns?)\s+(?:(?:in\s+)?total|overall)\b/i,
    /\bper\s+(\d{1,4})\s+(?:volte|iterazioni|run|giri)(?:\s+in\s+totale)?\b/i,
    /\b(?:per\s+)?un\s+totale\s+di\s+(\d{1,4})\s+(?:volte|iterazioni|run|giri)\b/i,
    /\b(\d{1,4})\s+(?:volte|iterazioni|run|giri)\s+in\s+totale\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    const amount = Number.parseInt(match?.[1] ?? "", 10);
    if (!match || !Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    const textWithoutIterationLimit = removeMatchedText(value, match).replace(/(?:,\s*)$/g, "");
    return {
      maxIterations: amount,
      textWithoutIterationLimit,
    };
  }
  return null;
}

export function extractChatAutomationInvocation(value: string): string | null {
  const text = normalizeInlineText(value);
  if (!text) {
    return null;
  }

  const slashMatch = /^\/automation(?:\s+([\s\S]*))?$/i.exec(text);
  if (slashMatch) {
    return normalizeInlineText(slashMatch[1] ?? "");
  }

  const withoutInlineMarker = text.replace(
    /(^|\s)(?:@automation(?::)?|\/automation)(?=\s|$)/i,
    " ",
  );
  if (withoutInlineMarker !== text) {
    return normalizeInlineText(withoutInlineMarker);
  }

  return null;
}

function parseTimeOfDay(value: string | undefined): string | null {
  const match = /^([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?$/i.exec(value?.trim() ?? "");
  if (!match) {
    return null;
  }
  const meridiem = match[3]?.toLowerCase();
  const hour = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  if (Number.isNaN(hour) || (meridiem && hour > 12)) {
    return null;
  }
  const safeHour =
    meridiem === "pm" && hour < 12 ? hour + 12 : meridiem === "am" && hour === 12 ? 0 : hour;
  const safeMinute = Number.isNaN(minute) ? 0 : Math.min(59, Math.max(0, minute));
  return `${String(safeHour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")}`;
}

function intervalUnitToSeconds(unit: string): number {
  if (
    unit === "s" ||
    unit === "sec" ||
    unit === "secs" ||
    unit === "second" ||
    unit === "seconds" ||
    unit === "secondo" ||
    unit === "secondi"
  ) {
    return 1;
  }
  if (
    unit === "m" ||
    unit === "min" ||
    unit === "mins" ||
    unit === "minute" ||
    unit === "minutes" ||
    unit === "minuto" ||
    unit === "minuti"
  ) {
    return 60;
  }
  if (
    unit === "h" ||
    unit === "hr" ||
    unit === "hrs" ||
    unit === "hour" ||
    unit === "hours" ||
    unit === "ora" ||
    unit === "ore"
  ) {
    return 3600;
  }
  return 86_400;
}

function intervalUnitLabel(unit: string): "s" | "m" | "h" | "d" {
  const seconds = intervalUnitToSeconds(unit);
  if (seconds === 1) return "s";
  if (seconds === 60) return "m";
  if (seconds === 3600) return "h";
  return "d";
}

export function formatAutomationIntentCadence(schedule: AutomationSchedule): string {
  if (schedule.type === "interval") {
    const seconds = schedule.everySeconds;
    if (seconds % 86_400 === 0) return `Every ${seconds / 86_400}d`;
    if (seconds % 3_600 === 0) return `Every ${seconds / 3_600}h`;
    if (seconds % 60 === 0) return `Every ${seconds / 60}m`;
    return `Every ${seconds}s`;
  }
  if (schedule.type === "once") {
    return `Once at ${new Date(schedule.runAt).toLocaleString()}`;
  }
  if (schedule.type === "cron") {
    return `Cron ${schedule.expression}`;
  }
  if (schedule.type === "daily") {
    return `Daily at ${schedule.timeOfDay}`;
  }
  if (schedule.type === "weekdays") {
    return `Weekdays at ${schedule.timeOfDay}`;
  }
  if (schedule.type === "weekly") {
    return `Weekly at ${schedule.timeOfDay}`;
  }
  return "Manual";
}

function parseIntervalSchedule(searchText: string): ParsedSchedule | null {
  const match =
    searchText.match(new RegExp(`\\b(?:every|each)\\s+${INTERVAL_PATTERN}\\b`)) ??
    searchText.match(new RegExp(`\\bogni\\s+${INTERVAL_PATTERN}\\b`));
  const bareMatch =
    match == null
      ? (searchText.match(
          new RegExp(
            `^(?:every|each)\\s+(${BARE_INTERVAL_UNIT_PATTERN})\\b${BARE_INTERVAL_LEADING_REMAINDER_PATTERN}`,
          ),
        ) ??
        searchText.match(new RegExp(`\\b(?:every|each)\\s+(${BARE_INTERVAL_UNIT_PATTERN})$`)) ??
        searchText.match(
          new RegExp(
            `^ogni\\s+(${BARE_INTERVAL_UNIT_PATTERN})\\b${BARE_INTERVAL_LEADING_REMAINDER_PATTERN}`,
          ),
        ) ??
        searchText.match(new RegExp(`\\bogni\\s+(${BARE_INTERVAL_UNIT_PATTERN})$`)))
      : null;
  if (!match && !bareMatch) {
    return null;
  }

  const amount = match ? Number.parseInt(match[1] ?? "", 10) : 1;
  const unit = match?.[2] ?? bareMatch?.[1] ?? "m";
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const everySeconds = amount * intervalUnitToSeconds(unit);

  const schedule = {
    type: "interval",
    everySeconds,
  } as const;
  return {
    schedule,
    cadenceLabel: `Every ${amount}${intervalUnitLabel(unit)}`,
  };
}

function parseOnceSchedule(searchText: string, nowIso: string): ParsedSchedule | null {
  const match =
    searchText.match(new RegExp(`\\bin\\s+${INTERVAL_PATTERN}\\b`)) ??
    searchText.match(new RegExp(`\\b(?:tra|fra)\\s+${INTERVAL_PATTERN}\\b`));
  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1] ?? "", 10);
  const unit = match[2] ?? "m";
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const delaySeconds = amount * intervalUnitToSeconds(unit);
  if (delaySeconds < 5) {
    return null;
  }
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) {
    return null;
  }
  const runAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
  return {
    schedule: { type: "once", runAt },
    cadenceLabel: `In ${amount}${intervalUnitLabel(unit)}`,
  };
}

function parseCronSchedule(searchText: string): ParsedSchedule | null {
  const match = searchText.match(
    new RegExp(
      `\\bcron\\s+(${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN})(?=\\s|$)`,
    ),
  );
  if (!match?.[1]) {
    return null;
  }
  const expression = match[1].trim();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    schedule: { type: "cron", expression, timezone },
    cadenceLabel: `Cron ${expression}`,
  };
}

function parseSimpleRecurringTime(
  searchText: string,
  english: string,
  italian: string,
): string | null {
  const timedMatch =
    searchText.match(new RegExp(`\\b(?:${english})\\s+at\\s+${TIME_PATTERN}\\b`)) ??
    searchText.match(new RegExp(`\\b(?:${italian})\\s+(?:alle|a)\\s+${TIME_PATTERN}\\b`));
  if (timedMatch) return parseTimeOfDay(timedMatch[1]);
  if (
    new RegExp(`\\b(?:${english})\\s+at\\b`).test(searchText) ||
    new RegExp(`\\b(?:${italian})\\s+(?:alle|a)\\b`).test(searchText)
  )
    return null;
  return new RegExp(`\\b(?:${english}|${italian})\\b`).test(searchText) ? DEFAULT_DAILY_TIME : null;
}

function parseDailySchedule(searchText: string): ParsedSchedule | null {
  const timeOfDay = parseSimpleRecurringTime(
    searchText,
    "daily|every day",
    "ogni giorno|tutti i giorni",
  );
  return timeOfDay
    ? { schedule: { type: "daily", timeOfDay }, cadenceLabel: `Daily at ${timeOfDay}` }
    : null;
}

function parseWeekdaysSchedule(searchText: string): ParsedSchedule | null {
  const timeOfDay = parseSimpleRecurringTime(
    searchText,
    "weekdays|every weekday|workdays",
    "giorni lavorativi|ogni giorno lavorativo",
  );
  return timeOfDay
    ? { schedule: { type: "weekdays", timeOfDay }, cadenceLabel: `Weekdays at ${timeOfDay}` }
    : null;
}

function parseWeeklySchedule(searchText: string): ParsedSchedule | null {
  const weekdayTokens = Object.keys(WEEKDAY_BY_TOKEN).join("|");
  const timedWeeklyMatch =
    searchText.match(new RegExp(`\\bevery\\s+(${weekdayTokens})\\s+at\\s+${TIME_PATTERN}\\b`)) ??
    searchText.match(
      new RegExp(`\\bogni\\s+(${weekdayTokens})\\s+(?:alle|a)\\s+${TIME_PATTERN}\\b`),
    );
  if (timedWeeklyMatch) {
    const dayOfWeek = WEEKDAY_BY_TOKEN[timedWeeklyMatch[1] ?? ""];
    const timeOfDay = parseTimeOfDay(timedWeeklyMatch[2]);
    return dayOfWeek !== undefined && timeOfDay
      ? {
          schedule: { type: "weekly", dayOfWeek, timeOfDay },
          cadenceLabel: `Weekly at ${timeOfDay}`,
        }
      : null;
  }

  if (
    new RegExp(`\\bevery\\s+(?:${weekdayTokens})\\s+at\\b`).test(searchText) ||
    new RegExp(`\\bogni\\s+(?:${weekdayTokens})\\s+(?:alle|a)\\b`).test(searchText)
  ) {
    return null;
  }

  const weeklyMatch =
    searchText.match(new RegExp(`\\bevery\\s+(${weekdayTokens})\\b`)) ??
    searchText.match(new RegExp(`\\bogni\\s+(${weekdayTokens})\\b`));
  if (!weeklyMatch) {
    return null;
  }

  const dayOfWeek = WEEKDAY_BY_TOKEN[weeklyMatch[1] ?? ""];
  if (dayOfWeek === undefined) {
    return null;
  }

  const timeOfDay = DEFAULT_DAILY_TIME;
  return {
    schedule: { type: "weekly", dayOfWeek, timeOfDay },
    cadenceLabel: `Weekly at ${timeOfDay}`,
  };
}

function parseSchedule(searchText: string, nowIso: string): ParsedSchedule | null {
  if (/\b(?:between|around|circa|verso)\b/.test(searchText)) {
    return null;
  }
  return (
    parseCronSchedule(searchText) ??
    parseOnceSchedule(searchText, nowIso) ??
    parseIntervalSchedule(searchText) ??
    parseWeekdaysSchedule(searchText) ??
    parseWeeklySchedule(searchText) ??
    parseDailySchedule(searchText)
  );
}

export function stripAutomationScaffold(value: string): string {
  let cleaned = normalizeInlineText(value);
  cleaned = cleaned
    .replace(
      /^(?:please\s+)?(?:make|create|set up|setup|add|start|build)\s+(?:an?\s+)?automation\s*(?:for\s+(?:me|myself)\b\s*)?(?:where|that|to|which)?\s*/i,
      "",
    )
    .replace(
      /^(?:please\s+)?(?:crea|creare|aggiungi|imposta|fai)\s+(?:un[' ]?)?(?:automazione|task|controllo|monitoraggio)\s*(?:per\s+(?:me|noi)\b\s*)?(?:che|per|dove)?\s*/i,
      "",
    )
    .replace(
      /^(?:please\s+)?schedule\s+(?:an?\s+)?(?:automation|task|job|check|monitor|reminder)\s*(?:for\s+(?:me|myself)\b\s*)?(?:to|that)?\s*/i,
      "",
    )
    .replace(/^(?:please\s+)?automate\s+(?:this|that|it)?\s*/i, "")
    .replace(/^(?:where|that|to|for|che|per|dove)\s+/i, "");

  cleaned = cleaned
    .replace(
      new RegExp(
        `\\b(?:you\\s+)?wake\\s+up\\s+(?:every|each)\\s+${INTERVAL_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:you\\s+)?run\\s+(?:it|this)?\\s*(?:every|each)\\s+${INTERVAL_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(`\\b(?:every|each)\\s+${INTERVAL_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*`, "i"),
      "",
    )
    .replace(
      new RegExp(
        `^(?:every|each)\\s+${BARE_INTERVAL_UNIT_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*${BARE_INTERVAL_LEADING_REMAINDER_PATTERN}`,
        "i",
      ),
      "",
    )
    .replace(new RegExp(`\\b(?:every|each)\\s+${BARE_INTERVAL_UNIT_PATTERN}$`, "i"), "")
    .replace(new RegExp(`\\bogni\\s+${INTERVAL_PATTERN}\\b\\s*(?:e|poi|per|,)?\\s*`, "i"), "")
    .replace(
      new RegExp(
        `^ogni\\s+${BARE_INTERVAL_UNIT_PATTERN}\\b\\s*(?:e|poi|per|,)?\\s*${BARE_INTERVAL_LEADING_REMAINDER_PATTERN}`,
        "i",
      ),
      "",
    )
    .replace(new RegExp(`\\bogni\\s+${BARE_INTERVAL_UNIT_PATTERN}$`, "i"), "")
    .replace(new RegExp(`\\bin\\s+${INTERVAL_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*`, "i"), "")
    .replace(
      new RegExp(`\\b(?:tra|fra)\\s+${INTERVAL_PATTERN}\\b\\s*(?:e|poi|per|,)?\\s*`, "i"),
      "",
    )
    .replace(
      new RegExp(
        `\\bcron\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:daily|every day)(?:\\s+(?:at|around)\\s+${TIME_PATTERN})?\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:ogni giorno|tutti i giorni)(?:\\s+(?:alle|a)\\s+${TIME_PATTERN})?\\s*(?:e|poi|per|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:weekdays|every weekday|workdays)(?:\\s+at\\s+${TIME_PATTERN})?\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:giorni lavorativi|ogni giorno lavorativo)(?:\\s+(?:alle|a)\\s+${TIME_PATTERN})?\\s*(?:e|poi|per|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\bevery\\s+(?:${WEEKDAY_STRIP_PATTERN})(?:\\s+at\\s+${TIME_PATTERN})?\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\bogni\\s+(?:${WEEKDAY_STRIP_PATTERN})(?:\\s+(?:alle|a)\\s+${TIME_PATTERN})?\\s*(?:e|poi|per|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(/^(?:please)\s+/i, "")
    .replace(/^(?:and|then|to|e|poi|che|di|per)\s+/i, "");

  return normalizeInlineText(cleaned);
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, " ");
}

function truncateName(value: string): string {
  const normalized = normalizeInlineText(value);
  if (normalized.length <= MAX_NAME_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}...`;
}

function sentenceCase(value: string): string {
  const trimmed = normalizeInlineText(value);
  if (!trimmed) {
    return "Chat automation";
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export function deriveAutomationIntentName(prompt: string): string {
  const withoutUrls = stripUrls(prompt);
  const availabilitySubject = withoutUrls.match(
    /\b(?:check|verify|monitor|watch|controlla|verifica|monitora)\s+(?:if|whether|se)?\s*(.+?)\s+(?:is|are|e|available|disponibile|disponibili|in stock)\b/i,
  );
  if (availabilitySubject?.[1]) {
    return truncateName(`Check ${sentenceCase(availabilitySubject[1])} availability`);
  }

  const actionSeed = withoutUrls.replace(
    /^(?:please\s+)?(?:check|verify|monitor|watch|notify|remind|tell me|controlla|verifica|monitora|avvisami|ricordami)\s+(?:me\s+)?/i,
    "",
  );
  return truncateName(sentenceCase(actionSeed));
}

export function parseChatAutomationInvocation(
  invocation: string,
  options: { readonly nowIso?: string } = {},
): ChatAutomationIntent | null {
  const normalizedInvocation = normalizeInlineText(invocation);
  if (!normalizedInvocation) {
    return null;
  }

  const executionScope = extractExecutionScope(normalizedInvocation);
  const scopedInvocation = executionScope?.textWithoutExecutionScope ?? normalizedInvocation;
  const searchText = normalizeSearchText(scopedInvocation);
  const parsedSchedule = parseSchedule(searchText, options.nowIso ?? new Date().toISOString());
  if (!parsedSchedule) {
    return null;
  }

  const iterationLimit = extractIterationLimit(scopedInvocation);
  const prompt = stripAutomationScaffold(
    iterationLimit?.textWithoutIterationLimit ?? scopedInvocation,
  );
  if (!prompt) {
    return null;
  }
  const stopClause = extractStopClause(prompt);
  const taskPrompt = stopClause?.textWithoutStopClause
    ? stripAutomationScaffold(stopClause.textWithoutStopClause)
    : prompt;
  if (!taskPrompt) {
    return null;
  }
  return {
    name: deriveAutomationIntentName(taskPrompt),
    prompt: taskPrompt,
    schedule: parsedSchedule.schedule,
    cadenceLabel: parsedSchedule.cadenceLabel,
    maxIterations: iterationLimit?.maxIterations ?? null,
    completionPolicy: completionPolicyFromStopWhen(stopClause?.stopWhen ?? ""),
    executionScope: executionScope?.executionScope ?? "thread",
  };
}

export function parsePlainChatAutomationInvocation(
  invocation: string,
  options: { readonly nowIso?: string } = {},
): ChatAutomationIntent | null {
  const normalizedInvocation = normalizeInlineText(invocation);
  if (!normalizedInvocation) {
    return null;
  }
  const politeInvocation = stripPlainAutomationPoliteRequest(normalizedInvocation);
  const candidate = politeInvocation ?? normalizedInvocation;
  if (!isLikelyPlainAutomationAction(candidate, politeInvocation !== null)) {
    return null;
  }
  const candidateIsQuestion =
    politeInvocation === null
      ? isLikelyAutomationQuestionCandidate(normalizedInvocation)
      : isLikelyAutomationQuestionCandidate(candidate);
  if (candidateIsQuestion) {
    return null;
  }
  return parseChatAutomationInvocation(candidate, options);
}
