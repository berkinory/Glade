import { type BrowserTabId } from "@glade/contracts/browser/automation/browserAutomationIds";
import {
  BrowserAutomationToolRequest,
  IDEMPOTENCY_TOMBSTONE_TTL_MS,
  IdempotencyEntry,
  MAX_IDEMPOTENCY_ENTRIES,
  MAX_IDEMPOTENCY_TOMBSTONES,
  SessionAffinity,
} from "./automationHostPolicy";
import { type BrowserAutomationHostRuntime } from "./automationHostRuntimeTypes";
import { BrowserAutomationHostError, browserHostError } from "./hostErrors";

export function createAutomationSessionAffinity(
  hostRuntime: Pick<
    BrowserAutomationHostRuntime,
    "idempotency" | "idempotencyTombstones" | "affinities"
  >,
) {
  function trimIdempotencyCache(): void {
    const now = performance.now();
    for (const [key, entry] of hostRuntime.idempotency) {
      if (entry.settled && entry.expiresAt <= now) evictIdempotencyEntry(key, entry, now);
    }
    for (const [key, tombstone] of hostRuntime.idempotencyTombstones) {
      if (tombstone.expiresAt <= now) hostRuntime.idempotencyTombstones.delete(key);
    }
    while (hostRuntime.idempotency.size > MAX_IDEMPOTENCY_ENTRIES) {
      const settled = [...hostRuntime.idempotency].find(([, entry]) => entry.settled);

      if (!settled) break;
      evictIdempotencyEntry(settled[0], settled[1], now);
    }
    while (hostRuntime.idempotencyTombstones.size > MAX_IDEMPOTENCY_TOMBSTONES) {
      hostRuntime.idempotencyTombstones.delete(
        hostRuntime.idempotencyTombstones.keys().next().value as string,
      );
    }
  }

  function evictIdempotencyEntry(key: string, entry: IdempotencyEntry, now: number): void {
    hostRuntime.idempotency.delete(key);
    if (!entry.effecting) return;
    hostRuntime.idempotencyTombstones.delete(key);
    hostRuntime.idempotencyTombstones.set(key, {
      fingerprint: entry.fingerprint,
      expiresAt: now + IDEMPOTENCY_TOMBSTONE_TTL_MS,
    });
  }

  async function reconcileIdempotentReplay(
    _request: BrowserAutomationToolRequest,
    affinity: SessionAffinity,
    result: Promise<unknown>,
  ): Promise<unknown> {
    const output = await result;
    if (output && typeof output === "object" && "tabId" in output) {
      const replayedTabId = (output as { readonly tabId?: unknown }).tabId;
      if (typeof replayedTabId === "string" && affinity.tabId !== replayedTabId) {
        throw new BrowserAutomationHostError({
          code: "BrowserReconciliationRequired",
          tabId: replayedTabId as BrowserTabId,
        });
      }
    }
    return output;
  }

  function bindSession(request: BrowserAutomationToolRequest): SessionAffinity {
    const existing = hostRuntime.affinities.get(request.sessionId);
    if (existing) {
      if (existing.provider !== request.provider) {
        browserHostError({
          code: "BrowserProviderProcessMismatch",
          retryable: false,
          phase: "routing",
          effectMayHaveCommitted: false,
        });
      }
      if (existing.threadId !== request.threadId) {
        browserHostError({
          code: "BrowserTabScopeViolation",
          retryable: false,
          phase: "routing",
          effectMayHaveCommitted: false,
        });
      }
      return existing;
    }
    const affinity: SessionAffinity = {
      provider: request.provider,
      threadId: request.threadId,
      tabId: null,
    };

    hostRuntime.affinities.set(request.sessionId, affinity);
    return affinity;
  }

  return { trimIdempotencyCache, reconcileIdempotentReplay, bindSession };
}
