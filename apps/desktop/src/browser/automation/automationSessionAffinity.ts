import { type BrowserTabId } from "@glade/contracts/browser/automation/browserAutomationIds";
import {
  BrowserAutomationToolRequest,
  IDEMPOTENCY_TOMBSTONE_TTL_MS,
  IDEMPOTENCY_TTL_MS,
  IdempotencyEntry,
  IdempotencyTombstone,
  MAX_IDEMPOTENCY_ENTRIES,
  MAX_IDEMPOTENCY_TOMBSTONES,
  SessionAffinity,
} from "./automationHostPolicy";
import { BrowserAutomationHostError, browserHostError } from "./hostErrors";

export class AutomationSessionRegistry {
  private readonly affinities = new Map<string, SessionAffinity>();
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly idempotencyTombstones = new Map<string, IdempotencyTombstone>();

  trimIdempotencyCache(): void {
    const now = performance.now();
    for (const [key, entry] of this.idempotency) {
      if (entry.settled && entry.expiresAt <= now) this.evictIdempotencyEntry(key, entry, now);
    }
    for (const [key, tombstone] of this.idempotencyTombstones) {
      if (tombstone.expiresAt <= now) this.idempotencyTombstones.delete(key);
    }
    while (this.idempotency.size > MAX_IDEMPOTENCY_ENTRIES) {
      const settled = [...this.idempotency].find(([, entry]) => entry.settled);
      if (!settled) break;
      this.evictIdempotencyEntry(settled[0], settled[1], now);
    }
    while (this.idempotencyTombstones.size > MAX_IDEMPOTENCY_TOMBSTONES) {
      this.idempotencyTombstones.delete(this.idempotencyTombstones.keys().next().value as string);
    }
  }

  private evictIdempotencyEntry(key: string, entry: IdempotencyEntry, now: number): void {
    this.idempotency.delete(key);
    if (!entry.effecting) return;
    this.idempotencyTombstones.delete(key);
    this.idempotencyTombstones.set(key, {
      fingerprint: entry.fingerprint,
      expiresAt: now + IDEMPOTENCY_TOMBSTONE_TTL_MS,
    });
  }

  async reconcileIdempotentReplay(
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

  bindSession(request: BrowserAutomationToolRequest): SessionAffinity {
    const existing = this.affinities.get(request.sessionId);
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
    this.affinities.set(request.sessionId, affinity);
    return affinity;
  }

  runIdempotent(
    cacheKey: string,
    fingerprint: string,
    effecting: boolean,
    affinity: SessionAffinity,
    run: () => Promise<unknown>,
  ): Promise<unknown> {
    this.trimIdempotencyCache();
    const existing = this.idempotency.get(cacheKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        browserHostError({
          code: "BrowserRequestConflict",
          retryable: false,
          phase: "queue",
          effectMayHaveCommitted: false,
        });
      }
      this.idempotency.delete(cacheKey);
      this.idempotency.set(cacheKey, existing);
      return this.reconcileIdempotentReplay(affinity, existing.result);
    }
    const tombstone = this.idempotencyTombstones.get(cacheKey);
    if (tombstone) {
      if (tombstone.fingerprint !== fingerprint) {
        browserHostError({
          code: "BrowserRequestConflict",
          retryable: false,
          phase: "queue",
          effectMayHaveCommitted: false,
        });
      }
      browserHostError({ code: "BrowserAmbiguousResult" });
    }
    const operation = run();
    const entry: IdempotencyEntry = {
      fingerprint,
      result: operation,
      settled: false,
      expiresAt: Number.POSITIVE_INFINITY,
      effecting,
    };
    this.idempotency.set(cacheKey, entry);
    void operation.then(
      () => {
        entry.settled = true;
        entry.expiresAt = performance.now() + IDEMPOTENCY_TTL_MS;
        this.trimIdempotencyCache();
      },
      (error: unknown) => {
        entry.settled = true;
        entry.expiresAt = performance.now() + IDEMPOTENCY_TTL_MS;
        // A confirmed pre-effect failure can be retried without repeating a committed action.
        if (
          error instanceof BrowserAutomationHostError &&
          !error.browserError.effectMayHaveCommitted &&
          this.idempotency.get(cacheKey) === entry
        ) {
          this.idempotency.delete(cacheKey);
        }
        this.trimIdempotencyCache();
      },
    );
    this.trimIdempotencyCache();
    return operation;
  }
}
