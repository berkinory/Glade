import type { SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderFailure } from "@glade/contracts/provider/providerFailure";
import { claudeAssistantErrorMessage } from "./streamErrors.ts";

export function claudeAssistantFailure(
  code: SDKAssistantMessageError,
  usageLimitResetsAt: string | undefined,
): ProviderFailure {
  const classification = (() => {
    switch (code) {
      case "authentication_failed":
        return { kind: "auth_required", action: "login" } as const;
      case "oauth_org_not_allowed":
      case "account_on_hold":
      case "verification_required":
      case "billing_error":
      case "cloud_credential_error":
        return { kind: "access_denied", action: null } as const;
      case "rate_limit":
        return { kind: "rate_limited", action: "wait" } as const;
      case "overloaded":
        return { kind: "overloaded", action: "retry" } as const;
      case "invalid_request":
        return { kind: "bad_request", action: null } as const;
      case "model_not_found":
        return { kind: "model_unavailable", action: "choose_model" } as const;
      case "server_error":
        return { kind: "internal", action: "retry" } as const;
      case "max_output_tokens":
      case "unknown":
        return { kind: "internal", action: null } as const;
    }
  })();
  return {
    ...classification,
    retry: { state: "none" },
    resetsAt: code === "rate_limit" ? (usageLimitResetsAt ?? null) : null,
    httpStatus: null,
    message: claudeAssistantErrorMessage(code),
  };
}

// The SDK retries a failed API request on its own and reports each attempt before it waits.
export function claudeRequestRetryFailure(
  retry: {
    readonly attempt: number;
    readonly maxRetries: number;
    readonly retryDelayMs: number;
    readonly httpStatus: number | null;
  },
  message: string,
): ProviderFailure {
  const { httpStatus } = retry;
  return {
    kind:
      httpStatus === null
        ? "connection_lost"
        : httpStatus === 429
          ? "rate_limited"
          : httpStatus === 503 || httpStatus === 529
            ? "overloaded"
            : "internal",
    retry: {
      state: "retrying",
      ...(retry.attempt >= 1 ? { attempt: Math.round(retry.attempt) } : {}),
      ...(retry.maxRetries >= 1 ? { maxAttempts: Math.round(retry.maxRetries) } : {}),
      retryDelayMs: Math.max(0, Math.round(retry.retryDelayMs)),
    },
    action: null,
    resetsAt: null,
    httpStatus,
    message,
  };
}
