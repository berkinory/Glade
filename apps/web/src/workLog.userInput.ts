import { Option, Schema } from "effect";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { UserInputRequestedPayload } from "@glade/contracts/provider/runtimePayloads";
import { ProviderUserInputAnswer } from "@glade/contracts/provider/sessionPolicy";
import { pendingRequestInstanceKey } from "@glade/shared/threads/threadSummary";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import type { DerivedWorkLogEntry, WorkLogUserInputExchangeItem } from "./workLog.types";

const decodeRequestedPayload = Schema.decodeUnknownOption(UserInputRequestedPayload);
const decodeAnswer = Schema.decodeUnknownOption(ProviderUserInputAnswer);

function requestInstanceKey(payload: Record<string, unknown> | null): string | null {
  const requestId = payload?.requestId;
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  const generation = payload?.lifecycleGeneration;
  return pendingRequestInstanceKey(
    requestId,
    typeof generation === "string" && generation.length > 0 ? generation : undefined,
  );
}

// Claude's answers are keyed by question text, every other provider's by question id.
function answerText(answers: Record<string, unknown> | null, id: string, question: string) {
  const value = decodeAnswer(answers?.[id] ?? answers?.[question]).pipe(Option.getOrNull);
  const text = (typeof value === "string" ? [value] : (value ?? []))
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(", ");
  return text.length > 0 ? text : null;
}

const exchangeEntryCache = new WeakMap<
  DerivedWorkLogEntry,
  { request: OrchestrationThreadActivity; entry: DerivedWorkLogEntry }
>();

// An answered question becomes one entry at the answer's position carrying the question and the
// answer; its request row is dropped. Requests replay in order so a reused request id never pairs an
// old answer with a newer question.
export function pairAnsweredUserInputs(
  entries: DerivedWorkLogEntry[],
  ordered: ReadonlyArray<OrchestrationThreadActivity>,
): DerivedWorkLogEntry[] {
  if (!entries.some((entry) => entry.activityKind === "user-input.resolved")) return entries;
  const openRequests = new Map<string, OrchestrationThreadActivity>();
  const pairByResolvedId = new Map<
    string,
    { request: OrchestrationThreadActivity; resolved: OrchestrationThreadActivity }
  >();
  for (const activity of ordered) {
    if (activity.kind !== "user-input.requested" && activity.kind !== "user-input.resolved") {
      continue;
    }
    const key = requestInstanceKey(asObjectRecord(activity.payload));
    if (!key) continue;
    if (activity.kind === "user-input.requested") {
      openRequests.set(key, activity);
      continue;
    }
    const request = openRequests.get(key);
    if (request) {
      pairByResolvedId.set(activity.id, { request, resolved: activity });
      openRequests.delete(key);
    }
  }

  const pairedRequestIds = new Set<string>();
  const paired = entries.map((entry) => {
    const pair = pairByResolvedId.get(entry.id);
    if (!pair) return entry;
    const { request, resolved } = pair;
    const cached = exchangeEntryCache.get(entry);
    if (cached?.request === request) {
      pairedRequestIds.add(request.id);
      return cached.entry;
    }
    const questions = decodeRequestedPayload(request.payload).pipe(
      Option.map((payload) => payload.questions),
      Option.getOrNull,
    );
    if (!questions || questions.length === 0) return entry;
    pairedRequestIds.add(request.id);
    const answers = asObjectRecord(asObjectRecord(resolved.payload)?.answers);
    const userInputExchange = questions.map(
      (question): WorkLogUserInputExchangeItem => ({
        id: question.id,
        question: question.question,
        answer: answerText(answers, question.id, question.question),
      }),
    );
    const exchangeEntry: DerivedWorkLogEntry = { ...entry, userInputExchange };
    exchangeEntryCache.set(entry, { request, entry: exchangeEntry });
    return exchangeEntry;
  });
  return paired.filter((entry) => !pairedRequestIds.has(entry.id));
}
