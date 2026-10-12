import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { pendingRequestInstanceKey } from "@glade/shared/threads/threadSummary";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import type { PendingUserInput } from "../../pendingInteractionDerivation";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { PendingUserInputRecoveryDraft } from "../../pendingUserInputRecovery";

type Answers = Record<string, Record<string, PendingUserInputDraftAnswer>>;
const EMPTY_DRAFTS: Record<string, PendingUserInputRecoveryDraft> = {};

function draftAnswers(drafts: Record<string, PendingUserInputRecoveryDraft>): Answers {
  return Object.fromEntries(Object.entries(drafts).map(([key, draft]) => [key, draft.answers]));
}

export function usePendingUserInputDrafts(
  threadId: ThreadId,
  requests: ReadonlyArray<PendingUserInput>,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
) {
  const drafts = useComposerThreadDraft(threadId).pendingUserInputDrafts ?? EMPTY_DRAFTS;
  const answers = useMemo(() => draftAnswers(drafts), [drafts]);
  const answersRef = useRef<Answers>(answers);
  const requestsRef = useRef(requests);
  useLayoutEffect(() => {
    answersRef.current = answers;
    requestsRef.current = requests;
  }, [answers, requests, threadId]);

  const setAnswers = useCallback(
    (update: (existing: Answers) => Answers) => {
      const store = useComposerDraftStore.getState();
      const existing = store.draftsByThreadId[threadId]?.pendingUserInputDrafts ?? EMPTY_DRAFTS;
      const nextAnswers = update(draftAnswers(existing));
      const nextDrafts = { ...existing };
      for (const [key, requestAnswers] of Object.entries(nextAnswers)) {
        const request =
          existing[key]?.request ??
          requestsRef.current.find(
            (entry) =>
              pendingRequestInstanceKey(entry.requestId, entry.lifecycleGeneration) === key,
          );
        if (request) nextDrafts[key] = { request, answers: requestAnswers };
      }
      answersRef.current = nextAnswers;
      store.setPendingUserInputDrafts(threadId, nextDrafts);
    },
    [threadId],
  );

  // Only a provider resolution proves the answer was delivered. A terminal row can also mean the
  // callback went stale, and that draft must survive so the answer can be restored.
  useEffect(() => {
    if (Object.keys(drafts).length === 0) return;
    const resolvedInstances = new Set<string>();
    const legacyResolvedAt = new Map<string, string>();
    for (const activity of activities) {
      if (activity.kind !== "user-input.resolved") continue;
      const payload = asObjectRecord(activity.payload);
      if (typeof payload?.requestId !== "string") continue;
      const generation = payload.lifecycleGeneration;
      if (typeof generation === "string" && generation.length > 0) {
        resolvedInstances.add(pendingRequestInstanceKey(payload.requestId, generation));
      } else if (activity.createdAt > (legacyResolvedAt.get(payload.requestId) ?? "")) {
        legacyResolvedAt.set(payload.requestId, activity.createdAt);
      }
    }
    const confirmed = new Set(
      Object.entries(drafts)
        .filter(
          ([key, draft]) =>
            resolvedInstances.has(key) ||
            (legacyResolvedAt.get(draft.request.requestId) ?? "") >= draft.request.createdAt,
        )
        .map(([key]) => key),
    );
    if (confirmed.size === 0) return;
    useComposerDraftStore
      .getState()
      .setPendingUserInputDrafts(
        threadId,
        Object.fromEntries(Object.entries(drafts).filter(([key]) => !confirmed.has(key))),
      );
  }, [activities, drafts, threadId]);

  return { answers, answersRef, setAnswers, drafts };
}
