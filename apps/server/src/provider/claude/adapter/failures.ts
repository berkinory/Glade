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
