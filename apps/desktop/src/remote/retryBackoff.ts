export interface RetryPolicy {
  readonly baseMs: number;
  readonly maxMs: number;
}

// Exponential backoff with jitter: a machine that stays away is asked less and less often, and
// machines that drop together (a network change, a wake) do not retry in lockstep.
export function retryDelayMs(attempt: number, policy: RetryPolicy): number {
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** attempt);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}
