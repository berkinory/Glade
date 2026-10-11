import { GitHubError } from "../Errors.ts";

export type GitHubResource = "core" | "graphql";
export type GitHubPriority = "foreground" | "background";

interface Quota {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAtMs: number;
}

interface Pause {
  readonly retryAtMs: number;
  readonly attempts: number;
  readonly generation: number;
}

const BACKGROUND_RESERVE_RATIO = 0.1;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;

function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return nowMs + Number(trimmed) * 1000;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readQuota(headers: Headers): Quota | null {
  const limit = Number(headers.get("x-ratelimit-limit"));
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (
    ![limit, remaining, reset].every(Number.isFinite) ||
    headers.get("x-ratelimit-limit") === null
  )
    return null;
  return { limit, remaining, resetAtMs: reset * 1000 };
}

/**
 * GitHub's own counters are the source of truth: nothing is debited locally, so 304s, requests that
 * never reached GitHub and the agent's own `gh` usage on the same token are all accounted for.
 * Scopes are credential fingerprints, never tokens.
 */
export class GitHubRateLimits {
  private readonly quotas = new Map<string, Quota>();
  private readonly pauses = new Map<string, Pause>();
  private generation = 0;

  constructor(private readonly now: () => number = Date.now) {}

  observe(scope: string, resource: GitHubResource, headers: Headers): void {
    const quota = readQuota(headers);
    if (!quota) return;
    const key = `${scope}\u0000${headers.get("x-ratelimit-resource") ?? resource}`;
    const previous = this.quotas.get(key);
    // Several regions answer for GitHub, so a later reply may report more remaining; only a reply from
    // an older reset window is stale.
    if (previous && quota.resetAtMs < previous.resetAtMs) return;
    this.quotas.set(key, quota);
  }

  admit(scope: string, resource: GitHubResource, priority: GitHubPriority): GitHubError | null {
    const nowMs = this.now();
    const pause = this.pauses.get(scope);
    if (pause && pause.retryAtMs > nowMs && priority === "background") {
      return this.pausedError(pause.retryAtMs);
    }
    const quota = this.quotas.get(`${scope}\u0000${resource}`);
    if (!quota || quota.resetAtMs <= nowMs) return null;
    if (quota.remaining <= 0) return this.pausedError(quota.resetAtMs);
    if (priority === "background" && quota.remaining < quota.limit * BACKGROUND_RESERVE_RATIO) {
      return this.pausedError(quota.resetAtMs);
    }
    return null;
  }

  /** Returns a lease that `succeeded` uses so a stale success cannot clear a newer pause. */
  pause(scope: string, headers: Headers | null): { retryAtMs: number; generation: number } {
    const nowMs = this.now();
    const previous = this.pauses.get(scope);
    const attempts = Math.min((previous?.attempts ?? 0) + 1, 6);
    const supplied =
      parseRetryAfterMs(headers?.get("retry-after") ?? null, nowMs) ??
      (headers?.get("x-ratelimit-reset") ? Number(headers.get("x-ratelimit-reset")) * 1000 : null);
    const retryAtMs =
      supplied !== null && Number.isFinite(supplied) && supplied > nowMs
        ? supplied
        : nowMs + Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
    const generation = ++this.generation;
    this.pauses.set(scope, {
      retryAtMs: Math.max(previous?.retryAtMs ?? 0, retryAtMs),
      attempts,
      generation,
    });
    return { retryAtMs, generation };
  }

  lease(scope: string): number {
    return this.pauses.get(scope)?.generation ?? 0;
  }

  succeeded(scope: string, leaseAtStart: number): void {
    const pause = this.pauses.get(scope);
    if (pause && pause.generation === leaseAtStart && pause.retryAtMs <= this.now()) {
      this.pauses.delete(scope);
    }
  }

  private pausedError(retryAtMs: number): GitHubError {
    return new GitHubError({
      operation: "request",
      reason: "rate-limited",
      retryAt: retryAtMs,
      detail: `GitHub requests are paused until ${new Date(retryAtMs).toISOString()} to stay within the rate limit.`,
    });
  }
}

export function isGitHubRateLimitMessage(message: string): boolean {
  return /(?:api |secondary )?rate limit (?:already )?(?:exceeded|reached)|secondary rate limit|abuse detection|http 429|429 too many requests/i.test(
    message,
  );
}
