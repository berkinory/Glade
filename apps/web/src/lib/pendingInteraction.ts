const STALE_PENDING_REQUEST_FAILURE_PHRASES = [
  "stale pending approval request",
  "stale pending user-input request",
  "unknown pending approval request",
  "unknown pending permission request",
  "unknown pending user-input request",
] as const;

export function isStalePendingRequestFailureDetail(detail: unknown): boolean {
  if (typeof detail !== "string") {
    return false;
  }
  const normalized = detail.toLowerCase();
  return STALE_PENDING_REQUEST_FAILURE_PHRASES.some((phrase) => normalized.includes(phrase));
}
