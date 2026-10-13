import type { ProviderFailure } from "@glade/contracts/provider/providerFailure";

import type { MspTurnCompleted, MspTurnRetryScheduled } from "./mspProtocol.ts";

function httpStatusOf(status: number | undefined): number | null {
  return status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

// Classifies a failed turn from MSP's typed error so Glade can offer the right recovery. A failure
// without an error object is a host that died mid-turn.
export function museTurnFailure(completed: MspTurnCompleted): ProviderFailure {
  const { error } = completed;
  const message = error?.message.trim() || completed.reason?.trim() || "The Muse Code turn failed.";
  if (!error) {
    return {
      kind: "connection_lost",
      retry: { state: "none" },
      action: "retry",
      resetsAt: null,
      httpStatus: null,
      message,
    };
  }
  if (error.quota) {
    return {
      kind: "quota_exhausted",
      retry: { state: "none" },
      action: "wait",
      resetsAt: new Date(error.quota.resetsAtMs).toISOString(),
      httpStatus: null,
      message,
    };
  }
  const auth = error.kind === "authRequired";
  return {
    kind: auth ? "auth_required" : error.kind === "configError" ? "bad_request" : "internal",
    retry: { state: "none" },
    action: auth ? "login" : error.retryable ? "retry" : null,
    resetsAt: null,
    httpStatus: null,
    message,
  };
}

// Muse retries a failing model call on its own and reports each attempt before it waits.
export function museRetryFailure(retry: typeof MspTurnRetryScheduled.Type): ProviderFailure {
  const httpStatus = httpStatusOf(retry.httpStatus);
  return {
    kind:
      httpStatus === 429
        ? "rate_limited"
        : httpStatus === 503 || httpStatus === 529
          ? "overloaded"
          : httpStatus === null
            ? "connection_lost"
            : "internal",
    retry: {
      state: "retrying",
      ...(retry.attempt >= 1 ? { attempt: Math.round(retry.attempt) } : {}),
      ...(retry.maxAttempts >= 1 ? { maxAttempts: Math.round(retry.maxAttempts) } : {}),
      retryDelayMs: Math.max(0, Math.round(retry.retryDelayMs)),
    },
    action: null,
    resetsAt: null,
    httpStatus,
    message: retry.reason.trim() || "Muse Code is retrying the model request.",
  };
}
